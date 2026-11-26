
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


// ==========================================
// INTERFACES
// ==========================================

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

type DashboardColor =
  | 'blue'
  | 'purple'
  | 'orange'
  | 'green'
  | 'red'
  | 'slate';

interface DashboardMetrics {
  registeredInterns: number;
  activeStudents: number;
  assignedInterns: number;
  unassignedInterns: number;
  activeInternships: number;
  notStartedInterns: number;
  partnerCompanies: number;
  activeSupervisors: number;
  delayedInterns: number;
  completedHours: number;
  overdueAttendance: number;
  overdueReports: number;
  pendingReports: number;
  presentToday: number;
  pendingAttendanceToday: number;
  notCheckedInToday: number;
}

interface SummaryCard {
  label: string;
  value: number;
  description: string;
  secondaryDescription?: string;
  color: DashboardColor;
  route: string;
  linkLabel: string;
  queryParams?: Record<string, string>;
}

interface AttentionItem {
  title: string;
  description: string;
  count: number;
  color: DashboardColor;
  route: string;
  queryParams?: Record<string, string>;
}

interface OverviewItem {
  label: string;
  value: number;
  percentage: number;
  color: DashboardColor;
}

interface AttendanceOverviewItem {
  label: string;
  value: number;
  description: string;
  color: DashboardColor;
}


// ==========================================
// COMPONENT
// ==========================================

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

  private readonly supabaseService =
    inject(SupabaseService);

  private readonly supabase =
    this.supabaseService.getClient();

  private readonly authService =
    inject(AuthService);

  private readonly cdr =
    inject(ChangeDetectorRef);

  private loadVersion = 0;
  private destroyed = false;

  loading = true;
  loadError = '';

  coordinatorName = 'Coordinator';

  metrics: DashboardMetrics =
    this.createEmptyMetrics();


  // ==========================================
  // LIFECYCLE
  // ==========================================

  ngOnInit(): void {

    void this.loadDashboardData();

  }

  ngOnDestroy(): void {

    this.destroyed = true;
    this.loadVersion++;

  }


  // ==========================================
  // INITIAL METRICS
  // ==========================================

  private createEmptyMetrics(): DashboardMetrics {

    return {
      registeredInterns: 0,
      activeStudents: 0,
      assignedInterns: 0,
      unassignedInterns: 0,
      activeInternships: 0,
      notStartedInterns: 0,
      partnerCompanies: 0,
      activeSupervisors: 0,
      delayedInterns: 0,
      completedHours: 0,
      overdueAttendance: 0,
      overdueReports: 0,
      pendingReports: 0,
      presentToday: 0,
      pendingAttendanceToday: 0,
      notCheckedInToday: 0,
    };

  }


  // ==========================================
  // PHILIPPINE DATE AND GREETING
  // ==========================================

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

    const year = parts.find(
      part => part.type === 'year'
    )?.value;

    const month = parts.find(
      part => part.type === 'month'
    )?.value;

    const day = parts.find(
      part => part.type === 'day'
    )?.value;

    return `${year}-${month}-${day}`;

  }


  // ==========================================
  // COORDINATOR DISPLAY NAME
  // ==========================================

  private getDisplayName(
    fullName: string | null | undefined
  ): string {

    const parts = (fullName || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (!parts.length) {
      return 'Coordinator';
    }

    const titles: Record<string, string> = {
      dr: 'Dr.',
      prof: 'Prof.',
      mr: 'Mr.',
      ms: 'Ms.',
      mrs: 'Mrs.',
      engr: 'Engr.',
      atty: 'Atty.',
      arch: 'Arch.',
    };

    const firstWord = parts[0]
      .replace(/\./g, '')
      .toLowerCase();

    const title = titles[firstWord] || '';

    if (title) {
      parts.shift();
    }

    const suffixes = [
      'jr',
      'sr',
      'ii',
      'iii',
      'iv',
    ];

    if (
      parts.length > 1 &&
      suffixes.includes(
        parts[parts.length - 1]
          .replace(/\./g, '')
          .toLowerCase()
      )
    ) {

      parts.pop();

    }

    if (!parts.length) {
      return 'Coordinator';
    }

    const surname = parts[parts.length - 1];

    return title
      ? `${title} ${surname}`
      : parts.join(' ');

  }


  // ==========================================
  // REQUEST VALIDATION
  // ==========================================

  private isCurrentRequest(
    version: number
  ): boolean {

    return (
      !this.destroyed &&
      version === this.loadVersion
    );

  }


  // ==========================================
  // PAGINATED DATABASE FETCH
  // ==========================================

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

        .select(columns, {
          count: 'exact',
        });

      for (
        const [column, value]
        of Object.entries(filters)
      ) {

        query = query.eq(column, value);

      }

      const {
        data,
        error,
        count,
      } = await query

        .order('id', {
          ascending: true,
        })

        .range(
          offset,
          offset + pageSize - 1
        );

      if (error) {
        throw error;
      }

      const rows =
        (data ?? []) as unknown as T[];

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


  // ==========================================
  // LOAD DASHBOARD DATA
  // ==========================================

  async loadDashboardData(): Promise<void> {

    const version = ++this.loadVersion;

    this.loading = true;
    this.loadError = '';

    this.coordinatorName = 'Coordinator';

    this.metrics = this.createEmptyMetrics();

    this.refreshView();

    try {

      // Wait for authentication initialization

      await this.authService.waitForInitialization();

      if (!this.isCurrentRequest(version)) {
        return;
      }

      if (
        !this.authService.isAuthenticated() ||
        this.authService.getUserRole() !== 'ojt_coordinator'
      ) {

        throw new Error(
          'Unauthorized coordinator account.'
        );

      }

      if (
        !this.authService.isOnline() ||
        this.authService.isOfflineSession()
      ) {

        throw new Error(
          'Internet connection is required.'
        );

      }


      // Validate authenticated user

      const {
        data: { user },
        error: authError,
      } = await this.supabase.auth.getUser();

      if (authError || !user) {

        throw new Error(
          'Unable to validate your session.'
        );

      }

      if (!this.isCurrentRequest(version)) {
        return;
      }

      const userId = user.id;


      // Retrieve coordinator profile

      const {
        data: coordinator,
        error: coordinatorError,
      } = await this.supabase

        .from('ojt_coordinators')

        .select(`
          id,
          full_name,
          account_status
        `)

        .eq('user_id', userId)

        .single();

      if (coordinatorError) {
        throw coordinatorError;
      }

      if (
        !coordinator ||
        coordinator.account_status !== 'active'
      ) {

        throw new Error(
          'Coordinator profile is unavailable.'
        );

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


      // Ensure the authenticated account
      // has not changed while loading records

      const {
        data: { user: currentUser },
        error: sessionError,
      } = await this.supabase.auth.getUser();

      if (!this.isCurrentRequest(version)) {
        return;
      }

      if (
        sessionError ||
        currentUser?.id !== userId ||
        this.authService.getUserRole() !== 'ojt_coordinator'
      ) {

        throw new Error(
          'Your session has changed.'
        );

      }


      // Personalized coordinator greeting

      this.coordinatorName = this.getDisplayName(
        coordinator.full_name
      );


      // Calculate dashboard metrics

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

      console.error(
        'Coordinator dashboard error:',
        error
      );

      this.metrics = this.createEmptyMetrics();

      this.loadError =
        'Please check your internet connection and account permissions.';

    } finally {

      if (this.isCurrentRequest(version)) {

        this.loading = false;

        this.refreshView();

      }

    }

  }


  // ==========================================
  // CALCULATE VERIFIED ATTENDANCE HOURS
  // ==========================================

  private getAttendanceHours(
    record: Attendance
  ): number {

    if (
      record.sync_status !== 'synced' ||
      record.verification_status !== 'verified' ||
      !record.time_in ||
      !record.time_out
    ) {

      return 0;

    }

    const start = new Date(
      record.time_in
    ).getTime();

    const end = new Date(
      record.time_out
    ).getTime();

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start
    ) {

      return 0;

    }

    if (record.total_hours_rendered !== null) {

      const storedHours = Number(
        record.total_hours_rendered
      );

      if (
        Number.isFinite(storedHours) &&
        storedHours >= 0
      ) {

        return storedHours;

      }

    }

    return (end - start) / 3600000;

  }


  private getRequiredHours(
    student: Student
  ): number {

    const hours = Number(
      student.required_hours
    );

    return Number.isFinite(hours) && hours > 0
      ? hours
      : 486;

  }


  // ==========================================
  // INTERNSHIP PROGRESS
  // ==========================================

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

    const current = Date.parse(
      `${today}T00:00:00Z`
    );

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      !Number.isFinite(current) ||
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

      (
        verifiedHours /
        this.getRequiredHours(student)
      ) * 100

    );

    // Existing follow-up threshold:
    // More than 10 percentage points behind schedule

    return expectedProgress - actualProgress > 10;

  }


  // ==========================================
  // DASHBOARD METRICS
  // ==========================================

  private calculateMetrics(
    students: Student[],
    assignments: Assignment[],
    attendance: Attendance[],
    reports: WeeklyReport[],
    supervisors: Supervisor[]
  ): void {

    const today = this.getManilaDate();

    const now = Date.now();

    const dayMilliseconds =
      24 * 60 * 60 * 1000;


    // ======================================
    // ACTIVE STUDENTS
    // ======================================

    const activeStudents = students.filter(

      student =>
        student.account_status === 'active'

    );

    const studentUUIDs = new Set(

      activeStudents.map(
        student => student.id
      )

    );


    // ======================================
    // ACTIVE ASSIGNMENTS
    // ======================================

    const activeAssignments = assignments.filter(

      assignment =>
        assignment.assignment_status === 'active' &&
        assignment.student_id !== null &&
        assignment.supervisor_id !== null &&
        studentUUIDs.has(assignment.student_id)

    );

    const assignedStudentUUIDs = new Set(

      activeAssignments.map(
        assignment => assignment.student_id
      )

    );

    const assignedStudents = activeStudents.filter(

      student =>
        assignedStudentUUIDs.has(student.id)

    );

    const assignedSchoolIds = new Set(

      assignedStudents.map(
        student => student.student_id
      )

    );


    // ======================================
    // VERIFIED INTERNSHIP HOURS
    // ======================================

    const verifiedHoursMap =
      new Map<string, number>();

    for (const record of attendance) {

      const hours = this.getAttendanceHours(
        record
      );

      const previous =
        verifiedHoursMap.get(record.student_id) ?? 0;

      verifiedHoursMap.set(
        record.student_id,
        previous + hours
      );

    }


    // ======================================
    // STUDENTS WITH COMPLETED HOURS
    // ======================================

    const completedStudents = activeStudents.filter(

      student => {

        const hours =
          verifiedHoursMap.get(student.student_id) ?? 0;

        return hours >= this.getRequiredHours(student);

      }

    );

    const completedUUIDs = new Set(

      completedStudents.map(
        student => student.id
      )

    );


    // ======================================
    // ONGOING INTERNSHIPS
    // ======================================

    const ongoingStudents = assignedStudents.filter(

      student => {

        const hasStarted =
          !!student.ojt_start_date &&
          student.ojt_start_date <= today;

        return (
          hasStarted &&
          !completedUUIDs.has(student.id)
        );

      }

    );

    const ongoingUUIDs = new Set(

      ongoingStudents.map(
        student => student.id
      )

    );

    const ongoingSchoolIds = new Set(

      ongoingStudents.map(
        student => student.student_id
      )

    );


    // ======================================
    // ASSIGNED BUT NOT YET STARTED
    // ======================================

    const notStartedStudents = assignedStudents.filter(

      student =>

        !completedUUIDs.has(student.id) &&

        (
          !student.ojt_start_date ||
          student.ojt_start_date > today
        )

    );


    // ======================================
    // UNIQUE PARTNER COMPANIES
    // ======================================

    const companyNames = new Set(

      activeAssignments

        .map(assignment =>
          (assignment.company_name || '')
            .trim()
            .toLowerCase()
        )

        .filter(Boolean)

    );


    // ======================================
    // ACTIVE SUPERVISORS
    // ======================================

    const activeSupervisorIds = new Set(

      supervisors.map(
        supervisor => supervisor.id
      )

    );

    const handlingSupervisorIds = new Set(

      activeAssignments

        .filter(assignment =>

          assignment.student_id !== null &&
          assignment.supervisor_id !== null &&

          ongoingUUIDs.has(
            assignment.student_id
          ) &&

          activeSupervisorIds.has(
            assignment.supervisor_id
          )

        )

        .map(
          assignment => assignment.supervisor_id
        )

    );


    // ======================================
    // INTERNS REQUIRING FOLLOW-UP
    // ======================================

    const delayedStudents = ongoingStudents.filter(

      student => {

        const hours =
          verifiedHoursMap.get(student.student_id) ?? 0;

        return this.hasDelayedProgress(
          student,
          hours,
          today
        );

      }

    );


    // ======================================
    // OVERDUE ATTENDANCE
    // Existing threshold: 72 hours
    // ======================================

    const overdueAttendance = attendance.filter(

      record => {

        if (
          !assignedSchoolIds.has(record.student_id)
        ) {

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

          now - referenceTime >
            72 * 60 * 60 * 1000

        );

      }

    );


    // ======================================
    // LATEST WEEKLY REPORT SUBMISSIONS
    // ======================================

    const latestSubmission =
      new Map<string, number>();

    for (const report of reports) {

      if (
        report.status === 'draft' ||
        !report.submitted_at
      ) {

        continue;

      }

      const submittedTime = Date.parse(
        report.submitted_at
      );

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


    // ======================================
    // OVERDUE WEEKLY REPORTS
    // Existing threshold: 14 days
    // ======================================

    const overdueReports = ongoingStudents.filter(

      student => {

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

          latestSubmission.get(
            student.student_id
          ) ?? startTime;

        const referenceTime = Math.max(
          lastSubmitted,
          startTime
        );

        return (

          now - referenceTime >
          14 * dayMilliseconds

        );

      }

    );


    // ======================================
    // REPORTS AWAITING SUPERVISOR REVIEW
    // ======================================

    const pendingReports = reports.filter(

      report =>

        ongoingSchoolIds.has(report.student_id) &&

        report.status === 'pending_review'

    );


    // ======================================
    // TODAY'S ATTENDANCE OVERVIEW
    // ======================================

    const todaysAttendance = attendance.filter(

      record =>

        record.attendance_date === today &&

        record.sync_status === 'synced' &&

        ongoingSchoolIds.has(record.student_id)

    );


    // Count unique interns who checked in

    const presentStudentIds = new Set(

      todaysAttendance

        .filter(
          record => Boolean(record.time_in)
        )

        .map(
          record => record.student_id
        )

    );


    // Complete records awaiting verification

    const pendingAttendanceToday =
      todaysAttendance.filter(

        record =>

          record.verification_status === 'provisional' &&

          Boolean(record.time_in) &&

          Boolean(record.time_out)

      ).length;


    // Ongoing interns without a synced check-in

    const notCheckedInToday = Math.max(

      0,

      ongoingStudents.length -
        presentStudentIds.size

    );


    // ======================================
    // FINAL DASHBOARD METRICS
    // ======================================

    this.metrics = {

      registeredInterns:
        students.length,

      activeStudents:
        activeStudents.length,

      assignedInterns:
        assignedStudents.length,

      unassignedInterns:
        activeStudents.length -
        assignedStudents.length,

      activeInternships:
        ongoingStudents.length,

      notStartedInterns:
        notStartedStudents.length,

      partnerCompanies:
        companyNames.size,

      activeSupervisors:
        handlingSupervisorIds.size,

      delayedInterns:
        delayedStudents.length,

      completedHours:
        completedStudents.length,

      overdueAttendance:
        overdueAttendance.length,

      overdueReports:
        overdueReports.length,

      pendingReports:
        pendingReports.length,

      presentToday:
        presentStudentIds.size,

      pendingAttendanceToday:
        pendingAttendanceToday,

      notCheckedInToday:
        notCheckedInToday,

    };

  }


  // ==========================================
  // SUMMARY CARDS
  // ==========================================

  get summaryCards(): SummaryCard[] {

    const m = this.metrics;

    return [

      {
        label: 'Registered interns',

        value: m.registeredInterns,

        description:
          `${m.assignedInterns} assigned · ` +
          `${m.unassignedInterns} unassigned`,

        color: 'blue',

        route: '/coordinator/student-interns',

        linkLabel: 'View student interns',
      },

      {
        label: 'Active internships',

        value: m.activeInternships,

        description:

          `${m.partnerCompanies} ${
            m.partnerCompanies === 1
              ? 'company'
              : 'companies'
          } · ` +

          `${m.activeSupervisors} ${
            m.activeSupervisors === 1
              ? 'supervisor'
              : 'supervisors'
          }`,

        color: 'purple',

        route: '/coordinator/internship-assignments',

        linkLabel: 'View assignments',
      },

      {
        label: 'Needs follow-up',

        value: m.delayedInterns,

        description:

          m.delayedInterns === 0

            ? 'No delayed interns'

            : `${m.delayedInterns} behind schedule`,

        color: 'orange',

        route: '/coordinator/student-interns',

        linkLabel: 'View interns',

        queryParams: {
          status: 'needs-follow-up',
        },
      },

      {
        label: 'Hours completed',

        value: m.completedHours,

        description: 'Hour requirement met',

        color: 'green',

        route: '/coordinator/reports-records',

        linkLabel: 'View completion records',

        queryParams: {
          type: 'completion',
        },
      },

    ];

  }


  // ==========================================
  // NEEDS ATTENTION
  // ==========================================

  get attentionItems(): AttentionItem[] {

    const m = this.metrics;

    const items: AttentionItem[] = [

      {
        title: 'Unassigned student interns',

        description:
          'Awaiting company placement',

        count: m.unassignedInterns,

        color: 'orange',

        route: '/coordinator/student-interns',

        queryParams: {
          status: 'unassigned',
        },
      },

      {
        title: 'Overdue attendance',

        description:
          'Unresolved records beyond 72 hours',

        count: m.overdueAttendance,

        color: 'red',

        route: '/coordinator/attendance-monitoring',

        queryParams: {
          status: 'overdue',
        },
      },

      {
        title: 'Overdue weekly reports',

        description:
          'No report submitted in the last 14 days',

        count: m.overdueReports,

        color: 'red',

        route: '/coordinator/reports-monitoring',

        queryParams: {
          status: 'overdue',
        },
      },

      {
        title: 'Interns needing follow-up',

        description:
          'Internship hours behind schedule',

        count: m.delayedInterns,

        color: 'orange',

        route: '/coordinator/student-interns',

        queryParams: {
          status: 'needs-follow-up',
        },
      },

      {
        title: 'Weekly reports pending review',

        description:
          'Awaiting supervisor decision',

        count: m.pendingReports,

        color: 'purple',

        route: '/coordinator/reports-monitoring',

        queryParams: {
          status: 'pending_review',
        },
      },

    ];

    // Only show items that require attention

    return items.filter(
      item => item.count > 0
    );

  }


  get totalOpenItems(): number {

    return this.attentionItems.reduce(

      (total, item) =>
        total + item.count,

      0

    );

  }


  // ==========================================
  // INTERNSHIP OVERVIEW
  // ==========================================

  get internshipOverview(): OverviewItem[] {

    const m = this.metrics;

    // Completed, ongoing, and not-started
    // students are mutually exclusive.
    // The remaining active students are unassigned.

    const unassignedWithoutCompleted = Math.max(

      0,

      m.activeStudents -
      m.activeInternships -
      m.notStartedInterns -
      m.completedHours

    );

    return [

      {
        label: 'Ongoing',

        value: m.activeInternships,

        percentage: this.getPercentage(
          m.activeInternships,
          m.activeStudents
        ),

        color: 'blue',
      },

      {
        label: 'Hours completed',

        value: m.completedHours,

        percentage: this.getPercentage(
          m.completedHours,
          m.activeStudents
        ),

        color: 'green',
      },

      {
        label: 'Awaiting placement',

        value: unassignedWithoutCompleted,

        percentage: this.getPercentage(
          unassignedWithoutCompleted,
          m.activeStudents
        ),

        color: 'orange',
      },

      {
        label: 'Not yet started / unscheduled',

        value: m.notStartedInterns,

        percentage: this.getPercentage(
          m.notStartedInterns,
          m.activeStudents
        ),

        color: 'purple',
      },

    ];

  }


  // ==========================================
  // TODAY'S ATTENDANCE OVERVIEW
  // ==========================================

  get attendanceOverview(): AttendanceOverviewItem[] {

    const m = this.metrics;

    return [

      {
        label: 'Checked in',

        value: m.presentToday,

        description:
          `Of ${m.activeInternships} ongoing interns`,

        color: 'green',
      },

      {
        label: 'Awaiting verification',

        value: m.pendingAttendanceToday,

        description:
          'Complete provisional records today',

        color: 'purple',
      },

      {
        label: 'No synced check-in',

        value: m.notCheckedInToday,

        description:
          'Ongoing interns without a synced check-in today',

        color: 'slate',
      },

    ];

  }


  // ==========================================
  // PERCENTAGE CALCULATION
  // ==========================================

  private getPercentage(
    value: number,
    total: number
  ): number {

    if (
      !Number.isFinite(value) ||
      !Number.isFinite(total) ||
      total <= 0
    ) {

      return 0;

    }

    return Math.max(

      0,

      Math.min(
        100,
        Math.round((value / total) * 100)
      )

    );

  }


  // ==========================================
  // REFRESH VIEW
  // ==========================================

  private refreshView(): void {

    if (!this.destroyed) {

      this.cdr.markForCheck();

    }

  }

}
