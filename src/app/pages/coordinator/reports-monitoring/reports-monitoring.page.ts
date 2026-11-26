import {
  Component,
  OnInit,
  inject,
  ChangeDetectorRef,
  NgZone
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonIcon, IonHeader, IonToolbar, IonTitle } from '@ionic/angular';

import { addIcons } from 'ionicons';

import {
  searchOutline,
  eyeOutline,
  chevronDownOutline,
  chevronBackOutline,
  chevronForwardOutline,
  documentTextOutline,
  alertCircleOutline,
  refreshOutline,
  closeOutline
} from 'ionicons/icons';

import { SupabaseService } from '../../../services/supabase.service';

interface StudentRecord {
  id: string;
  student_id: string;
  full_name: string;
  company_name: string | null;
}

interface ReportRecord {
  id: number;
  student_id: string;
  week: number;
  period: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  submitted_at: string | null;
  reviewing_supervisor_id: string | null;
}

interface AssignmentRecord {
  id: string;
  student_id: string;
  supervisor_id: string;
  company_name: string;
  assignment_status: string;
  start_date: string | null;
  end_date: string | null;
}

interface WeeklyReport {
  id: number;
  studentId: string;
  studentUuid: string;
  fullName: string;
  companyName: string;
  week: number;
  period: string;
  submittedAt: string | null;
  status: string;
  initials: string;
  avatarColor: string;
}

@Component({
  selector: 'app-reports-monitoring',
  templateUrl: './reports-monitoring.page.html',
  styleUrls: ['./reports-monitoring.page.scss'],
  standalone: true,
  imports: [IonTitle, IonToolbar, IonHeader, 
    CommonModule,
    FormsModule,
    IonIcon
  ]
})
export class ReportsMonitoringPage implements OnInit {

  private supabaseService = inject(SupabaseService);
  private supabase = this.supabaseService.getClient();

  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private ngZone = inject(NgZone);

  reports: WeeklyReport[] = [];

  isLoading = true;
  errorMessage = '';

  private loadingInProgress = false;

  searchQuery = '';
  selectedCompany = 'all';
  selectedWeek = 'all';
  selectedStatus = 'all';

  currentPage = 1;
  readonly pageSize = 10;

  constructor() {
    addIcons({
      searchOutline,
      eyeOutline,
      chevronDownOutline,
      chevronBackOutline,
      chevronForwardOutline,
      documentTextOutline,
      alertCircleOutline,
      refreshOutline,
      closeOutline
    });
  }

  ngOnInit(): void {
    void this.loadReports();
  }

  ionViewWillEnter(): void {
    void this.loadReports();
  }

  // =========================================
  // LOAD REPORTS
  // =========================================

  async loadReports(): Promise<void> {

    if (this.loadingInProgress) {
      return;
    }

    this.loadingInProgress = true;
    this.isLoading = true;
    this.errorMessage = '';

    try {

      const [
        reportRecords,
        students,
        assignments
      ] = await Promise.all([
        this.fetchReports(),
        this.fetchStudents(),
        this.fetchAssignments()
      ]);

      const studentMap = new Map<string, StudentRecord>();

      students.forEach(student => {
        studentMap.set(student.student_id, student);
      });

      const assignmentMap = new Map<string, AssignmentRecord[]>();

      assignments.forEach(assignment => {

        const existing =
          assignmentMap.get(assignment.student_id) || [];

        existing.push(assignment);

        assignmentMap.set(
          assignment.student_id,
          existing
        );
      });

      const mappedReports: WeeklyReport[] =
        reportRecords.map(report => {

          const student = studentMap.get(report.student_id);

          const studentAssignments = student
            ? assignmentMap.get(student.id) || []
            : [];

          const fullName =
            student?.full_name || 'Unknown student';

          return {
            id: report.id,

            studentId: report.student_id,

            studentUuid: student?.id || '',

            fullName,

            companyName: this.resolveCompany(
              report,
              studentAssignments
            ),

            week: Number(report.week),

            period: this.formatPeriod(
              report.start_date,
              report.end_date,
              report.period
            ),

            submittedAt: report.submitted_at,

            status: report.status,

            initials: this.getInitials(fullName),

            avatarColor: this.getAvatarColor(
              report.student_id
            )
          };
        });

      this.ngZone.run(() => {

        this.reports = mappedReports;

        this.currentPage = Math.min(
          this.currentPage,
          this.totalPages
        );

        this.cdr.detectChanges();
      });

    } catch (error) {

      console.error(
        'Unable to load weekly reports:',
        error
      );

      this.ngZone.run(() => {
        this.errorMessage =
          'Unable to load weekly reports. Please check your connection and try again.';
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
  // FETCH DATABASE RECORDS
  // =========================================

  private async fetchReports(): Promise<ReportRecord[]> {

    const records: ReportRecord[] = [];

    const batchSize = 500;

    let offset = 0;

    while (true) {

      const { data, error } = await this.supabase
        .from('reports')
        .select(`
          id,
          student_id,
          week,
          period,
          status,
          start_date,
          end_date,
          submitted_at,
          reviewing_supervisor_id
        `)
        .in('status', [
          'pending_review',
          'approved',
          'returned'
        ])
        .order('submitted_at', {
          ascending: false,
          nullsFirst: false
        })
        .order('id', {
          ascending: false
        })
        .range(
          offset,
          offset + batchSize - 1
        );

      if (error) {
        throw error;
      }

      const batch = (data || []) as ReportRecord[];

      records.push(...batch);

      if (batch.length < batchSize) {
        break;
      }

      offset += batchSize;
    }

    return records;
  }

  private async fetchStudents(): Promise<StudentRecord[]> {

    const records: StudentRecord[] = [];

    const batchSize = 500;

    let offset = 0;

    while (true) {

      const { data, error } = await this.supabase
        .from('students')
        .select(`
          id,
          student_id,
          full_name,
          company_name
        `)
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

      const batch = (data || []) as StudentRecord[];

      records.push(...batch);

      if (batch.length < batchSize) {
        break;
      }

      offset += batchSize;
    }

    return records;
  }

  private async fetchAssignments(): Promise<AssignmentRecord[]> {

    const records: AssignmentRecord[] = [];

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

      const batch = (data || []) as AssignmentRecord[];

      records.push(...batch);

      if (batch.length < batchSize) {
        break;
      }

      offset += batchSize;
    }

    return records;
  }

  // =========================================
  // HISTORICAL COMPANY ATTRIBUTION
  // =========================================

  private resolveCompany(
    report: ReportRecord,
    assignments: AssignmentRecord[]
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
  // SUMMARY
  // =========================================

  get totalReports(): number {
    return this.reports.length;
  }

  get pendingReports(): number {
    return this.reports.filter(
      report => report.status === 'pending_review'
    ).length;
  }

  get approvedReports(): number {
    return this.reports.filter(
      report => report.status === 'approved'
    ).length;
  }

  get returnedReports(): number {
    return this.reports.filter(
      report => report.status === 'returned'
    ).length;
  }

  get summaryText(): string {

    return `${this.totalReports} submitted reports · ` +
      `${this.pendingReports} pending supervisor review · ` +
      `${this.approvedReports} approved · ` +
      `${this.returnedReports} returned for revision.`;
  }

  // =========================================
  // FILTER OPTIONS
  // =========================================

  get companyOptions(): string[] {

    return [
      ...new Set(
        this.reports.map(report => report.companyName)
      )
    ].sort((a, b) => a.localeCompare(b));
  }

  get weekOptions(): number[] {

    return [
      ...new Set(
        this.reports.map(report => report.week)
      )
    ].sort((a, b) => b - a);
  }

  get hasActiveFilters(): boolean {

    return !!this.searchQuery.trim() ||
      this.selectedCompany !== 'all' ||
      this.selectedWeek !== 'all' ||
      this.selectedStatus !== 'all';
  }

  // =========================================
  // SEARCH AND FILTER
  // =========================================

  get filteredReports(): WeeklyReport[] {

    const query =
      this.searchQuery.trim().toLowerCase();

    return this.reports.filter(report => {

      const matchesSearch =
        !query ||
        report.fullName.toLowerCase().includes(query) ||
        report.studentId.toLowerCase().includes(query);

      const matchesCompany =
        this.selectedCompany === 'all' ||
        report.companyName === this.selectedCompany;

      const matchesWeek =
        this.selectedWeek === 'all' ||
        report.week === Number(this.selectedWeek);

      const matchesStatus =
        this.selectedStatus === 'all' ||
        report.status === this.selectedStatus;

      return matchesSearch &&
        matchesCompany &&
        matchesWeek &&
        matchesStatus;
    });
  }

  get filteredCount(): number {
    return this.filteredReports.length;
  }

  onFilterChange(): void {
    this.currentPage = 1;
  }

  clearFilters(): void {

    this.searchQuery = '';
    this.selectedCompany = 'all';
    this.selectedWeek = 'all';
    this.selectedStatus = 'all';

    this.currentPage = 1;
  }

  // =========================================
  // PAGINATION
  // =========================================

  get totalPages(): number {

    return Math.max(
      1,
      Math.ceil(
        this.filteredCount / this.pageSize
      )
    );
  }

  get paginatedReports(): WeeklyReport[] {

    const start =
      (this.currentPage - 1) * this.pageSize;

    return this.filteredReports.slice(
      start,
      start + this.pageSize
    );
  }

  get showingFrom(): number {

    if (!this.filteredCount) {
      return 0;
    }

    return (
      (this.currentPage - 1) * this.pageSize
    ) + 1;
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
      return [1, 2, 3, '...', total];
    }

    if (current >= total - 1) {

      return [
        1,
        '...',
        total - 2,
        total - 1,
        total
      ];
    }

    return [
      1,
      ...(current > 3 ? ['...'] : []),
      current - 1,
      current,
      current + 1,
      ...(current < total - 2 ? ['...'] : []),
      total
    ];
  }

  goToPage(page: number | string): void {

    if (
      typeof page !== 'number' ||
      page < 1 ||
      page > this.totalPages
    ) {
      return;
    }

    this.currentPage = page;
  }

  previousPage(): void {
    this.goToPage(this.currentPage - 1);
  }

  nextPage(): void {
    this.goToPage(this.currentPage + 1);
  }

  // =========================================
  // NAVIGATION
  // =========================================

  viewReport(report: WeeklyReport): void {

    void this.router.navigate([
      '/coordinator/reports',
      report.id
    ]);
  }

  retryLoad(): void {
    void this.loadReports();
  }

  // =========================================
  // FORMATTING
  // =========================================

  getStatusLabel(status: string): string {

    switch (status) {

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

  getStatusClass(status: string): string {

    switch (status) {

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

  formatDate(value: string | null): string {

    if (!value) {
      return 'Not recorded';
    }

    const date = new Date(
      /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? `${value}T00:00:00+08:00`
        : value
    );

    if (Number.isNaN(date.getTime())) {
      return 'Not recorded';
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

  private getInitials(name: string): string {

    const parts = name
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    return parts
      .slice(0, 2)
      .map(part => part.charAt(0).toUpperCase())
      .join('') || 'ST';
  }

  private getAvatarColor(value: string): string {

    const colors = [
      'blue',
      'purple',
      'orange',
      'green',
      'rose',
      'slate'
    ];

    let hash = 0;

    for (let i = 0; i < value.length; i++) {
      hash = (hash * 31 + value.charCodeAt(i)) | 0;
    }

    return colors[Math.abs(hash) % colors.length];
  }

  trackByReport(
    index: number,
    report: WeeklyReport
  ): number {

    return report.id;
  }
}
