import { CommonModule } from '@angular/common';

import {
  ChangeDetectorRef,
  Component,
  inject,
  type OnInit,
  type OnDestroy
} from '@angular/core';

import {
  ActivatedRoute,
  RouterLink
} from '@angular/router';

import { FormsModule } from '@angular/forms';

import { Subscription } from 'rxjs';

import { AuthService } from '../../../services/auth.service';
import { SupabaseService } from '../../../services/supabase.service';


// ==========================================
// TYPE DEFINITIONS
// ==========================================

type DetailsTab =
  | 'overview'
  | 'attendance'
  | 'reports'
  | 'evaluations';

type InternStatus =
  | 'ongoing'
  | 'needs-follow-up'
  | 'completed';

type AttendanceFilter =
  | 'all'
  | 'verified'
  | 'provisional'
  | 'incomplete'
  | 'rejected';

type ReportFilter =
  | 'all'
  | 'pending_review'
  | 'approved'
  | 'returned';


// ==========================================
// INTERN DETAILS INTERFACE
// ==========================================

interface InternDetails {
  id: string;
  name: string;
  initials: string;

  email: string;
  course: string;
  department: string;
  schoolName: string;

  companyName: string;
  supervisorName: string;

  startDate: string;
  endDate: string;

  requiredHours: number;
  verifiedHours: number;
  provisionalHours: number;
  remainingHours: number;

  progress: number;

  status: string;
  statusClass: InternStatus;
}


// ==========================================
// ATTENDANCE INTERFACE
// ==========================================

interface AttendanceRecord {
  id: string;
  student_id: string;

  attendance_date: string;

  time_in: string | null;
  time_out: string | null;

  total_hours_rendered: number | string | null;

  verification_status: string | null;
  sync_status: string | null;
}


// ==========================================
// WEEKLY REPORT INTERFACE
// ==========================================

interface WeeklyReport {
  id: number | string;

  student_id: string;

  week: number;

  start_date: string | null;
  end_date: string | null;

  accomplishments: string | null;
  reflection: string | null;

  status: string;

  feedback: string | null;

  submitted_at: string | null;
  reviewed_at: string | null;
  updated_at: string | null;
}


// ==========================================
// COMPONENT
// ==========================================

@Component({
  selector: 'app-intern-details',

  standalone: true,

  imports: [
    CommonModule,
    FormsModule,
    RouterLink
  ],

  templateUrl: './intern-details.page.html',

  styleUrls: ['./intern-details.page.scss']
})
export class InternDetailsPage
  implements OnInit, OnDestroy {

  // ==========================================
  // SERVICES
  // ==========================================

  private readonly route =
    inject(ActivatedRoute);

  private readonly authService =
    inject(AuthService);

  private readonly supabaseService =
    inject(SupabaseService);

  private readonly supabase =
    this.supabaseService.getClient();

  private readonly cdr =
    inject(ChangeDetectorRef);


  // ==========================================
  // PAGE STATE
  // ==========================================

  studentId = '';

  intern: InternDetails | null = null;

  loading = true;

  loadError = '';

  attendanceRecords: AttendanceRecord[] = [];

  weeklyReports: WeeklyReport[] = [];

  selectedReport: WeeklyReport | null = null;


  // ==========================================
  // TAB STATE
  // ==========================================

  activeTab: DetailsTab = 'overview';

  readonly tabs: {
    id: DetailsTab;
    label: string;
  }[] = [

    {
      id: 'overview',
      label: 'Overview'
    },

    {
      id: 'attendance',
      label: 'Attendance History'
    },

    {
      id: 'reports',
      label: 'Weekly Reports'
    },

    {
      id: 'evaluations',
      label: 'Evaluations'
    }

  ];


  // ==========================================
  // FILTER STATE
  // ==========================================

  attendanceFilter: AttendanceFilter = 'all';

  reportFilter: ReportFilter = 'all';


  // ==========================================
  // REQUEST TRACKING
  // ==========================================

  private routeSubscription?: Subscription;

  private loadVersion = 0;

  private destroyed = false;


  // ==========================================
  // INITIALIZATION
  // ==========================================

  ngOnInit(): void {

    this.routeSubscription =
      this.route.paramMap.subscribe(params => {

        this.studentId =
          params.get('studentId')?.trim() || '';

        this.activeTab = 'overview';

        this.attendanceFilter = 'all';

        this.reportFilter = 'all';

        this.selectedReport = null;

        void this.loadData();

      });

  }


  // ==========================================
  // CLEANUP
  // ==========================================

  ngOnDestroy(): void {

    this.destroyed = true;

    this.loadVersion++;

    this.routeSubscription?.unsubscribe();

    this.intern = null;

    this.attendanceRecords = [];

    this.weeklyReports = [];

    this.selectedReport = null;

  }


  // ==========================================
  // LOAD INTERN DETAILS
  // ==========================================

  async loadData(): Promise<void> {

    const requestVersion = ++this.loadVersion;

    const studentId = this.studentId;

    this.loading = true;

    this.loadError = '';

    this.intern = null;

    this.attendanceRecords = [];

    this.weeklyReports = [];

    this.selectedReport = null;

    this.cdr.markForCheck();

    try {

      // ======================================
      // VALIDATE ROUTE AND SESSION
      // ======================================

      if (!studentId) {

        throw new Error(
          'No student ID was provided.'
        );

      }

      const userId =
        this.authService.getCurrentUser()?.id;

      if (!userId) {

        throw new Error(
          'Your session is unavailable. Please sign in again.'
        );

      }


      // ======================================
      // GET AUTHENTICATED SUPERVISOR
      // ======================================

      const {
        data: supervisor,
        error: supervisorError
      } = await this.supabase

        .from('company_supervisors')

        .select(`
          id,
          full_name,
          company_name
        `)

        .eq('user_id', userId)

        .single();


      if (supervisorError) {

        throw supervisorError;

      }

      if (!supervisor) {

        throw new Error(
          'No company supervisor profile was found.'
        );

      }

      if (!this.isCurrentRequest(
        requestVersion,
        userId,
        studentId
      )) {

        return;

      }


      // ======================================
      // VERIFY ACTIVE INTERN ASSIGNMENT
      // ======================================

      const {
        data: assignments,
        error: assignmentError
      } = await this.supabase

        .from('intern_supervisor_assignments')

        .select(`
          student_id,
          students!student_id!inner(
            id,
            student_id,
            full_name,
            email,
            course,
            department,
            school_name,
            company_name,
            ojt_start_date,
            ojt_end_date,
            required_hours
          )
        `)

        .eq('supervisor_id', supervisor.id)

        .eq('assignment_status', 'active')

        .eq('students.student_id', studentId)

        .limit(1);


      if (assignmentError) {

        throw assignmentError;

      }

      if (!this.isCurrentRequest(
        requestVersion,
        userId,
        studentId
      )) {

        return;

      }

      const assignment = assignments?.[0];

      if (!assignment) {

        this.loadError =
          'This student is not currently assigned to your account.';

        return;

      }


      // ======================================
      // EXTRACT STUDENT INFORMATION
      // ======================================

      const student = Array.isArray(
        assignment.students
      )

        ? assignment.students[0]

        : assignment.students;


      if (!student || student.student_id !== studentId) {

        this.loadError =
          'The requested student record is unavailable.';

        return;

      }


      // ======================================
      // LOAD ATTENDANCE AND WEEKLY REPORTS
      // ======================================

      const [
        attendance,
        reports
      ] = await Promise.all([

        this.loadAttendance(
          studentId,
          requestVersion,
          userId
        ),

        this.loadWeeklyReports(
          studentId,
          requestVersion,
          userId
        )

      ]);


      if (!this.isCurrentRequest(
        requestVersion,
        userId,
        studentId
      )) {

        return;

      }


      // ======================================
      // CALCULATE VERIFIED AND PROVISIONAL HOURS
      // ======================================

      let verifiedHours = 0;

      let provisionalHours = 0;


      for (const record of attendance) {

        if (record.sync_status !== 'synced') {

          continue;

        }

        const hours =
          this.calculateHours(record);


        if (
          this.attendanceStatus(record) === 'verified'
        ) {

          verifiedHours += hours;

        } else if (
          this.attendanceStatus(record) === 'provisional'
        ) {

          provisionalHours += hours;

        }

      }


      // ======================================
      // REQUIRED AND REMAINING HOURS
      // ======================================

      const storedRequiredHours =
        Number(student.required_hours ?? 486);

      const requiredHours =

        Number.isFinite(storedRequiredHours) &&
        storedRequiredHours > 0

          ? storedRequiredHours

          : 486;


      const remainingHours = Math.max(

        0,

        requiredHours - verifiedHours

      );


      // ======================================
      // INTERNSHIP PROGRESS
      // ======================================

      const progress = Math.min(

        100,

        Math.max(

          0,

          (verifiedHours / requiredHours) * 100

        )

      );


      const statusClass = this.getInternStatus(

        verifiedHours,

        requiredHours,

        progress,

        student.ojt_start_date,

        student.ojt_end_date

      );


      const name =
        student.full_name?.trim() || 'Unknown student';


      // ======================================
      // BUILD INTERN DETAILS
      // ======================================

      this.intern = {

        id: student.student_id,

        name,

        initials: this.getInitials(name),

        email: student.email || 'Not provided',

        course: student.course || 'Not provided',

        department:
          student.department || 'Not assigned',

        schoolName:
          student.school_name || 'Not provided',

        companyName:
          student.company_name ||
          supervisor.company_name ||
          'Not provided',

        supervisorName:
          supervisor.full_name || 'Not provided',

        startDate:
          this.formatDate(student.ojt_start_date),

        endDate:
          this.formatDate(student.ojt_end_date),

        requiredHours,

        verifiedHours,

        provisionalHours,

        remainingHours,

        progress,

        status:
          this.getInternStatusLabel(statusClass),

        statusClass

      };


      this.attendanceRecords = attendance;

      this.weeklyReports = reports;


    } catch (error) {

      if (
        this.destroyed ||
        requestVersion !== this.loadVersion
      ) {

        return;

      }

      console.error(
        'Error loading intern details:',
        error
      );

      this.intern = null;

      this.attendanceRecords = [];

      this.weeklyReports = [];

      this.loadError =
        'We could not retrieve the intern details. Please try again.';


    } finally {

      if (
        !this.destroyed &&
        requestVersion === this.loadVersion
      ) {

        this.loading = false;

        this.cdr.markForCheck();

      }

    }

  }


  // ==========================================
  // REQUEST VALIDATION
  // ==========================================

  private isCurrentRequest(

    requestVersion: number,

    userId: string,

    studentId: string

  ): boolean {

    return (

      !this.destroyed &&

      requestVersion === this.loadVersion &&

      this.studentId === studentId &&

      this.authService.getCurrentUser()?.id === userId

    );

  }


  // ==========================================
  // LOAD ATTENDANCE RECORDS
  // ==========================================

  private async loadAttendance(

    studentId: string,

    requestVersion: number,

    userId: string

  ): Promise<AttendanceRecord[]> {

    const records: AttendanceRecord[] = [];

    const pageSize = 500;

    let offset = 0;


    while (true) {

      if (!this.isCurrentRequest(
        requestVersion,
        userId,
        studentId
      )) {

        return [];

      }


      const {
        data,
        error,
        count
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
        `, { count: 'exact' })

        .eq('student_id', studentId)

        .eq('sync_status', 'synced')

        .order('attendance_date', {
          ascending: false
        })

        .order('id', {
          ascending: true
        })

        .range(
          offset,
          offset + pageSize - 1
        );


      if (error) {

        throw error;

      }

      if (!this.isCurrentRequest(
        requestVersion,
        userId,
        studentId
      )) {

        return [];

      }


      const batch = (data || []) as AttendanceRecord[];

      records.push(...batch);

      offset += batch.length;


      if (

        batch.length === 0 ||

        (count !== null && offset >= count) ||

        (count === null && batch.length < pageSize)

      ) {

        break;

      }

    }


    // Remove duplicate records if any appear
    // during paginated retrieval.

    return Array.from(

      new Map(

        records.map(record => [
          record.id,
          record
        ])

      ).values()

    );

  }


  // ==========================================
// LOAD WEEKLY REPORTS
// ==========================================

private async loadWeeklyReports(
  studentId: string,
  requestVersion: number,
  userId: string
): Promise<WeeklyReport[]> {

  const records: WeeklyReport[] = [];

  const pageSize = 500;

  let offset = 0;

  while (true) {

    if (!this.isCurrentRequest(
      requestVersion,
      userId,
      studentId
    )) {
      return [];
    }

    const {
      data,
      error,
      count
    } = await this.supabase

      .from('reports')

      .select(`
        id,
        student_id,
        week,
        start_date,
        end_date,
        accomplishments,
        reflection:student_reflection,
        status,
        feedback,
        submitted_at,
        reviewed_at,
        updated_at
      `, { count: 'exact' })

      .eq('student_id', studentId)

      .in('status', [
        'pending_review',
        'approved',
        'returned'
      ])

      .order('week', {
        ascending: false
      })

      .order('id', {
        ascending: true
      })

      .range(
        offset,
        offset + pageSize - 1
      );

    if (error) {
      throw error;
    }

    if (!this.isCurrentRequest(
      requestVersion,
      userId,
      studentId
    )) {
      return [];
    }

    const batch = (data || []) as WeeklyReport[];

    records.push(...batch);

    offset += batch.length;

    if (
      batch.length === 0 ||
      (count !== null && offset >= count) ||
      (count === null && batch.length < pageSize)
    ) {
      break;
    }

  }

  return Array.from(
    new Map(
      records.map(report => [
        report.id,
        report
      ])
    ).values()
  );

}


  // ==========================================
  // CALCULATE ATTENDANCE HOURS
  // ==========================================

  calculateHours(record: AttendanceRecord): number {

    if (!record.time_in || !record.time_out) {

      return 0;

    }


    const start =
      new Date(record.time_in).getTime();

    const end =
      new Date(record.time_out).getTime();


    if (

      !Number.isFinite(start) ||

      !Number.isFinite(end) ||

      end <= start

    ) {

      return 0;

    }


    const storedHours =
      record.total_hours_rendered;


    if (
      storedHours !== null &&
      storedHours !== undefined
    ) {

      const hours = Number(storedHours);

      if (Number.isFinite(hours) && hours >= 0) {

        return hours;

      }

    }


    return (end - start) / (1000 * 60 * 60);

  }


  // ==========================================
  // ATTENDANCE STATUS
  // ==========================================

  attendanceStatus(record: AttendanceRecord): string {

    if (record.verification_status === 'rejected') {

      return 'rejected';

    }

    if (!record.time_in || !record.time_out) {

      return 'incomplete';

    }


    const start =
      new Date(record.time_in).getTime();

    const end =
      new Date(record.time_out).getTime();


    if (

      !Number.isFinite(start) ||

      !Number.isFinite(end) ||

      end <= start

    ) {

      return 'incomplete';

    }


    if (record.verification_status === 'verified') {

      return 'verified';

    }

    if (record.verification_status === 'provisional') {

      return 'provisional';

    }

    return 'neutral';

  }


  attendanceStatusLabel(
    record: AttendanceRecord
  ): string {

    const status = this.attendanceStatus(record);

    const labels: Record<string, string> = {

      verified: 'Verified',

      provisional: 'Pending verification',

      incomplete: 'Incomplete',

      rejected: 'Rejected',

      neutral: 'Unknown'

    };

    return labels[status] || 'Unknown';

  }


  // ==========================================
  // ATTENDANCE SUMMARY
  // ==========================================

  get verifiedRecords(): number {

    return this.attendanceRecords.filter(

      record =>
        this.attendanceStatus(record) === 'verified'

    ).length;

  }


  get pendingRecords(): number {

    return this.attendanceRecords.filter(

      record =>
        this.attendanceStatus(record) === 'provisional'

    ).length;

  }


  get incompleteRecords(): number {

    return this.attendanceRecords.filter(

      record =>
        this.attendanceStatus(record) === 'incomplete'

    ).length;

  }


  // ==========================================
  // FILTER ATTENDANCE
  // ==========================================

  get filteredAttendance(): AttendanceRecord[] {

    if (this.attendanceFilter === 'all') {

      return this.attendanceRecords;

    }

    return this.attendanceRecords.filter(

      record =>

        this.attendanceStatus(record) ===
        this.attendanceFilter

    );

  }


  // ==========================================
  // INTERNSHIP STATUS
  // ==========================================

  private getInternStatus(

    verifiedHours: number,

    requiredHours: number,

    progress: number,

    startDate: string | null,

    endDate: string | null

  ): InternStatus {

    if (

      requiredHours > 0 &&

      verifiedHours >= requiredHours

    ) {

      return 'completed';

    }


    if (startDate && endDate) {

      const start =
        new Date(startDate).getTime();

      const end =
        new Date(endDate).getTime();

      const today = Date.now();


      if (

        Number.isFinite(start) &&

        Number.isFinite(end) &&

        end > start

      ) {

        const expectedProgress = Math.min(

          100,

          Math.max(

            0,

            ((today - start) / (end - start)) * 100

          )

        );


        if (progress - expectedProgress < -10) {

          return 'needs-follow-up';

        }

      }

    }

    return 'ongoing';

  }


  private getInternStatusLabel(
    status: InternStatus
  ): string {

    const labels: Record<InternStatus, string> = {

      ongoing: 'Ongoing',

      'needs-follow-up': 'Needs follow-up',

      completed: 'Completed'

    };

    return labels[status];

  }


  // ==========================================
  // WEEKLY REPORT STATUS
  // ==========================================

  reportStatusLabel(status: string): string {

    const labels: Record<string, string> = {

      pending_review: 'Pending review',

      approved: 'Approved',

      returned: 'Returned',

      draft: 'Draft'

    };

    return labels[status] || 'Unknown';

  }


  reportStatusClass(status: string): string {

    const classes: Record<string, string> = {

      pending_review: 'pending',

      approved: 'approved',

      returned: 'returned',

      draft: 'neutral'

    };

    return classes[status] || 'neutral';

  }


  // ==========================================
  // LATEST WEEKLY REPORT
  // ==========================================

  get latestReport(): WeeklyReport | null {

    return this.weeklyReports[0] || null;

  }


  // ==========================================
  // FILTER WEEKLY REPORTS
  // ==========================================

  get filteredReports(): WeeklyReport[] {

    if (this.reportFilter === 'all') {

      return this.weeklyReports;

    }

    return this.weeklyReports.filter(

      report => report.status === this.reportFilter

    );

  }


  // ==========================================
  // OPEN WEEKLY REPORT
  // ==========================================

  openReport(report: WeeklyReport): void {

    this.activeTab = 'reports';

    this.reportFilter = 'all';

    this.selectedReport = report;

  }


  closeReport(): void {

    this.selectedReport = null;

  }


  // ==========================================
  // TAB NAVIGATION
  // ==========================================

  setTab(tab: DetailsTab): void {

    this.activeTab = tab;

    this.selectedReport = null;

  }


  // ==========================================
  // GENERATE STUDENT INITIALS
  // ==========================================

  private getInitials(name: string): string {

    const parts = name

      .trim()

      .split(/\s+/)

      .filter(Boolean);


    if (parts.length === 0) {

      return '??';

    }

    if (parts.length === 1) {

      return parts[0]

        .substring(0, 2)

        .toUpperCase();

    }


    return (

      parts[0][0] +

      parts[parts.length - 1][0]

    ).toUpperCase();

  }


  // ==========================================
  // FORMAT DATE
  // ==========================================

  formatDate(
    value: string | null | undefined
  ): string {

    if (!value) {

      return 'Not provided';

    }


    const date = new Date(value);


    if (!Number.isFinite(date.getTime())) {

      return 'Not provided';

    }


    return date.toLocaleDateString('en-US', {

      month: 'short',

      day: 'numeric',

      year: 'numeric',

      timeZone: 'Asia/Manila'

    });

  }


  // ==========================================
  // FORMAT DAY
  // ==========================================

  formatDay(
    value: string | null | undefined
  ): string {

    if (!value) {

      return '—';

    }


    const date = new Date(value);


    if (!Number.isFinite(date.getTime())) {

      return '—';

    }


    return date.toLocaleDateString('en-US', {

      weekday: 'long',

      timeZone: 'Asia/Manila'

    });

  }


  // ==========================================
  // FORMAT TIME
  // ==========================================

  formatTime(
    value: string | null | undefined
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

}