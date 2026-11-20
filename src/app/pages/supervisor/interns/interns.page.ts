import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject, type OnInit } from '@angular/core';

import { AuthService } from '../../../services/auth.service';
import { SupabaseService } from '../../../services/supabase.service';

interface Intern {
  id: string;
  name: string;
  status: string;
  statusClass: string;
  completedHours: number;
  requiredHours: number;
  progress: number;
  division: string;
  email: string;
  startDate: string;
  endDate: string;
}

@Component({
  selector: 'app-interns',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './interns.page.html',
  styleUrls: ['./interns.page.scss'],
})
export class InternsPage implements OnInit {
  private supabaseService = inject(SupabaseService);
  private supabase = this.supabaseService.getClient();
  private authService = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);

  interns: Intern[] = [];
  loading = true;

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
        .select('student_id, students!student_id(id, student_id, full_name, course, email, ojt_start_date, ojt_end_date, required_hours)')
        .eq('supervisor_id', supervisor.id)
        .eq('assignment_status', 'active');
      if (e1) throw e1;

      // Get attendance data for each student to calculate completed hours using text student_id
      const schoolIds = assignments?.map(a => {
        const student = Array.isArray(a.students) ? a.students[0] : a.students;
        return student?.student_id;
      }).filter(Boolean) || [];

      // Get verified attendance only for approved hours (synced records only)
      const { data: attendance, error: e2 } = await this.supabase
        .from('attendance')
        .select('student_id, time_in, time_out, verification_status')
        .in('student_id', schoolIds)
        .eq('verification_status', 'verified')
        .eq('sync_status', 'synced')  // Only show synced records
        .not('time_in', 'is', null)
        .not('time_out', 'is', null);
      if (e2) throw e2;

      // Calculate verified hours per student using text student_id
      const hoursByStudent = new Map<string, number>();
      attendance?.forEach(record => {
        if (record.time_in && record.time_out) {
          const start = new Date(record.time_in);
          const end = new Date(record.time_out);
          const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
          const current = hoursByStudent.get(record.student_id) || 0;
          hoursByStudent.set(record.student_id, current + hours);
        }
      });

      this.interns = (assignments?.map(a => {
        const student = Array.isArray(a.students) ? a.students[0] : a.students;
        const completedHours = Math.round(hoursByStudent.get(student?.student_id || '') || 0);
        const requiredHours = student?.required_hours || 486;
        const progress = requiredHours > 0 ? Math.round((completedHours / requiredHours) * 1000) / 10 : 0;

        // Calculate status based on OJT end date and progress
        const startDate = student?.ojt_start_date ? new Date(student.ojt_start_date) : null;
        const endDate = student?.ojt_end_date ? new Date(student.ojt_end_date) : null;
        const today = new Date();

        let status = 'AT RISK';
        let statusClass = 'at-risk';

        if (startDate && endDate) {
          const totalDays = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
          const elapsedDays = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
          const expectedProgress = totalDays > 0 ? (elapsedDays / totalDays) * 100 : 0;

          // Compare actual progress with expected progress
          const progressDiff = progress - expectedProgress;

          if (progressDiff >= 10) {
            status = 'AHEAD';
            statusClass = 'ahead';
          } else if (progressDiff >= -10) {
            status = 'ON TRACK';
            statusClass = 'on-track';
          } else {
            status = 'AT RISK';
            statusClass = 'at-risk';
          }
        } else if (progress >= 80) {
          status = 'AHEAD';
          statusClass = 'ahead';
        } else if (progress >= 50) {
          status = 'ON TRACK';
          statusClass = 'on-track';
        }

        return {
          id: student?.student_id || '',
          name: student?.full_name || 'Unknown',
          status,
          statusClass,
          completedHours,
          requiredHours,
          progress,
          division: student?.course || 'N/A',
          email: student?.email || '',
          startDate: student?.ojt_start_date ? new Date(student.ojt_start_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'N/A',
          endDate: student?.ojt_end_date ? new Date(student.ojt_end_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'N/A',
        };
      }) || []).filter(i => i.id);

    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

}
