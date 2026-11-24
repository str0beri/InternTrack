import { CommonModule } from '@angular/common';

import {
  ChangeDetectorRef,
  Component,
  inject,
  type OnInit,
  type OnDestroy,
} from '@angular/core';

import { RouterLink } from '@angular/router';

import { SupabaseService } from '../../../services/supabase.service';

// Interfaces

interface Student {
  id: string;
  student_id: string;
  full_name: string;
  course: string | null;
  required_hours: number | null;
  ojt_start_date: string | null;
  ojt_end_date: string | null;
}

interface AttendanceRecord {
  id: string;
  student_id: string;
  attendance_date: string;
  time_in: string | null;
  time_out: string | null;
  total_hours_rendered: number | null;
  verification_status: string | null;
  sync_status: string | null;
}

interface ReportRecord {
  id: number;
  student_id: string;
  status: string;
}

interface EvaluationRecord {
  id: string;
  student_id: string | null;
  supervisor_name: string;
  rating: number | null;
}

interface SupervisorMetrics {
  totalInterns: number;
  presentToday: number;
  pendingAttendance: number;
  incompleteAttendance: number;
  reportsToReview: number;
  returnedReports: number;
  evaluationsToComplete: number;
  needsFollowUp: number;
  completedInterns: number;
}

type AttendanceStatus =
  | 'pending'
  | 'verified'
  | 'incomplete'
  | 'rejected'
  | 'unknown';

interface AttendancePreview {
  id: string;
  studentId: string;
  name: string;
  initials: string;
  avatarColor: string;
  timeIn: string;
  timeOut: string;
  status: string;
  statusClass: AttendanceStatus;
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
  private readonly cdr = inject(ChangeDetectorRef);

  private loadVersion = 0;
  private destroyed = false;

  loading = true;
  loadError = '';

  supervisorName = '';
  firstName = 'Supervisor';

  attendanceDate = '';
  greeting = 'Welcome';

  attendanceList: AttendancePreview[] = [];

  metrics: SupervisorMetrics = this.emptyMetrics();

  ngOnInit(): void {
    this.updateDateAndGreeting();
    void this.loadDashboardData();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.loadVersion++;
  }

  // Initial dashboard values

  private emptyMetrics(): SupervisorMetrics {
    return {
      totalInterns: 0,
      presentToday: 0,
      pendingAttendance: 0,
      incompleteAttendance: 0,
      reportsToReview: 0,
      returnedReports: 0,
      evaluationsToComplete: 0,
      needsFollowUp: 0,
      completedInterns: 0,
    };
  }

  // Philippine date and time

  private getPhilippineDate(date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);

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

  private updateDateAndGreeting(): void {
    const now = new Date();

    this.attendanceDate = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(now);

    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Manila',
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(now)
    );

    if (hour < 12) {
      this.greeting = 'Good morning';
    } else if (hour < 18) {
      this.greeting = 'Good afternoon';
    } else {
      this.greeting = 'Good evening';
    }
  }

  private formatTime(value: string | null): string {
    if (!value) {
      return '—';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return '—';
    }

    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  }

  // Load dashboard

  async loadDashboardData(): Promise<void> {
    const version = ++this.loadVersion;

    this.loading = true;
    this.loadError = '';
    this.metrics = this.emptyMetrics();
    this.attendanceList = [];
    this.supervisorName = '';
    this.firstName = 'Supervisor';

    this.updateDateAndGreeting();
    this.refreshView();

    try {
      // Validate the current authenticated account

      const {
        data: { user },
        error: authError,
      } = await this.supabase.auth.getUser();

      if (authError || !user) {
        throw new Error('Unable to validate your account.');
      }

      if (!this.isCurrentRequest(version)) {
        return;
      }

      // Get the company supervisor profile

      const {
        data: supervisor,
        error: supervisorError,
      } = await this.supabase
        .from('company_supervisors')
        .select('id, full_name, account_status')
        .eq('user_id', user.id)
        .single();

      if (supervisorError || !supervisor) {
        throw new Error('Supervisor profile not found.');
      }

      if (supervisor.account_status !== 'active') {
        throw new Error('Supervisor account is not active.');
      }

      if (!this.isCurrentRequest(version)) {
        return;
      }

      this.supervisorName = supervisor.full_name;

      this.firstName =
        supervisor.full_name?.trim().split(/\s+/)[0]
        || 'Supervisor';

      // Get all active intern assignments

      const assignments = await this.loadAssignments(
        supervisor.id
      );

      if (!this.isCurrentRequest(version)) {
        return;
      }

      // Extract and remove duplicate students

      const studentMap = new Map<string, Student>();

      for (const assignment of assignments) {
        const student = Array.isArray(assignment.students)
          ? assignment.students[0]
          : assignment.students;

        if (student?.student_id) {
          studentMap.set(student.student_id, student);
        }
      }

      const students = Array.from(studentMap.values());

      const schoolIds = students.map(
        student => student.student_id
      );

      const nextMetrics = this.emptyMetrics();

      nextMetrics.totalInterns = students.length;

      // Handle supervisors with no assigned interns

      if (schoolIds.length === 0) {
        this.metrics = nextMetrics;
        return;
      }

      // Load records for assigned interns only

      const [
        attendance,
        reports,
        evaluations,
      ] = await Promise.all([
        this.loadAttendance(schoolIds),
        this.loadReports(schoolIds),
        this.loadEvaluations(
          schoolIds,
          supervisor.full_name
        ),
      ]);

      if (!this.isCurrentRequest(version)) {
        return;
      }

      // Confirm that the account has not changed

      const {
        data: { user: currentUser },
        error: currentUserError,
      } = await this.supabase.auth.getUser();

      if (!this.isCurrentRequest(version)) {
        return;
      }

      if (
        currentUserError ||
        currentUser?.id !== user.id
      ) {
        throw new Error('Your session has changed.');
      }

      const today = this.getPhilippineDate();

      // Today's synchronized attendance

      const todaysAttendance = attendance.filter(
        record => record.attendance_date === today
      );

      // Count unique students who checked in today

      const presentStudentIds = new Set(
        todaysAttendance
          .filter(record => Boolean(record.time_in))
          .map(record => record.student_id)
      );

      nextMetrics.presentToday = presentStudentIds.size;

      // Completed attendance records awaiting verification

      nextMetrics.pendingAttendance = attendance.filter(
        record =>
          record.verification_status === 'provisional' &&
          Boolean(record.time_in) &&
          Boolean(record.time_out)
      ).length;

      // Incomplete records from previous dates only.
      // An intern currently working today is not yet overdue.

      nextMetrics.incompleteAttendance = attendance.filter(
        record =>
          record.attendance_date < today &&
          record.verification_status === 'provisional' &&
          (!record.time_in || !record.time_out)
      ).length;

      // Weekly report counts

      nextMetrics.reportsToReview = reports.filter(
        report => report.status === 'pending_review'
      ).length;

      nextMetrics.returnedReports = reports.filter(
        report => report.status === 'returned'
      ).length;

      // Evaluation counts
      // Temporary rule based on the existing database schema

      const evaluatedStudentIds = new Set(
        evaluations
          .filter(
            evaluation =>
              evaluation.student_id &&
              evaluation.rating !== null
          )
          .map(evaluation => evaluation.student_id)
      );

      nextMetrics.evaluationsToComplete = students.filter(
        student =>
          !evaluatedStudentIds.has(student.student_id)
      ).length;

      // Calculate verified internship hours

      const verifiedHours = new Map<string, number>();

      for (const record of attendance) {
        if (
          record.verification_status !== 'verified' ||
          !record.time_in ||
          !record.time_out
        ) {
          continue;
        }

        const hours = this.calculateHours(record);

        const previousHours =
          verifiedHours.get(record.student_id) || 0;

        verifiedHours.set(
          record.student_id,
          previousHours + hours
        );
      }

      // Calculate internship progress

      for (const student of students) {
        const completed =
          verifiedHours.get(student.student_id) || 0;

        const required = Number(student.required_hours);

        if (!Number.isFinite(required) || required <= 0) {
          continue;
        }

        if (completed >= required) {
          nextMetrics.completedInterns++;
          continue;
        }

        if (
          this.needsFollowUp(
            student,
            completed,
            required,
            today
          )
        ) {
          nextMetrics.needsFollowUp++;
        }
      }

      // Build today's attendance preview

      this.attendanceList = todaysAttendance
        .sort((a, b) => {
          const timeA = a.time_in
            ? new Date(a.time_in).getTime()
            : Number.MAX_SAFE_INTEGER;

          const timeB = b.time_in
            ? new Date(b.time_in).getTime()
            : Number.MAX_SAFE_INTEGER;

          return timeA - timeB;
        })
        .slice(0, 6)
        .map(record => {
          const student = studentMap.get(record.student_id);

          const name = student?.full_name || 'Unknown student';

          const status = this.getAttendanceStatus(record);

          return {
            id: record.id,
            studentId: record.student_id,
            name,
            initials: this.getInitials(name),
            avatarColor: this.getAvatarColor(record.student_id),
            timeIn: this.formatTime(record.time_in),
            timeOut: this.formatTime(record.time_out),
            status: status.label,
            statusClass: status.type,
          };
        });

      this.metrics = nextMetrics;

    } catch (error) {

      if (!this.isCurrentRequest(version)) {
        return;
      }

      console.error('Dashboard loading failed:', error);

      this.metrics = this.emptyMetrics();
      this.attendanceList = [];

      this.loadError =
        'Please check your connection and account access, then try again.';

    } finally {

      if (this.isCurrentRequest(version)) {
        this.loading = false;
        this.refreshView();
      }

    }
  }

  // Load active assignments with pagination

  private async loadAssignments(
    supervisorId: string
  ): Promise<any[]> {

    const records: any[] = [];
    const pageSize = 500;

    let offset = 0;

    while (true) {

      const { data, error, count } = await this.supabase
        .from('intern_supervisor_assignments')
        .select(`
          id,
          student_id,
          students!student_id(
            id,
            student_id,
            full_name,
            course,
            required_hours,
            ojt_start_date,
            ojt_end_date
          )
        `, { count: 'exact' })
        .eq('supervisor_id', supervisorId)
        .eq('assignment_status', 'active')
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (error) {
        throw error;
      }

      const page = data ?? [];

      records.push(...page);

      offset += page.length;

      if (
        page.length === 0 ||
        (count !== null && offset >= count) ||
        (count === null && page.length < pageSize)
      ) {
        break;
      }
    }

    return records;
  }

  // Split large student ID lists into smaller batches

  private createBatches(
    values: string[],
    size = 50
  ): string[][] {

    const batches: string[][] = [];

    for (let i = 0; i < values.length; i += size) {
      batches.push(values.slice(i, i + size));
    }

    return batches;
  }

  // Load synchronized attendance

  private async loadAttendance(
    studentIds: string[]
  ): Promise<AttendanceRecord[]> {

    const records: AttendanceRecord[] = [];
    const pageSize = 500;

    for (const batch of this.createBatches(studentIds)) {

      let offset = 0;

      while (true) {

        const { data, error, count } = await this.supabase
          .from('attendance')
          .select(`
            id,
            student_id,
            attendance_date,
            time_in,
            time_out,
            total_hours_rendered,
            verification_status,
            sync_status
          `, { count: 'exact' })
          .in('student_id', batch)
          .eq('sync_status', 'synced')
          .order('id', { ascending: true })
          .range(offset, offset + pageSize - 1);

        if (error) {
          throw error;
        }

        const page = (data ?? []) as AttendanceRecord[];

        records.push(...page);

        offset += page.length;

        if (
          page.length === 0 ||
          (count !== null && offset >= count) ||
          (count === null && page.length < pageSize)
        ) {
          break;
        }
      }
    }

    return records;
  }

  // Load pending and returned weekly reports

  private async loadReports(
    studentIds: string[]
  ): Promise<ReportRecord[]> {

    const records: ReportRecord[] = [];
    const pageSize = 500;

    for (const batch of this.createBatches(studentIds)) {

      let offset = 0;

      while (true) {

        const { data, error, count } = await this.supabase
          .from('reports')
          .select(
            'id, student_id, status',
            { count: 'exact' }
          )
          .in('student_id', batch)
          .in('status', ['pending_review', 'returned'])
          .order('id', { ascending: true })
          .range(offset, offset + pageSize - 1);

        if (error) {
          throw error;
        }

        const page = (data ?? []) as ReportRecord[];

        records.push(...page);

        offset += page.length;

        if (
          page.length === 0 ||
          (count !== null && offset >= count) ||
          (count === null && page.length < pageSize)
        ) {
          break;
        }
      }
    }

    return records;
  }

  // Load evaluations using the existing schema

  private async loadEvaluations(
    studentIds: string[],
    supervisorName: string
  ): Promise<EvaluationRecord[]> {

    const records: EvaluationRecord[] = [];
    const pageSize = 500;

    for (const batch of this.createBatches(studentIds)) {

      let offset = 0;

      while (true) {

        const { data, error, count } = await this.supabase
          .from('evaluations')
          .select(
            'id, student_id, supervisor_name, rating',
            { count: 'exact' }
          )
          .in('student_id', batch)
          .eq('supervisor_name', supervisorName)
          .order('id', { ascending: true })
          .range(offset, offset + pageSize - 1);

        if (error) {
          throw error;
        }

        const page = (data ?? []) as EvaluationRecord[];

        records.push(...page);

        offset += page.length;

        if (
          page.length === 0 ||
          (count !== null && offset >= count) ||
          (count === null && page.length < pageSize)
        ) {
          break;
        }
      }
    }

    return records;
  }

  // Calculate attendance hours

  private calculateHours(
    record: AttendanceRecord
  ): number {

    if (!record.time_in || !record.time_out) {
      return 0;
    }

    const timeIn = new Date(record.time_in).getTime();

    const timeOut = new Date(record.time_out).getTime();

    if (
      !Number.isFinite(timeIn) ||
      !Number.isFinite(timeOut) ||
      timeOut <= timeIn
    ) {
      return 0;
    }

    const storedHours = Number(record.total_hours_rendered);

    if (
      record.total_hours_rendered !== null &&
      Number.isFinite(storedHours) &&
      storedHours >= 0
    ) {
      return storedHours;
    }

    return (timeOut - timeIn) / 3600000;
  }

  // Determine whether an intern needs follow-up

  private needsFollowUp(
    student: Student,
    completedHours: number,
    requiredHours: number,
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

    // Internship has ended but required hours are incomplete

    if (current > end) {
      return completedHours < requiredHours;
    }

    const expectedProgress = Math.max(
      0,
      Math.min(
        100,
        ((current - start) / (end - start)) * 100
      )
    );

    const actualProgress =
      (completedHours / requiredHours) * 100;

    // Flag students who are more than
    // 10 percentage points behind expected progress

    return expectedProgress - actualProgress > 10;
  }

  // Attendance status

  private getAttendanceStatus(
    record: AttendanceRecord
  ): {
    label: string;
    type: AttendanceStatus;
  } {

    if (record.verification_status === 'rejected') {
      return {
        label: 'Rejected',
        type: 'rejected',
      };
    }

    if (!record.time_in || !record.time_out) {
      return {
        label: 'Incomplete',
        type: 'incomplete',
      };
    }

    if (record.verification_status === 'verified') {
      return {
        label: 'Verified',
        type: 'verified',
      };
    }

    if (record.verification_status === 'provisional') {
      return {
        label: 'Pending',
        type: 'pending',
      };
    }

    return {
      label: 'Unknown',
      type: 'unknown',
    };
  }

  // Student avatar

  private getInitials(fullName: string): string {
    const parts = fullName
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (!parts.length) {
      return '?';
    }

    return parts
      .slice(0, 2)
      .map(part => part.charAt(0).toUpperCase())
      .join('');
  }

  private getAvatarColor(studentId: string): string {
    const colors = [
      'blue',
      'orange',
      'slate',
      'green',
      'purple',
    ];

    let hash = 0;

    for (const character of studentId) {
      hash = (hash * 31 + character.charCodeAt(0)) | 0;
    }

    return colors[Math.abs(hash) % colors.length];
  }

  // Summary cards

  get summaryCards() {

    const notCheckedIn = Math.max(
      0,
      this.metrics.totalInterns - this.metrics.presentToday
    );

    return [
      {
        label: 'Assigned interns',
        value: this.metrics.totalInterns,
        color: 'blue',
        highlight:
          `${this.metrics.needsFollowUp} need follow-up`,
        description:
          ` · ${this.metrics.completedInterns} completed`,
        linkLabel: 'View my interns',
        route: '/supervisor/interns',
      },
      {
        label: 'Present today',
        value: this.metrics.presentToday,
        color: 'green',
        highlight: '',
        description: `${notCheckedIn} not yet checked in`,
        linkLabel: 'View attendance',
        route: '/supervisor/attendance',
      },
      {
        label: 'Attendance pending',
        value: this.metrics.pendingAttendance,
        color: 'orange',
        highlight:
          `${this.metrics.incompleteAttendance} incomplete`,
        description: ' · verification required',
        linkLabel: 'Verify records',
        route: '/supervisor/attendance',
      },
      {
        label: 'Weekly reports pending',
        value: this.metrics.reportsToReview,
        color: 'purple',
        highlight: '',
        description:
          `${this.metrics.returnedReports} returned for revision`,
        linkLabel: 'Review reports',
        route: '/supervisor/reports',
      },
    ];
  }

  // Needs attention

  get attentionItems() {
    return [
      {
        title: 'Unverified attendance',
        description:
          `${this.metrics.pendingAttendance} records need photo and GPS review`,
        count: this.metrics.pendingAttendance,
        color: 'orange',
        route: '/supervisor/attendance',
      },
      {
        title: 'Incomplete attendance',
        description:
          `${this.metrics.incompleteAttendance} previous records are missing a time-in or time-out`,
        count: this.metrics.incompleteAttendance,
        color: 'red',
        route: '/supervisor/attendance',
      },
      {
        title: 'Weekly reports to review',
        description:
          `${this.metrics.reportsToReview} submitted reports are waiting for a decision`,
        count: this.metrics.reportsToReview,
        color: 'blue',
        route: '/supervisor/reports',
      },
      {
        title: 'Evaluations to complete',
        description:
          `${this.metrics.evaluationsToComplete} interns do not have a recorded evaluation`,
        count: this.metrics.evaluationsToComplete,
        color: 'purple',
        route: '/supervisor/evaluations',
      },
    ];
  }

  // Prevent outdated requests from updating the page

  private isCurrentRequest(version: number): boolean {
    return (
      !this.destroyed &&
      version === this.loadVersion
    );
  }

  private refreshView(): void {
    if (!this.destroyed) {
      this.cdr.markForCheck();
    }
  }
}