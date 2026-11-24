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

type ReportStatus = 'pending_review' | 'approved' | 'returned';

interface Intern {
  id: string;
  name: string;
  initials: string;
  department: string;
  avatarColor: string;
}

interface WeeklyReport {
  id: number;
  studentId: string;
  studentName: string;
  initials: string;
  avatarColor: string;
  week: number;
  period: string;
  submittedDate: string;
  submittedAt: string | null;
  status: ReportStatus;
  statusLabel: string;
}

@Component({
  selector: 'app-reports-review',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './reports-review.page.html',
  styleUrls: ['./reports-review.page.scss'],
})
export class ReportsReviewPage implements OnInit, OnDestroy {

  private supabaseService = inject(SupabaseService);
  private supabase = this.supabaseService.getClient();
  private authService = inject(AuthService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  private loadVersion = 0;

  interns: Intern[] = [];
  reports: WeeklyReport[] = [];

  loading = true;
  loadError = '';

  searchQuery = '';
  selectedWeek = 'all';
  selectedStatus = 'all';

  currentPage = 1;
  readonly pageSize = 8;

  ngOnInit(): void {
    void this.loadData();
  }

  ngOnDestroy(): void {
    this.loadVersion++;
  }

  async loadData(): Promise<void> {

    const version = ++this.loadVersion;

    this.loading = true;
    this.loadError = '';
    this.interns = [];
    this.reports = [];
    this.currentPage = 1;

    this.cdr.markForCheck();

    const userId = this.authService.getCurrentUser()?.id;

    try {

      if (!userId) {
        throw new Error('No authenticated user found.');
      }

      // Get the current supervisor profile

      const { data: supervisor, error: supervisorError } =
        await this.supabase
          .from('company_supervisors')
          .select('id')
          .eq('user_id', userId)
          .single();

      if (supervisorError) throw supervisorError;

      if (!supervisor) {
        throw new Error('Supervisor profile not found.');
      }

      if (!this.isCurrentRequest(version, userId)) return;

      // Get actively assigned interns

      const { data: assignments, error: assignmentError } =
        await this.supabase
          .from('intern_supervisor_assignments')
          .select(`
            student_id,
            students!student_id(
              id,
              student_id,
              full_name,
              course,
              department
            )
          `)
          .eq('supervisor_id', supervisor.id)
          .eq('assignment_status', 'active');

      if (assignmentError) throw assignmentError;

      if (!this.isCurrentRequest(version, userId)) return;

      const internMap = new Map<string, Intern>();

      for (const assignment of assignments || []) {

        const student = Array.isArray(assignment.students)
          ? assignment.students[0]
          : assignment.students;

        if (!student?.student_id) continue;

        const name = student.full_name || 'Unknown student';

        internMap.set(student.student_id, {
          id: student.student_id,
          name,
          initials: this.getInitials(name),
          department: student.department || 'Not provided',
          avatarColor: this.getAvatarColor(student.student_id)
        });
      }

      this.interns = Array.from(internMap.values());

      if (this.interns.length === 0) return;

      const studentIds = this.interns.map(intern => intern.id);

      const allReports: WeeklyReport[] = [];

      // Retrieve reports in batches

      const batchSize = 50;
      const fetchSize = 500;

      for (
        let batchStart = 0;
        batchStart < studentIds.length;
        batchStart += batchSize
      ) {

        const batch = studentIds.slice(
          batchStart,
          batchStart + batchSize
        );

        let offset = 0;

        while (true) {

          const { data, error, count } = await this.supabase
            .from('reports')
            .select(`
              id,
              student_id,
              week,
              period,
              start_date,
              end_date,
              submitted_at,
              status
            `, { count: 'exact' })
            .in('student_id', batch)
            .in('status', [
              'pending_review',
              'approved',
              'returned'
            ])
            .order('id', { ascending: true })
            .range(offset, offset + fetchSize - 1);

          if (error) throw error;

          if (!this.isCurrentRequest(version, userId)) return;

          const records = data || [];

          for (const record of records) {

            const intern = internMap.get(record.student_id);

            if (!intern) continue;

            const status = record.status as ReportStatus;

            allReports.push({
              id: record.id,
              studentId: record.student_id,
              studentName: intern.name,
              initials: intern.initials,
              avatarColor: intern.avatarColor,
              week: record.week,
              period: record.period ||
                this.formatPeriod(
                  record.start_date,
                  record.end_date
                ),
              submittedDate: this.formatSubmittedDate(
                record.submitted_at
              ),
              submittedAt: record.submitted_at,
              status,
              statusLabel: this.getStatusLabel(status)
            });
          }

          offset += records.length;

          if (
            records.length === 0 ||
            (count !== null && offset >= count) ||
            (count === null && records.length < fetchSize)
          ) {
            break;
          }
        }
      }

      // Most recently submitted reports appear first

      this.reports = allReports.sort((a, b) => {

        const dateA = a.submittedAt
          ? new Date(a.submittedAt).getTime()
          : 0;

        const dateB = b.submittedAt
          ? new Date(b.submittedAt).getTime()
          : 0;

        return dateB - dateA || b.id - a.id;
      });

    } catch (error) {

      if (version !== this.loadVersion) return;

      console.error('Error loading weekly reports:', error);

      this.interns = [];
      this.reports = [];
      this.loadError =
        'We could not retrieve the weekly reports. Please try again.';

    } finally {

      if (version === this.loadVersion) {
        this.loading = false;
        this.cdr.markForCheck();
      }
    }
  }

  private isCurrentRequest(
    version: number,
    userId: string
  ): boolean {

    return version === this.loadVersion &&
      this.authService.getCurrentUser()?.id === userId;
  }

  // Summary counts

  get pendingCount(): number {
    return this.reports.filter(
      report => report.status === 'pending_review'
    ).length;
  }

  get returnedCount(): number {
    return this.reports.filter(
      report => report.status === 'returned'
    ).length;
  }

  // Reporting week options

  get weeks(): number[] {
    return Array.from(
      new Set(this.reports.map(report => report.week))
    ).sort((a, b) => b - a);
  }

  // Search and filters

  get filteredReports(): WeeklyReport[] {

    const query = this.searchQuery.trim().toLowerCase();

    return this.reports.filter(report => {

      const matchesSearch =
        !query ||
        report.studentName.toLowerCase().includes(query) ||
        report.studentId.toLowerCase().includes(query);

      const matchesWeek =
        this.selectedWeek === 'all' ||
        String(report.week) === String(this.selectedWeek);

      const matchesStatus =
        this.selectedStatus === 'all' ||
        report.status === this.selectedStatus;

      return matchesSearch && matchesWeek && matchesStatus;
    });
  }

  resetPage(): void {
    this.currentPage = 1;
  }

  clearFilters(): void {
    this.searchQuery = '';
    this.selectedWeek = 'all';
    this.selectedStatus = 'all';
    this.resetPage();
  }

  // Pagination

  get totalPages(): number {
    return Math.max(
      1,
      Math.ceil(this.filteredReports.length / this.pageSize)
    );
  }

  get pageNumbers(): number[] {
    return Array.from(
      { length: this.totalPages },
      (_, index) => index + 1
    );
  }

  get paginatedReports(): WeeklyReport[] {

    const start = (this.currentPage - 1) * this.pageSize;

    return this.filteredReports.slice(
      start,
      start + this.pageSize
    );
  }

  get firstRecord(): number {

    return this.filteredReports.length === 0
      ? 0
      : (this.currentPage - 1) * this.pageSize + 1;
  }

  get lastRecord(): number {

    return Math.min(
      this.currentPage * this.pageSize,
      this.filteredReports.length
    );
  }

  goToPage(page: number): void {

    if (page < 1 || page > this.totalPages) return;

    this.currentPage = page;
  }

  // Navigation

  openReport(reportId: number): void {

    void this.router.navigate([
      '/supervisor',
      'reports',
      reportId
    ]);
  }

  // Formatting helpers

  private getStatusLabel(status: ReportStatus): string {

    switch (status) {
      case 'pending_review':
        return 'Pending';

      case 'approved':
        return 'Approved';

      case 'returned':
        return 'Returned';
    }
  }

  private getInitials(name: string): string {

    const parts = name.trim().split(/\s+/).filter(Boolean);

    return parts.slice(0, 2)
      .map(part => part[0].toUpperCase())
      .join('') || '?';
  }

  private getAvatarColor(studentId: string): string {

    const colors = [
      'blue',
      'orange',
      'slate',
      'green',
      'purple'
    ];

    const hash = Array.from(studentId).reduce(
      (sum, char) => sum + char.charCodeAt(0),
      0
    );

    return colors[hash % colors.length];
  }

  private formatSubmittedDate(value: string | null): string {

    if (!value) return 'Not recorded';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return 'Not recorded';

    const dateLabel = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'Asia/Manila'
    });

    const timeLabel = date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Manila'
    });

    return `${dateLabel} · ${timeLabel}`;
  }

  private formatPeriod(
    start: string | null,
    end: string | null
  ): string {

    if (!start || !end) return 'Not provided';

    const startDate = new Date(`${start}T00:00:00Z`);
    const endDate = new Date(`${end}T00:00:00Z`);

    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime())
    ) {
      return 'Not provided';
    }

    return startDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC'
    }) + ' – ' +
    endDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC'
    });
  }
}