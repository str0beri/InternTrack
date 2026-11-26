import {
  Component,
  OnInit,
  ChangeDetectorRef,
  NgZone,
  inject
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonIcon, IonHeader, IonToolbar } from '@ionic/angular';

import { addIcons } from 'ionicons';
import {
  searchOutline,
  chevronDownOutline,
  chevronBackOutline,
  chevronForwardOutline,
  calendarOutline,
  calendarClearOutline,
  eyeOutline,
  closeOutline,
  refreshOutline,
  alertCircleOutline
} from 'ionicons/icons';

import {
  SupabaseService
} from '../../../services/supabase.service';

interface Student {
  id: string;
  student_id: string;
  full_name: string;
  company_name: string | null;
  account_status: string;
}

interface Supervisor {
  id: string;
  user_id: string | null;
  full_name: string;
  company_name: string;
  department: string | null;
}

interface InternshipAssignment {
  id: string;
  student_id: string;
  supervisor_id: string;
  company_name: string;
  assigned_date: string | null;
  start_date: string | null;
  end_date: string | null;
  assignment_status: string;
  assignment_history: any[];
}

interface RawAttendance {
  id: string;
  student_id: string;
  attendance_date: string;
  time_in: string | null;
  time_out: string | null;
  total_hours_rendered: number | string | null;
  verification_status: string | null;
  sync_status: string | null;
  verified_by: string | null;
  verified_at: string | null;
  remarks: string | null;
}

type AttendanceStatus =
  | 'verified'
  | 'pending'
  | 'incomplete'
  | 'rejected'
  | 'unknown';

interface AttendanceRecord {
  id: string;
  studentId: string;
  studentName: string;
  studentUuid: string;
  companyName: string;
  supervisorId: string;
  supervisorName: string;
  attendanceDate: string;
  timeIn: string | null;
  timeOut: string | null;
  renderedHours: number | null;
  verificationStatus: string;
  status: AttendanceStatus;
  initials: string;
  avatarColor: string;
}

interface SupervisorOption {
  id: string;
  name: string;
  company: string;
}

@Component({
  selector: 'app-attendance-monitoring',
  templateUrl: './attendance-monitoring.page.html',
  styleUrls: ['./attendance-monitoring.page.scss'],
  standalone: true,
  imports: [IonToolbar, IonHeader, 
    CommonModule,
    FormsModule,
    IonIcon
  ]
})
export class AttendanceMonitoringPage implements OnInit {

  private supabaseService = inject(SupabaseService);
  private supabase = this.supabaseService.getClient();

  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private ngZone = inject(NgZone);

  attendanceRecords: AttendanceRecord[] = [];

  isLoading = true;
  errorMessage = '';

  private loadingInProgress = false;

  searchQuery = '';
  selectedCompany = 'all';
  selectedSupervisor = 'all';
  selectedStatus = 'all';

  startDate = '';
  endDate = '';

  currentPage = 1;
  readonly pageSize = 10;

  constructor() {

    addIcons({
      searchOutline,
      chevronDownOutline,
      chevronBackOutline,
      chevronForwardOutline,
      calendarOutline,
      calendarClearOutline,
      eyeOutline,
      closeOutline,
      refreshOutline,
      alertCircleOutline
    });

  }

  ngOnInit(): void {
    void this.loadAttendanceRecords();
  }

  ionViewWillEnter(): void {
    void this.loadAttendanceRecords();
  }

  // ==========================================
  // FETCH ALL RECORDS
  // ==========================================

  private async fetchAll<T>(
    table: string,
    columns: string,
    filters: Record<string, string> = {}
  ): Promise<T[]> {

    const records: T[] = [];

    const batchSize = 500;
    let offset = 0;

    while (true) {

      let query = this.supabase
        .from(table)
        .select(columns);

      for (const [column, value] of Object.entries(filters)) {
        query = query.eq(column, value);
      }

      const { data, error } = await query
        .order('id', { ascending: true })
        .range(offset, offset + batchSize - 1);

      if (error) {
        throw error;
      }

      const batch =
        (data ?? []) as unknown as T[];

      records.push(...batch);

      if (batch.length < batchSize) {
        break;
      }

      offset += batchSize;

    }

    return records;

  }

  // ==========================================
  // LOAD ATTENDANCE
  // ==========================================

  async loadAttendanceRecords(): Promise<void> {

    if (this.loadingInProgress) {
      return;
    }

    this.loadingInProgress = true;
    this.isLoading = true;
    this.errorMessage = '';

    try {

      const [
        students,
        supervisors,
        assignments,
        attendance
      ] = await Promise.all([

        this.fetchAll<Student>(
          'students',
          `
            id,
            student_id,
            full_name,
            company_name,
            account_status
          `
        ),

        this.fetchAll<Supervisor>(
          'company_supervisors',
          `
            id,
            user_id,
            full_name,
            company_name,
            department
          `
        ),

        this.fetchAll<InternshipAssignment>(
          'intern_supervisor_assignments',
          `
            id,
            student_id,
            supervisor_id,
            company_name,
            assigned_date,
            start_date,
            end_date,
            assignment_status,
            assignment_history
          `
        ),

        this.fetchAll<RawAttendance>(
          'attendance',
          `
            id,
            student_id,
            attendance_date,
            time_in,
            time_out,
            total_hours_rendered,
            verification_status,
            sync_status,
            verified_by,
            verified_at,
            remarks
          `,
          {
            sync_status: 'synced'
          }
        )

      ]);

      // Attendance uses the student's school ID.
      const studentMap = new Map(
        students.map(student => [
          student.student_id,
          student
        ])
      );

      const supervisorMap = new Map(
        supervisors.map(supervisor => [
          supervisor.id,
          supervisor
        ])
      );

      // Group assignments using the student's UUID.
      const assignmentMap =
        new Map<string, InternshipAssignment[]>();

      for (const assignment of assignments) {

        if (!assignment.student_id) {
          continue;
        }

        const existing =
          assignmentMap.get(assignment.student_id) || [];

        existing.push(assignment);

        assignmentMap.set(
          assignment.student_id,
          existing
        );

      }

      const records: AttendanceRecord[] =
        attendance.map(record => {

          const student =
            studentMap.get(record.student_id);

          const studentAssignments = student
            ? assignmentMap.get(student.id) || []
            : [];

          const placement = this.resolvePlacement(
            studentAssignments,
            record.attendance_date
          );

          const supervisor = placement
            ? supervisorMap.get(placement.supervisor_id)
            : undefined;

          const studentName =
            student?.full_name || 'Unknown student';

          return {

            id: record.id,

            studentId: record.student_id,

            studentUuid: student?.id || '',

            studentName,

            companyName:
              placement?.company_name ||
              'Not recorded',

            supervisorId:
              supervisor?.id || '',

            supervisorName:
              supervisor?.full_name ||
              'Not recorded',

            attendanceDate:
              record.attendance_date,

            timeIn: record.time_in,

            timeOut: record.time_out,

            renderedHours:
              this.getRenderedHours(record),

            verificationStatus:
              record.verification_status || 'unknown',

            status:
              this.resolveStatus(record),

            initials:
              this.getInitials(studentName),

            avatarColor:
              this.getAvatarColor(record.student_id)

          };

        });

      // Latest attendance records first.
      records.sort((a, b) => {

        const dateComparison =
          (b.attendanceDate || '').localeCompare(
            a.attendanceDate || ''
          );

        if (dateComparison !== 0) {
          return dateComparison;
        }

        const timeA = a.timeIn
          ? new Date(a.timeIn).getTime()
          : 0;

        const timeB = b.timeIn
          ? new Date(b.timeIn).getTime()
          : 0;

        return timeB - timeA ||
          a.id.localeCompare(b.id);

      });

      this.ngZone.run(() => {

        this.attendanceRecords = records;

        if (
          this.selectedCompany !== 'all' &&
          !this.companyOptions.includes(
            this.selectedCompany
          )
        ) {
          this.selectedCompany = 'all';
        }

        if (
          this.selectedSupervisor !== 'all' &&
          !this.supervisorOptions.some(
            supervisor =>
              supervisor.id === this.selectedSupervisor
          )
        ) {
          this.selectedSupervisor = 'all';
        }

        this.currentPage = Math.min(
          this.currentPage,
          this.totalPages
        );

        this.cdr.detectChanges();

      });

    } catch (error) {

      console.error(
        'Attendance monitoring loading error:',
        error
      );

      this.ngZone.run(() => {

        this.errorMessage =
          'Unable to load attendance records. Please try again.';

      });

    } finally {

      this.ngZone.run(() => {

        this.isLoading = false;
        this.loadingInProgress = false;

        this.cdr.detectChanges();

      });

    }

  }

  retryLoad(): void {
    void this.loadAttendanceRecords();
  }

  // ==========================================
  // HISTORICAL PLACEMENT RESOLUTION
  // ==========================================

  private resolvePlacement(
    assignments: InternshipAssignment[],
    attendanceDate: string
  ): InternshipAssignment | undefined {

    if (!attendanceDate) {
      return undefined;
    }

    const matchingAssignments =
      assignments.filter(assignment => {

        const startDate = assignment.start_date;

        let endDate = assignment.end_date;

        // Use reassignment history to limit
        // the previous placement's effective period.
        if (
          assignment.assignment_status === 'inactive' &&
          Array.isArray(assignment.assignment_history)
        ) {

          const reassignmentEvent = [
            ...assignment.assignment_history
          ].reverse().find(event =>
            event?.previous_assignment_id ===
              assignment.id
          );

          if (reassignmentEvent) {

            const nextStart =
              reassignmentEvent.new_start_date;

            const changedDate =
              this.toManilaDate(
                reassignmentEvent.changed_at
              );

            const boundary =
              nextStart || changedDate;

            if (
              boundary &&
              attendanceDate >= boundary
            ) {
              return false;
            }

          } else {

            // Unknown historical end boundary.
            return false;

          }

        }

        if (!startDate) {
          return false;
        }

        return attendanceDate >= startDate &&
          (!endDate || attendanceDate <= endDate);

      });

    // Do not invent a historical placement when
    // multiple assignment periods overlap.
    return matchingAssignments.length === 1
      ? matchingAssignments[0]
      : undefined;

  }

  private toManilaDate(
    value: string | null | undefined
  ): string {

    if (!value) {
      return '';
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);

    const year =
      parts.find(part => part.type === 'year')?.value;

    const month =
      parts.find(part => part.type === 'month')?.value;

    const day =
      parts.find(part => part.type === 'day')?.value;

    return `${year}-${month}-${day}`;

  }

  // ==========================================
  // ATTENDANCE STATUS
  // ==========================================

  private resolveStatus(
    record: RawAttendance
  ): AttendanceStatus {

    const verification =
      (record.verification_status || '').toLowerCase();

    if (verification === 'rejected') {
      return 'rejected';
    }

    if (!record.time_in || !record.time_out) {
      return 'incomplete';
    }

    const timeIn =
      new Date(record.time_in).getTime();

    const timeOut =
      new Date(record.time_out).getTime();

    if (
      !Number.isFinite(timeIn) ||
      !Number.isFinite(timeOut) ||
      timeOut < timeIn
    ) {
      return 'incomplete';
    }

    if (verification === 'verified') {
      return 'verified';
    }

    if (
      verification === 'provisional' ||
      verification === 'pending'
    ) {
      return 'pending';
    }

    return 'unknown';

  }

  getStatusLabel(status: AttendanceStatus): string {

    const labels: Record<AttendanceStatus, string> = {
      verified: 'Verified',
      pending: 'Pending',
      incomplete: 'Incomplete',
      rejected: 'Rejected',
      unknown: 'Unknown'
    };

    return labels[status] || 'Unknown';

  }

  getStatusClass(status: AttendanceStatus): string {
    return `status-${status}`;
  }

  // ==========================================
  // RENDERED HOURS
  // ==========================================

  private getRenderedHours(
    record: RawAttendance
  ): number | null {

    if (!record.time_in || !record.time_out) {
      return null;
    }

    const timeIn =
      new Date(record.time_in).getTime();

    const timeOut =
      new Date(record.time_out).getTime();

    if (
      !Number.isFinite(timeIn) ||
      !Number.isFinite(timeOut) ||
      timeOut < timeIn
    ) {
      return null;
    }

    if (
      record.total_hours_rendered === null ||
      record.total_hours_rendered === undefined ||
      record.total_hours_rendered === ''
    ) {
      return null;
    }

    const hours =
      Number(record.total_hours_rendered);

    if (!Number.isFinite(hours) || hours < 0) {
      return null;
    }

    return hours;

  }

  formatHours(hours: number | null): string {

    if (hours === null) {
      return '—';
    }

    return `${hours.toFixed(1)} h`;

  }

  // ==========================================
  // SUMMARY
  // ==========================================

  get totalRecords(): number {
    return this.attendanceRecords.length;
  }

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

  get verifiedCount(): number {

    return this.attendanceRecords.filter(
      record => record.status === 'verified'
    ).length;

  }

  get rejectedCount(): number {

    return this.attendanceRecords.filter(
      record => record.status === 'rejected'
    ).length;

  }

  get summaryText(): string {

    return `${this.totalRecords} attendance ${
      this.totalRecords === 1
        ? 'record'
        : 'records'
    } · ${this.pendingCount} awaiting supervisor verification · ${this.incompleteCount} incomplete.`;

  }

  // ==========================================
  // COMPANY FILTER
  // ==========================================

  get companyOptions(): string[] {

    return Array.from(
      new Set(
        this.attendanceRecords
          .map(record => record.companyName)
          .filter(company =>
            !!company &&
            company !== 'Not recorded'
          )
      )
    ).sort((a, b) => a.localeCompare(b));

  }

  // ==========================================
  // SUPERVISOR FILTER
  // ==========================================

  get supervisorOptions(): SupervisorOption[] {

    const options =
      new Map<string, SupervisorOption>();

    const records = this.attendanceRecords.filter(
      record =>
        this.selectedCompany === 'all' ||
        record.companyName === this.selectedCompany
    );

    for (const record of records) {

      if (!record.supervisorId) {
        continue;
      }

      options.set(record.supervisorId, {
        id: record.supervisorId,
        name: record.supervisorName,
        company: record.companyName
      });

    }

    return Array.from(options.values()).sort(
      (a, b) => a.name.localeCompare(b.name)
    );

  }

  // ==========================================
  // SEARCH AND FILTERS
  // ==========================================

  get isDateRangeValid(): boolean {

    if (!this.startDate || !this.endDate) {
      return true;
    }

    return this.endDate >= this.startDate;

  }

  get filteredRecords(): AttendanceRecord[] {

    if (!this.isDateRangeValid) {
      return [];
    }

    const query =
      this.searchQuery.trim().toLowerCase();

    return this.attendanceRecords.filter(record => {

      const matchesSearch =
        !query ||
        record.studentName
          .toLowerCase()
          .includes(query) ||
        record.studentId
          .toLowerCase()
          .includes(query);

      const matchesCompany =
        this.selectedCompany === 'all' ||
        record.companyName === this.selectedCompany;

      const matchesSupervisor =
        this.selectedSupervisor === 'all' ||
        record.supervisorId === this.selectedSupervisor;

      const matchesStatus =
        this.selectedStatus === 'all' ||
        record.status === this.selectedStatus;

      const matchesStartDate =
        !this.startDate ||
        record.attendanceDate >= this.startDate;

      const matchesEndDate =
        !this.endDate ||
        record.attendanceDate <= this.endDate;

      return matchesSearch &&
        matchesCompany &&
        matchesSupervisor &&
        matchesStatus &&
        matchesStartDate &&
        matchesEndDate;

    });

  }

  get filteredCount(): number {
    return this.filteredRecords.length;
  }

  get hasActiveFilters(): boolean {

    return !!this.searchQuery.trim() ||
      this.selectedCompany !== 'all' ||
      this.selectedSupervisor !== 'all' ||
      this.selectedStatus !== 'all' ||
      !!this.startDate ||
      !!this.endDate;

  }

  onSearchChange(): void {
    this.currentPage = 1;
  }

  onCompanyChange(): void {
    this.selectedSupervisor = 'all';
    this.currentPage = 1;
  }

  onFilterChange(): void {
    this.currentPage = 1;
  }

  onDateChange(): void {
    this.currentPage = 1;
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.currentPage = 1;
  }

  clearDateRange(): void {
    this.startDate = '';
    this.endDate = '';
    this.currentPage = 1;
  }

  clearFilters(): void {

    this.searchQuery = '';
    this.selectedCompany = 'all';
    this.selectedSupervisor = 'all';
    this.selectedStatus = 'all';
    this.startDate = '';
    this.endDate = '';
    this.currentPage = 1;

  }

  // ==========================================
  // PAGINATION
  // ==========================================

  get totalPages(): number {

    return Math.max(
      1,
      Math.ceil(this.filteredCount / this.pageSize)
    );

  }

  get paginatedRecords(): AttendanceRecord[] {

    const start =
      (this.currentPage - 1) * this.pageSize;

    return this.filteredRecords.slice(
      start,
      start + this.pageSize
    );

  }

  get showingFrom(): number {

    return this.filteredCount === 0
      ? 0
      : (this.currentPage - 1) * this.pageSize + 1;

  }

  get showingTo(): number {

    return Math.min(
      this.currentPage * this.pageSize,
      this.filteredCount
    );

  }

  get pageNumbers(): (number | string)[] {

    const total = this.totalPages;
    const current = this.currentPage;

    if (total <= 5) {

      return Array.from(
        { length: total },
        (_, index) => index + 1
      );

    }

    if (current <= 2) {
      return [1, 2, 'right-gap', total];
    }

    if (current >= total - 1) {
      return [1, 'left-gap', total - 1, total];
    }

    const pages: (number | string)[] = [1];

    if (current > 3) {
      pages.push('left-gap');
    }

    if (current - 1 > 1) {
      pages.push(current - 1);
    }

    pages.push(current);

    if (current + 1 < total) {
      pages.push(current + 1);
    }

    if (current + 2 < total) {
      pages.push('right-gap');
    }

    pages.push(total);

    return pages;

  }

  isPageNumber(
    page: number | string
  ): boolean {

    return typeof page === 'number';

  }

  goToPage(page: number | string): void {

    if (
      typeof page === 'number' &&
      page >= 1 &&
      page <= this.totalPages
    ) {
      this.currentPage = page;
    }

  }

  previousPage(): void {
    this.goToPage(this.currentPage - 1);
  }

  nextPage(): void {
    this.goToPage(this.currentPage + 1);
  }

  // ==========================================
  // NAVIGATION
  // ==========================================

  viewAttendance(record: AttendanceRecord): void {

    void this.router.navigate([
      '/coordinator/attendance',
      record.id
    ]);

  }

  // ==========================================
  // DATE AND TIME FORMATTING
  // ==========================================

  formatAttendanceDate(value: string): string {

    if (!value) {
      return '—';
    }

    const date = new Date(
      /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? `${value}T00:00:00+08:00`
        : value
    );

    if (Number.isNaN(date.getTime())) {
      return '—';
    }

    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'Asia/Manila'
    }).format(date);

  }

  formatTime(value: string | null): string {

    if (!value) {
      return '—';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return '—';
    }

    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: 'Asia/Manila'
    }).format(date);

  }

  // ==========================================
  // AVATAR HELPERS
  // ==========================================

  getInitials(name: string): string {

    const parts = name
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (!parts.length) {
      return '?';
    }

    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }

    return (
      parts[0][0] +
      parts[parts.length - 1][0]
    ).toUpperCase();

  }

  getAvatarColor(value: string): string {

    const colors = [
      'blue',
      'purple',
      'green',
      'orange',
      'rose',
      'slate'
    ];

    const hash = Array.from(value || '').reduce(
      (sum, character) =>
        sum + character.charCodeAt(0),
      0
    );

    return colors[hash % colors.length];

  }

  // ==========================================
  // TRACK BY
  // ==========================================

  trackByRecord(
    index: number,
    record: AttendanceRecord
  ): string {

    return record.id;

  }

  trackBySupervisor(
    index: number,
    supervisor: SupervisorOption
  ): string {

    return supervisor.id;

  }

  trackByPage(
    index: number,
    page: number | string
  ): number | string {

    return page;

  }

}
