import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  inject,
  OnInit,
  OnDestroy
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { AuthService } from '../../../services/auth.service';
import { SupabaseService } from '../../../services/supabase.service';
import { IonIcon, IonModal } from "@ionic/angular";

type AttendanceStatus =
  | 'pending'
  | 'verified'
  | 'incomplete'
  | 'rejected'
  | 'unknown';

interface Intern {
  id: string;
  name: string;
  initials: string;
  department: string;
  avatarColor: string;
}

interface AttendanceRecord {
  id: string;
  studentId: string;
  studentName: string;
  initials: string;
  avatarColor: string;
  attendanceDate: string;
  date: string;
  day: string;
  timeIn: string;
  timeOut: string;
  duration: string;
  status: AttendanceStatus;
  statusLabel: string;
}

@Component({
  selector: 'app-attendance-review',
  standalone: true,
  imports: [IonModal, IonIcon, CommonModule, FormsModule],
  templateUrl: './attendance-review.page.html',
  styleUrls: ['./attendance-review.page.scss']
})
export class AttendanceReviewPage implements OnInit, OnDestroy {

  private readonly supabaseService = inject(SupabaseService);
  private readonly supabase = this.supabaseService.getClient();
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);

  private loadVersion = 0;

  interns: Intern[] = [];
  attendanceRecords: AttendanceRecord[] = [];

  loading = true;
  loadError = '';

  searchQuery = '';
  selectedStudent = 'all';
  selectedStatus = 'all';

  dateFrom = '';
  dateTo = '';

  currentPage = 1;
  readonly pageSize = 8;

  ngOnInit(): void {
    this.initializeDates();
    void this.loadData();
  }

  ngOnDestroy(): void {
    this.loadVersion++;
  }

  // ==========================================
  // DEFAULT DATE RANGE
  // ==========================================

  private initializeDates(): void {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());

    const year = today.find(p => p.type === 'year')?.value;
    const month = today.find(p => p.type === 'month')?.value;
    const day = today.find(p => p.type === 'day')?.value;

    this.dateTo = `${year}-${month}-${day}`;

    const start = new Date(`${this.dateTo}T00:00:00Z`);

    start.setUTCDate(start.getUTCDate() - 7);

    this.dateFrom = start.toISOString().slice(0, 10);
  }

  // ==========================================
  // REQUEST VALIDATION
  // ==========================================

  private isCurrentRequest(
    version: number,
    userId: string
  ): boolean {

    return (
      version === this.loadVersion &&
      this.authService.getCurrentUser()?.id === userId
    );
  }

  // ==========================================
  // LOAD ATTENDANCE DATA
  // ==========================================

  async loadData(): Promise<void> {

    const version = ++this.loadVersion;

    this.loading = true;
    this.loadError = '';
    this.interns = [];
    this.attendanceRecords = [];
    this.currentPage = 1;

    this.cdr.markForCheck();

    try {

      const userId =
        this.authService.getCurrentUser()?.id;

      if (!userId) {
        throw new Error('No authenticated user found.');
      }

      // Get the supervisor profile.

      const {
        data: supervisor,
        error: supervisorError
      } = await this.supabase
        .from('company_supervisors')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (supervisorError) {
        throw supervisorError;
      }

      if (!supervisor) {
        throw new Error('Supervisor profile not found.');
      }

      if (!this.isCurrentRequest(version, userId)) {
        return;
      }

      // Get all actively assigned interns.

      const internMap = new Map<string, Intern>();

      const batchSize = 500;

      let assignmentOffset = 0;

      while (true) {

        const {
          data: assignments,
          error: assignmentError,
          count
        } = await this.supabase

          .from('intern_supervisor_assignments')

          .select(`
            student_id,
            students!student_id(
              id,
              student_id,
              full_name,
              department
            )
          `, { count: 'exact' })

          .eq('supervisor_id', supervisor.id)

          .eq('assignment_status', 'active')

          .order('student_id', {
            ascending: true
          })

          .range(
            assignmentOffset,
            assignmentOffset + batchSize - 1
          );

        if (assignmentError) {
          throw assignmentError;
        }

        if (!this.isCurrentRequest(version, userId)) {
          return;
        }

        const batch = assignments || [];

        for (const assignment of batch) {

          const student = Array.isArray(assignment.students)
            ? assignment.students[0]
            : assignment.students;

          if (!student?.student_id) {
            continue;
          }

          const id = student.student_id;

          const name = student.full_name || 'Unknown student';

          internMap.set(id, {
            id,
            name,
            initials: this.getInitials(name),
            department: student.department || 'Not provided',
            avatarColor: this.getAvatarColor(id)
          });
        }

        assignmentOffset += batch.length;

        if (
          batch.length === 0 ||
          (count !== null && assignmentOffset >= count) ||
          (count === null && batch.length < batchSize)
        ) {
          break;
        }
      }

      const assignedInterns = Array.from(
        internMap.values()
      ).sort((a, b) =>
        a.name.localeCompare(b.name)
      );

      if (assignedInterns.length === 0) {

        this.interns = [];

        return;
      }

      // Retrieve synchronized attendance records.
      // Student IDs are text school IDs, not UUIDs.

      const studentIds = assignedInterns.map(
        intern => intern.id
      );

      const records = new Map<string, AttendanceRecord>();

      const studentBatchSize = 50;

      for (
        let index = 0;
        index < studentIds.length;
        index += studentBatchSize
      ) {

        const studentBatch = studentIds.slice(
          index,
          index + studentBatchSize
        );

        let offset = 0;

        while (true) {

          if (!this.isCurrentRequest(version, userId)) {
            return;
          }

          const {
            data: attendance,
            error: attendanceError,
            count
          } = await this.supabase

            .from('attendance')

            .select(`
              id,
              student_id,
              attendance_date,
              time_in,
              time_out,
              verification_status
            `, { count: 'exact' })

            .in('student_id', studentBatch)

            .eq('sync_status', 'synced')

            .order('attendance_date', {
              ascending: false
            })

            .order('id', {
              ascending: true
            })

            .range(
              offset,
              offset + batchSize - 1
            );

          if (attendanceError) {
            throw attendanceError;
          }

          if (!this.isCurrentRequest(version, userId)) {
            return;
          }

          const batch = attendance || [];

          for (const record of batch) {

            const intern = internMap.get(record.student_id);

            if (!intern) {
              continue;
            }

            const status = this.getAttendanceStatus(
              record.verification_status,
              record.time_in,
              record.time_out
            );

            records.set(record.id, {

              id: record.id,

              studentId: intern.id,

              studentName: intern.name,

              initials: intern.initials,

              avatarColor: intern.avatarColor,

              attendanceDate: record.attendance_date,

              date: this.formatDate(
                record.attendance_date
              ),

              day: this.formatDay(
                record.attendance_date
              ),

              timeIn: this.formatTime(
                record.time_in
              ),

              timeOut: this.formatTime(
                record.time_out
              ),

              duration: this.calculateDuration(
                record.time_in,
                record.time_out
              ),

              status,

              statusLabel: this.getStatusLabel(status)

            });
          }

          offset += batch.length;

          if (
            batch.length === 0 ||
            (count !== null && offset >= count) ||
            (count === null && batch.length < batchSize)
          ) {
            break;
          }
        }
      }

      if (!this.isCurrentRequest(version, userId)) {
        return;
      }

      this.interns = assignedInterns;

      this.attendanceRecords = Array.from(
        records.values()
      ).sort((a, b) => {

        const dateComparison =
          b.attendanceDate.localeCompare(a.attendanceDate);

        if (dateComparison !== 0) {
          return dateComparison;
        }

        return a.studentName.localeCompare(b.studentName);
      });

      if (
        this.selectedStudent !== 'all' &&
        !this.interns.some(
          intern => intern.id === this.selectedStudent
        )
      ) {
        this.selectedStudent = 'all';
      }

    } catch (error) {

      if (version !== this.loadVersion) {
        return;
      }

      console.error('Error loading attendance:', error);

      this.interns = [];
      this.attendanceRecords = [];

      this.loadError =
        'We could not retrieve the attendance records. Please try again.';

    } finally {

      if (version === this.loadVersion) {

        this.loading = false;

        this.cdr.markForCheck();
      }
    }
  }

  // ==========================================
  // ATTENDANCE STATUS
  // ==========================================

  private getAttendanceStatus(
    verificationStatus: string | null,
    timeIn: string | null,
    timeOut: string | null
  ): AttendanceStatus {

    if (verificationStatus === 'rejected') {
      return 'rejected';
    }

    if (
      !timeIn ||
      !timeOut ||
      !Number.isFinite(Date.parse(timeIn)) ||
      !Number.isFinite(Date.parse(timeOut)) ||
      Date.parse(timeOut) < Date.parse(timeIn)
    ) {
      return 'incomplete';
    }

    if (verificationStatus === 'verified') {
      return 'verified';
    }

    if (verificationStatus === 'provisional') {
      return 'pending';
    }

    return 'unknown';
  }

  private getStatusLabel(
    status: AttendanceStatus
  ): string {

    const labels: Record<AttendanceStatus, string> = {
      pending: 'Pending',
      verified: 'Verified',
      incomplete: 'Incomplete',
      rejected: 'Rejected',
      unknown: 'Unknown'
    };

    return labels[status];
  }

  // ==========================================
  // FORMATTING
  // ==========================================

  private getInitials(name: string): string {

    const parts = name.trim().split(/\s+/);

    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }

    return (
      parts[0][0] +
      parts[parts.length - 1][0]
    ).toUpperCase();
  }

  private getAvatarColor(studentId: string): string {

    const colors = [
      'blue',
      'orange',
      'slate',
      'green',
      'purple'
    ];

    let hash = 0;

    for (const character of studentId) {
      hash = (hash * 31 + character.charCodeAt(0)) | 0;
    }

    return colors[Math.abs(hash) % colors.length];
  }

  private formatDate(date: string): string {

    if (!date) {
      return '—';
    }

    const value = new Date(`${date}T00:00:00Z`);

    if (!Number.isFinite(value.getTime())) {
      return '—';
    }

    return value.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC'
    });
  }

  private formatDay(date: string): string {

    if (!date) {
      return '—';
    }

    const value = new Date(`${date}T00:00:00Z`);

    if (!Number.isFinite(value.getTime())) {
      return '—';
    }

    return value.toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: 'UTC'
    });
  }

  private formatTime(value: string | null): string {

    if (!value) {
      return '—';
    }

    const date = new Date(value);

    if (!Number.isFinite(date.getTime())) {
      return '—';
    }

    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Manila'
    });
  }

  private calculateDuration(
    timeIn: string | null,
    timeOut: string | null
  ): string {

    if (!timeIn || !timeOut) {
      return '—';
    }

    const milliseconds =
      Date.parse(timeOut) - Date.parse(timeIn);

    if (
      !Number.isFinite(milliseconds) ||
      milliseconds < 0
    ) {
      return '—';
    }

    const totalMinutes = Math.floor(
      milliseconds / 60000
    );

    const hours = Math.floor(totalMinutes / 60);

    const minutes = totalMinutes % 60;

    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }

  // ==========================================
  // SUMMARY COUNTERS
  // ==========================================

  get pendingCount(): number {

    return this.attendanceRecords.filter(
      record => record.status === 'pending'
    ).length;
  }

  get incompleteCount(): number {

    return this.attendanceRecords.filter(
      record => record.status === 'incomplete'
    ).length;
  }

  // ==========================================
  // FILTERING
  // ==========================================

  get invalidDateRange(): boolean {

    return !!(
      this.dateFrom &&
      this.dateTo &&
      this.dateFrom > this.dateTo
    );
  }

  get filteredAttendance(): AttendanceRecord[] {

    if (this.invalidDateRange) {
      return [];
    }

    const search = this.searchQuery.trim().toLowerCase();

    return this.attendanceRecords.filter(record => {

      const matchesSearch =
        !search ||
        record.studentName.toLowerCase().includes(search) ||
        record.studentId.toLowerCase().includes(search);

      const matchesStudent =
        this.selectedStudent === 'all' ||
        record.studentId === this.selectedStudent;

      const matchesStatus =
        this.selectedStatus === 'all' ||
        record.status === this.selectedStatus;

      const matchesStartDate =
        !this.dateFrom ||
        record.attendanceDate >= this.dateFrom;

      const matchesEndDate =
        !this.dateTo ||
        record.attendanceDate <= this.dateTo;

      return (
        matchesSearch &&
        matchesStudent &&
        matchesStatus &&
        matchesStartDate &&
        matchesEndDate
      );
    });
  }

  onFilterChange(): void {

    this.currentPage = 1;
  }

  clearFilters(): void {

    this.searchQuery = '';
    this.selectedStudent = 'all';
    this.selectedStatus = 'all';

    this.dateFrom = '';
    this.dateTo = '';

    this.currentPage = 1;
  }

  // ==========================================
  // PAGINATION
  // ==========================================

  get totalRecords(): number {

    return this.filteredAttendance.length;
  }

  get totalPages(): number {

    return Math.max(
      1,
      Math.ceil(this.totalRecords / this.pageSize)
    );
  }

  get paginatedAttendance(): AttendanceRecord[] {

    const start =
      (this.currentPage - 1) * this.pageSize;

    return this.filteredAttendance.slice(
      start,
      start + this.pageSize
    );
  }

  get pageNumbers(): number[] {

    const visiblePages = 5;

    const start = Math.max(
      1,
      Math.min(
        this.currentPage - 2,
        this.totalPages - visiblePages + 1
      )
    );

    const end = Math.min(
      this.totalPages,
      start + visiblePages - 1
    );

    return Array.from(
      { length: end - start + 1 },
      (_, index) => start + index
    );
  }

  get firstRecord(): number {

    return this.totalRecords === 0
      ? 0
      : (this.currentPage - 1) * this.pageSize + 1;
  }

  get lastRecord(): number {

    return Math.min(
      this.currentPage * this.pageSize,
      this.totalRecords
    );
  }

  goToPage(page: number): void {

    if (page < 1 || page > this.totalPages) {
      return;
    }

    this.currentPage = page;
  }

  // ==========================================
  // ATTENDANCE DETAILS NAVIGATION
  // ==========================================

  openAttendanceDetails(
    record: AttendanceRecord
  ): void {

    void this.router.navigate([
      '/supervisor',
      'attendance',
      record.id
    ]);
  }
}