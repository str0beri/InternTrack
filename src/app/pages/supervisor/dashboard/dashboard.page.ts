
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


// ==========================================
// INTERFACES
// ==========================================

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

interface SupervisorMetrics {
  totalInterns: number;
  presentToday: number;
  pendingAttendance: number;
  incompleteAttendance: number;
  reportsToReview: number;
  returnedReports: number;
  needsFollowUp: number;
  completedInterns: number;
}

type AttendanceStatus =
  | 'pending'
  | 'provisional'
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

  private readonly supabaseService = inject(SupabaseService);

  private readonly supabase =
    this.supabaseService.getClient();

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


  // ==========================================
  // LIFECYCLE
  // ==========================================

  ngOnInit(): void {

    this.updateDateAndGreeting();

    void this.loadDashboardData();

  }

  ngOnDestroy(): void {

    this.destroyed = true;

    this.loadVersion++;

  }


  // ==========================================
  // INITIAL DASHBOARD VALUES
  // ==========================================

  private emptyMetrics(): SupervisorMetrics {

    return {
      totalInterns: 0,
      presentToday: 0,
      pendingAttendance: 0,
      incompleteAttendance: 0,
      reportsToReview: 0,
      returnedReports: 0,
      needsFollowUp: 0,
      completedInterns: 0,
    };

  }


  // ==========================================
  // PHILIPPINE DATE AND TIME
  // ==========================================

  private getPhilippineDate(
    date = new Date()
  ): string {

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

    this.attendanceDate = new Intl.DateTimeFormat(
      'en-US',
      {
        timeZone: 'Asia/Manila',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }
    ).format(now);

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


  // ==========================================
  // SUPERVISOR DISPLAY NAME
  // ==========================================

  private formatSupervisorName(
    fullName: string | null | undefined
  ): string {

    const parts = (fullName || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (!parts.length) {
      return 'Supervisor';
    }

    const titles: Record<string, string> = {
      engr: 'Engr.',
      dr: 'Dr.',
      mr: 'Mr.',
      ms: 'Ms.',
      mrs: 'Mrs.',
      prof: 'Prof.',
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

    const surname = parts[parts.length - 1];

    if (!surname) {
      return 'Supervisor';
    }

    return title
      ? `${title} ${surname}`
      : surname;

  }


  private formatTime(
    value: string | null
  ): string {

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


  // ==========================================
  // LOAD DASHBOARD DATA
  // ==========================================

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

      // Validate authenticated account

      const {
        data: { user },
        error: authError,
      } = await this.supabase.auth.getUser();

      if (authError || !user) {

        throw new Error(
          'Unable to validate your account.'
        );

      }

      if (!this.isCurrentRequest(version)) {
        return;
      }


      // Get company supervisor profile

      const {
        data: supervisor,
        error: supervisorError,
      } = await this.supabase
        .from('company_supervisors')
        .select('id, full_name, account_status')
        .eq('user_id', user.id)
        .single();

      if (supervisorError || !supervisor) {

        throw new Error(
          'Supervisor profile not found.'
        );

      }

      if (supervisor.account_status !== 'active') {

        throw new Error(
          'Supervisor account is not active.'
        );

      }

      if (!this.isCurrentRequest(version)) {
        return;
      }

      this.supervisorName = supervisor.full_name;

      this.firstName = this.formatSupervisorName(
        supervisor.full_name
      );


      // Load active intern assignments

      const assignments = await this.loadAssignments(
        supervisor.id
      );

      if (!this.isCurrentRequest(version)) {
        return;
      }


      // Extract unique assigned students

      const studentMap = new Map<string, Student>();

      for (const assignment of assignments) {

        const student = Array.isArray(assignment.students)
          ? assignment.students[0]
          : assignment.students;

        if (student?.student_id) {

          studentMap.set(
            student.student_id,
            student
          );

        }

      }

      const students = Array.from(
        studentMap.values()
      );

      const schoolIds = students.map(
        student => student.student_id
      );

      const nextMetrics = this.emptyMetrics();

      nextMetrics.totalInterns = students.length;


      // Handle supervisors without assigned interns

      if (schoolIds.length === 0) {

        this.metrics = nextMetrics;

        return;

      }


      // Load attendance and weekly reports

      const [
        attendance,
        reports,
      ] = await Promise.all([

        this.loadAttendance(schoolIds),

        this.loadReports(schoolIds),

      ]);

      if (!this.isCurrentRequest(version)) {
        return;
      }


      // Confirm that the authenticated account
      // has not changed while loading records

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

        throw new Error(
          'Your session has changed.'
        );

      }

      const today = this.getPhilippineDate();


      // ======================================
      // TODAY'S ATTENDANCE
      // ======================================

      const todaysAttendance = attendance.filter(
        record => record.attendance_date === today
      );


      // Count unique students who checked in

      const presentStudentIds = new Set(

        todaysAttendance
          .filter(record => Boolean(record.time_in))
          .map(record => record.student_id)

      );

      nextMetrics.presentToday =
        presentStudentIds.size;


      // ======================================
      // ATTENDANCE VERIFICATION
      // ======================================

      nextMetrics.pendingAttendance =
        attendance.filter(

          record =>
            record.verification_status === 'provisional' &&
            Boolean(record.time_in) &&
            Boolean(record.time_out)

        ).length;


      // Only previous incomplete records require
      // attention. Today's ongoing attendance
      // is not counted as overdue.

      nextMetrics.incompleteAttendance =
        attendance.filter(

          record =>
            record.attendance_date < today &&
            record.verification_status === 'provisional' &&
            (!record.time_in || !record.time_out)

        ).length;


      // ======================================
      // WEEKLY REPORTS
      // ======================================

      nextMetrics.reportsToReview =
        reports.filter(

          report => report.status === 'pending_review'

        ).length;

      nextMetrics.returnedReports =
        reports.filter(

          report => report.status === 'returned'

        ).length;


      // ======================================
      // VERIFIED INTERNSHIP HOURS
      // ======================================

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


      // ======================================
      // INTERNSHIP PROGRESS
      // ======================================

      for (const student of students) {

        const completed =
          verifiedHours.get(student.student_id) || 0;

        const required = Number(
          student.required_hours
        );

        if (
          !Number.isFinite(required) ||
          required <= 0
        ) {

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


      // ======================================
      // ATTENDANCE PREVIEW
      // ======================================

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

          const student = studentMap.get(
            record.student_id
          );

          const name =
            student?.full_name || 'Unknown student';

          const status = this.getAttendanceStatus(
            record
          );

          return {

            id: record.id,

            studentId: record.student_id,

            name,

            initials: this.getInitials(name),

            avatarColor: this.getAvatarColor(
              record.student_id
            ),

            timeIn: this.formatTime(
              record.time_in
            ),

            timeOut: this.formatTime(
              record.time_out
            ),

            status: status.label,

            statusClass: status.type,

          };

        });

      this.metrics = nextMetrics;

    } catch (error) {

      if (!this.isCurrentRequest(version)) {
        return;
      }

      console.error(
        'Dashboard loading failed:',
        error
      );

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


  // ==========================================
  // LOAD ACTIVE ASSIGNMENTS
  // ==========================================

  private async loadAssignments(
    supervisorId: string
  ): Promise<any[]> {

    const records: any[] = [];

    const pageSize = 500;

    let offset = 0;

    while (true) {

      const {
        data,
        error,
        count,
      } = await this.supabase

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
        `, {
          count: 'exact',
        })

        .eq('supervisor_id', supervisorId)

        .eq('assignment_status', 'active')

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


  // ==========================================
  // BATCH STUDENT IDS
  // ==========================================

  private createBatches(
    values: string[],
    size = 50
  ): string[][] {

    const batches: string[][] = [];

    for (
      let i = 0;
      i < values.length;
      i += size
    ) {

      batches.push(
        values.slice(i, i + size)
      );

    }

    return batches;

  }


  // ==========================================
  // LOAD SYNCHRONIZED ATTENDANCE
  // ==========================================

  private async loadAttendance(
    studentIds: string[]
  ): Promise<AttendanceRecord[]> {

    const records: AttendanceRecord[] = [];

    const pageSize = 500;

    for (
      const batch of this.createBatches(studentIds)
    ) {

      let offset = 0;

      while (true) {

        const {
          data,
          error,
          count,
        } = await this.supabase

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
          `, {
            count: 'exact',
          })

          .in('student_id', batch)

          .eq('sync_status', 'synced')

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

        const page =
          (data ?? []) as AttendanceRecord[];

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


  // ==========================================
  // LOAD WEEKLY REPORTS
  // ==========================================

  private async loadReports(
    studentIds: string[]
  ): Promise<ReportRecord[]> {

    const records: ReportRecord[] = [];

    const pageSize = 500;

    for (
      const batch of this.createBatches(studentIds)
    ) {

      let offset = 0;

      while (true) {

        const {
          data,
          error,
          count,
        } = await this.supabase

          .from('reports')

          .select(
            'id, student_id, status',
            {
              count: 'exact',
            }
          )

          .in('student_id', batch)

          .in('status', [
            'pending_review',
            'returned',
          ])

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

        const page =
          (data ?? []) as ReportRecord[];

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


  // ==========================================
  // CALCULATE ATTENDANCE HOURS
  // ==========================================

  private calculateHours(
    record: AttendanceRecord
  ): number {

    if (!record.time_in || !record.time_out) {
      return 0;
    }

    const timeIn = new Date(
      record.time_in
    ).getTime();

    const timeOut = new Date(
      record.time_out
    ).getTime();

    if (
      !Number.isFinite(timeIn) ||
      !Number.isFinite(timeOut) ||
      timeOut <= timeIn
    ) {

      return 0;

    }

    const storedHours = Number(
      record.total_hours_rendered
    );

    if (
      record.total_hours_rendered !== null &&
      Number.isFinite(storedHours) &&
      storedHours >= 0
    ) {

      return storedHours;

    }

    return (timeOut - timeIn) / 3600000;

  }


  // ==========================================
  // INTERNS REQUIRING FOLLOW-UP
  // ==========================================

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


    // Internship period has ended but the
    // required hours are not yet completed.

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


    // Flag interns who are more than
    // 10 percentage points behind schedule.

    return expectedProgress - actualProgress > 10;

  }


  // ==========================================
  // ATTENDANCE STATUS
  // ==========================================

  private getAttendanceStatus(
    record: AttendanceRecord
  ): {
    label: string;
    type: AttendanceStatus;
  } {

    if (
      record.verification_status === 'rejected'
    ) {

      return {
        label: 'Rejected',
        type: 'rejected',
      };

    }

    if (
      !record.time_in ||
      !record.time_out
    ) {

      return {
        label: 'Incomplete',
        type: 'incomplete',
      };

    }

    if (
      record.verification_status === 'verified'
    ) {

      return {
        label: 'Verified',
        type: 'verified',
      };

    }

    if (
      record.verification_status === 'provisional'
    ) {

      return {
        label: 'Provisional',
        type: 'provisional',
      };

    }

    return {
      label: 'Unknown',
      type: 'unknown',
    };

  }


  // ==========================================
  // STUDENT AVATAR
  // ==========================================

  private getInitials(
    fullName: string
  ): string {

    const parts = fullName
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (!parts.length) {
      return '?';
    }

    return parts

      .slice(0, 2)

      .map(
        part => part.charAt(0).toUpperCase()
      )

      .join('');

  }


  private getAvatarColor(
    studentId: string
  ): string {

    const colors = [
      'blue',
      'orange',
      'slate',
      'green',
      'purple',
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


  // ==========================================
  // SUMMARY CARDS
  // ==========================================

  get summaryCards() {

    const notCheckedIn = Math.max(
      0,
      this.metrics.totalInterns -
      this.metrics.presentToday
    );

    return [

      {
        label: 'Assigned interns',

        value: this.metrics.totalInterns,

        color: 'blue',

        highlight:
          this.metrics.needsFollowUp > 0

            ? `${this.metrics.needsFollowUp} ${
                this.metrics.needsFollowUp === 1
                  ? 'needs'
                  : 'need'
              } follow-up`

            : '',

        description:
          this.metrics.needsFollowUp > 0

            ? ` · ${this.metrics.completedInterns} completed`

            : `${this.metrics.completedInterns} completed`,

        linkLabel: 'View my interns',

        route: '/supervisor/interns',
      },

      {
        label: 'Present today',

        value: this.metrics.presentToday,

        color: 'green',

        highlight: '',

        description:
          `${notCheckedIn} not yet checked in`,

        linkLabel: 'View attendance',

        route: '/supervisor/attendance',
      },

      {
        label: 'Attendance pending',

        value: this.metrics.pendingAttendance,

        color: 'orange',

        highlight:
          this.metrics.incompleteAttendance > 0

            ? `${this.metrics.incompleteAttendance} incomplete`

            : '',

        description:
          this.metrics.incompleteAttendance > 0

            ? ' · previous records'

            : this.metrics.pendingAttendance > 0

              ? 'Awaiting verification'

              : 'No pending verification',

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


  // ==========================================
  // NEEDS ATTENTION
  // Only display items with pending actions.
  // ==========================================

  get attentionItems() {

    return [

      {
        title: 'Unverified attendance',

        description:
          'Awaiting your verification',

        count: this.metrics.pendingAttendance,

        color: 'orange',

        route: '/supervisor/attendance',
      },

      {
        title: 'Incomplete attendance',

        description:
          'Previous records with missing time entries',

        count: this.metrics.incompleteAttendance,

        color: 'red',

        route: '/supervisor/attendance',
      },

      {
        title: 'Weekly reports to review',

        description:
          'Awaiting your review decision',

        count: this.metrics.reportsToReview,

        color: 'orange',

        route: '/supervisor/reports',
      },

    ].filter(item => item.count > 0);

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
  // REFRESH VIEW
  // ==========================================

  private refreshView(): void {

    if (!this.destroyed) {

      this.cdr.markForCheck();

    }

  }

}
