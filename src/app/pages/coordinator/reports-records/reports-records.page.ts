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
import { IonIcon, IonHeader, IonToolbar, IonTitle } from '@ionic/angular';
import { addIcons } from 'ionicons';

import {
  listOutline,
  businessOutline,
  calendarOutline,
  timeOutline,
  documentTextOutline,
  checkmarkCircleOutline,
  shieldCheckmarkOutline,
  downloadOutline,
  printOutline,
  chevronDownOutline,
  chevronBackOutline,
  chevronForwardOutline,
  refreshOutline,
  alertCircleOutline
} from 'ionicons/icons';

import { SupabaseService } from '../../../services/supabase.service';

import { createReportTemplate } from '../../../utils/report-template';

import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';

(pdfMake as any).vfs =
  (pdfFonts as any).pdfMake?.vfs ??
  (pdfFonts as any).vfs ??
  pdfFonts;

type ReportType =
  | 'master-list'
  | 'assignments'
  | 'dtr'
  | 'hours-summary'
  | 'weekly-compliance'
  | 'completion';

interface Student {
  id: string;
  student_id: string;
  full_name: string;
  course: string | null;
  year_level: string | null;
  company_name: string | null;
  required_hours: number | null;
  ojt_start_date: string | null;
  ojt_end_date: string | null;
  account_status: string;
}

interface Supervisor {
  id: string;
  full_name: string;
  company_name: string;
}

interface Assignment {
  id: string;
  student_id: string;
  supervisor_id: string;
  company_name: string;
  assigned_date: string;
  assignment_status: string;
}

interface Attendance {
  id: string;
  student_id: string;
  attendance_date: string;
  time_in: string | null;
  time_out: string | null;
  total_hours_rendered: number | null;
  verification_status: string;
  sync_status: string;
}

interface WeeklyReport {
  id: number;
  student_id: string;
  week: number;
  status: string;
  submitted_at: string | null;
  updated_at: string;
}

interface ReportDefinition {
  id: ReportType;
  title: string;
  description: string;
  icon: string;
  columns: string[];
}

interface ReportRow {
  studentUuid: string;
  studentId: string;
  company: string;
  status: string;
  cells: string[];
}

interface StudentSummary {
  student: Student;
  company: string;
  required: number | null;
  verified: number;
  provisional: number;
  remaining: number | null;
  approved: number;
  submitted: number;
  latestReportStatus: string;
  status: string;
}

@Component({
  selector: 'app-reports-records',
  templateUrl: './reports-records.page.html',
  styleUrls: ['./reports-records.page.scss'],
  standalone: true,
  imports: [IonTitle, IonToolbar, IonHeader, 
    CommonModule,
    FormsModule,
    IonIcon
  ]
})
export class ReportsRecordsPage implements OnInit {

  private supabaseService = inject(SupabaseService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private ngZone = inject(NgZone);

  private supabase = this.supabaseService.getClient();

  readonly schoolName = 'Pamantasan ng Lungsod ng Valenzuela';

  readonly reportLibrary: ReportDefinition[] = [
    {
      id: 'master-list',
      title: 'Student Internship Master List',
      description:
        'Registration, academic, and placement details for every intern.',
      icon: 'list-outline',
      columns: [
        'Student ID',
        'Student name',
        'Course',
        'Company',
        'Status',
        'Verified hours'
      ]
    },
    {
      id: 'assignments',
      title: 'Internship Assignment Records',
      description:
        'Active and historical placements, including reassignments.',
      icon: 'business-outline',
      columns: [
        'Student',
        'Company',
        'Supervisor',
        'Assigned',
        'Status'
      ]
    },
    {
      id: 'dtr',
      title: 'Daily Time Records',
      description:
        'Synced attendance entries with their verification status.',
      icon: 'calendar-outline',
      columns: [
        'Date',
        'Student',
        'Company',
        'Time in',
        'Time out',
        'Hours',
        'Verification'
      ]
    },
    {
      id: 'hours-summary',
      title: 'Internship Hours Summary',
      description:
        'Required, verified, provisional, and remaining hours per intern.',
      icon: 'time-outline',
      columns: [
        'Student',
        'Company',
        'Required',
        'Verified',
        'Provisional',
        'Remaining'
      ]
    },
    {
      id: 'weekly-compliance',
      title: 'Weekly Report Compliance',
      description:
        'Approved and submitted weekly reports for each student.',
      icon: 'document-text-outline',
      columns: [
        'Student',
        'Company',
        'Approved reports',
        'Submitted reports',
        'Approval rate',
        'Latest status'
      ]
    },
    {
      id: 'completion',
      title: 'Internship Completion Records',
      description:
        'Interns who have reached their required verified hours.',
      icon: 'checkmark-circle-outline',
      columns: [
        'Student',
        'Company',
        'Required hours',
        'Verified hours',
        'Approved reports',
        'Completion status'
      ]
    }
  ];

  students: Student[] = [];
  supervisors: Supervisor[] = [];
  assignments: Assignment[] = [];
  attendanceRecords: Attendance[] = [];
  weeklyReports: WeeklyReport[] = [];

  summaries: StudentSummary[] = [];
  reportRows: ReportRow[] = [];

  selectedReport: ReportType = 'master-list';

  selectedCompany = 'all';
  selectedStudent = 'all';
  selectedStatus = 'all';

  startDate = '';
  endDate = '';

  currentPage = 1;
  readonly pageSize = 10;

  isLoading = true;
  isExporting = false;
  errorMessage = '';
  exportError = '';

  generatedAt = new Date();

  private loadingInProgress = false;

  constructor() {
    addIcons({
      listOutline,
      businessOutline,
      calendarOutline,
      timeOutline,
      documentTextOutline,
      checkmarkCircleOutline,
      shieldCheckmarkOutline,
      downloadOutline,
      printOutline,
      chevronDownOutline,
      chevronBackOutline,
      chevronForwardOutline,
      refreshOutline,
      alertCircleOutline
    });
  }

  ngOnInit(): void {
    void this.loadRecords();
  }

  ionViewWillEnter(): void {
    void this.loadRecords();
  }

  // =========================================
  // DATA RETRIEVAL
  // =========================================

  private async fetchAll<T>(
    table: string,
    columns: string
  ): Promise<T[]> {

    const results: T[] = [];
    const batchSize = 500;
    let offset = 0;

    while (true) {

      const { data, error } = await this.supabase
        .from(table)
        .select(columns)
        .order('id', { ascending: true })
        .range(offset, offset + batchSize - 1);

      if (error) {
        throw new Error(error.message);
      }

      const batch = (data ?? []) as unknown as T[];

      results.push(...batch);

      if (batch.length < batchSize) {
        break;
      }

      offset += batchSize;
    }

    return results;
  }

  async loadRecords(): Promise<void> {

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
        attendance,
        reports
      ] = await Promise.all([

        this.fetchAll<Student>(
          'students',
          'id, student_id, full_name, course, year_level, company_name, required_hours, ojt_start_date, ojt_end_date, account_status'
        ),

        this.fetchAll<Supervisor>(
          'company_supervisors',
          'id, full_name, company_name'
        ),

        this.fetchAll<Assignment>(
          'intern_supervisor_assignments',
          'id, student_id, supervisor_id, company_name, assigned_date, assignment_status'
        ),

        this.fetchAll<Attendance>(
          'attendance',
          'id, student_id, attendance_date, time_in, time_out, total_hours_rendered, verification_status, sync_status'
        ),

        this.fetchAll<WeeklyReport>(
          'reports',
          'id, student_id, week, status, submitted_at, updated_at'
        )

      ]);

      this.ngZone.run(() => {

        this.students = students.sort((a, b) =>
          a.full_name.localeCompare(b.full_name)
        );

        this.supervisors = supervisors;
        this.assignments = assignments;

        this.attendanceRecords = attendance.filter(
          record => record.sync_status === 'synced'
        );

        this.weeklyReports = reports.filter(
          report =>
            ['pending_review', 'approved', 'returned']
              .includes(report.status)
        );

        this.buildStudentSummaries();
        this.buildReportRows();

        this.generatedAt = new Date();
        this.currentPage = 1;

      });

    } catch (error) {

      console.error('Unable to load report records:', error);

      this.errorMessage =
        'Unable to load institutional records. Please try again.';

    } finally {

      this.ngZone.run(() => {

        this.isLoading = false;
        this.loadingInProgress = false;
        this.cdr.detectChanges();

      });

    }
  }

  retryLoad(): void {
    void this.loadRecords();
  }

  // =========================================
  // STUDENT SUMMARIES
  // =========================================

  private buildStudentSummaries(): void {

    const activeAssignments = new Map<string, Assignment>();

    for (const assignment of this.assignments) {

      if (assignment.assignment_status === 'active') {
        activeAssignments.set(
          assignment.student_id,
          assignment
        );
      }

    }

    const attendanceByStudent =
      new Map<string, Attendance[]>();

    for (const record of this.attendanceRecords) {

      const records =
        attendanceByStudent.get(record.student_id) ?? [];

      records.push(record);

      attendanceByStudent.set(
        record.student_id,
        records
      );

    }

    const reportsByStudent =
      new Map<string, WeeklyReport[]>();

    for (const report of this.weeklyReports) {

      const records =
        reportsByStudent.get(report.student_id) ?? [];

      records.push(report);

      reportsByStudent.set(
        report.student_id,
        records
      );

    }

    this.summaries = this.students.map(student => {

      const assignment = activeAssignments.get(student.id);

      const company =
        assignment?.company_name ?? 'Unassigned';

      const required =
        student.required_hours !== null &&
        Number(student.required_hours) > 0
          ? Number(student.required_hours)
          : null;

      const attendance =
        attendanceByStudent.get(student.student_id) ?? [];

      const reports =
        reportsByStudent.get(student.student_id) ?? [];

      let verified = 0;
      let provisional = 0;

      for (const record of attendance) {

        if (!record.time_in || !record.time_out) {
          continue;
        }

        const hours = Number(
          record.total_hours_rendered ?? 0
        );

        if (!Number.isFinite(hours) || hours < 0) {
          continue;
        }

        if (record.verification_status === 'verified') {
          verified += hours;
        }

        if (record.verification_status === 'provisional') {
          provisional += hours;
        }

      }

      const approved = reports.filter(
        report => report.status === 'approved'
      ).length;

      const submitted = reports.length;

      const latestReport = [...reports].sort(
        (a, b) =>
          b.week - a.week ||
          b.id - a.id
      )[0];

      const remaining = required === null
        ? null
        : Math.max(0, required - verified);

      let status = 'Ongoing';

      if (student.account_status !== 'active') {

        status = 'Inactive';

      } else if (required !== null && verified >= required) {

        status = 'Hours completed';

      } else if (!assignment) {

        status = 'Unassigned';

      } else if (
        student.ojt_start_date &&
        student.ojt_start_date > this.today
      ) {

        status = 'Not started';

      } else if (
        student.ojt_end_date &&
        student.ojt_end_date < this.today
      ) {

        status = 'Needs follow-up';

      }

      return {
        student,
        company,
        required,
        verified,
        provisional,
        remaining,
        approved,
        submitted,
        latestReportStatus: latestReport
          ? this.formatStatus(latestReport.status)
          : 'Not submitted',
        status
      };

    });

  }

  // =========================================
  // REPORT SELECTION
  // =========================================

  get activeReport(): ReportDefinition {

    return this.reportLibrary.find(
      report => report.id === this.selectedReport
    ) ?? this.reportLibrary[0];

  }

  selectReport(report: ReportType): void {

    this.selectedReport = report;
    this.selectedStatus = 'all';

    this.startDate = '';
    this.endDate = '';

    this.currentPage = 1;
    this.exportError = '';

    this.buildReportRows();

    if (
      this.selectedCompany !== 'all' &&
      !this.companyOptions.includes(this.selectedCompany)
    ) {
      this.selectedCompany = 'all';
    }

  }

  openCompletionReviews(): void {
    this.selectReport('completion');
  }

  // =========================================
  // REPORT GENERATION
  // =========================================

  private buildReportRows(): void {

    switch (this.selectedReport) {

      case 'master-list':
        this.reportRows = this.buildMasterList();
        break;

      case 'assignments':
        this.reportRows = this.buildAssignments();
        break;

      case 'dtr':
        this.reportRows = this.buildDtr();
        break;

      case 'hours-summary':
        this.reportRows = this.buildHoursSummary();
        break;

      case 'weekly-compliance':
        this.reportRows = this.buildWeeklyCompliance();
        break;

      case 'completion':
        this.reportRows = this.buildCompletionRecords();
        break;

    }

  }

  private buildMasterList(): ReportRow[] {

    return this.summaries.map(summary => ({

      studentUuid: summary.student.id,
      studentId: summary.student.student_id,
      company: summary.company,
      status: summary.status,

      cells: [
        summary.student.student_id,
        summary.student.full_name,
        summary.student.course || 'Not specified',
        summary.company,
        summary.status,
        `${this.formatNumber(summary.verified)} / ${
          summary.required === null
            ? 'Not set'
            : this.formatNumber(summary.required)
        } h`
      ]

    }));

  }

  private buildAssignments(): ReportRow[] {

    const studentMap = new Map(
      this.students.map(student => [student.id, student])
    );

    const supervisorMap = new Map(
      this.supervisors.map(
        supervisor => [supervisor.id, supervisor]
      )
    );

    return [...this.assignments]

      .sort((a, b) =>
        (b.assigned_date || '')
          .localeCompare(a.assigned_date || '')
      )

      .map(assignment => {

        const student = studentMap.get(
          assignment.student_id
        );

        const supervisor = supervisorMap.get(
          assignment.supervisor_id
        );

        const status = this.formatStatus(
          assignment.assignment_status
        );

        return {

          studentUuid: student?.id ?? '',
          studentId: student?.student_id ?? '',
          company: assignment.company_name,
          status,

          cells: [
            student?.full_name ?? 'Student unavailable',
            assignment.company_name,
            supervisor?.full_name ?? 'Supervisor unavailable',
            this.formatDate(assignment.assigned_date),
            status
          ]

        };

      });

  }

  private buildDtr(): ReportRow[] {

    const studentMap = new Map(
      this.students.map(
        student => [student.student_id, student]
      )
    );

    return [...this.attendanceRecords]

      .sort((a, b) =>
        b.attendance_date.localeCompare(a.attendance_date)
      )

      .map(record => {

        const student = studentMap.get(record.student_id);

        const company = 'Not recorded';

        const isComplete =
          !!record.time_in && !!record.time_out;

        const status =
          record.verification_status === 'rejected'
            ? 'Rejected'
            : !isComplete
              ? 'Incomplete'
              : this.formatStatus(record.verification_status);

        return {

          studentUuid: student?.id ?? '',
          studentId: record.student_id,
          company,
          status,

          cells: [
            this.formatDate(record.attendance_date),
            student?.full_name ?? record.student_id,
            company,
            this.formatTime(record.time_in),
            this.formatTime(record.time_out),
            isComplete
              ? this.formatHours(record.total_hours_rendered)
              : 'Not available',
            status
          ]

        };

      });

  }

  private buildHoursSummary(): ReportRow[] {

    return this.summaries.map(summary => ({

      studentUuid: summary.student.id,
      studentId: summary.student.student_id,
      company: summary.company,
      status: summary.status,

      cells: [
        summary.student.full_name,
        summary.company,
        this.formatHours(summary.required),
        this.formatHours(summary.verified),
        this.formatHours(summary.provisional),
        this.formatHours(summary.remaining)
      ]

    }));

  }

  private buildWeeklyCompliance(): ReportRow[] {

    return this.summaries.map(summary => ({

      studentUuid: summary.student.id,
      studentId: summary.student.student_id,
      company: summary.company,
      status: summary.latestReportStatus,

      cells: [
        summary.student.full_name,
        summary.company,
        String(summary.approved),
        String(summary.submitted),

        summary.submitted > 0
          ? `${Math.round(
              summary.approved /
              summary.submitted * 100
            )}%`
          : 'Not available',

        summary.latestReportStatus
      ]

    }));

  }

  private buildCompletionRecords(): ReportRow[] {

    return this.summaries

      .filter(summary =>
        summary.required !== null &&
        summary.verified >= summary.required
      )

      .map(summary => ({

        studentUuid: summary.student.id,
        studentId: summary.student.student_id,
        company: summary.company,
        status: 'Hours completed',

        cells: [
          summary.student.full_name,
          summary.company,
          this.formatHours(summary.required),
          this.formatHours(summary.verified),
          `${summary.approved} / ${summary.submitted}`,
          'Formal completion not recorded'
        ]

      }));

  }

  // =========================================
  // FILTER OPTIONS
  // =========================================

  get companyOptions(): string[] {

    return [...new Set(
      this.reportRows.map(row => row.company)
    )].sort((a, b) => a.localeCompare(b));

  }

  get studentOptions(): Student[] {

    return this.students;

  }

  get statusOptions(): string[] {

    return [...new Set(
      this.reportRows.map(row => row.status)
    )].sort((a, b) => a.localeCompare(b));

  }

  get showDateFilter(): boolean {

    return this.selectedReport === 'dtr' ||
      this.selectedReport === 'assignments';

  }

  get invalidDateRange(): boolean {

    return !!(
      this.startDate &&
      this.endDate &&
      this.startDate > this.endDate
    );

  }

  get hasActiveFilters(): boolean {

    return (
      this.selectedCompany !== 'all' ||
      this.selectedStudent !== 'all' ||
      this.selectedStatus !== 'all' ||
      !!this.startDate ||
      !!this.endDate
    );

  }

  onFilterChange(): void {

    this.currentPage = 1;
    this.exportError = '';

  }

  resetFilters(): void {

    this.selectedCompany = 'all';
    this.selectedStudent = 'all';
    this.selectedStatus = 'all';

    this.startDate = '';
    this.endDate = '';

    this.currentPage = 1;
    this.exportError = '';

  }

  // =========================================
  // FILTERED RECORDS
  // =========================================

  get filteredRows(): ReportRow[] {

    if (this.invalidDateRange) {
      return [];
    }

    return this.reportRows.filter(row => {

      const matchesCompany =
        this.selectedCompany === 'all' ||
        row.company === this.selectedCompany;

      const matchesStudent =
        this.selectedStudent === 'all' ||
        row.studentUuid === this.selectedStudent;

      const matchesStatus =
        this.selectedStatus === 'all' ||
        row.status === this.selectedStatus;

      let matchesDate = true;

      if (
        this.showDateFilter &&
        (this.startDate || this.endDate)
      ) {

        const dateText =
          this.selectedReport === 'dtr'
            ? row.cells[0]
            : row.cells[3];

        const parsedDate = new Date(dateText);

        if (Number.isNaN(parsedDate.getTime())) {

          matchesDate = false;

        } else {

          const date = this.toLocalDate(parsedDate);

          matchesDate =
            (!this.startDate || date >= this.startDate) &&
            (!this.endDate || date <= this.endDate);

        }

      }

      return matchesCompany &&
        matchesStudent &&
        matchesStatus &&
        matchesDate;

    });

  }

  get filteredCount(): number {
    return this.filteredRows.length;
  }

  // =========================================
  // PAGINATION
  // =========================================

  get totalPages(): number {

    return Math.max(
      1,
      Math.ceil(this.filteredCount / this.pageSize)
    );

  }

  get paginatedRows(): ReportRow[] {

    const start =
      (this.currentPage - 1) * this.pageSize;

    return this.filteredRows.slice(
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

  get pageNumbers(): number[] {

    const start = Math.max(
      1,
      Math.min(
        this.currentPage - 2,
        this.totalPages - 4
      )
    );

    const end = Math.min(
      this.totalPages,
      start + 4
    );

    return Array.from(
      { length: end - start + 1 },
      (_, index) => start + index
    );

  }

  goToPage(page: number): void {

    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
    }

  }

  previousPage(): void {
    this.goToPage(this.currentPage - 1);
  }

  nextPage(): void {
    this.goToPage(this.currentPage + 1);
  }

  // =========================================
  // COMPLETION REVIEW QUEUE
  // =========================================

  get completionQueue(): StudentSummary[] {

    const visibleStudents = new Set(
      this.filteredRows.map(row => row.studentUuid)
    );

    return this.summaries.filter(summary =>

      summary.required !== null &&
      summary.verified >= summary.required &&
      visibleStudents.has(summary.student.id)

    );

  }

  get completionCount(): number {

    return this.summaries.filter(summary =>

      summary.required !== null &&
      summary.verified >= summary.required

    ).length;

  }

  reviewStudent(summary: StudentSummary): void {

    void this.router.navigate([
      '/coordinator/student-interns',
      summary.student.id
    ]);

  }

  // =========================================
  // CSV EXPORT
  // =========================================

  get canExport(): boolean {

    return !this.isLoading &&
      !this.errorMessage &&
      !this.isExporting &&
      !this.invalidDateRange &&
      this.filteredCount > 0;

  }

  exportCsv(): void {

    if (!this.canExport) {
      return;
    }

    this.exportError = '';

    try {

      const headers = this.activeReport.columns;

      const rows = this.filteredRows.map(
        row => row.cells
      );

      const csv = [headers, ...rows]

        .map(row =>
          row.map(cell => this.escapeCsv(cell)).join(',')
        )

        .join('\r\n');

      const blob = new Blob(
        ['\uFEFF', csv],
        { type: 'text/csv;charset=utf-8;' }
      );

      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');

      link.href = url;

      link.download =
        `InternTrack-${this.selectedReport}-${this.today}.csv`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => URL.revokeObjectURL(url), 1000);

    } catch (error) {

      console.error('CSV export failed:', error);

      this.exportError =
        'Unable to export the report. Please try again.';

    }

  }

  private escapeCsv(value: string): string {

    let safeValue = String(value ?? '');

    // Prevent spreadsheet formula injection.
    if (/^[\s]*[=+\-@]/.test(safeValue)) {
      safeValue = "'" + safeValue;
    }

    return `"${safeValue.replace(/"/g, '""')}"`;

  }

  // =========================================
  // PDF EXPORT
  // =========================================
  
  printReport(): void {

    if (!this.canExport) {
      return;
    }

    this.isExporting = true;
    this.exportError = '';

    try {

      const report = this.activeReport;

      const rows = this.filteredRows;

      const filterDescription = [

        this.selectedCompany === 'all'
          ? 'All companies'
          : this.selectedCompany,

        this.selectedStudent === 'all'
          ? 'All students'
          : this.students.find(
              student =>
                student.id === this.selectedStudent
            )?.full_name ?? 'Selected student',

        this.selectedStatus === 'all'
          ? 'All statuses'
          : this.selectedStatus,

        this.showDateFilter &&
        (this.startDate || this.endDate)
          ? `Date range: ${this.startDate || 'Any'} to ${
              this.endDate || 'Any'
            }`
          : ''

      ].filter(Boolean).join(' | ');

      const documentDefinition = createReportTemplate({

        schoolName: this.schoolName,

        title: report.title,

        description: report.description,

        columns: report.columns,

        rows: rows.map(row => row.cells),

        filters: filterDescription,

        generatedDate: this.formatDate(
          new Date().toISOString()
        ),

        note: this.reportNote,

        reportType: this.selectedReport

      });

      pdfMake
        .createPdf(documentDefinition)
        .open();

    } catch (error) {

      console.error(
        'PDF generation failed:',
        error
      );

      this.exportError =
        'Unable to generate the PDF report. Please try again.';

    } finally {

      this.isExporting = false;

      this.cdr.detectChanges();

    }

  }


  // =========================================
  // REPORT NOTES
  // =========================================

  get reportNote(): string {

    switch (this.selectedReport) {

      case 'master-list':
        return 'Company information reflects the current active placement. Verified hours include complete, synced, supervisor-verified attendance records.';

      case 'assignments':
        return 'Assignment history is retained. The assigned date is the recorded assignment date, not necessarily the internship start date.';

      case 'dtr':
        return 'Only synced attendance records are included. Historical company information is not stored directly in the attendance record.';

      case 'hours-summary':
        return 'Only verified hours count toward the required internship hours. Provisional hours are awaiting verification.';

      case 'weekly-compliance':
        return 'Approval rate is based on approved reports divided by submitted reports. It is not institutional compliance against a required weekly report count.';

      case 'completion':
        return 'Reaching the required verified hours does not automatically confirm formal internship completion.';

      default:
        return '';

    }

  }

  // =========================================
  // FORMATTING HELPERS
  // =========================================

  get today(): string {

    return this.toLocalDate(new Date());

  }

  get generatedDate(): string {

    return this.formatDate(
      this.generatedAt.toISOString()
    );

  }

  private toLocalDate(date: Date): string {

    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
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

  formatDate(value: string | null): string {

    if (!value) {
      return 'Not recorded';
    }

    const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00+08:00`)
      : new Date(value);

    if (Number.isNaN(date.getTime())) {
      return 'Not recorded';
    }

    return new Intl.DateTimeFormat('en-US', {

      timeZone: 'Asia/Manila',
      month: 'short',
      day: 'numeric',
      year: 'numeric'

    }).format(date);

  }

  formatTime(value: string | null): string {

    if (!value) {
      return 'Not recorded';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return 'Not recorded';
    }

    return new Intl.DateTimeFormat('en-GB', {

      timeZone: 'Asia/Manila',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'

    }).format(date);

  }

  formatNumber(value: number): string {

    return Number(value).toLocaleString('en-US', {

      maximumFractionDigits: 2

    });

  }

  formatHours(value: number | null): string {

    if (
      value === null ||
      !Number.isFinite(Number(value))
    ) {
      return 'Not set';
    }

    return `${this.formatNumber(Number(value))} h`;

  }

  formatStatus(status: string | null): string {

    switch (status) {

      case 'active':
        return 'Active';

      case 'inactive':
        return 'Inactive';

      case 'ended':
        return 'Ended';

      case 'disabled':
        return 'Disabled';

      case 'verified':
        return 'Verified';

      case 'provisional':
        return 'Pending verification';

      case 'rejected':
        return 'Rejected';

      case 'approved':
        return 'Approved';

      case 'pending_review':
        return 'Pending review';

      case 'returned':
        return 'Returned for revision';

      case 'draft':
        return 'Draft';

      default:
        return status
          ? status.replace(/_/g, ' ')
          : 'Not recorded';

    }

  }

  trackByReport(
    index: number,
    report: ReportDefinition
  ): string {

    return report.id;

  }

  trackByRow(index: number): number {
    return index;
  }

  trackByPage(index: number, page: number): number {
    return page;
  }

  trackByStudent(
    index: number,
    summary: StudentSummary
  ): string {

    return summary.student.id;

  }

}
