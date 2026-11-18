import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject, type OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { cameraOutline } from 'ionicons/icons';

import { AuthService } from '../../../services/auth.service';
import { SupabaseService } from '../../../services/supabase.service';

interface SupervisorMetrics {
  totalInterns: number;
  reportsToReview: number;
  attendanceRate: number;
  internsOnSite: number;
  todaysAttendance: any[];
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [IonIcon, CommonModule, RouterLink],
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
})
export class DashboardPage implements OnInit {
  private supabaseService = inject(SupabaseService);
  private supabase = this.supabaseService.getClient();
  private authService = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);

  constructor() {
    addIcons({
      cameraOutline,
    });
  }

  metrics: SupervisorMetrics = {
    totalInterns: 0,
    reportsToReview: 0,
    attendanceRate: 0,
    internsOnSite: 0,
    todaysAttendance: []
  };

  attendanceDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  loading = true;

  ngOnInit(): void {
    this.loadDashboardData();
  }

  private localDate(d = new Date()): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  async loadDashboardData() {
    console.log('🔍 Dashboard: Starting load...');
    this.loading = true;
    try {
      // Don't rely on AuthService.currentUser: it can still be null on page refresh
      const { data: { session } } = await this.supabase.auth.getSession();
      console.log('🔍 Dashboard: Session:', session);
      const userId = session?.user?.id;
      console.log('🔍 Dashboard: User ID:', userId);
      
      if (!userId) throw new Error('Not signed in');

      const { data: supervisor, error: e1 } = await this.supabase
        .from('company_supervisors').select('id').eq('user_id', userId).single();
      console.log('🔍 Dashboard: Supervisor:', supervisor);
      console.log('🔍 Dashboard: Supervisor error:', e1);
      if (e1) throw e1;

      const { data: assignments, error: e2 } = await this.supabase
        .from('intern_supervisor_assignments')
        .select('student_id, students!student_id(id, student_id, full_name, course)')
        .eq('supervisor_id', supervisor.id)
        .eq('assignment_status', 'active');
      console.log('🔍 Dashboard: Assignments:', assignments);
      console.log('🔍 Dashboard: Assignments error:', e2);
      if (e2) throw e2;

      const interns: any[] = (assignments ?? [])
        .map(a => Array.isArray(a.students) ? a.students[0] : a.students)
        .filter(Boolean);
      console.log('🔍 Dashboard: Interns:', interns);
      this.metrics.totalInterns = interns.length;

      const schoolIds = interns.map(s => s.student_id);          // text IDs, not UUIDs
      const byId = new Map(interns.map(s => [s.student_id, s]));
      console.log('🔍 Dashboard: School IDs:', schoolIds);
      
      if (!schoolIds.length) { 
        console.log('🔍 Dashboard: No school IDs, setting empty attendance');
        this.metrics.todaysAttendance = []; 
        return; 
      }

      const today = this.localDate();
      console.log('🔍 Dashboard: Today:', today);
      const { data: attendance, error: e3 } = await this.supabase
        .from('attendance').select('*')
        .in('student_id', schoolIds).eq('attendance_date', today)
        .eq('sync_status', 'synced')  // Only show synced records
        .order('time_in', { ascending: false });
      console.log('🔍 Dashboard: Attendance:', attendance);
      console.log('🔍 Dashboard: Attendance error:', e3);
      if (e3) throw e3;
      this.metrics.todaysAttendance = (attendance ?? [])
        .map(a => ({ ...a, students: byId.get(a.student_id) }));

      // Count interns currently on-site (clocked in but not clocked out)
      this.metrics.internsOnSite = (attendance ?? []).filter(
        a => a.time_in && !a.time_out
      ).length;
      console.log('🔍 Dashboard: Interns on-site:', this.metrics.internsOnSite);

      const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
      const { data: weekly, error: e4 } = await this.supabase
        .from('attendance').select('student_id, attendance_date')
        .in('student_id', schoolIds)
        .eq('sync_status', 'synced')  // Only show synced records
        .gte('attendance_date', this.localDate(weekStart))
        .lte('attendance_date', this.localDate(weekEnd));
      console.log('🔍 Dashboard: Weekly attendance:', weekly);
      console.log('🔍 Dashboard: Weekly error:', e4);
      if (e4) throw e4;
      const possible = interns.length * 5;
      this.metrics.attendanceRate = possible
        ? Math.min(100, Math.round(((weekly?.length ?? 0) / possible) * 100)) : 0;

      const { data: reports, error: e5 } = await this.supabase
        .from('reports').select('id')
        .in('student_id', schoolIds).eq('status', 'pending_review');
      console.log('🔍 Dashboard: Reports:', reports);
      console.log('🔍 Dashboard: Reports error:', e5);
      if (e5) throw e5;
      this.metrics.reportsToReview = reports?.length ?? 0;
      
      console.log('✅ Dashboard: Load complete');
    } catch (err) {
      console.error('❌ Dashboard: Error loading dashboard data:', err);
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  get summaryCards() {
    return [
      {
        label: 'My Interns',
        value: this.metrics.totalInterns.toString(),
        description: 'All Active',
      },
      {
        label: 'Reports to review',
        value: this.metrics.reportsToReview.toString(),
        description: 'Pending submission review',
        hasIndicator: this.metrics.reportsToReview > 0,
      },
      {
        label: 'Interns on-site',
        value: this.metrics.internsOnSite.toString(),
        description: 'Currently clocked in',
      },
      {
        label: 'Attendance this week',
        value: `${this.metrics.attendanceRate}%`,
        description: 'Across assigned interns',
      },
    ];
  }

  get attendanceList() {
    return this.metrics.todaysAttendance.map(att => {
      const student = Array.isArray(att.students) ? att.students[0] : att.students;
      return {
        initials: this.getInitials(student?.full_name),
        name: student?.full_name || 'Unknown',
        details: `${student?.student_id || ''} · ${student?.course || ''}`,
        status: att.time_out ? 'CLOCKED OUT' : 'CLOCKED IN',
        time: att.time_in ? new Date(att.time_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '',
        hasPhoto: !!(att.time_in_photo || att.time_out_photo),
      };
    });
  }

  private getInitials(fullName?: string): string {
    if (!fullName) return '??';
    const parts = fullName.trim().split(' ');
    if (parts.length === 0) return '??';
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }

  quickActions = [
    {
      title: 'Review Attendance',
      subtitle: 'Pending verification',
      route: '/supervisor/attendance',
    },
    {
      title: 'Review Reports',
      subtitle: 'Weekly submissions',
      route: '/supervisor/reports',
    },
    {
      title: 'Intern Roster',
      subtitle: 'Hours & completion status',
      route: '/supervisor/interns',
    },
  ];
}
