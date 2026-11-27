
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

import { IonIcon, IonModal } from '@ionic/angular';

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
  imports: [
    IonModal,
    IonIcon,
    CommonModule,
    FormsModule
  ],
  templateUrl: './attendance-review.page.html',
  styleUrls: ['./attendance-review.page.scss']
})

export class AttendanceReviewPage implements OnInit, OnDestroy {

  private readonly supabaseService = inject(SupabaseService);

  private readonly supabase =
    this.supabaseService.getClient();

  private readonly authService = inject(AuthService);

  private readonly router = inject(Router);

  private readonly cdr = inject(ChangeDetectorRef);

  private loadVersion = 0;

  private destroyed = false;

  private loadedUserId = '';

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
    this.destroyed = true;
    this.loadVersion++;
    this.clearLoadedData();
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

    const year = today.find(
      p => p.type === 'year'
    )?.value;

    const month = today.find(
      p => p.type === 'month'
    )?.value;

    const day = today.find(
      p => p.type === 'day'
    )?.value;

    this.dateTo = `${year}-${month}-${day}`;

    const start = new Date(
      `${this.dateTo}T00:00:00Z`
    );

    start.setUTCDate(
      start.getUTCDate() - 7
    );

    this.dateFrom =
      start.toISOString().slice(0, 10);
  }

  // ==========================================
  // SESSION AND REQUEST VALIDATION
  // ==========================================

  private hasValidSupervisorSession(
    userId: string
  ): boolean {

    return (
      !this.destroyed &&
      !!userId &&
      this.authService.getCurrentUser()?.id === userId &&
      this.authService.getUserRole() === 'company_supervisor' &&
      this.authService.isOnline()
    );
  }

  private isCurrentRequest(
    version: number,
    userId: string
  ): boolean {

    return (
      version === this.loadVersion &&
      this.hasValidSupervisorSession(userId)
    );
  }

  private ensureCurrentRequest(
    version: number,
    userId: string
  ): void {

    if (!this.isCurrentRequest(version, userId)) {
      throw new Error(
        'The supervisor session or request changed.'
      );
    }
  }

  private get hasValidLoadedSession(): boolean {

    return (
      !this.loading &&
      !this.loadError &&
      !!this.loadedUserId &&
      this.hasValidSupervisorSession(
        this.loadedUserId
      )
    );
  }

  private clearLoadedData(): void {

    this.loadedUserId = '';

    this.interns = [];

    this.attendanceRecords = [];

    this.currentPage = 1;
  }

  // ==========================================
  // ACTIVE SUPERVISOR VALIDATION
  // ==========================================

  private async getActiveSupervisorId(
    userId: string
  ): Promise<string> {

    if (!this.hasValidSupervisorSession(userId)) {
      throw new Error(
        'An active online supervisor session is required.'
      );
    }

    const {
      data: supervisor,
      error
    } = await this.supabase
      .from('company_supervisors')
      .select('id')
      .eq('user_id', userId)
      .eq('account_status', 'active')
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!supervisor?.id) {
      throw new Error(
        'Active supervisor profile unavailable.'
      );
    }

    if (!this.hasValidSupervisorSession(userId)) {
      throw new Error(
        'The supervisor session changed.'
      );
    }

    return supervisor.id;
  }

  // ==========================================
  // RETRIEVE ACTIVE INTERN ASSIGNMENTS
  // ==========================================

  private async fetchAssignedInterns(
    supervisorId: string,
    version: number,
    userId: string
  ): Promise<{
    interns: Intern[];
    assignmentKeys: string[];
  }> {

    const internMap = new Map<string, Intern>();

    const assignmentIds = new Set<string>();

    const assignmentKeys: string[] = [];

    const batchSize = 500;

    let offset = 0;

    let expectedCount: number | null = null;

    while (true) {

      this.ensureCurrentRequest(
        version,
        userId
      );

      const {
        data: assignments,
        error,
        count
      } = await this.supabase
        .from('intern_supervisor_assignments')
        .select(`
          id,
          student_id,
          students!student_id(
            id,
            student_id,
            full_name,
            department
          )
        `, {
          count: 'exact'
        })
        .eq('supervisor_id', supervisorId)
        .eq('assignment_status', 'active')
        .order('student_id', {
          ascending: true
        })
        .order('id', {
          ascending: true
        })
        .range(
          offset,
          offset + batchSize - 1
        );

      this.ensureCurrentRequest(
        version,
        userId
      );

      if (error) {
        throw error;
      }

      if (
        count === null ||
        (
          expectedCount !== null &&
          expectedCount !== count
        )
      ) {
        throw new Error(
          'Intern assignments changed during retrieval.'
        );
      }

      expectedCount = count;

      const batch = assignments || [];

      for (const assignment of batch) {

        if (
          !assignment.id ||
          assignmentIds.has(assignment.id)
        ) {
          throw new Error(
            'Duplicate or invalid intern assignment detected.'
          );
        }

        assignmentIds.add(assignment.id);

        const student = Array.isArray(
          assignment.students
        )
          ? assignment.students[0]
          : assignment.students;

        if (
          !student?.student_id ||
          student.id !== assignment.student_id
        ) {
          throw new Error(
            'An assigned student could not be retrieved.'
          );
        }

        const id = student.student_id;

        if (internMap.has(id)) {
          throw new Error(
            'Duplicate active student assignment detected.'
          );
        }

        const name =
          student.full_name || 'Unknown student';

        internMap.set(id, {
          id,
          name,
          initials: this.getInitials(name),
          department:
            student.department || 'Not provided',
          avatarColor: this.getAvatarColor(id)
        });

        assignmentKeys.push(
          JSON.stringify([
            assignment.id,
            assignment.student_id,
            id
          ])
        );
      }

      offset += batch.length;

      if (offset > expectedCount) {
        throw new Error(
          'Intern assignment retrieval was inconsistent.'
        );
      }

      if (offset === expectedCount) {
        break;
      }

      if (batch.length === 0) {
        throw new Error(
          'Intern assignment retrieval was incomplete.'
        );
      }
    }

    if (
      assignmentIds.size !== expectedCount ||
      internMap.size !== expectedCount
    ) {
      throw new Error(
        'Intern assignment retrieval was incomplete.'
      );
    }

    return {
      interns: Array.from(
        internMap.values()
      ).sort((a, b) =>
        a.name.localeCompare(b.name)
      ),

      assignmentKeys: assignmentKeys.sort()
    };
  }

  // ==========================================
  // LOAD ATTENDANCE DATA
  // ==========================================

  async loadData(): Promise<void> {

    if (this.destroyed) {
      return;
    }

    const version = ++this.loadVersion;

    this.loading = true;

    this.loadError = '';

    this.clearLoadedData();

    this.cdr.markForCheck();

    try {

      const userId =
        this.authService.getCurrentUser()?.id;

      if (
        !userId ||
        !this.hasValidSupervisorSession(userId)
      ) {
        throw new Error(
          'An active online supervisor session is required.'
        );
      }

      // Validate the active supervisor profile.

      const supervisorId =
        await this.getActiveSupervisorId(userId);

      this.ensureCurrentRequest(
        version,
        userId
      );

      // Retrieve all active intern assignments.

      const initialAssignments =
        await this.fetchAssignedInterns(
          supervisorId,
          version,
          userId
        );

      const assignedInterns =
        initialAssignments.interns;

      const internMap = new Map(
        assignedInterns.map(intern => [
          intern.id,
          intern
        ])
      );

      const studentIds = assignedInterns.map(
        intern => intern.id
      );

      const records =
        new Map<string, AttendanceRecord>();

      const attendanceKeys = new Set<string>();

      const batchSize = 500;

      const studentBatchSize = 50;

      // Retrieve synchronized attendance only.

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

        let expectedCount: number | null = null;

        while (true) {

          this.ensureCurrentRequest(
            version,
            userId
          );

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
            `, {
              count: 'exact'
            })
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

          this.ensureCurrentRequest(
            version,
            userId
          );

          if (attendanceError) {
            throw attendanceError;
          }

          if (
            count === null ||
            (
              expectedCount !== null &&
              expectedCount !== count
            )
          ) {
            throw new Error(
              'Attendance records changed during retrieval.'
            );
          }

          expectedCount = count;

          const batch = attendance || [];

          for (const record of batch) {

            const intern = internMap.get(
              record.student_id
            );

            if (
              !intern ||
              !studentBatch.includes(
                record.student_id
              )
            ) {
              throw new Error(
                'An unauthorized attendance record was detected.'
              );
            }

            if (
              !record.id ||
              records.has(record.id)
            ) {
              throw new Error(
                'Duplicate or invalid attendance record detected.'
              );
            }

            if (
              !this.isValidDate(
                record.attendance_date
              )
            ) {
              throw new Error(
                'Invalid attendance date detected.'
              );
            }

            const attendanceKey =
              JSON.stringify([
                record.student_id,
                record.attendance_date
              ]);

            if (
              attendanceKeys.has(attendanceKey)
            ) {
              throw new Error(
                'Duplicate daily attendance detected.'
              );
            }

            attendanceKeys.add(attendanceKey);

            const status =
              this.getAttendanceStatus(
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

              attendanceDate:
                record.attendance_date,

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

              statusLabel:
                this.getStatusLabel(status)

            });
          }

          offset += batch.length;

          if (offset > expectedCount) {
            throw new Error(
              'Attendance retrieval was inconsistent.'
            );
          }

          if (offset === expectedCount) {
            break;
          }

          if (batch.length === 0) {
            throw new Error(
              'Attendance retrieval was incomplete.'
            );
          }
        }
      }

      // Revalidate the supervisor before publishing
      // the retrieved attendance information.

      this.ensureCurrentRequest(
        version,
        userId
      );

      const latestSupervisorId =
        await this.getActiveSupervisorId(userId);

      this.ensureCurrentRequest(
        version,
        userId
      );

      if (latestSupervisorId !== supervisorId) {
        throw new Error(
          'The supervisor profile changed during retrieval.'
        );
      }

      // Revalidate the active intern assignments.

      const latestAssignments =
        await this.fetchAssignedInterns(
          supervisorId,
          version,
          userId
        );

      this.ensureCurrentRequest(
        version,
        userId
      );

      const originalKeys =
        initialAssignments.assignmentKeys;

      const latestKeys =
        latestAssignments.assignmentKeys;

      if (
        originalKeys.length !== latestKeys.length ||
        originalKeys.some(
          (key, index) =>
            key !== latestKeys[index]
        )
      ) {
        throw new Error(
          'Intern assignments changed during retrieval.'
        );
      }

      // Refresh intern names and avatar information
      // using the latest authorized assignment results.

      const latestInternMap = new Map(
        latestAssignments.interns.map(intern => [
          intern.id,
          intern
        ])
      );

      const finalRecords = Array.from(
        records.values()
      ).map(record => {

        const intern = latestInternMap.get(
          record.studentId
        );

        if (!intern) {
          throw new Error(
            'An intern assignment is no longer available.'
          );
        }

        return {
          ...record,
          studentName: intern.name,
          initials: intern.initials,
          avatarColor: intern.avatarColor
        };
      });

      this.ensureCurrentRequest(
        version,
        userId
      );

      // Publish only complete, authorized results.

      this.interns =
        latestAssignments.interns;

      this.attendanceRecords =
        finalRecords.sort((a, b) => {

          const dateComparison =
            b.attendanceDate.localeCompare(
              a.attendanceDate
            );

          if (dateComparison !== 0) {
            return dateComparison;
          }

          const nameComparison =
            a.studentName.localeCompare(
              b.studentName
            );

          if (nameComparison !== 0) {
            return nameComparison;
          }

          return a.id.localeCompare(b.id);
        });

      this.loadedUserId = userId;

      if (
        this.selectedStudent !== 'all' &&
        !this.interns.some(
          intern =>
            intern.id === this.selectedStudent
        )
      ) {
        this.selectedStudent = 'all';
      }

    } catch (error) {

      if (
        this.destroyed ||
        version !== this.loadVersion
      ) {
        return;
      }

      console.error(
        'Error loading attendance:',
        error
      );

      this.clearLoadedData();

      this.loadError =
        this.getLoadErrorMessage(error);

    } finally {

      if (
        !this.destroyed &&
        version === this.loadVersion
      ) {

        this.loading = false;

        this.cdr.markForCheck();
      }
    }
  }

  // ==========================================
  // ERROR HANDLING
  // ==========================================

  private getLoadErrorMessage(
    error: unknown
  ): string {

    if (!this.authService.isOnline()) {
      return 'No internet connection. Reconnect and try again.';
    }

    if (
      !this.authService.getCurrentUser()?.id ||
      this.authService.getUserRole() !==
        'company_supervisor'
    ) {
      return 'An authorized supervisor session is required. Please sign in again.';
    }

    const details = error as {
      code?: string;
      message?: string;
    } | null;

    const code = details?.code || '';

    const message = String(
      details?.message || ''
    ).toLowerCase();

    if (
      code === 'PGRST301' ||
      message.includes('jwt expired') ||
      message.includes('session changed') ||
      message.includes('session or request changed')
    ) {
      return 'Your session changed or expired. Please sign in again.';
    }

    if (
      code === '42501' ||
      message.includes('unauthorized') ||
      message.includes('active supervisor profile') ||
      message.includes('permission denied')
    ) {
      return 'You do not have permission to retrieve these attendance records.';
    }

    if (
      message.includes('changed during retrieval') ||
      message.includes('no longer available')
    ) {
      return 'Attendance or intern assignments changed while loading. Please refresh and try again.';
    }

    if (
      message.includes('duplicate') ||
      message.includes('incomplete') ||
      message.includes('inconsistent') ||
      message.includes('invalid attendance') ||
      message.includes('could not be retrieved')
    ) {
      return 'Attendance data could not be retrieved completely or consistently. Please refresh and try again.';
    }

    if (
      message.includes('failed to fetch') ||
      message.includes('network error')
    ) {
      return 'Unable to connect to the attendance server. Check your connection and try again.';
    }

    return 'We could not retrieve the attendance records. Please try again.';
  }

  // ==========================================
  // ATTENDANCE STATUS
  // ==========================================

  private getAttendanceStatus(
    verificationStatus: string | null,
    timeIn: string | null,
    timeOut: string | null
  ): AttendanceStatus {

    // Rejected status always takes priority.

    if (verificationStatus === 'rejected') {
      return 'rejected';
    }

    if (!timeIn || !timeOut) {
      return 'incomplete';
    }

    const start = Date.parse(timeIn);

    const end = Date.parse(timeOut);

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start
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

    const labels: Record<
      AttendanceStatus,
      string
    > = {
      pending: 'Pending',
      verified: 'Verified',
      incomplete: 'Incomplete',
      rejected: 'Rejected',
      unknown: 'Unknown'
    };

    return labels[status];
  }

  // ==========================================
  // DATE VALIDATION
  // ==========================================

  private isValidDate(
    value: string | null | undefined
  ): boolean {

    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
      return false;
    }

    const date = new Date(
      `${value}T00:00:00Z`
    );

    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }

  // ==========================================
  // FORMATTING
  // ==========================================

  private getInitials(name: string): string {

    const parts = name
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (parts.length === 0) {
      return 'NA';
    }

    if (parts.length === 1) {
      return parts[0]
        .slice(0, 2)
        .toUpperCase();
    }

    return (
      parts[0][0] +
      parts[parts.length - 1][0]
    ).toUpperCase();
  }

  private getAvatarColor(
    studentId: string
  ): string {

    const colors = [
      'blue',
      'orange',
      'slate',
      'green',
      'purple'
    ];

    let hash = 0;

    for (const character of studentId) {
      hash = (
        hash * 31 +
        character.charCodeAt(0)
      ) | 0;
    }

    return colors[
      Math.abs(hash) % colors.length
    ];
  }

  private formatDate(date: string): string {

    if (!this.isValidDate(date)) {
      return '—';
    }

    const value = new Date(
      `${date}T00:00:00Z`
    );

    return value.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC'
    });
  }

  private formatDay(date: string): string {

    if (!this.isValidDate(date)) {
      return '—';
    }

    const value = new Date(
      `${date}T00:00:00Z`
    );

    return value.toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: 'UTC'
    });
  }

  private formatTime(
    value: string | null
  ): string {

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

    const start = Date.parse(timeIn);

    const end = Date.parse(timeOut);

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start
    ) {
      return '—';
    }

    // Display recorded elapsed duration.
    // Credited hours are calculated separately
    // in attendance details and the database.

    const milliseconds = end - start;

    const totalMinutes = Math.floor(
      milliseconds / 60000
    );

    const hours = Math.floor(
      totalMinutes / 60
    );

    const minutes = totalMinutes % 60;

    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }

  // ==========================================
  // SUMMARY COUNTERS
  // ==========================================

  get pendingCount(): number {

    if (!this.hasValidLoadedSession) {
      return 0;
    }

    return this.attendanceRecords.filter(
      record => record.status === 'pending'
    ).length;
  }

  get incompleteCount(): number {

    if (!this.hasValidLoadedSession) {
      return 0;
    }

    return this.attendanceRecords.filter(
      record => record.status === 'incomplete'
    ).length;
  }

  // ==========================================
  // FILTERING
  // ==========================================

  get invalidDateRange(): boolean {

    if (
      this.dateFrom &&
      !this.isValidDate(this.dateFrom)
    ) {
      return true;
    }

    if (
      this.dateTo &&
      !this.isValidDate(this.dateTo)
    ) {
      return true;
    }

    return !!(
      this.dateFrom &&
      this.dateTo &&
      this.dateFrom > this.dateTo
    );
  }

  get filteredAttendance(): AttendanceRecord[] {

    if (
      !this.hasValidLoadedSession ||
      this.invalidDateRange
    ) {
      return [];
    }

    const search = this.searchQuery
      .trim()
      .toLowerCase();

    return this.attendanceRecords.filter(
      record => {

        const matchesSearch =
          !search ||
          record.studentName
            .toLowerCase()
            .includes(search) ||
          record.studentId
            .toLowerCase()
            .includes(search);

        const matchesStudent =
          this.selectedStudent === 'all' ||
          record.studentId ===
            this.selectedStudent;

        const matchesStatus =
          this.selectedStatus === 'all' ||
          record.status ===
            this.selectedStatus;

        const matchesStartDate =
          !this.dateFrom ||
          record.attendanceDate >=
            this.dateFrom;

        const matchesEndDate =
          !this.dateTo ||
          record.attendanceDate <=
            this.dateTo;

        return (
          matchesSearch &&
          matchesStudent &&
          matchesStatus &&
          matchesStartDate &&
          matchesEndDate
        );
      }
    );
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
      Math.ceil(
        this.totalRecords / this.pageSize
      )
    );
  }

  get paginatedAttendance(): AttendanceRecord[] {

    const page = Math.max(
      1,
      Math.min(
        this.currentPage,
        this.totalPages
      )
    );

    const start =
      (page - 1) * this.pageSize;

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
      {
        length: end - start + 1
      },
      (_, index) => start + index
    );
  }

  get firstRecord(): number {

    if (this.totalRecords === 0) {
      return 0;
    }

    const page = Math.max(
      1,
      Math.min(
        this.currentPage,
        this.totalPages
      )
    );

    return (
      (page - 1) * this.pageSize + 1
    );
  }

  get lastRecord(): number {

    const page = Math.max(
      1,
      Math.min(
        this.currentPage,
        this.totalPages
      )
    );

    return Math.min(
      page * this.pageSize,
      this.totalRecords
    );
  }

  goToPage(page: number): void {

    if (
      !this.hasValidLoadedSession ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > this.totalPages
    ) {
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

    if (!this.hasValidLoadedSession) {

      this.clearLoadedData();

      this.loadError =
        'An active online supervisor session is required. Please refresh or sign in again.';

      this.cdr.markForCheck();

      return;
    }

    const authorizedRecord =
      this.attendanceRecords.find(
        item =>
          item.id === record.id &&
          item.studentId === record.studentId
      );

    if (!authorizedRecord) {

      this.clearLoadedData();

      this.loadError =
        'This attendance record is no longer available. Please refresh.';

      this.cdr.markForCheck();

      return;
    }

    // The destination page revalidates
    // the active supervisor and assignment.

    void this.router.navigate([
      '/supervisor',
      'attendance',
      authorizedRecord.id
    ]);
  }
}
