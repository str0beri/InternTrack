import {
  Component,
  OnInit,
  inject,
  ChangeDetectorRef,
  NgZone
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { IonIcon, IonHeader, IonToolbar, IonTitle } from '@ionic/angular';

import { addIcons } from 'ionicons';

import {
  arrowBackOutline,
  arrowForwardOutline,
  documentTextOutline,
  chatboxEllipsesOutline,
  shieldCheckmarkOutline,
  checkmarkCircleOutline,
  alertCircleOutline,
  refreshOutline,
  timeOutline
} from 'ionicons/icons';

import { SupabaseService } from '../../../services/supabase.service';

interface ReportDetails {
  id: number;
  student_id: string;
  week: number;
  period: string;
  status: string;
  accomplishments: string | null;
  student_reflection: string | null;
  feedback: string | null;
  start_date: string | null;
  end_date: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewing_supervisor_id: string | null;
  supervisor_name: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface StudentDetails {
  id: string;
  student_id: string;
  full_name: string;
  email: string | null;
  course: string | null;
  year_level: string | null;
  company_name: string | null;
  ojt_start_date: string | null;
  ojt_end_date: string | null;
}

interface SupervisorDetails {
  id: string;
  full_name: string;
  company_name: string;
  department: string | null;
  position: string | null;
}

interface AssignmentDetails {
  id: string;
  student_id: string;
  supervisor_id: string;
  company_name: string;
  assignment_status: string;
  start_date: string | null;
  end_date: string | null;
}

@Component({
  selector: 'app-report-details',
  templateUrl: './report-details.page.html',
  styleUrls: ['./report-details.page.scss'],
  standalone: true,
  imports: [IonTitle, IonToolbar, IonHeader, 
    CommonModule,
    IonIcon
  ]
})
export class ReportDetailsPage implements OnInit {

  private supabaseService = inject(SupabaseService);
  private supabase = this.supabaseService.getClient();

  private route = inject(ActivatedRoute);
  private router = inject(Router);

  private cdr = inject(ChangeDetectorRef);
  private ngZone = inject(NgZone);

  reportId = '';

  report: ReportDetails | null = null;
  student: StudentDetails | null = null;
  supervisor: SupervisorDetails | null = null;
  assignment: AssignmentDetails | null = null;

  resolvedCompany = 'Company not recorded';

  submittedReportCount = 0;
  approvedReportCount = 0;

  reportCountAvailable = false;

  isLoading = true;
  errorMessage = '';

  private loadingInProgress = false;

  constructor() {

    addIcons({
      arrowBackOutline,
      arrowForwardOutline,
      documentTextOutline,
      chatboxEllipsesOutline,
      shieldCheckmarkOutline,
      checkmarkCircleOutline,
      alertCircleOutline,
      refreshOutline,
      timeOutline
    });
  }

  // =========================================
  // INITIALIZATION
  // =========================================

  ngOnInit(): void {

    this.reportId =
      this.route.snapshot.paramMap.get('reportId') ||
      this.route.snapshot.paramMap.get('id') ||
      '';

    if (
      !this.reportId ||
      !/^\d+$/.test(this.reportId)
    ) {

      this.errorMessage =
        'No valid weekly report was selected.';

      this.isLoading = false;

      return;
    }

    void this.loadReportDetails();
  }

  ionViewWillEnter(): void {

    const currentId =
      this.route.snapshot.paramMap.get('reportId') ||
      this.route.snapshot.paramMap.get('id') ||
      '';

    if (currentId && /^\d+$/.test(currentId)) {

      this.reportId = currentId;

      void this.loadReportDetails();
    }
  }

  // =========================================
  // LOAD REPORT DETAILS
  // =========================================

  async loadReportDetails(): Promise<void> {

    if (this.loadingInProgress) {
      return;
    }

    if (!this.reportId || !/^\d+$/.test(this.reportId)) {

      this.errorMessage =
        'No valid weekly report was selected.';

      this.isLoading = false;

      return;
    }

    this.loadingInProgress = true;
    this.isLoading = true;
    this.errorMessage = '';

    this.reportCountAvailable = false;

    try {

      // 1. Fetch selected submitted report

      const {
        data: reportData,
        error: reportError
      } = await this.supabase
        .from('reports')
        .select(`
          id,
          student_id,
          week,
          period,
          status,
          accomplishments,
          student_reflection,
          feedback,
          start_date,
          end_date,
          submitted_at,
          reviewed_at,
          reviewing_supervisor_id,
          supervisor_name,
          created_at,
          updated_at
        `)
        .eq('id', this.reportId)
        .in('status', [
          'pending_review',
          'approved',
          'returned'
        ])
        .maybeSingle();

      if (reportError) {
        throw reportError;
      }

      if (!reportData) {

        throw new Error(
          'The submitted report could not be found or is unavailable.'
        );
      }

      const selectedReport =
        reportData as ReportDetails;

      // 2. Fetch student information

      const {
        data: studentData,
        error: studentError
      } = await this.supabase
        .from('students')
        .select(`
          id,
          student_id,
          full_name,
          email,
          course,
          year_level,
          company_name,
          ojt_start_date,
          ojt_end_date
        `)
        .eq('student_id', selectedReport.student_id)
        .maybeSingle();

      if (studentError) {
        throw studentError;
      }

      const selectedStudent =
        studentData as StudentDetails | null;

      // 3. Fetch assignment records

      let assignments: AssignmentDetails[] = [];

      if (selectedStudent) {

        assignments = await this.fetchAssignments(
          selectedStudent.id
        );
      }

      // 4. Resolve placement during report period

      const selectedAssignment =
        this.resolveAssignment(
          selectedReport,
          assignments
        );

      // 5. Fetch reviewing or assigned supervisor

      const supervisorId =
        selectedReport.reviewing_supervisor_id ||
        selectedAssignment?.supervisor_id ||
        null;

      let selectedSupervisor: SupervisorDetails | null = null;

      if (supervisorId) {

        const {
          data: supervisorData,
          error: supervisorError
        } = await this.supabase
          .from('company_supervisors')
          .select(`
            id,
            full_name,
            company_name,
            department,
            position
          `)
          .eq('id', supervisorId)
          .maybeSingle();

        if (supervisorError) {
          throw supervisorError;
        }

        selectedSupervisor =
          supervisorData as SupervisorDetails | null;
      }

      // 6. Fetch submitted and approved report counts

      let submittedCount = 0;
      let approvedCount = 0;
      let countsAvailable = false;

      try {

        const counts = await this.fetchReportCounts(
          selectedReport.student_id
        );

        submittedCount = counts.submitted;
        approvedCount = counts.approved;
        countsAvailable = true;

      } catch (countError) {

        console.warn(
          'Unable to load report counts:',
          countError
        );
      }

      // 7. Update view

      this.ngZone.run(() => {

        this.report = selectedReport;
        this.student = selectedStudent;
        this.assignment = selectedAssignment;
        this.supervisor = selectedSupervisor;

        this.resolvedCompany = this.resolveCompany(
          selectedReport,
          assignments
        );

        this.submittedReportCount = submittedCount;
        this.approvedReportCount = approvedCount;
        this.reportCountAvailable = countsAvailable;

        this.cdr.detectChanges();
      });

    } catch (error) {

      console.error(
        'Unable to load report details:',
        error
      );

      this.ngZone.run(() => {

        this.report = null;

        this.errorMessage =
          error instanceof Error
            ? error.message
            : 'Unable to load this weekly report. Please try again.';
      });

    } finally {

      this.ngZone.run(() => {

        this.isLoading = false;
        this.loadingInProgress = false;

        this.cdr.detectChanges();
      });
    }
  }

  // =========================================
  // FETCH ASSIGNMENTS
  // =========================================

  private async fetchAssignments(
    studentUuid: string
  ): Promise<AssignmentDetails[]> {

    const records: AssignmentDetails[] = [];

    const batchSize = 500;

    let offset = 0;

    while (true) {

      const { data, error } = await this.supabase
        .from('intern_supervisor_assignments')
        .select(`
          id,
          student_id,
          supervisor_id,
          company_name,
          assignment_status,
          start_date,
          end_date
        `)
        .eq('student_id', studentUuid)
        .order('id', {
          ascending: true
        })
        .range(
          offset,
          offset + batchSize - 1
        );

      if (error) {
        throw error;
      }

      const batch =
        (data || []) as AssignmentDetails[];

      records.push(...batch);

      if (batch.length < batchSize) {
        break;
      }

      offset += batchSize;
    }

    return records;
  }

  // =========================================
  // RESOLVE HISTORICAL PLACEMENT
  // =========================================

  private resolveAssignment(
    report: ReportDetails,
    assignments: AssignmentDetails[]
  ): AssignmentDetails | null {

    const start = report.start_date;
    const end = report.end_date || start;

    if (start && end) {

      const matching = assignments.filter(assignment =>
        !!assignment.start_date &&
        assignment.start_date <= start &&
        (
          !assignment.end_date ||
          assignment.end_date >= end
        )
      );

      if (matching.length === 1) {
        return matching[0];
      }

      if (report.reviewing_supervisor_id) {

        const reviewerMatches = matching.filter(
          assignment =>
            assignment.supervisor_id ===
            report.reviewing_supervisor_id
        );

        if (reviewerMatches.length === 1) {
          return reviewerMatches[0];
        }
      }
    }

    if (report.reviewing_supervisor_id) {

      const matching = assignments.filter(
        assignment =>
          assignment.supervisor_id ===
          report.reviewing_supervisor_id
      );

      if (matching.length === 1) {
        return matching[0];
      }
    }

    return null;
  }

  private resolveCompany(
    report: ReportDetails,
    assignments: AssignmentDetails[]
  ): string {

    const start = report.start_date;
    const end = report.end_date || start;

    if (start && end) {

      const matching = assignments.filter(assignment =>
        !!assignment.start_date &&
        assignment.start_date <= start &&
        (
          !assignment.end_date ||
          assignment.end_date >= end
        )
      );

      const companies = [
        ...new Set(
          matching.map(item => item.company_name)
        )
      ];

      if (companies.length === 1) {
        return companies[0];
      }
    }

    if (report.reviewing_supervisor_id) {

      const companies = [
        ...new Set(
          assignments
            .filter(item =>
              item.supervisor_id ===
              report.reviewing_supervisor_id
            )
            .map(item => item.company_name)
        )
      ];

      if (companies.length === 1) {
        return companies[0];
      }
    }

    return 'Company not recorded';
  }

  // =========================================
  // REPORT COUNTS
  // =========================================

  private async fetchReportCounts(
    studentId: string
  ): Promise<{
    submitted: number;
    approved: number;
  }> {

    const [
      submittedResult,
      approvedResult
    ] = await Promise.all([

      this.supabase
        .from('reports')
        .select('id', {
          count: 'exact',
          head: true
        })
        .eq('student_id', studentId)
        .in('status', [
          'pending_review',
          'approved',
          'returned'
        ]),

      this.supabase
        .from('reports')
        .select('id', {
          count: 'exact',
          head: true
        })
        .eq('student_id', studentId)
        .eq('status', 'approved')

    ]);

    if (submittedResult.error) {
      throw submittedResult.error;
    }

    if (approvedResult.error) {
      throw approvedResult.error;
    }

    return {
      submitted: submittedResult.count || 0,
      approved: approvedResult.count || 0
    };
  }

  // =========================================
  // STUDENT INFORMATION
  // =========================================

  get studentName(): string {

    return this.student?.full_name ||
      'Unknown student';
  }

  get studentId(): string {

    return this.student?.student_id ||
      this.report?.student_id ||
      'Not recorded';
  }

  get studentInitials(): string {

    return this.studentName
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part.charAt(0).toUpperCase())
      .join('') || 'ST';
  }

  get avatarColor(): string {

    const colors = [
      'blue',
      'purple',
      'orange',
      'green',
      'rose',
      'slate'
    ];

    const value = this.studentId;

    let hash = 0;

    for (let i = 0; i < value.length; i++) {

      hash =
        (hash * 31 + value.charCodeAt(i)) | 0;
    }

    return colors[Math.abs(hash) % colors.length];
  }

  get companyName(): string {
    return this.resolvedCompany;
  }

  get supervisorName(): string {

    return this.report?.supervisor_name?.trim() ||
      this.supervisor?.full_name ||
      'Not recorded';
  }

  get supervisorLabel(): string {

    return this.report?.reviewing_supervisor_id ||
      this.report?.reviewed_at
      ? 'Reviewing supervisor'
      : 'Assigned supervisor';
  }

  // =========================================
  // REPORT CONTENT
  // =========================================

  get reportingWeek(): string {

    return this.report
      ? `Week ${this.report.week}`
      : 'Not recorded';
  }

  get reportingPeriod(): string {

    if (!this.report) {
      return 'Not recorded';
    }

    return this.formatPeriod(
      this.report.start_date,
      this.report.end_date,
      this.report.period
    );
  }

  get accomplishments(): string {

    return this.report?.accomplishments || '';
  }

  get hasAccomplishments(): boolean {

    return !!this.accomplishments.trim();
  }

  get studentReflection(): string {

    return this.report?.student_reflection || '';
  }

  get hasReflection(): boolean {

    return !!this.studentReflection.trim();
  }

  get supervisorFeedback(): string {

    return this.report?.feedback || '';
  }

  get hasFeedback(): boolean {

    return !!this.supervisorFeedback.trim();
  }

  // =========================================
  // REVIEW STATUS
  // =========================================

  get statusLabel(): string {

    switch (this.report?.status) {

      case 'pending_review':
        return 'Pending review';

      case 'approved':
        return 'Approved';

      case 'returned':
        return 'Returned for revision';

      default:
        return 'Unknown';
    }
  }

  get statusClass(): string {

    switch (this.report?.status) {

      case 'pending_review':
        return 'pending';

      case 'approved':
        return 'approved';

      case 'returned':
        return 'returned';

      default:
        return 'neutral';
    }
  }

  get reviewMessage(): string {

    switch (this.report?.status) {

      case 'pending_review':

        return 'Awaiting routine review by the assigned company supervisor.';

      case 'approved':

        return 'This weekly report has been approved by the company supervisor.';

      case 'returned':

        return 'This report has been returned to the student for revision.';

      default:

        return 'The review status is unavailable.';
    }
  }

  get reviewIcon(): string {

    switch (this.report?.status) {

      case 'approved':
        return 'checkmark-circle-outline';

      case 'returned':
        return 'alert-circle-outline';

      default:
        return 'document-text-outline';
    }
  }

  // =========================================
  // DATE FORMATTING
  // =========================================

  formatDate(
    value: string | null | undefined,
    fallback = 'Not recorded'
  ): string {

    if (!value) {
      return fallback;
    }

    const date = new Date(
      /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? `${value}T00:00:00+08:00`
        : value
    );

    if (Number.isNaN(date.getTime())) {
      return fallback;
    }

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'Asia/Manila'
    }).format(date);
  }

  private formatPeriod(
    start: string | null,
    end: string | null,
    fallback: string
  ): string {

    if (!start || !end) {
      return fallback || 'Not recorded';
    }

    const startDate =
      new Date(`${start}T00:00:00+08:00`);

    const endDate =
      new Date(`${end}T00:00:00+08:00`);

    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime())
    ) {
      return fallback || 'Not recorded';
    }

    const shortFormatter =
      new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'Asia/Manila'
      });

    if (start.slice(0, 4) === end.slice(0, 4)) {

      return `${shortFormatter.format(startDate)} – ` +
        `${this.formatDate(end)}`;
    }

    return `${this.formatDate(start)} – ` +
      `${this.formatDate(end)}`;
  }

  // =========================================
  // NAVIGATION
  // =========================================

  goBack(): void {

    void this.router.navigate([
      '/coordinator/reports'
    ]);
  }

  openStudentRecord(): void {

    if (!this.student?.id) {
      return;
    }

    void this.router.navigate([
      '/coordinator/student-interns',
      this.student.id
    ]);
  }

  retryLoad(): void {

    void this.loadReportDetails();
  }
}
