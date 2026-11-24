import { CommonModule } from '@angular/common';

import {
  ChangeDetectorRef,
  Component,
  inject,
  type OnInit,
  type OnDestroy,
} from '@angular/core';

import { RouterLink } from '@angular/router';

import { AuthService } from '../../../services/auth.service';
import { SupabaseService } from '../../../services/supabase.service';

interface Student {
  id: string;
  student_id: string;
  full_name: string;
  required_hours: number | null;
  ojt_start_date: string | null;
  ojt_end_date: string | null;
  account_status: string | null;
}

interface Assignment {
  id: string;
  student_id: string | null;
  supervisor_id: string | null;
  company_name: string;
  assignment_status: string | null;
}

interface Attendance {
  id: string;
  student_id: string;
  attendance_date: string;
  time_in: string | null;
  time_out: string | null;
  total_hours_rendered: number | null;
  verification_status: string | null;
  sync_status: string | null;
}

interface WeeklyReport {
  id: number;
  student_id: string;
  status: string;
  submitted_at: string | null;
}

interface Supervisor {
  id: string;
  account_status: string | null;
}

interface DashboardMetrics {
  registeredInterns: number;
  assignedInterns: number;
  unassignedInterns: number;
  activeInternships: number;
  partnerCompanies: number;
  activeSupervisors: number;
  delayedInterns: number;
  completedHours: number;
  overdueAttendance: number;
  overdueReports: number;
  pendingReports: number;
}

interface SummaryCard {
  label: string;
  value: number;
  description: string;
  secondaryDescription?: string;
  color: string;
  route: string;
  linkLabel: string;
  queryParams?: Record<string, string>;
}

interface AttentionItem {
  title: string;
  description: string;
  count: number;
  color: string;
  route: string;
  queryParams?: Record<string, string>;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
  ],
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
})
export class DashboardPage implements OnInit, OnDestroy {

  private readonly supabaseService = inject(SupabaseService);
  private readonly supabase = this.supabaseService.getClient();

  private readonly authService = inject(AuthService);
  private readonly cdr = inject(ChangeDetectorRef);

  private loadVersion = 0;
  private destroyed = false;

  loading = true;
  loadError = '';

  coordinatorName = 'Coordinator';

  metrics: DashboardMetrics = this.createEmptyMetrics();

  ngOnInit(): void {
    void this.loadDashboardData();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.loadVersion++;
  }

  private createEmptyMetrics(): DashboardMetrics {
    return {
      registeredInterns: 0,
      assignedInterns: 0,
      unassignedInterns: 0,
      activeInternships: 0,
      partnerCompanies: 0,
      activeSupervisors: 0,
      delayedInterns: 0,
      completedHours: 0,
      overdueAttendance: 0,
      overdueReports: 0,
      pendingReports: 0,
    };
  }

  // =========================================
  // DATE AND GREETING
  // =========================================

  get greeting(): string {

    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Manila',
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(new Date())
    );

    if (hour < 12) {
      return 'Good morning';
    }

    if (hour < 18) {
      return 'Good afternoon';
    }

    return 'Good evening';
  }

  get currentDate(): string {
    return new Date().toLocaleDateString('en-US', {
      timeZone: 'Asia/Manila',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  private getManilaDate(): string {

    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());

    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;

    return `${year}-${month}-${day}`;
  }

  private getDisplayName(fullName: string): string {

    const name = fullName.trim();

    if (!name) {
      return 'Coordinator';
    }

    const parts = name.split(/\s+/);

    const first = parts[0];
    const last = parts[parts.length - 1];

    const titles = [
      'dr',
      'prof',
      'mr',
      'ms',
      'mrs',
      'engr',
    ];

    if (
      parts.length > 1 &&
      titles.includes(first.replace(/\./g, '').toLowerCase())
    ) {
      return `${first} ${last}`;
    }

    return name;
  }

  // =========================================
  // REQUEST VALIDATION
  // =========================================

  private isCurrentRequest(version: number): boolean {
    return (
      !this.destroyed &&
      version === this.loadVersion
    );
  }

  // =========================================
  // PAGINATED DATABASE FETCH
  // =========================================

  private async fetchAll<T>(
    table: string,
    columns: string,
    filters: Record<string, string> = {}
  ): Promise<T[]> {

    const records: T[] = [];
    const pageSize = 500;

    let offset = 0;

    while (true) {

      let query = this.supabase
        .from(table)
        .select(columns, { count: 'exact' });

      for (const [column, value] of Object.entries(filters)) {
        query = query.eq(column, value);
      }

      const { data, error, count } = await query
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (error) {
        throw error;
      }

      const rows = (data ?? []) as unknown as T[];

      records.push(...rows);

      offset += rows.length;

      if (
        rows.length === 0 ||
        (count !== null && offset >= count) ||
        (count === null && rows.length < pageSize)
      ) {
        break;
      }
    }

    return records;
  }

  // =========================================
  // LOAD DASHBOARD DATA
  // =========================================

  async loadDashboardData(): Promise<void> {

    const version = ++this.loadVersion;

    this.loading = true;
    this.loadError = '';
    this.metrics = this.createEmptyMetrics();

    this.cdr.markForCheck();

    try {

      await this.authService.waitForInitialization();

      if (
        !this.authService.isAuthenticated() ||
        this.authService.getUserRole() !== 'ojt_coordinator'
      ) {
        throw new Error('Unauthorized coordinator account.');
      }

      if (
        !this.authService.isOnline() ||
        this.authService.isOfflineSession()
      ) {
        throw new Error('Internet connection is required.');
      }

      // Validate authenticated user

      const {
        data: { user },
        error: authError,
      } = await this.supabase.auth.getUser();

      if (authError || !user) {
        throw new Error('Unable to validate your session.');
      }

      const userId = user.id;

      // Retrieve coordinator profile

      const {
        data: coordinator,
        error: coordinatorError,
      } = await this.supabase
        .from('ojt_coordinators')
        .select('id, full_name, account_status')
        .eq('user_id', userId)
        .single();

      if (coordinatorError) {
        throw coordinatorError;
      }

      if (
        !coordinator ||
        coordinator.account_status !== 'active'
      ) {
        throw new Error('Coordinator profile is unavailable.');
      }

      if (!this.isCurrentRequest(version)) {
        return;
      }

      // Retrieve database records

      const [
        students,
        assignments,
        attendance,
        reports,
        supervisors,
      ] = await Promise.all([

        this.fetchAll<Student>(
          'students',
          'id, student_id, full_name, required_hours, ' +
          'ojt_start_date, ojt_end_date, account_status'
        ),

        this.fetchAll<Assignment>(
          'intern_supervisor_assignments',
          'id, student_id, supervisor_id, ' +
          'company_name, assignment_status',
          {
            assignment_status: 'active',
          }
        ),

        this.fetchAll<Attendance>(
          'attendance',
          'id, student_id, attendance_date, time_in, ' +
          'time_out, total_hours_rendered, ' +
          'verification_status, sync_status',
          {
            sync_status: 'synced',
          }
        ),

        this.fetchAll<WeeklyReport>(
          'reports',
          'id, student_id, status, submitted_at'
        ),

        this.fetchAll<Supervisor>(
          'company_supervisors',
          'id, account_status',
          {
            account_status: 'active',
          }
        ),

      ]);

      if (!this.isCurrentRequest(version)) {
        return;
      }

      // Ensure the account has not changed during loading

      const {
        data: { user: currentUser },
        error: sessionError,
      } = await this.supabase.auth.getUser();

      if (
        sessionError ||
        currentUser?.id !== userId ||
        this.authService.getUserRole() !== 'ojt_coordinator'
      ) {
        throw new Error('Your session has changed.');
      }

      if (!this.isCurrentRequest(version)) {
        return;
      }

      this.coordinatorName = this.getDisplayName(
        coordinator.full_name
      );

      this.calculateMetrics(
        students,
        assignments,
        attendance,
        reports,
        supervisors
      );

    } catch (error) {

      if (!this.isCurrentRequest(version)) {
        return;
      }

      console.error('Coordinator dashboard error:', error);

      this.metrics = this.createEmptyMetrics();

      this.loadError =
        'Please check your internet connection and account permissions.';

    } finally {

      if (this.isCurrentRequest(version)) {
        this.loading = false;
        this.cdr.markForCheck();
      }

    }
  }

  // =========================================
  // CALCULATE VERIFIED HOURS
  // =========================================

  private getAttendanceHours(record: Attendance): number {

    if (
      record.sync_status !== 'synced' ||
      record.verification_status !== 'verified' ||
      !record.time_in ||
      !record.time_out
    ) {
      return 0;
    }

    const start = new Date(record.time_in).getTime();
    const end = new Date(record.time_out).getTime();

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start
    ) {
      return 0;
    }

    if (record.total_hours_rendered !== null) {

      const storedHours = Number(record.total_hours_rendered);

      if (
        Number.isFinite(storedHours) &&
        storedHours >= 0
      ) {
        return storedHours;
      }
    }

    return (end - start) / 3600000;
  }

  private getRequiredHours(student: Student): number {

    const hours = Number(student.required_hours);

    return Number.isFinite(hours) && hours > 0
      ? hours
      : 486;
  }

  // =========================================
  // INTERNSHIP PROGRESS
  // =========================================

  private hasDelayedProgress(
    student: Student,
    verifiedHours: number,
    today: string
  ): boolean {

    if (
      !student.ojt_start_date ||
      !student.ojt_end_date
    ) {
      return false;
    }

    const start = Date.parse(
      `${student.ojt_start_date}T00:00:00Z`
    );

    const end = Date.parse(
      `${student.ojt_end_date}T00:00:00Z`
    );

    const current = Date.parse(`${today}T00:00:00Z`);

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      current < start
    ) {
      return false;
    }

    const expectedProgress = Math.min(
      100,
      Math.max(
        0,
        ((current - start) / (end - start)) * 100
      )
    );

    const actualProgress = Math.min(
      100,
      (verifiedHours / this.getRequiredHours(student)) * 100
    );

    // Follow-up threshold: 10 percentage points behind

    return expectedProgress - actualProgress > 10;
  }

  // =========================================
  // DASHBOARD METRICS
  // =========================================

  private calculateMetrics(
    students: Student[],
    assignments: Assignment[],
    attendance: Attendance[],
    reports: WeeklyReport[],
    supervisors: Supervisor[]
  ): void {

    const today = this.getManilaDate();

    const now = Date.now();

    const dayMilliseconds = 24 * 60 * 60 * 1000;

    const activeStudents = students.filter(
      student => student.account_status === 'active'
    );

    const studentUUIDs = new Set(
      activeStudents.map(student => student.id)
    );

    const activeAssignments = assignments.filter(
      assignment =>
        assignment.student_id !== null &&
        assignment.supervisor_id !== null &&
        studentUUIDs.has(assignment.student_id)
    );

    const assignedStudentUUIDs = new Set(
      activeAssignments.map(assignment => assignment.student_id)
    );

    const assignedStudents = activeStudents.filter(
      student => assignedStudentUUIDs.has(student.id)
    );

    // Count unique assigned students

    const assignedSchoolIds = new Set(
      assignedStudents.map(student => student.student_id)
    );

    // Calculate verified rendered hours

    const verifiedHoursMap = new Map<string, number>();

    for (const record of attendance) {

      const hours = this.getAttendanceHours(record);

      const previous =
        verifiedHoursMap.get(record.student_id) ?? 0;

      verifiedHoursMap.set(
        record.student_id,
        previous + hours
      );
    }

    // Students who have met their required hours

    const completedStudents = activeStudents.filter(student => {

      const hours =
        verifiedHoursMap.get(student.student_id) ?? 0;

      return hours >= this.getRequiredHours(student);
    });

    const completedUUIDs = new Set(
      completedStudents.map(student => student.id)
    );

    // Assigned students with ongoing internships

    const ongoingStudents = assignedStudents.filter(student => {

      const hasStarted =
        !!student.ojt_start_date &&
        student.ojt_start_date <= today;

      return (
        hasStarted &&
        !completedUUIDs.has(student.id)
      );
    });

    const ongoingUUIDs = new Set(
      ongoingStudents.map(student => student.id)
    );

    const ongoingSchoolIds = new Set(
      ongoingStudents.map(student => student.student_id)
    );

    // Unique partner companies

    const companyNames = new Set(
      activeAssignments
        .map(assignment =>
          assignment.company_name.trim().toLowerCase()
        )
        .filter(Boolean)
    );

    // Active supervisors handling ongoing interns

    const activeSupervisorIds = new Set(
      supervisors.map(supervisor => supervisor.id)
    );

    const handlingSupervisorIds = new Set(
      activeAssignments
        .filter(assignment =>
          assignment.student_id !== null &&
          assignment.supervisor_id !== null &&
          ongoingUUIDs.has(assignment.student_id) &&
          activeSupervisorIds.has(assignment.supervisor_id)
        )
        .map(assignment => assignment.supervisor_id)
    );

    // Interns with delayed progress

    const delayedStudents = ongoingStudents.filter(student => {

      const hours =
        verifiedHoursMap.get(student.student_id) ?? 0;

      return this.hasDelayedProgress(
        student,
        hours,
        today
      );
    });

    // Attendance requiring follow-up beyond 72 hours

    const overdueAttendance = attendance.filter(record => {

      if (!assignedSchoolIds.has(record.student_id)) {
        return false;
      }

      if (
        record.verification_status === 'verified' ||
        record.verification_status === 'rejected'
      ) {
        return false;
      }

      const incomplete =
        !record.time_in || !record.time_out;

      const pending =
        record.verification_status === 'provisional';

      if (!incomplete && !pending) {
        return false;
      }

      const referenceTime = record.time_out
        ? Date.parse(record.time_out)
        : Date.parse(
            `${record.attendance_date}T23:59:59+08:00`
          );

      return (
        Number.isFinite(referenceTime) &&
        now - referenceTime > 72 * 60 * 60 * 1000
      );
    });

    // Latest submitted weekly report per student

    const latestSubmission = new Map<string, number>();

    for (const report of reports) {

      if (
        report.status === 'draft' ||
        !report.submitted_at
      ) {
        continue;
      }

      const submittedTime = Date.parse(report.submitted_at);

      if (!Number.isFinite(submittedTime)) {
        continue;
      }

      const previous =
        latestSubmission.get(report.student_id) ?? 0;

      if (submittedTime > previous) {
        latestSubmission.set(
          report.student_id,
          submittedTime
        );
      }
    }

    // Interns without a submission in the last 14 days

    const overdueReports = ongoingStudents.filter(student => {

      if (!student.ojt_start_date) {
        return false;
      }

      const startTime = Date.parse(
        `${student.ojt_start_date}T00:00:00+08:00`
      );

      if (!Number.isFinite(startTime)) {
        return false;
      }

      const lastSubmitted =
        latestSubmission.get(student.student_id) ?? startTime;

      const referenceTime = Math.max(
        lastSubmitted,
        startTime
      );

      return now - referenceTime > 14 * dayMilliseconds;
    });

    // Reports awaiting supervisor review

    const pendingReports = reports.filter(
      report =>
        ongoingSchoolIds.has(report.student_id) &&
        report.status === 'pending_review'
    );

    this.metrics = {
      registeredInterns: students.length,

      assignedInterns: assignedStudents.length,

      unassignedInterns:
        activeStudents.length - assignedStudents.length,

      activeInternships: ongoingStudents.length,

      partnerCompanies: companyNames.size,

      activeSupervisors: handlingSupervisorIds.size,

      delayedInterns: delayedStudents.length,

      completedHours: completedStudents.length,

      overdueAttendance: overdueAttendance.length,

      overdueReports: overdueReports.length,

      pendingReports: pendingReports.length,
    };
  }

  // =========================================
  // SUMMARY CARDS
  // =========================================

  get summaryCards(): SummaryCard[] {

    const m = this.metrics;

    return [

      {
        label: 'Registered Interns',
        value: m.registeredInterns,
        description:
          `${m.assignedInterns} assigned · ` +
          `${m.unassignedInterns} unassigned`,
        color: '#3157d5',
        route: '/coordinator/student-interns',
        linkLabel: 'View student interns',
      },

      {
        label: 'Active Internships',
        value: m.activeInternships,
        description:
          `${m.partnerCompanies} partner companies with active placements`,
        secondaryDescription:
          `${m.activeSupervisors} supervisors handling ongoing interns`,
        color: '#7556d9',
        route: '/coordinator/internship-assignments',
        linkLabel: 'View assignments',
      },

      {
        label: 'Needs Follow-up',
        value: m.delayedInterns,
        description:
          `${m.delayedInterns} interns with delayed progress`,
        secondaryDescription:
          `${m.overdueAttendance} overdue attendance records`,
        color: '#ff9638',
        route: '/coordinator/student-interns',
        linkLabel: 'View interns',
        queryParams: {
          status: 'needs-follow-up',
        },
      },

      {
        label: 'Completed Hours',
        value: m.completedHours,
        description:
          `${m.completedHours} interns met their required hours`,
        secondaryDescription:
          'Based on verified attendance records',
        color: '#087b56',
        route: '/coordinator/reports-records',
        linkLabel: 'View completion records',
        queryParams: {
          type: 'completion',
        },
      },

    ];
  }

  // =========================================
  // NEEDS ATTENTION
  // =========================================

  get attentionItems(): AttentionItem[] {

    const m = this.metrics;

    return [

      {
        title: 'Unassigned student interns',
        description:
          'Active student interns without an active company placement',
        count: m.unassignedInterns,
        color: '#ff9638',
        route: '/coordinator/student-interns',
        queryParams: {
          status: 'unassigned',
        },
      },

      {
        title: 'Overdue attendance records',
        description:
          'Pending or incomplete time records beyond 72 hours',
        count: m.overdueAttendance,
        color: '#cf3434',
        route: '/coordinator/attendance-monitoring',
        queryParams: {
          status: 'overdue',
        },
      },

      {
        title: 'Overdue weekly reports',
        description:
          'Active interns without a submitted report in the last 14 days',
        count: m.overdueReports,
        color: '#7556d9',
        route: '/coordinator/reports-monitoring',
        queryParams: {
          status: 'overdue',
        },
      },

      {
        title: 'Interns with delayed internship progress',
        description:
          'Interns falling behind their expected rendered hours',
        count: m.delayedInterns,
        color: '#ff9638',
        route: '/coordinator/student-interns',
        queryParams: {
          status: 'needs-follow-up',
        },
      },

      {
        title: 'Weekly reports awaiting supervisor review',
        description:
          'Submitted reports that still require a supervisor decision',
        count: m.pendingReports,
        color: '#3157d5',
        route: '/coordinator/reports-monitoring',
        queryParams: {
          status: 'pending_review',
        },
      },

    ];
  }

  get totalOpenItems(): number {

    return this.attentionItems.reduce(
      (total, item) => total + item.count,
      0
    );
  }

}