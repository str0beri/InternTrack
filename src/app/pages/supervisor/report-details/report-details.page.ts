import { CommonModule } from '@angular/common';

import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  ViewChild,
  inject,
  OnInit,
  OnDestroy
} from '@angular/core';

import { FormsModule } from '@angular/forms';

import {
  ActivatedRoute,
  Router
} from '@angular/router';

import { AuthService } from '../../../services/auth.service';
import { SupabaseService } from '../../../services/supabase.service';

type ReportStatus =
  'pending_review' | 'approved' | 'returned';

type DialogMode = 'approve' | 'return' | null;

interface Student {
  id: string;
  student_id: string;
  full_name: string;
  course: string | null;
  department: string | null;
}

interface Supervisor {
  id: string;
  full_name: string;
}

interface Report {
  id: number;
  student_id: string;
  week: number;
  period: string;
  status: ReportStatus;
  accomplishments: string | null;
  student_reflection: string | null;
  feedback: string | null;
  comment_count: number | null;
  start_date: string | null;
  end_date: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewing_supervisor_id: string | null;
  supervisor_name: string | null;
  updated_at: string;
}

@Component({
  selector: 'app-report-details',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './report-details.page.html',
  styleUrls: ['./report-details.page.scss'],
})
export class ReportDetailsPage implements OnInit, OnDestroy {

  private supabaseService = inject(SupabaseService);
  private supabase = this.supabaseService.getClient();

  private authService = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  @ViewChild('reviewDialog')
  reviewDialog!: ElementRef<HTMLDialogElement>;

  private loadVersion = 0;
  private destroyed = false;
  private currentUserId = '';

  private supervisor: Supervisor | null = null;

  private readonly reportColumns = `
    id,
    student_id,
    week,
    period,
    status,
    accomplishments,
    student_reflection,
    feedback,
    comment_count,
    start_date,
    end_date,
    submitted_at,
    reviewed_at,
    reviewing_supervisor_id,
    supervisor_name,
    updated_at
  `;

  reportId = '';

  report: Report | null = null;
  student: Student | null = null;

  loading = true;
  saving = false;

  loadError = '';
  actionError = '';
  successMessage = '';

  dialogMode: DialogMode = null;
  feedback = '';

  ngOnInit(): void {

    this.reportId =
      this.route.snapshot.paramMap.get('reportId') || '';

    void this.loadData();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.loadVersion++;
  }

  // Load report details

  async loadData(): Promise<void> {

    const version = ++this.loadVersion;

    this.loading = true;
    this.loadError = '';
    this.successMessage = '';

    this.report = null;
    this.student = null;
    this.supervisor = null;

    this.cdr.markForCheck();

    const userId = this.authService.getCurrentUser()?.id;

    try {

      if (!userId) {
        throw new Error('No authenticated user found.');
      }

      if (!/^[1-9]\d*$/.test(this.reportId)) {
        throw new Error('Invalid report identifier.');
      }

      this.currentUserId = userId;

      // Get the logged-in supervisor

      const { data: supervisor, error: supervisorError } =
        await this.supabase
          .from('company_supervisors')
          .select('id, full_name')
          .eq('user_id', userId)
          .single();

      if (supervisorError) throw supervisorError;

      if (!supervisor) {
        throw new Error('Supervisor profile not found.');
      }

      if (!this.isCurrentRequest(version, userId)) return;

      // Retrieve active intern assignments

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

      const assignedStudents = new Map<string, Student>();

      for (const assignment of assignments || []) {

        const student = Array.isArray(assignment.students)
          ? assignment.students[0]
          : assignment.students;

        if (student?.student_id) {
          assignedStudents.set(student.student_id, student);
        }
      }

      const assignedIds = Array.from(assignedStudents.keys());

      if (assignedIds.length === 0) {
        throw new Error('No active intern assignments found.');
      }

      // Retrieve the selected submitted report

      const { data: report, error: reportError } =
        await this.supabase
          .from('reports')
          .select(this.reportColumns)
          .eq('id', this.reportId)
          .in('student_id', assignedIds)
          .in('status', [
            'pending_review',
            'approved',
            'returned'
          ])
          .maybeSingle();

      if (reportError) throw reportError;

      if (!this.isCurrentRequest(version, userId)) return;

      if (!report) {
        throw new Error(
          'Report not found or access is not permitted.'
        );
      }

      const selectedReport = report as unknown as Report;

      const student = assignedStudents.get(
        selectedReport.student_id
      );

      if (!student) {
        throw new Error('Student is not assigned to you.');
      }

      this.supervisor = supervisor;
      this.report = selectedReport;
      this.student = student;

    } catch (error) {

      if (version !== this.loadVersion) return;

      console.error('Error loading report details:', error);

      this.report = null;
      this.student = null;
      this.supervisor = null;

      this.loadError =
        'The report could not be retrieved or you do not have permission to view it.';

    } finally {

      if (!this.destroyed && version === this.loadVersion) {
        this.loading = false;
        this.cdr.markForCheck();
      }
    }
  }

  private isCurrentRequest(
    version: number,
    userId: string
  ): boolean {

    return !this.destroyed &&
      version === this.loadVersion &&
      this.authService.getCurrentUser()?.id === userId;
  }

  private isCurrentIdentity(): boolean {

    return !this.destroyed &&
      !!this.currentUserId &&
      this.authService.getCurrentUser()?.id ===
        this.currentUserId;
  }

  // Display helpers

  get initials(): string {

    if (!this.student) return '?';

    return this.student.full_name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0].toUpperCase())
      .join('') || '?';
  }

  get statusLabel(): string {

    switch (this.report?.status) {

      case 'pending_review':
        return 'Pending';

      case 'approved':
        return 'Approved';

      case 'returned':
        return 'Returned';

      default:
        return 'Unknown';
    }
  }

  get reportingPeriod(): string {

    if (!this.report) return '';

    if (this.report.period) {
      return this.report.period;
    }

    if (!this.report.start_date || !this.report.end_date) {
      return 'Not provided';
    }

    const start = new Date(
      `${this.report.start_date}T00:00:00Z`
    );

    const end = new Date(
      `${this.report.end_date}T00:00:00Z`
    );

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime())
    ) {
      return 'Not provided';
    }

    return start.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC'
    }) + ' – ' +
    end.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC'
    });
  }

  formatDateTime(value: string | null): string {

    if (!value) return 'Not recorded';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return 'Not recorded';
    }

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

  // Navigation

  goBack(): void {

    if (this.saving) return;

    void this.router.navigate(['/supervisor', 'reports']);
  }

  openInternProfile(): void {

    if (!this.student || this.saving) return;

    void this.router.navigate([
      '/supervisor',
      'interns',
      this.student.student_id
    ]);
  }

  // Confirmation dialogs

  openDialog(mode: 'approve' | 'return'): void {

    if (
      !this.report ||
      this.report.status !== 'pending_review' ||
      this.saving ||
      !this.isCurrentIdentity()
    ) {
      return;
    }

    this.dialogMode = mode;
    this.feedback = '';
    this.actionError = '';

    this.cdr.detectChanges();

    const dialog = this.reviewDialog.nativeElement;

    if (!dialog.open) {
      dialog.showModal();
    }
  }

  closeDialog(): void {

    if (this.saving) return;

    const dialog = this.reviewDialog?.nativeElement;

    if (dialog?.open) {
      dialog.close();
    }
  }

  onDialogCancel(event: Event): void {

    if (this.saving) {
      event.preventDefault();
    }
  }

  onDialogClosed(): void {

    this.dialogMode = null;
    this.feedback = '';
    this.actionError = '';

    if (!this.destroyed) {
      this.cdr.markForCheck();
    }
  }

  // Approve or return the report

  async confirmDecision(): Promise<void> {

    if (
      !this.report ||
      !this.student ||
      !this.supervisor ||
      !this.dialogMode ||
      this.report.status !== 'pending_review' ||
      this.saving ||
      !this.isCurrentIdentity()
    ) {
      return;
    }

    const mode = this.dialogMode;
    const feedback = this.feedback.trim();

    if (mode === 'return' && feedback.length < 20) {

      this.actionError =
        'Please provide at least 20 characters of feedback.';

      return;
    }

    const report = this.report;
    const student = this.student;
    const supervisor = this.supervisor;

    const nextStatus: ReportStatus =
      mode === 'approve' ? 'approved' : 'returned';

    this.saving = true;
    this.actionError = '';
    this.successMessage = '';

    this.cdr.markForCheck();

    try {

      // Recheck active assignment before making changes

      const { data: assignment, error: assignmentError } =
        await this.supabase
          .from('intern_supervisor_assignments')
          .select('student_id')
          .eq('student_id', student.id)
          .eq('supervisor_id', supervisor.id)
          .eq('assignment_status', 'active')
          .limit(1)
          .maybeSingle();

      if (assignmentError) throw assignmentError;

      if (!assignment) {
        throw new Error(
          'You are no longer assigned to this intern.'
        );
      }

      if (!this.isCurrentIdentity()) {
        throw new Error('Your session has changed.');
      }

      const now = new Date().toISOString();

      const updateData: Record<string, unknown> = {

        status: nextStatus,

        reviewed_at: now,

        reviewing_supervisor_id: supervisor.id,

        supervisor_name: supervisor.full_name,

        updated_at: now
      };

      // Feedback is required when returning a report

      if (mode === 'return') {

        updateData['feedback'] = feedback;

        updateData['comment_count'] =
          (report.comment_count || 0) + 1;
      }

      // Compare current status and updated_at to avoid
      // reviewing a report that has changed since loading.

      const { data: updatedReport, error: updateError } =
        await this.supabase
          .from('reports')
          .update(updateData)
          .eq('id', report.id)
          .eq('student_id', student.student_id)
          .eq('status', 'pending_review')
          .eq('updated_at', report.updated_at)
          .select(this.reportColumns)
          .maybeSingle();

      if (updateError) throw updateError;

      if (!updatedReport) {
        throw new Error(
          'The report may have changed or your access has been restricted. Reload the report before trying again.'
        );
      }

      if (!this.isCurrentIdentity()) return;

      this.report = updatedReport as unknown as Report;

      this.successMessage = mode === 'approve'
        ? 'Weekly report approved successfully.'
        : 'Weekly report returned for revision successfully.';

      this.saving = false;

      this.closeDialog();

    } catch (error) {

      console.error('Error reviewing weekly report:', error);

      if (!this.destroyed) {

        this.actionError = error instanceof Error
          ? error.message
          : 'Unable to save your decision. Please try again.';
      }

    } finally {

      this.saving = false;

      if (!this.destroyed) {
        this.cdr.markForCheck();
      }
    }
  }
}