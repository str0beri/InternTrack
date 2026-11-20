import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonDatetime, IonIcon, IonModal } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { cameraOutline, calendarOutline } from 'ionicons/icons';

import { AuthService } from '../../../services/auth.service';
import { SupabaseService } from '../../../services/supabase.service';

interface Intern {
  id: string;
  studentId: string;
  name: string;
  department: string;
  totalRendered: number;
  totalVerified: number;
}

interface AttendanceRecord {
  id: string;
  internId: string;
  date: string;
  day: string;
  timeIn: string;
  timeOut: string;
  hours: string;
  photo: boolean;
  timeInPhoto: string;
  timeOutPhoto: string;
  location: string;
  remarks: string;
  status: 'PROVISIONAL' | 'VERIFIED';
  action: string;
  rawData: any;
}

@Component({
  selector: 'app-attendance-review',
  standalone: true,
  imports: [CommonModule, FormsModule, IonIcon, IonDatetime, IonModal],
  templateUrl: './attendance-review.page.html',
  styleUrls: ['./attendance-review.page.scss'],
})
export class AttendanceReviewPage implements OnInit {
  private supabaseService = inject(SupabaseService);
  private supabase = this.supabaseService.getClient();
  private authService = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);

  constructor() {
    addIcons({
      cameraOutline,
      calendarOutline
    });
  }

  selectedInternId = '';
  interns: Intern[] = [];
  attendanceRecords: AttendanceRecord[] = [];
  loading = true;
  selectedDate = '';
  verificationRemark = '';
  isCalendarOpen = false;

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
        .select('student_id, students!student_id(id, student_id, full_name, course, company_name)')
        .eq('supervisor_id', supervisor.id)
        .eq('assignment_status', 'active');
      if (e1) throw e1;

      this.interns = (assignments?.map(a => {
        const student = Array.isArray(a.students) ? a.students[0] : a.students;
        return {
          id: student?.student_id || '',
          studentId: student?.id || '',
          name: student?.full_name || 'Unknown',
          department: student?.course || 'N/A',
          totalRendered: 0,
          totalVerified: 0,
        };
      }) || []).filter(i => i.id);

      // Select first intern by default
      if (this.interns.length > 0 && !this.selectedInternId) {
        this.selectedInternId = this.interns[0].id;
        await this.loadAttendanceForIntern(this.selectedInternId);
      }

    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      this.loading = false;
    }
  }

  async loadAttendanceForIntern(internId: string): Promise<void> {
    console.log('🔍 Attendance Review: Loading for intern:', internId);
    try {
      const intern = this.interns.find(i => i.id === internId);
      console.log('🔍 Attendance Review: Intern:', intern);
      if (!intern) return;

      // Get attendance records for this student using text student_id
      // Only show synced records (exclude pending upload records)
      const { data: attendance, error } = await this.supabase
        .from('attendance')
        .select('*')
        .eq('student_id', internId)  // Use the text ID parameter directly
        .eq('sync_status', 'synced')  // Only show synced records
        .order('attendance_date', { ascending: false })
        .limit(50);
      console.log('🔍 Attendance Review: Attendance:', attendance);
      console.log('🔍 Attendance Review: Error:', error);

      if (error) throw error;

      this.attendanceRecords = (attendance || []).map(record => ({
        id: record.id,
        internId: intern.id,
        date: record.attendance_date ? new Date(record.attendance_date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' }) : 'N/A',
        day: record.attendance_date ? new Date(record.attendance_date).toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase() : 'N/A',
        timeIn: record.time_in ? new Date(record.time_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '--',
        timeOut: record.time_out ? new Date(record.time_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'Active',
        hours: this.calculateHours(record.time_in, record.time_out),
        photo: !!(record.time_in_photo || record.time_out_photo),
        timeInPhoto: record.time_in_photo || '',
        timeOutPhoto: record.time_out_photo || '',
        location: record.location || 'N/A',
        remarks: record.remarks || '',
        status: record.verification_status === 'verified' ? 'VERIFIED' : 'PROVISIONAL',
        action: record.verification_status === 'verified' ? 'Signed' : 'VERIFY',
        rawData: record,
      }));

      // Update totals for this intern
      const verified = this.attendanceRecords.filter(r => r.status === 'VERIFIED').length;
      intern.totalRendered = this.attendanceRecords.length;
      intern.totalVerified = verified;

      console.log('🔍 Attendance Review: Attendance records set:', this.attendanceRecords.length);
      console.log('🔍 Attendance Review: Selected intern:', this.selectedIntern);

    } catch (error) {
      console.error('Error loading attendance:', error);
    } finally {
      this.loading = false;
      console.log('🔍 Attendance Review: Loading flag cleared');
      this.cdr.detectChanges();
    }
  }

  private calculateHours(timeIn: string, timeOut: string): string {
    if (!timeIn || !timeOut) return '--';
    
    const start = new Date(timeIn);
    const end = new Date(timeOut);
    const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    
    return hours > 0 ? `${hours.toFixed(1)}h` : '--';
  }

  // selected intern details
  get selectedIntern(): Intern | undefined {
    return this.interns.find(
      (intern) => intern.id === this.selectedInternId
    );
  }

  // filtered attendance records
  get filteredAttendance(): AttendanceRecord[] {
    let records = this.attendanceRecords.filter(
      (record) => record.internId === this.selectedInternId
    );

    // Apply date filter if selected
    if (this.selectedDate) {
      const filterDate = new Date(this.selectedDate).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
      records = records.filter(record => record.date === filterDate);
    }

    return records;
  }

  // select intern
  async selectIntern(internId: string): Promise<void> {
    this.selectedInternId = internId;
    this.selectedDate = '';
    this.verificationRemark = '';
    await this.loadAttendanceForIntern(internId);
  }

  // date filter methods
  onDateChange(_event: any): void {
    this.cdr.detectChanges();
  }

  onDateFilterChange(): void {
    this.cdr.detectChanges();
  }

  clearDateFilter(): void {
    this.selectedDate = '';
    this.cdr.detectChanges();
  }

  // verify attendance
  async verifyAttendance(recordId: string): Promise<void> {
    try {
      const record = this.attendanceRecords.find(
        (item) => item.id === recordId
      );

      // Security check: ensure record belongs to selected intern
      if (record && record.internId !== this.selectedInternId) {
        alert('You can only verify attendance for your assigned interns.');
        console.error('❌ Security violation: Attempting to verify record for non-assigned intern');
        return;
      }

      if (record && record.status === 'PROVISIONAL') {
        console.log('🔍 Verifying attendance record:', recordId);

        // Get supervisor UUID (not Auth UID) for the foreign key constraint
        const userId = this.authService.getCurrentUser()?.id;
        const { data: supervisor } = await this.supabase
          .from('company_supervisors')
          .select('id')
          .eq('user_id', userId)
          .single();

        if (!supervisor) {
          console.error('❌ Supervisor profile not found');
          return;
        }

        console.log('🔍 Supervisor UUID:', supervisor.id);

        // Update in database using supervisor UUID and remarks
        const { data, error } = await this.supabase
          .from('attendance')
          .update({
            verification_status: 'verified',
            verified_at: new Date().toISOString(),
            verified_by: supervisor.id,  // Use supervisor UUID, not Auth UID
            remarks: this.verificationRemark || null
          })
          .eq('id', recordId)
          .select();

        console.log('🔍 Verify result:', { data, error });

        if (!error) {
          record.status = 'VERIFIED';
          record.action = 'Signed';
          record.remarks = this.verificationRemark;
          this.verificationRemark = '';
          this.cdr.detectChanges();
        } else {
          console.error('❌ Verify failed:', error);
        }
      }
    } catch (error) {
      console.error('Error verifying attendance:', error);
    }
  }

  // view photo
  viewPhoto(photoUrl: string): void {
    if (photoUrl) {
      window.open(photoUrl, '_blank');
    }
  }

}