import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject, type OnInit } from '@angular/core';

import { AuthService } from '../../../services/auth.service';
import { SupabaseService } from '../../../services/supabase.service';

interface Intern {
  id: string;
  studentId: string;
  name: string;
  initials: string;
  department: string;
}

interface Report {
  weekLabel: string;
  submittedDate: string;
  hoursLogged: string;
  daysPresent: string;
  dtrStatus: string;
  activities: string;
  reflection: string;
  status: string;
  rawData: any;
}

@Component({
  selector: 'app-reports-review',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './reports-review.page.html',
  styleUrls: ['./reports-review.page.scss'],
})
export class ReportsReviewPage implements OnInit {
  private supabaseService = inject(SupabaseService);
  private supabase = this.supabaseService.getClient();
  private authService = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);

  selectedInternId = '';
  selectedWeek = '';
  interns: Intern[] = [];
  reports: Report[] = [];
  report: Report | null = null;
  loading = true;

  reviewComment = '';

  ngOnInit(): void {
    this.loadData();
  }

  async loadData(): Promise<void> {
    try {
      this.loading = true;
      const userId = this.authService.getCurrentUser()?.id;
      
      if (!userId) {
        console.error('No user ID found');
        return;
      }

      // Get supervisor profile
      const { data: supervisor } = await this.supabase
        .from('company_supervisors')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (!supervisor) {
        console.error('No supervisor profile found');
        return;
      }

      // Get assigned interns
      const { data: assignments, error: e1 } = await this.supabase
        .from('intern_supervisor_assignments')
        .select('student_id, students!student_id(id, student_id, full_name, course)')
        .eq('supervisor_id', supervisor.id)
        .eq('assignment_status', 'active');
      if (e1) throw e1;

      this.interns = (assignments?.map(a => {
        const student = Array.isArray(a.students) ? a.students[0] : a.students;
        return {
          id: student?.student_id || '',
          studentId: student?.id || '',
          name: student?.full_name || 'Unknown',
          initials: this.getInitials(student?.full_name),
          department: student?.course || 'N/A',
        };
      }) || []).filter(i => i.id);

      // Select first intern by default
      if (this.interns.length > 0 && !this.selectedInternId) {
        this.selectedInternId = this.interns[0].id;
        await this.loadReportsForIntern(this.selectedInternId);
      }

    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  private getInitials(fullName?: string): string {
    if (!fullName) return '??';
    const parts = fullName.trim().split(' ');
    if (parts.length === 0) return '??';
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }

  async loadReportsForIntern(internId: string): Promise<void> {
    try {
      const intern = this.interns.find(i => i.id === internId);
      if (!intern) return;

      // Get reports for this student using text student_id
      // Show all non-draft reports (pending_review, approved, returned)
      // Drafts should never appear to supervisor
      const { data: reports, error } = await this.supabase
        .from('reports')
        .select('*')
        .eq('student_id', internId)  // Use text ID
        .neq('status', 'draft')  // Exclude drafts
        .order('week', { ascending: false });

      if (error) throw error;

      // Get attendance records for weekly summary calculation
      const { data: attendance } = await this.supabase
        .from('attendance')
        .select('attendance_date, time_in, time_out, verification_status')
        .eq('student_id', internId)
        .eq('verification_status', 'verified');

      this.reports = (reports || []).map(report => {
        // Calculate weekly hours and days present for this report's week
        const weekNum = report.week;
        const weekStart = this.getWeekStart(weekNum);
        const weekEnd = this.getWeekEnd(weekNum);

        const weekAttendance = (attendance || []).filter(att => {
          const attDate = new Date(att.attendance_date);
          return attDate >= weekStart && attDate <= weekEnd;
        });

        const hoursLogged = weekAttendance.reduce((sum, att) => {
          if (att.time_in && att.time_out) {
            const start = new Date(att.time_in);
            const end = new Date(att.time_out);
            return sum + ((end.getTime() - start.getTime()) / (1000 * 60 * 60));
          }
          return sum;
        }, 0);

        const daysPresent = new Set(weekAttendance.map(att => att.attendance_date)).size;

        return {
          weekLabel: `Week ${report.week}`,
          submittedDate: report.submitted_at ? `Submitted ${new Date(report.submitted_at).toLocaleDateString()}` : 'Not submitted',
          hoursLogged: hoursLogged.toFixed(1) + 'h',
          daysPresent: daysPresent.toString(),
          dtrStatus: weekAttendance.length > 0 ? 'Verified' : 'No records',
          activities: report.accomplishments || 'No activities recorded',
          reflection: report.feedback || 'No reflection recorded',
          status: this.getReportStatus(report.status),
          rawData: report,
        };
      });

      // Select latest report
      if (this.reports.length > 0) {
        this.report = this.reports[0];
        this.selectedWeek = this.reports[0].weekLabel;
      } else {
        this.report = null;
        this.selectedWeek = '';
      }

    } catch (error) {
      console.error('Error loading reports:', error);
    }
  }

  private getWeekStart(weekNum: number): Date {
    // Assuming OJT started on a Monday, calculate week start
    const startDate = new Date('2024-01-01'); // Placeholder - should get from student's OJT start date
    const weekStart = new Date(startDate);
    weekStart.setDate(weekStart.getDate() + ((weekNum - 1) * 7));
    return weekStart;
  }

  private getWeekEnd(weekNum: number): Date {
    const weekStart = this.getWeekStart(weekNum);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    return weekEnd;
  }

  private getReportStatus(status: string): string {
    switch (status) {
      case 'pending_review': return 'Pending for review';
      case 'approved': return 'Approved';
      case 'returned': return 'Returned';
      case 'draft': return 'Draft';
      default: return 'Unknown';
    }
  }

  get selectedIntern(): Intern | undefined {
    return this.interns.find(
      intern => intern.id === this.selectedInternId
    );
  }

  get weeks(): string[] {
    return this.reports.map(r => r.weekLabel);
  }

  async selectIntern(internId: string): Promise<void> {
    this.selectedInternId = internId;
    this.reviewComment = '';
    await this.loadReportsForIntern(internId);
  }

  selectWeek(week: string): void {
    this.selectedWeek = week;
    const report = this.reports.find(r => r.weekLabel === week);
    this.report = report || null;
  }

  onCommentChange(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    this.reviewComment = textarea.value;
  }

  async approveReport(): Promise<void> {
    if (!this.report) return;

    // Security check: ensure report belongs to selected intern
    if (this.report.rawData.student_id !== this.selectedInternId) {
      alert('You can only review reports for your assigned interns.');
      console.error('❌ Security violation: Attempting to review report for non-assigned intern');
      return;
    }

    // Only allow approving pending_review reports
    if (this.report.rawData.status !== 'pending_review') {
      alert(`Cannot approve report with status: ${this.report.rawData.status}. Only pending reports can be approved.`);
      return;
    }

    try {
      const userId = this.authService.getCurrentUser()?.id;
      const { data: supervisor } = await this.supabase
        .from('company_supervisors')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (!supervisor) {
        alert('Supervisor profile not found');
        return;
      }

      const { data, error } = await this.supabase
        .from('reports')
        .update({
          status: 'approved',
          feedback: this.reviewComment || this.report.rawData.feedback,
          reviewed_at: new Date().toISOString(),
          reviewed_by: supervisor.id
        })
        .eq('id', this.report.rawData.id)
        .select();

      if (!error && data) {
        this.report.status = 'Approved';
        this.reviewComment = '';
        this.cdr.detectChanges();
        alert('Report approved successfully!');
      } else {
        console.error('Error approving report:', error);
        alert('Failed to approve report. Please try again.');
      }
    } catch (error) {
      console.error('Error approving report:', error);
      alert('Failed to approve report. Please try again.');
    }
  }

  async returnReport(): Promise<void> {
    if (!this.report) return;

    // Security check: ensure report belongs to selected intern
    if (this.report.rawData.student_id !== this.selectedInternId) {
      alert('You can only review reports for your assigned interns.');
      console.error('❌ Security violation: Attempting to review report for non-assigned intern');
      return;
    }

    // Only allow returning pending_review reports
    if (this.report.rawData.status !== 'pending_review') {
      alert(`Cannot return report with status: ${this.report.rawData.status}. Only pending reports can be returned.`);
      return;
    }

    // Require comment for returning
    if (!this.reviewComment.trim()) {
      alert('Please provide a comment when returning a report for revision.');
      return;
    }

    try {
      const userId = this.authService.getCurrentUser()?.id;
      const { data: supervisor } = await this.supabase
        .from('company_supervisors')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (!supervisor) {
        alert('Supervisor profile not found');
        return;
      }

      const { data, error } = await this.supabase
        .from('reports')
        .update({
          status: 'returned',
          feedback: this.reviewComment,
          reviewed_at: new Date().toISOString(),
          reviewed_by: supervisor.id
        })
        .eq('id', this.report.rawData.id)
        .select();

      if (!error && data) {
        this.report.status = 'Returned';
        this.reviewComment = '';
        this.cdr.detectChanges();
        alert('Report returned for revision successfully!');
      } else {
        console.error('Error returning report:', error);
        alert('Failed to return report. Please try again.');
      }
    } catch (error) {
      console.error('Error returning report:', error);
      alert('Failed to return report. Please try again.');
    }
  }

}