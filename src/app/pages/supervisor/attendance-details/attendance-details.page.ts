import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import {
  createDtrTemplate,
  type DtrTemplateRecord
} from '../../../utils/dtr-template';
import { CommonModule } from '@angular/common';
import {
  Component,
  inject,
  OnInit,
  OnDestroy,
  ChangeDetectorRef
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { SupabaseService } from '../../../services/supabase.service';
import { IonHeader, IonToolbar, IonTitle, IonContent } from "@ionic/angular";
pdfMake.addVirtualFileSystem(pdfFonts as unknown as Record<string, string>);
type DtrAttendance = Pick<Attendance, 'id' | 'student_id' | 'attendance_date' | 'time_in' | 'time_out' | 'total_hours_rendered' | 'verification_status' | 'sync_status'>;
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
export class AttendanceDetailsPage implements OnInit, OnDestroy {
  downloadingDTR = false;
  private destroyed = false;
  ngOnDestroy(): void { this.destroyed = true; }
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
  private originalRecord: Attendance | null = null;
  private photoLoadVersion = 0;
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
  // Rejection is enabled for synchronized provisional records.
  readonly rejectionEnabled = true;
  ngOnInit(): void {
    this.recordId =
      this.route.snapshot.paramMap.get('recordId') || '';
    void this.loadData();
  }
  // ==========================================
  // LOAD ATTENDANCE DETAILS
  // ==========================================
  async loadData(): Promise<void> {
    const photoVersion = ++this.photoLoadVersion;
    this.loading = true;
    this.loadError = '';
    this.student = null;
    this.record = null;
    this.originalRecord = null;
    this.supervisorId = '';
    this.verifiedHours = 0;
    this.provisionalHours = 0;
    try {
      const userId =
        this.authService.getCurrentUser()?.id;
      if (
        !userId ||
        !this.recordId ||
        this.authService.getUserRole() !== 'company_supervisor' ||
        !this.authService.isOnline()
      ) {
        throw new Error(
          'An active online supervisor session is required.'
        );
      }
      // Retrieve the supervisor profile.
      const {
        data: supervisor,
        error: supervisorError
      } = await this.supabase
        .from('company_supervisors')
        .select('id')
        .eq('user_id', userId)
        .eq('account_status', 'active')
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
      const [timeInPhoto, timeOutPhoto] = await Promise.all([
        this.signPhoto(attendance.time_in_photo, attendance.student_id, 'in'),
        this.signPhoto(attendance.time_out_photo, attendance.student_id, 'out')
      ]);
      if (this.destroyed || photoVersion !== this.photoLoadVersion ||
          this.authService.getCurrentUser()?.id !== userId) {
        return;
      }
      this.originalRecord = attendance;
      this.record = {
        ...attendance,
        time_in_photo: timeInPhoto,
        time_out_photo: timeOutPhoto
      };
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
    this.originalRecord = null;
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
    const start = Date.parse(timeIn);
    const end = Date.parse(timeOut);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start
    ) {
      return 0;
    }
    // Determine the attendance date in Philippine time.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(start));
    const part = (type: string): string =>
      parts.find(item => item.type === type)?.value || '';
    const attendanceDate =
      `${part('year')}-${part('month')}-${part('day')}`;
    // Fixed lunch break: 12:00 PM to 1:00 PM.
    const lunchStart = Date.parse(
      `${attendanceDate}T12:00:00+08:00`
    );
    const lunchEnd = Date.parse(
      `${attendanceDate}T13:00:00+08:00`
    );
    // Deduct only the actual overlap with the lunch break.
    const lunchOverlap = Math.max(
      0,
      Math.min(end, lunchEnd) -
      Math.max(start, lunchStart)
    );
    const renderedMilliseconds = Math.max(
      0,
      end - start - lunchOverlap
    );
    const calculatedHours = Number(
      (renderedMilliseconds / 3600000).toFixed(6)
    );
    // Accept stored hours only when consistent with
    // the expected server-side calculation.
    if (
      storedHours !== null &&
      Number.isFinite(Number(storedHours)) &&
      Number(storedHours) >= 0 &&
      Math.abs(
        Number(storedHours) - calculatedHours
      ) <= 0.000001
    ) {
      return Number(storedHours);
    }
    return calculatedHours;
  }
  get creditedHours(): number {
    if (!this.record || this.record.verification_status === 'rejected') {
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
      Date.parse(this.record.time_out) <=
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
    return (
      this.isValidPhotoUrl(
        this.record.time_in_photo
      ) &&
      this.isValidPhotoUrl(
        this.record.time_out_photo
      ) &&
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
      !this.destroyed &&
      !this.loading &&
      !this.loadError &&
      !!this.supervisorId &&
      !!this.authService.getCurrentUser()?.id &&
      this.authService.getUserRole() === 'company_supervisor' &&
      this.authService.isOnline() &&
      this.record?.sync_status === 'synced' &&
      this.status === 'Pending' &&
      this.hasCompleteEvidence &&
      this.creditedHours > 0 &&
      !this.saving
    );
  }
  get canReject(): boolean {
    return (
      !this.destroyed &&
      !this.loading &&
      !this.loadError &&
      !!this.supervisorId &&
      !!this.authService.getCurrentUser()?.id &&
      this.authService.getUserRole() === 'company_supervisor' &&
      this.authService.isOnline() &&
      this.rejectionEnabled &&
      this.record?.verification_status === 'provisional' &&
      this.record.sync_status === 'synced' &&
      (
        this.status === 'Pending' ||
        this.status === 'Incomplete'
      ) &&
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
  private isValidPhotoUrl(
    value: string | null | undefined
  ): boolean {
    if (
      typeof value !== 'string' ||
      !value.trim()
    ) {
      return false;
    }
    try {
      const url = new URL(value.trim());
      return (
        url.protocol === 'https:' &&
        !!url.hostname &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }
  private validCoordinates(
    latitude: number | null,
    longitude: number | null
  ): boolean {
    if (
      latitude === null ||
      latitude === undefined ||
      longitude === null ||
      longitude === undefined
    ) {
      return false;
    }
    if (
      String(latitude).trim() === '' ||
      String(longitude).trim() === ''
    ) {
      return false;
    }
    const lat = Number(latitude);
    const lng = Number(longitude);
    return (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
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
  private async signPhoto(
    reference: string | null,
    studentId: string,
    kind: 'in' | 'out'
  ): Promise<string | null> {
    if (!reference) return null;
    try {
      const bucket = this.supabase.storage.from('attendance-photos');
      const marker = '__photo_reference__';
      const base = new URL(bucket.getPublicUrl(marker).data.publicUrl);
      const url = new URL(reference);
      const prefix = base.pathname.slice(0, -marker.length);
      if (url.protocol !== 'https:' || url.origin !== base.origin ||
          url.username || url.password || url.search || url.hash ||
          !url.pathname.startsWith(prefix)) return null;
      const name = decodeURIComponent(url.pathname.slice(prefix.length));
      if (!name.startsWith(studentId + '-') ||
          !/^[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/i.test(name) ||
          !new RegExp('-time-' + kind + '\\.(jpg|jpeg|png|webp)$', 'i').test(name)) return null;
      const { data, error } = await bucket.createSignedUrl(name, 300);
      return error ? null : data?.signedUrl || null;
    } catch {
      return null;
    }
  }

  async viewPhoto(url: string | null): Promise<void> {
    const record = this.record;
    const original = this.originalRecord;
    const userId = this.authService.getCurrentUser()?.id;
    if (!url || !record || !original || !userId || this.destroyed ||
        this.authService.getUserRole() !== 'company_supervisor' ||
        !this.authService.isOnline()) return;
    const kind = url === record.time_in_photo ? 'in' :
      url === record.time_out_photo ? 'out' : null;
    if (!kind) return;
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    const signed = await this.signPhoto(
      kind === 'in' ? original.time_in_photo : original.time_out_photo,
      original.student_id, kind
    );
    if (!signed || this.destroyed || this.record !== record ||
        this.authService.getCurrentUser()?.id !== userId) {
      popup?.close();
      window.alert('Photo unavailable. Refresh the attendance record and try again.');
      return;
    }
    if (kind === 'in') record.time_in_photo = signed;
    else record.time_out_photo = signed;
    this.cdr.markForCheck();
    if (popup) popup.location.replace(signed);
    else window.alert('Allow pop-ups to view the photo.');
  }
  private getReviewErrorMessage(
    error: unknown,
    action: 'verify' | 'reject'
  ): string {
    if (!this.authService.isOnline()) {
      return 'No internet connection. Reconnect and try again.';
    }
    if (
      !this.authService.getCurrentUser()?.id ||
      this.authService.getUserRole() !== 'company_supervisor'
    ) {
      return 'Your supervisor session is unavailable. Please sign in again.';
    }
    const details = error as {
      code?: string;
      message?: string;
    } | null;
    const code = details?.code || '';
    const message = String(
      details?.message || ''
    ).toLowerCase();
    if (
      code === 'PGRST301' ||
      message.includes('jwt expired') ||
      message.includes('session unavailable') ||
      message.includes('session changed')
    ) {
      return 'Your session is unavailable or has expired. Please sign in again.';
    }
    if (
      message.includes('reviewed attendance') ||
      message.includes('already reviewed')
    ) {
      return 'This attendance has already been reviewed and cannot be modified.';
    }
    if (
      message.includes('record was changed') ||
      message.includes('record changed')
    ) {
      return 'The attendance record may have changed or access may have been revoked. Refresh the page before reviewing again.';
    }
    if (
      code === '42501' ||
      message.includes('unauthorized') ||
      message.includes('access denied') ||
      message.includes('assignment no longer active') ||
      message.includes('supervisor unavailable') ||
      message.includes('supervisor identity')
    ) {
      return 'You no longer have permission to review this attendance record.';
    }
    if (
      message.includes('photo evidence') ||
      message.includes('gps evidence')
    ) {
      return 'Complete and valid photo and GPS evidence is required before verification.';
    }
    if (
      message.includes('incomplete attendance') ||
      message.includes('positive rendered hours') ||
      message.includes('invalid attendance time sequence')
    ) {
      return 'This attendance does not meet the required time and rendered hours conditions.';
    }
    if (
      message.includes('rejection remarks')
    ) {
      return 'Please provide valid rejection remarks before continuing.';
    }
    if (
      message.includes('must be synchronized')
    ) {
      return 'This attendance must be synchronized before it can be reviewed.';
    }
    if (code === '22023') {
      return 'The attendance does not meet the review requirements. Refresh and check the record.';
    }
    if (
      message.includes('failed to fetch') ||
      message.includes('network error')
    ) {
      return 'Unable to confirm the operation. Check your connection and refresh the record before trying again.';
    }
    return action === 'verify'
      ? 'Unable to verify attendance. Refresh the record and try again.'
      : 'Unable to reject attendance. Refresh the record and try again.';
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
    const record = this.originalRecord;
    if (!record) return;
    this.saving = true;
    this.actionError = '';
    this.successMessage = '';
    const student = this.student;
    try {
      const userId =
        this.authService.getCurrentUser()?.id;
      if (
        !userId ||
        this.authService.getUserRole() !== 'company_supervisor' ||
        !this.authService.isOnline()
      ) {
        throw new Error(
          'An active online supervisor session is required.'
        );
      }
      const {
        data: supervisor,
        error: supervisorError
      } = await this.supabase
        .from('company_supervisors')
        .select('id')
        .eq('user_id', userId)
        .eq('account_status', 'active')
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
      // Update only if the original attendance record
      // and its evidence have not changed.
      let query = this.supabase
        .from('attendance')
        .update({
          verification_status: 'verified'
        })
        .eq('id', record.id)
        .eq('student_id', student.student_id)
        .eq('attendance_date', record.attendance_date)
        .eq('sync_status', 'synced')
        .eq('verification_status', 'provisional')
        .eq('time_in', record.time_in)
        .eq('time_out', record.time_out!);
      // Protect the original Time-In photo reference.
      query = record.time_in_photo === null
        ? query.is('time_in_photo', null)
        : query.eq('time_in_photo', record.time_in_photo);
      // Protect the original Time-Out photo reference.
      query = record.time_out_photo === null
        ? query.is('time_out_photo', null)
        : query.eq('time_out_photo', record.time_out_photo);
      // Protect the original Time-In GPS coordinates.
      query = record.time_in_location_lat === null
        ? query.is('time_in_location_lat', null)
        : query.eq(
            'time_in_location_lat',
            record.time_in_location_lat
          );
      query = record.time_in_location_long === null
        ? query.is('time_in_location_long', null)
        : query.eq(
            'time_in_location_long',
            record.time_in_location_long
          );
      // Protect the original Time-Out GPS coordinates.
      query = record.time_out_location_lat === null
        ? query.is('time_out_location_lat', null)
        : query.eq(
            'time_out_location_lat',
            record.time_out_location_lat
          );
      query = record.time_out_location_long === null
        ? query.is('time_out_location_long', null)
        : query.eq(
            'time_out_location_long',
            record.time_out_location_long
          );
      // Protect the original stored rendered hours.
      query = record.total_hours_rendered === null
        ? query.is('total_hours_rendered', null)
        : query.eq(
            'total_hours_rendered',
            record.total_hours_rendered
          );
      const {
        data: updated,
        error: updateError
      } = await query
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
      this.successMessage = this.loadError
        ? 'Attendance was verified, but the updated record could not be loaded. Please refresh.'
        : 'Attendance record successfully verified.';
    } catch (error) {
      console.error('Verification failed:', error);
      this.actionError =
        this.getReviewErrorMessage(error, 'verify');
    } finally {
      this.saving = false;
      this.cdr.markForCheck();
    }
  }
  // ==========================================
  // REJECTION
  // ==========================================
  async rejectAttendance(): Promise<void> {
    if (!this.canReject || !this.record || !this.student) return;
    const reason = this.rejectionReason;
    const details = this.rejectionDetails.trim();
    const remarks = `${reason}: ${details}`;
    if (
      !this.rejectionReasons.includes(reason) ||
      !details ||
      details.length > 1000 ||
      remarks.length > 1200
    ) {
      this.actionError =
        'Select a valid reason and enter details (up to 1000 characters).';
      return;
    }
    const record = this.originalRecord;
    if (!record) return;
    const student = this.student;
    const userId = this.authService.getCurrentUser()?.id;
    this.saving = true;
    this.actionError = '';
    this.successMessage = '';
    try {
      if (
        !userId ||
        this.authService.getUserRole() !== 'company_supervisor' ||
        !this.authService.isOnline()
      ) {
        throw new Error(
          'An active online supervisor session is required.'
        );
      }
      const { data: supervisor, error: supervisorError } = await this.supabase
        .from('company_supervisors').select('id')
        .eq('user_id', userId).eq('account_status', 'active').single();
      if (supervisorError || !supervisor) throw supervisorError || new Error('Supervisor unavailable.');
      const { data: assignment, error: assignmentError } = await this.supabase
        .from('intern_supervisor_assignments').select('student_id')
        .eq('student_id', student.id).eq('supervisor_id', supervisor.id)
        .eq('assignment_status', 'active').limit(1).maybeSingle();
      if (assignmentError || !assignment) throw assignmentError || new Error('Assignment no longer active.');
      if (this.authService.getCurrentUser()?.id !== userId) throw new Error('Session changed.');
      let query = this.supabase
        .from('attendance')
        .update({
          verification_status: 'rejected',
          remarks: remarks
        })
        .eq('id', record.id)
        .eq('student_id', student.student_id)
        .eq('attendance_date', record.attendance_date)
        .eq('sync_status', 'synced')
        .eq('verification_status', 'provisional')
        .eq('time_in', record.time_in);
      // Protect the original Time-Out timestamp.
      query = record.time_out === null
        ? query.is('time_out', null)
        : query.eq('time_out', record.time_out);
      // Protect the original photo references.
      query = record.time_in_photo === null
        ? query.is('time_in_photo', null)
        : query.eq('time_in_photo', record.time_in_photo);
      query = record.time_out_photo === null
        ? query.is('time_out_photo', null)
        : query.eq('time_out_photo', record.time_out_photo);
      // Protect the original Time-In GPS coordinates.
      query = record.time_in_location_lat === null
        ? query.is('time_in_location_lat', null)
        : query.eq(
            'time_in_location_lat',
            record.time_in_location_lat
          );
      query = record.time_in_location_long === null
        ? query.is('time_in_location_long', null)
        : query.eq(
            'time_in_location_long',
            record.time_in_location_long
          );
      // Protect the original Time-Out GPS coordinates.
      query = record.time_out_location_lat === null
        ? query.is('time_out_location_lat', null)
        : query.eq(
            'time_out_location_lat',
            record.time_out_location_lat
          );
      query = record.time_out_location_long === null
        ? query.is('time_out_location_long', null)
        : query.eq(
            'time_out_location_long',
            record.time_out_location_long
          );
      // Protect the original stored rendered hours.
      query = record.total_hours_rendered === null
        ? query.is('total_hours_rendered', null)
        : query.eq(
            'total_hours_rendered',
            record.total_hours_rendered
          );
      const {
        data: updated,
        error: updateError
      } = await query
        .select('id')
        .maybeSingle();
      if (updateError || !updated) throw updateError || new Error('Record changed or access denied.');
      this.activeDialog = null;
      await this.loadData();
      this.successMessage = this.loadError
        ? 'Attendance was rejected, but the updated record could not be loaded. Please refresh.'
        : 'Attendance record successfully rejected.';
    } catch (error) {
      console.error('Rejection failed:', error);
      this.actionError =
        this.getReviewErrorMessage(error, 'reject');
    } finally {
      this.saving = false;
      this.cdr.markForCheck();
    }
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
  private dtrStatus(r: DtrAttendance): 'verified' | 'provisional' | 'rejected' | 'incomplete' | 'neutral' {
    if (r.verification_status === 'rejected') return 'rejected';
    if (!r.time_in || !r.time_out || !Number.isFinite(Date.parse(r.time_in)) || !Number.isFinite(Date.parse(r.time_out)) || Date.parse(r.time_out) <= Date.parse(r.time_in)) return 'incomplete';
    if (r.verification_status === 'verified') return 'verified';
    if (r.verification_status === 'provisional') return 'provisional';
    return 'neutral';
  }
  async downloadDTR(): Promise<void> {
  if (
    this.downloadingDTR ||
    this.loading ||
    !this.student ||
    this.saving
  ) {
    return;
  }
  const studentId = this.student.student_id;
  const recordId = this.recordId;
  const userId =
    this.authService.getCurrentUser()?.id;
  if (
    !userId ||
    this.authService.getUserRole() !== 'company_supervisor' ||
    !this.authService.isOnline()
  ) {
    window.alert(
      'An active online supervisor session is required.'
    );
    return;
  }
  this.downloadingDTR = true;
  this.cdr.markForCheck();
  const current = () =>
    !this.destroyed &&
    this.recordId === recordId &&
    this.student?.student_id === studentId &&
    this.authService.getCurrentUser()?.id === userId &&
    this.authService.getUserRole() === 'company_supervisor' &&
    this.authService.isOnline();
  try {
    // =====================================
    // VALIDATE SUPERVISOR ACCESS
    // =====================================
    const {
      data: supervisor,
      error: supervisorError
    } = await this.supabase
      .from('company_supervisors')
      .select('id, full_name, company_name')
      .eq('user_id', userId)
      .eq('account_status', 'active')
      .single();
    if (supervisorError || !supervisor) {
      throw new Error(
        'Supervisor access is unavailable.'
      );
    }
    // =====================================
    // VALIDATE ACTIVE ASSIGNMENT
    // =====================================
    const getAssignment = async () => {
      const {
        data,
        error
      } = await this.supabase
        .from('intern_supervisor_assignments')
        .select(`
          id,
          company_name,
          students!student_id!inner(
            student_id,
            full_name,
            course,
            school_name,
            required_hours,
            ojt_start_date,
            ojt_end_date
          )
        `)
        .eq('supervisor_id', supervisor.id)
        .eq('assignment_status', 'active')
        .eq('students.student_id', studentId)
        .limit(1)
        .maybeSingle();
      if (error || !data) {
        throw new Error(
          'This intern is not assigned to your account.'
        );
      }
      return data;
    };
    const assignment = await getAssignment();
    const student = Array.isArray(
      assignment.students
    )
      ? assignment.students[0]
      : assignment.students;
    if (
      !student ||
      student.student_id !== studentId ||
      !current()
    ) {
      return;
    }
    // =====================================
    // GET CURRENT PHILIPPINE DATE
    // =====================================
    const parts = new Intl.DateTimeFormat(
      'en-US',
      {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }
    ).formatToParts(new Date());
    const part = (type: string) =>
      parts.find(p => p.type === type)?.value || '';
    const today =
      `${part('year')}-${part('month')}-${part('day')}`;
    // =====================================
    // VALIDATE INTERNSHIP PERIOD
    // =====================================
    const start = student.ojt_start_date;
    const registeredEnd =
      student.ojt_end_date;
    const validDate = (
      value: string
    ): boolean => {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value)
      ) {
        return false;
      }
      const date = new Date(
        value + 'T00:00:00Z'
      );
      return (
        Number.isFinite(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
      );
    };
    if (!start || !validDate(start)) {
      throw new Error(
        'Please specify a valid internship start date.'
      );
    }
    if (
      registeredEnd &&
      (
        !validDate(registeredEnd) ||
        registeredEnd < start
      )
    ) {
      throw new Error(
        'Invalid internship end date.'
      );
    }
    if (start > today) {
      throw new Error(
        'The internship has not started yet.'
      );
    }
    const end =
      registeredEnd && registeredEnd < today
        ? registeredEnd
        : today;
    // =====================================
    // RETRIEVE SYNCHRONIZED ATTENDANCE
    // =====================================
    const records: DtrAttendance[] = [];
    let expected: number | null = null;
    while (current()) {
      const {
        data,
        error,
        count
      } = await this.supabase
        .from('attendance')
        .select(
          `
            id,
            student_id,
            attendance_date,
            time_in,
            time_out,
            total_hours_rendered,
            verification_status,
            sync_status
          `,
          {
            count: 'exact'
          }
        )
        .eq('student_id', studentId)
        .eq('sync_status', 'synced')
        .gte('attendance_date', start)
        .lte('attendance_date', end)
        .order('attendance_date', {
          ascending: true
        })
        .order('id', {
          ascending: true
        })
        .range(
          records.length,
          records.length + 499
        );
      if (error) {
        throw new Error(
          'Unable to retrieve attendance records.'
        );
      }
      if (!current()) {
        return;
      }
      if (
        count === null ||
        (
          expected !== null &&
          expected !== count
        )
      ) {
        throw new Error(
          'Attendance changed during export. Please retry.'
        );
      }
      expected = count;
      const batch =
        (data || []) as DtrAttendance[];
      records.push(...batch);
      if (records.length >= expected) {
        break;
      }
      if (!batch.length) {
        throw new Error(
          'Attendance retrieval was incomplete. Please retry.'
        );
      }
    }
    if (!current()) {
      return;
    }
    // =====================================
    // VALIDATE ATTENDANCE RESULTS
    // =====================================
    if (
      records.length !== expected ||
      new Set(
        records.map(record => record.id)
      ).size !== records.length
    ) {
      throw new Error(
        'Attendance retrieval was incomplete. Please retry.'
      );
    }
    // =====================================
    // MAP RECORDS TO SHARED DTR TEMPLATE
    // =====================================
    const templateRecords: DtrTemplateRecord[] =
      records.map(record => {
        const attendanceStatus =
          this.dtrStatus(record);
        const status: DtrTemplateRecord['status'] =
          attendanceStatus === 'neutral'
            ? 'unknown'
            : attendanceStatus;
        const minutes =
          status === 'rejected' ||
          status === 'incomplete'
            ? 0
            : this.calculateCreditedHours(
                record.time_in,
                record.time_out,
                record.total_hours_rendered
              ) * 60;
        return {
          date: record.attendance_date,
          timeIn: this.formatTime(
            record.time_in
          ),
          timeOut: this.formatTime(
            record.time_out
          ),
          minutes,
          status,
          syncStatus: 'synced'
        };
      });
    // =====================================
    // CREATE SHARED DTR DOCUMENT
    // =====================================
    const definition = createDtrTemplate({
      studentName:
        student.full_name || 'Unknown student',
      studentId,
      schoolName:
        student.school_name ||
        'School not provided',
      course:
        student.course || 'Not provided',
      company:
        assignment.company_name ||
        supervisor.company_name ||
        'Not available',
      supervisorName:
        supervisor.full_name,
      startDate: start,
      endDate: end,
      records: templateRecords,
      includeEmptyDates: false,
      includeRemarks: false,
      isCachedData: false,
      reviewerRole: 'Company Supervisor',
      placementNote:
        'This report contains synchronized attendance records only. Dates without attendance are not included.'
    });
    // =====================================
    // GENERATE PDF
    // =====================================
    const blob = await pdfMake
      .createPdf(definition)
      .getBlob();
    // =====================================
    // REVALIDATE ASSIGNMENT
    // =====================================
    const latestAssignment =
      await getAssignment();
    if (
      !current() ||
      latestAssignment.id !== assignment.id
    ) {
      throw new Error(
        'Assignment changed. Please refresh and retry.'
      );
    }
    // =====================================
    // DOWNLOAD PDF
    // =====================================
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeStudentId = studentId.replace(
      /[^a-zA-Z0-9_-]/g,
      '_'
    );
    link.href = url;
    link.download =
      `InternTrack-DTR-${safeStudentId}-${start}-to-${end}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 30000);
  } catch (error) {
    if (current()) {
      window.alert(
        error instanceof Error
          ? error.message
          : 'Unable to download DTR. Please try again.'
      );
    }
  } finally {
    this.downloadingDTR = false;
    if (!this.destroyed) {
      this.cdr.markForCheck();
    }
  }
}
}
