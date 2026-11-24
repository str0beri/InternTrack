import { CommonModule } from '@angular/common';
import {
  Component,
  inject,
  OnInit,
  ChangeDetectorRef
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { AuthService } from '../../../services/auth.service';
import { SupabaseService } from '../../../services/supabase.service';
import { IonHeader, IonToolbar, IonTitle, IonContent } from "@ionic/angular";

interface Student {
  id: string;
  student_id: string;
  full_name: string;
  course: string;
  department: string | null;
  required_hours: number | null;
  ojt_start_date: string | null;
  ojt_end_date: string | null;
}

interface Attendance {
  id: string;
  student_id: string;
  attendance_date: string;
  time_in: string;
  time_out: string | null;
  time_in_photo: string | null;
  time_out_photo: string | null;
  time_in_location_lat: number | null;
  time_in_location_long: number | null;
  time_out_location_lat: number | null;
  time_out_location_long: number | null;
  total_hours_rendered: number | null;
  verification_status: string | null;
  sync_status: string;
  verified_by: string | null;
  verified_at: string | null;
  remarks: string | null;
}

@Component({
  selector: 'app-attendance-details',
  standalone: true,
  imports: [IonContent, IonTitle, IonToolbar, IonHeader, CommonModule, FormsModule],
  templateUrl: './attendance-details.page.html',
  styleUrls: ['./attendance-details.page.scss']
})
export class AttendanceDetailsPage implements OnInit {

  private readonly supabase =
    inject(SupabaseService).getClient();

  private readonly authService = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);

  recordId = '';
  supervisorId = '';

  student: Student | null = null;
  record: Attendance | null = null;

  loading = true;
  saving = false;

  loadError = '';
  actionError = '';
  successMessage = '';

  verifiedHours = 0;
  provisionalHours = 0;

  activeDialog: 'verify' | 'reject' | null = null;

  rejectionReason = '';
  rejectionDetails = '';

  rejectionReasons = [
    'Missing time-out record',
    'Photo is unclear or does not match the student',
    'GPS location is outside the assigned workplace',
    'Duplicate or overlapping attendance entry',
    'Duration does not match the approved schedule',
    'Other'
  ];

  // Enable only after rejection is supported by the
  // database and student mobile application.
  readonly rejectionEnabled = false;

  ngOnInit(): void {

    this.recordId =
      this.route.snapshot.paramMap.get('recordId') || '';

    void this.loadData();
  }

  // ==========================================
  // LOAD ATTENDANCE DETAILS
  // ==========================================

  async loadData(): Promise<void> {

    this.loading = true;
    this.loadError = '';
    this.student = null;
    this.record = null;

    try {

      const userId =
        this.authService.getCurrentUser()?.id;

      if (!userId || !this.recordId) {
        throw new Error('Invalid attendance request.');
      }

      // Retrieve the supervisor profile.

      const {
        data: supervisor,
        error: supervisorError
      } = await this.supabase
        .from('company_supervisors')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (supervisorError) {
        throw supervisorError;
      }

      if (!supervisor) {
        throw new Error('Supervisor profile not found.');
      }

      this.supervisorId = supervisor.id;

      // Retrieve the selected synchronized record.

      const {
        data: attendance,
        error: attendanceError
      } = await this.supabase
        .from('attendance')
        .select(`
          id,
          student_id,
          attendance_date,
          time_in,
          time_out,
          time_in_photo,
          time_out_photo,
          time_in_location_lat,
          time_in_location_long,
          time_out_location_lat,
          time_out_location_long,
          total_hours_rendered,
          verification_status,
          sync_status,
          verified_by,
          verified_at,
          remarks
        `)
        .eq('id', this.recordId)
        .eq('sync_status', 'synced')
        .single();

      if (attendanceError) {
        throw attendanceError;
      }

      if (!attendance) {
        throw new Error('Attendance record not found.');
      }

      // Retrieve student information.

      const {
        data: student,
        error: studentError
      } = await this.supabase
        .from('students')
        .select(`
          id,
          student_id,
          full_name,
          course,
          department,
          required_hours,
          ojt_start_date,
          ojt_end_date
        `)
        .eq('student_id', attendance.student_id)
        .single();

      if (studentError) {
        throw studentError;
      }

      if (!student) {
        throw new Error('Student not found.');
      }

      // Confirm active supervisor assignment.
      // The assignment table uses the student's UUID.

      const {
        data: assignment,
        error: assignmentError
      } = await this.supabase
        .from('intern_supervisor_assignments')
        .select('student_id')
        .eq('student_id', student.id)
        .eq('supervisor_id', this.supervisorId)
        .eq('assignment_status', 'active')
        .limit(1)
        .maybeSingle();

      if (assignmentError) {
        throw assignmentError;
      }

      if (!assignment) {
        throw new Error(
          'This intern is not assigned to your account.'
        );
      }

      if (
        this.authService.getCurrentUser()?.id !== userId
      ) {
        throw new Error('The authenticated user changed.');
      }

      this.student = student;
      this.record = attendance;

      await this.loadInternSummary();

      if (
        this.authService.getCurrentUser()?.id !== userId
      ) {
        throw new Error('The authenticated user changed.');
      }

    } catch (error) {

      console.error(
        'Error loading attendance details:',
        error
      );

      this.student = null;
      this.record = null;

      this.loadError =
        'We could not retrieve this attendance record. Please try again.';

    } finally {

      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  // ==========================================
  // INTERN SUMMARY
  // ==========================================

  async loadInternSummary(): Promise<void> {

    if (!this.student) {
      return;
    }

    let verified = 0;
    let provisional = 0;

    let offset = 0;
    const batchSize = 500;

    while (true) {

      const { data, error, count } =
        await this.supabase
          .from('attendance')
          .select(`
            id,
            time_in,
            time_out,
            total_hours_rendered,
            verification_status
          `, { count: 'exact' })
          .eq('student_id', this.student.student_id)
          .eq('sync_status', 'synced')
          .in('verification_status', [
            'verified',
            'provisional'
          ])
          .not('time_out', 'is', null)
          .order('id', { ascending: true })
          .range(offset, offset + batchSize - 1);

      if (error) {
        throw error;
      }

      const records = data || [];

      for (const item of records) {

        const hours = this.calculateCreditedHours(
          item.time_in,
          item.time_out,
          item.total_hours_rendered
        );

        if (item.verification_status === 'verified') {
          verified += hours;
        }

        if (item.verification_status === 'provisional') {
          provisional += hours;
        }
      }

      offset += records.length;

      if (
        records.length === 0 ||
        (count !== null && offset >= count) ||
        (count === null && records.length < batchSize)
      ) {
        break;
      }
    }

    this.verifiedHours = verified;
    this.provisionalHours = provisional;
  }

  // ==========================================
  // ATTENDANCE CALCULATIONS
  // ==========================================

  private calculateCreditedHours(
    timeIn: string | null,
    timeOut: string | null,
    storedHours: number | null
  ): number {

    if (!timeIn || !timeOut) {
      return 0;
    }

    const elapsed =
      (Date.parse(timeOut) - Date.parse(timeIn)) /
      3600000;

    if (!Number.isFinite(elapsed) || elapsed <= 0) {
      return 0;
    }

    if (
      storedHours !== null &&
      Number.isFinite(Number(storedHours)) &&
      Number(storedHours) >= 0
    ) {
      return Number(storedHours);
    }

    return elapsed;
  }

  get creditedHours(): number {

    if (!this.record) {
      return 0;
    }

    return this.calculateCreditedHours(
      this.record.time_in,
      this.record.time_out,
      this.record.total_hours_rendered
    );
  }

  get recordedDuration(): string {

    if (!this.record?.time_in || !this.record.time_out) {
      return '—';
    }

    const elapsed =
      Date.parse(this.record.time_out) -
      Date.parse(this.record.time_in);

    if (!Number.isFinite(elapsed) || elapsed < 0) {
      return '—';
    }

    const minutes = Math.floor(elapsed / 60000);

    return `${Math.floor(minutes / 60)}h ${
      String(minutes % 60).padStart(2, '0')
    }m`;
  }

  get requiredHours(): number {

    const hours = Number(this.student?.required_hours);

    return Number.isFinite(hours) && hours > 0
      ? hours
      : 486;
  }

  get initials(): string {

    const names = (
      this.student?.full_name || ''
    ).trim().split(/\s+/).filter(Boolean);

    return names
      .slice(0, 2)
      .map(name => name[0])
      .join('')
      .toUpperCase();
  }

  get firstName(): string {

    return this.student?.full_name.split(' ')[0]
      || 'the student';
  }

  get status(): string {

    if (!this.record) {
      return 'Unknown';
    }

    if (this.record.verification_status === 'rejected') {
      return 'Rejected';
    }

    if (
      !this.record.time_out ||
      !Number.isFinite(Date.parse(this.record.time_in)) ||
      !Number.isFinite(Date.parse(this.record.time_out)) ||
      Date.parse(this.record.time_out) <
        Date.parse(this.record.time_in)
    ) {
      return 'Incomplete';
    }

    if (this.record.verification_status === 'verified') {
      return 'Verified';
    }

    if (this.record.verification_status === 'provisional') {
      return 'Pending';
    }

    return 'Unknown';
  }

  get statusClass(): string {
    return this.status.toLowerCase();
  }

  get internshipStatus(): string {

    return this.verifiedHours >= this.requiredHours
      ? 'Hours completed'
      : 'Ongoing';
  }

  get hasCompleteEvidence(): boolean {

    if (!this.record) {
      return false;
    }

    return !!(
      this.record.time_in_photo &&
      this.record.time_out_photo &&
      this.validCoordinates(
        this.record.time_in_location_lat,
        this.record.time_in_location_long
      ) &&
      this.validCoordinates(
        this.record.time_out_location_lat,
        this.record.time_out_location_long
      )
    );
  }

  get canVerify(): boolean {

    return (
      this.status === 'Pending' &&
      this.hasCompleteEvidence &&
      this.creditedHours > 0 &&
      !this.saving
    );
  }

  get canReject(): boolean {

    return (
      (this.status === 'Pending' ||
       this.status === 'Incomplete') &&
      !this.saving
    );
  }

  // ==========================================
  // DATE AND LOCATION FORMATTING
  // ==========================================

  formatDate(
    value: string | null | undefined,
    long = false
  ): string {

    if (!value) {
      return 'Not provided';
    }

    const date = new Date(`${value}T00:00:00Z`);

    if (!Number.isFinite(date.getTime())) {
      return 'Not provided';
    }

    return date.toLocaleDateString('en-US', {
      weekday: long ? 'long' : undefined,
      month: long ? 'long' : 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC'
    });
  }

  formatTime(value: string | null | undefined): string {

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

  private validCoordinates(
    latitude: number | null,
    longitude: number | null
  ): boolean {

    return (
      latitude !== null &&
      longitude !== null &&
      Number.isFinite(Number(latitude)) &&
      Number.isFinite(Number(longitude)) &&
      Math.abs(Number(latitude)) <= 90 &&
      Math.abs(Number(longitude)) <= 180
    );
  }

  formatCoordinates(
    latitude: number | null,
    longitude: number | null
  ): string {

    if (!this.validCoordinates(latitude, longitude)) {
      return 'GPS location unavailable';
    }

    const lat = Number(latitude);
    const lng = Number(longitude);

    return `${Math.abs(lat).toFixed(4)}° ${
      lat >= 0 ? 'N' : 'S'
    }, ${Math.abs(lng).toFixed(4)}° ${
      lng >= 0 ? 'E' : 'W'
    }`;
  }

  openLocation(
    latitude: number | null,
    longitude: number | null
  ): void {

    if (!this.validCoordinates(latitude, longitude)) {
      return;
    }

    const url =
      `https://www.google.com/maps?q=${latitude},${longitude}`;

    window.open(url, '_blank', 'noopener,noreferrer');
  }

  viewPhoto(url: string | null): void {

    if (url && /^https?:\/\//i.test(url)) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  // ==========================================
  // CONFIRMATION DIALOGS
  // ==========================================

  openVerifyDialog(): void {

    if (!this.canVerify) {
      return;
    }

    this.actionError = '';
    this.activeDialog = 'verify';
  }

  openRejectDialog(): void {

    if (!this.canReject) {
      return;
    }

    this.actionError = '';
    this.rejectionReason = '';
    this.rejectionDetails = '';

    this.activeDialog = 'reject';
  }

  closeDialog(): void {

    if (this.saving) {
      return;
    }

    this.activeDialog = null;
    this.actionError = '';
  }

  // ==========================================
  // VERIFY ATTENDANCE
  // ==========================================

  async verifyAttendance(): Promise<void> {

    if (!this.canVerify || !this.record || !this.student) {
      return;
    }

    this.saving = true;
    this.actionError = '';
    this.successMessage = '';

    const record = this.record;
    const student = this.student;
    const creditedHours = this.creditedHours;

    try {

      const userId =
        this.authService.getCurrentUser()?.id;

      if (!userId) {
        throw new Error('Session unavailable.');
      }

      const {
        data: supervisor,
        error: supervisorError
      } = await this.supabase
        .from('company_supervisors')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (supervisorError || !supervisor) {
        throw supervisorError ||
          new Error('Supervisor unavailable.');
      }

      // Recheck assignment before updating.

      const {
        data: assignment,
        error: assignmentError
      } = await this.supabase
        .from('intern_supervisor_assignments')
        .select('student_id')
        .eq('student_id', student.id)
        .eq('supervisor_id', supervisor.id)
        .eq('assignment_status', 'active')
        .limit(1)
        .maybeSingle();

      if (assignmentError || !assignment) {
        throw assignmentError ||
          new Error('Assignment no longer active.');
      }

      if (
        this.authService.getCurrentUser()?.id !== userId
      ) {
        throw new Error('Session changed.');
      }

      // Update only the original provisional record.
      // The timestamp filters prevent approving a
      // record whose attendance times have changed.

      const {
        data: updated,
        error: updateError
      } = await this.supabase
        .from('attendance')
        .update({
          verification_status: 'verified',
          verified_by: supervisor.id,
          verified_at: new Date().toISOString(),
          total_hours_rendered: creditedHours
        })
        .eq('id', record.id)
        .eq('student_id', student.student_id)
        .eq('sync_status', 'synced')
        .eq('verification_status', 'provisional')
        .eq('time_in', record.time_in)
        .eq('time_out', record.time_out!)
        .select('id')
        .maybeSingle();

      if (updateError) {
        throw updateError;
      }

      if (!updated) {
        throw new Error(
          'The record was changed or access was denied.'
        );
      }

      this.activeDialog = null;

      await this.loadData();

      this.successMessage =
        'Attendance record successfully verified.';

    } catch (error) {

      console.error('Verification failed:', error);

      this.actionError =
        'Unable to verify attendance. Refresh the record and try again.';

    } finally {

      this.saving = false;
      this.cdr.markForCheck();
    }
  }

  // ==========================================
  // REJECTION
  // ==========================================

  rejectAttendance(): void {

    // Rejection is intentionally disabled until
    // database and student-side support are ready.

    this.actionError =
      'Attendance rejection is not yet enabled.';
  }

  // ==========================================
  // NAVIGATION
  // ==========================================

  goBack(): void {

    void this.router.navigate([
      '/supervisor',
      'attendance'
    ]);
  }

  openAttendanceHistory(): void {

    if (!this.student) {
      return;
    }

    void this.router.navigate([
      '/supervisor',
      'interns',
      this.student.student_id
    ], {
      queryParams: {
        tab: 'attendance'
      }
    });
  }
}