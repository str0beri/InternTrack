
import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  NgZone,
  inject
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { IonIcon, IonHeader, IonToolbar } from '@ionic/angular';

import { addIcons } from 'ionicons';
import {
  arrowBackOutline,
  documentTextOutline,
  downloadOutline,
  printOutline,
  locationOutline,
  shieldCheckmarkOutline,
  imageOutline,
  alertCircleOutline,
  refreshOutline,
  openOutline,
  closeOutline
} from 'ionicons/icons';

import { SupabaseService } from '../../../services/supabase.service';

import { createDtrTemplate } from '../../../utils/dtr-template';
import type { DtrTemplateRecord } from '../../../utils/dtr-template';

import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';

import type {
  TDocumentDefinitions
} from 'pdfmake/interfaces';

pdfMake.addVirtualFileSystem(
  pdfFonts as unknown as Record<string, string>
);

interface AttendanceRecord {
  id: string;
  student_id: string;
  attendance_date: string;
  time_in: string | null;
  time_out: string | null;
  time_in_photo: string | null;
  time_out_photo: string | null;
  time_in_location_lat: number | null;
  time_in_location_long: number | null;
  time_out_location_lat: number | null;
  time_out_location_long: number | null;
  total_hours_rendered: number | null;
  verification_status: string | null;
  sync_status: string | null;
  verified_by: string | null;
  verified_at: string | null;
  remarks: string | null;
}

interface StudentRecord {
  id: string;
  student_id: string;
  full_name: string;
  email: string | null;
  course: string | null;
  year_level: string | null;
  school_name: string | null;
  company_name: string | null;
  required_hours: number | null;
  ojt_start_date: string | null;
  ojt_end_date: string | null;
}

interface SupervisorRecord {
  id: string;
  user_id: string | null;
  supervisor_id: string;
  full_name: string;
  company_name: string;
  department: string | null;
  position: string | null;
}

interface AssignmentRecord {
  id: string;
  student_id: string;
  supervisor_id: string | null;
  company_name: string;
  assigned_date: string | null;
  start_date: string | null;
  end_date: string | null;
  assignment_status: string;
  assignment_history: any[] | null;
}

type AttendanceStatus =
  | 'verified'
  | 'pending'
  | 'incomplete'
  | 'rejected'
  | 'unknown';

type DtrAction = 'open' | 'download' | 'print';

@Component({
  selector: 'app-attendance-details',
  templateUrl: './attendance-details.page.html',
  styleUrls: ['./attendance-details.page.scss'],
  standalone: true,
  imports: [
    IonToolbar,
    IonHeader,
    CommonModule,
    IonIcon
  ]
})
export class AttendanceDetailsPage implements OnInit, OnDestroy {

  private supabaseService = inject(SupabaseService);
  private supabase = this.supabaseService.getClient();

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private ngZone = inject(NgZone);

  attendance: AttendanceRecord | null = null;
  student: StudentRecord | null = null;
  assignment: AssignmentRecord | null = null;
  supervisor: SupervisorRecord | null = null;
  reviewingSupervisor: SupervisorRecord | null = null;

  isLoading = true;
  errorMessage = '';

  isGeneratingDtr = false;
  dtrErrorMessage = '';
  dtrSuccessMessage = '';

  timeInPhotoUrl = '';
  timeOutPhotoUrl = '';

  timeInPhotoFailed = false;
  timeOutPhotoFailed = false;

  selectedPhotoUrl = '';
  selectedPhotoTitle = '';

  private photoRequest = 0;
  private attendanceId = '';
  private loadingInProgress = false;
  private destroyed = false;
  private loadVersion = 0;
  private loadedUserId = '';

  private authSubscription: {
    unsubscribe(): void;
  } | null = null;

  constructor() {
    addIcons({
      arrowBackOutline,
      documentTextOutline,
      downloadOutline,
      printOutline,
      locationOutline,
      shieldCheckmarkOutline,
      imageOutline,
      alertCircleOutline,
      refreshOutline,
      openOutline,
      closeOutline
    });
  }

  ngOnInit(): void {
    this.attendanceId =
      this.route.snapshot.paramMap.get('recordId') ||
      this.route.snapshot.paramMap.get('attendanceId') ||
      this.route.snapshot.paramMap.get('id') ||
      '';

    if (!this.attendanceId || !this.isUuid(this.attendanceId)) {
      this.errorMessage = 'No valid attendance record was selected.';
      this.isLoading = false;
      return;
    }

    const { data } = this.supabase.auth.onAuthStateChange(
      (event, session) => {
        if (this.destroyed) {
          return;
        }

        if (
          event === 'SIGNED_OUT' ||
          (
            this.loadedUserId &&
            session?.user?.id !== this.loadedUserId
          )
        ) {
          this.ngZone.run(() => {
            this.loadVersion++;
            this.loadedUserId = '';
            this.loadingInProgress = false;
            this.isLoading = false;

            this.clearLoadedData();

            this.errorMessage =
              'Your session has changed. Please sign in again.';

            this.refreshView();
          });
        }
      }
    );

    this.authSubscription = data.subscription;

    void this.loadAttendanceDetails();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.loadVersion++;

    this.authSubscription?.unsubscribe();
    this.authSubscription = null;

    this.clearLoadedData();
  }

  // ==========================================
  // SESSION AND ACCESS VALIDATION
  // ==========================================

  private refreshView(): void {
    if (!this.destroyed) {
      this.cdr.markForCheck();
    }
  }

  private clearLoadedData(): void {
    this.photoRequest++;
    this.attendance = null;
    this.student = null;
    this.assignment = null;
    this.supervisor = null;
    this.reviewingSupervisor = null;

    this.timeInPhotoUrl = '';
    this.timeOutPhotoUrl = '';

    this.timeInPhotoFailed = false;
    this.timeOutPhotoFailed = false;

    this.selectedPhotoUrl = '';
    this.selectedPhotoTitle = '';

    this.dtrErrorMessage = '';
    this.dtrSuccessMessage = '';
  }

  private async validateCoordinatorAccess(
    expectedUserId?: string
  ): Promise<string> {

    if (this.destroyed) {
      throw new Error('The attendance page is no longer active.');
    }

    if (!navigator.onLine) {
      throw new Error(
        'An internet connection is required to access attendance records.'
      );
    }

    const {
      data: authData,
      error: authError
    } = await this.supabase.auth.getUser();

    const userId = authData.user?.id;

    if (authError || !userId) {
      throw new Error(
        'Your session is unavailable. Please sign in again.'
      );
    }

    if (expectedUserId && expectedUserId !== userId) {
      throw new Error(
        'Your session has changed. Please sign in again.'
      );
    }

    const {
      data: account,
      error: accountError
    } = await this.supabase
      .from('users')
      .select('id, role, account_status')
      .eq('id', userId)
      .maybeSingle();

    if (
      accountError ||
      !account ||
      account.role !== 'ojt_coordinator' ||
      account.account_status !== 'active'
    ) {
      throw new Error(
        'You are not authorized to access coordinator attendance records.'
      );
    }

    const {
      data: coordinator,
      error: coordinatorError
    } = await this.supabase
      .from('ojt_coordinators')
      .select('id')
      .eq('user_id', userId)
      .eq('account_status', 'active')
      .maybeSingle();

    if (coordinatorError || !coordinator) {
      throw new Error(
        'An active coordinator account is required.'
      );
    }

    if (this.destroyed) {
      throw new Error('The attendance page is no longer active.');
    }

    return userId;
  }

  private isCurrentRequest(version: number): boolean {
    return !this.destroyed && version === this.loadVersion;
  }

  // ==========================================
  // LOAD ATTENDANCE DETAILS
  // ==========================================

  async loadAttendanceDetails(): Promise<void> {

    if (
      this.destroyed ||
      this.loadingInProgress ||
      this.isGeneratingDtr
    ) {
      return;
    }

    const version = ++this.loadVersion;

    this.loadingInProgress = true;
    this.isLoading = true;
    this.errorMessage = '';
    this.loadedUserId = '';

    this.clearLoadedData();

    try {
      const userId = await this.validateCoordinatorAccess();

      if (!this.isCurrentRequest(version)) {
        return;
      }

      this.loadedUserId = userId;

      const {
        data: attendanceData,
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
        .eq('id', this.attendanceId)
        .eq('sync_status', 'synced')
        .maybeSingle();

      if (attendanceError || !attendanceData) {
        throw new Error(
          'Attendance record was not found or is unavailable.'
        );
      }

      const attendance = attendanceData as AttendanceRecord;

      if (
        attendance.id !== this.attendanceId ||
        attendance.sync_status !== 'synced' ||
        !this.isValidDateOnly(attendance.attendance_date)
      ) {
        throw new Error('Invalid attendance record.');
      }

      const {
        data: studentData,
        error: studentError
      } = await this.supabase
        .from('students')
        .select(`
          id,
          student_id,
          full_name,
          email,
          course,
          year_level,
          school_name,
          company_name,
          required_hours,
          ojt_start_date,
          ojt_end_date
        `)
        .eq('student_id', attendance.student_id)
        .maybeSingle();

      if (studentError || !studentData) {
        throw new Error(
          'The student associated with this attendance record was not found.'
        );
      }

      const student = studentData as StudentRecord;

      if (student.student_id !== attendance.student_id) {
        throw new Error('Attendance and student information do not match.');
      }

      const assignments =
        await this.fetchStudentAssignments(student.id);

      const assignment = this.resolvePlacement(
        assignments,
        attendance.attendance_date
      );

      let supervisor: SupervisorRecord | null = null;

      if (assignment?.supervisor_id) {
        supervisor = await this.fetchSupervisor(
          'id',
          assignment.supervisor_id
        );
      }

      let reviewingSupervisor: SupervisorRecord | null = null;

      if (attendance.verified_by) {
        const reviewerId = attendance.verified_by;

        if (this.isUuid(reviewerId)) {
          reviewingSupervisor = await this.fetchSupervisor(
            'id',
            reviewerId
          );

          if (!reviewingSupervisor) {
            reviewingSupervisor = await this.fetchSupervisor(
              'user_id',
              reviewerId
            );
          }
        } else {
          reviewingSupervisor = await this.fetchSupervisor(
            'supervisor_id',
            reviewerId
          );
        }
      }

      const timeInPhotoUrl =
        await this.resolvePhotoUrl(attendance.time_in_photo, attendance.student_id, 'in');

      const timeOutPhotoUrl =
        await this.resolvePhotoUrl(attendance.time_out_photo, attendance.student_id, 'out');

      await this.validateCoordinatorAccess(userId);

      if (!this.isCurrentRequest(version)) {
        return;
      }

      this.ngZone.run(() => {
        this.attendance = attendance;
        this.student = student;
        this.assignment = assignment || null;
        this.supervisor = supervisor;
        this.reviewingSupervisor = reviewingSupervisor;

        this.timeInPhotoUrl = timeInPhotoUrl;
        this.timeOutPhotoUrl = timeOutPhotoUrl;

        this.refreshView();
      });

    } catch (error) {
      if (!this.isCurrentRequest(version)) {
        return;
      }

      console.error('Attendance details loading error:', error);

      this.ngZone.run(() => {
        this.clearLoadedData();
        this.loadedUserId = '';

        this.errorMessage =
          error instanceof Error
            ? error.message
            : 'Unable to load attendance details. Please try again.';
      });

    } finally {
      if (this.isCurrentRequest(version)) {
        this.ngZone.run(() => {
          this.isLoading = false;
          this.loadingInProgress = false;
          this.refreshView();
        });
      }
    }
  }

  retryLoad(): void {
    void this.loadAttendanceDetails();
  }

  // ==========================================
  // ASSIGNMENT HISTORY
  // ==========================================

  private async fetchStudentAssignments(
    studentUuid: string
  ): Promise<AssignmentRecord[]> {

    const records: AssignmentRecord[] = [];
    const uniqueIds = new Set<string>();

    const batchSize = 500;
    let offset = 0;
    let expectedCount: number | null = null;

    while (true) {
      if (this.destroyed) {
        throw new Error('The attendance page is no longer active.');
      }

      const { data, error, count } = await this.supabase
        .from('intern_supervisor_assignments')
        .select(`
          id,
          student_id,
          supervisor_id,
          company_name,
          assigned_date,
          start_date,
          end_date,
          assignment_status,
          assignment_history
        `, { count: 'exact' })
        .eq('student_id', studentUuid)
        .order('id', { ascending: true })
        .range(offset, offset + batchSize - 1);

      if (error || count === null) {
        throw new Error('Unable to retrieve complete assignment history.');
      }

      if (expectedCount === null) {
        expectedCount = count;
      }

      if (count !== expectedCount) {
        throw new Error(
          'Assignment history changed during retrieval. Please try again.'
        );
      }

      const batch = (data ?? []) as AssignmentRecord[];

      for (const record of batch) {
        if (
          record.student_id !== studentUuid ||
          uniqueIds.has(record.id)
        ) {
          throw new Error('Invalid or duplicate assignment record detected.');
        }

        uniqueIds.add(record.id);
        records.push(record);
      }

      if (records.length === expectedCount) {
        break;
      }

      if (
        batch.length === 0 ||
        records.length > expectedCount
      ) {
        throw new Error('Assignment history retrieval was incomplete.');
      }

      offset += batch.length;
    }

    return records;
  }

  private resolvePlacement(
    assignments: AssignmentRecord[],
    attendanceDate: string
  ): AssignmentRecord | undefined {

    const matches = assignments.filter(assignment => {

      if (
        !assignment.start_date ||
        !this.isValidDateOnly(assignment.start_date)
      ) {
        return false;
      }

      if (attendanceDate < assignment.start_date) {
        return false;
      }

      if (
        assignment.end_date &&
        (
          !this.isValidDateOnly(assignment.end_date) ||
          attendanceDate > assignment.end_date
        )
      ) {
        return false;
      }

      if (assignment.assignment_status === 'inactive') {

        const history =
          Array.isArray(assignment.assignment_history)
            ? assignment.assignment_history
            : [];

        const reassignment = [...history]
          .reverse()
          .find(event =>
            event?.previous_assignment_id === assignment.id
          );

        if (!reassignment) {
          return false;
        }

        const boundary =
          reassignment.new_start_date ||
          this.toManilaDate(reassignment.changed_at);

        if (
          !boundary ||
          !this.isValidDateOnly(boundary) ||
          attendanceDate >= boundary
        ) {
          return false;
        }
      }

      return true;
    });

    return matches.length === 1
      ? matches[0]
      : undefined;
  }

  // ==========================================
  // SUPERVISOR INFORMATION
  // ==========================================

  private async fetchSupervisor(
    column: 'id' | 'user_id' | 'supervisor_id',
    value: string
  ): Promise<SupervisorRecord | null> {

    const { data, error } = await this.supabase
      .from('company_supervisors')
      .select(`
        id,
        user_id,
        supervisor_id,
        full_name,
        company_name,
        department,
        position
      `)
      .eq(column, value)
      .maybeSingle();

    if (error) {
      throw new Error('Unable to retrieve supervisor information.');
    }

    return data
      ? data as SupervisorRecord
      : null;
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(value);
  }

  // ==========================================
  // STUDENT AND COMPANY DISPLAY
  // ==========================================

  get studentName(): string {
    return this.student?.full_name || 'Unknown student';
  }

  get studentId(): string {
    return this.student?.student_id ||
      this.attendance?.student_id ||
      'Not recorded';
  }

  get studentCourse(): string {
    return this.student?.course || 'Not recorded';
  }

  get studentYearLevel(): string {
    return this.student?.year_level || '';
  }

  get companyName(): string {
    return this.assignment?.company_name || 'Not recorded';
  }

  get supervisorName(): string {
    return this.supervisor?.full_name || 'Not recorded';
  }

  get reviewingSupervisorName(): string {
    if (this.reviewingSupervisor) {
      return this.reviewingSupervisor.full_name;
    }

    if (this.attendance?.verified_by) {
      return 'Reviewer not identified';
    }

    return 'Not yet reviewed';
  }

  get internshipPeriod(): string {
    if (!this.assignment?.start_date) {
      return 'Not recorded';
    }

    const start = this.formatDate(this.assignment.start_date);

    const end = this.assignment.end_date
      ? this.formatDate(this.assignment.end_date)
      : 'Ongoing';

    return `${start} – ${end}`;
  }

  get studentInitials(): string {
    const parts = this.studentName
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (!parts.length) {
      return '?';
    }

    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }

    return (
      parts[0][0] +
      parts[parts.length - 1][0]
    ).toUpperCase();
  }

  get studentAvatarColor(): string {
    const colors = [
      'blue',
      'purple',
      'green',
      'orange',
      'rose',
      'slate'
    ];

    const hash = Array.from(this.studentId)
      .reduce(
        (sum, character) => sum + character.charCodeAt(0),
        0
      );

    return colors[hash % colors.length];
  }

  // ==========================================
  // ATTENDANCE VERIFICATION
  // ==========================================

  private resolveStatus(
    record: AttendanceRecord
  ): AttendanceStatus {

    const status =
      (record.verification_status || '').toLowerCase();

    if (status === 'rejected') {
      return 'rejected';
    }

    if (record.sync_status !== 'synced') {
      return 'unknown';
    }

    if (!record.time_in || !record.time_out) {
      return 'incomplete';
    }

    const timeIn = new Date(record.time_in).getTime();
    const timeOut = new Date(record.time_out).getTime();

    if (
      !Number.isFinite(timeIn) ||
      !Number.isFinite(timeOut) ||
      timeOut <= timeIn
    ) {
      return 'incomplete';
    }

    if (status === 'verified') {
      return 'verified';
    }

    if (status === 'provisional') {
      return 'pending';
    }

    return 'unknown';
  }

  get attendanceStatus(): AttendanceStatus {
    return this.attendance
      ? this.resolveStatus(this.attendance)
      : 'unknown';
  }

  private statusLabel(status: AttendanceStatus): string {
    const labels: Record<AttendanceStatus, string> = {
      verified: 'Verified',
      pending: 'Pending',
      incomplete: 'Incomplete',
      rejected: 'Rejected',
      unknown: 'Unknown'
    };

    return labels[status];
  }

  get verificationLabel(): string {
    return this.statusLabel(this.attendanceStatus);
  }

  get verificationClass(): string {
    return `status-${this.attendanceStatus}`;
  }

  get verificationMessage(): string {

    switch (this.attendanceStatus) {

      case 'verified':
        if (
          this.attendance &&
          this.getValidHours(this.attendance) === null
        ) {
          return 'This record is verified, but its stored rendered hours require reconciliation before they can be included in the official OJT total.';
        }

        return 'This attendance record has been verified. Valid rendered hours are included in the student’s official OJT hours.';

      case 'pending':
        return 'This record is awaiting routine verification by the company supervisor.';

      case 'incomplete':
        return 'This attendance record has a missing or invalid time-in or time-out entry. It cannot be counted as verified OJT hours.';

      case 'rejected':
        return 'This attendance record has been rejected and is excluded from official verified OJT hours.';

      default:
        return 'The verification status of this attendance record could not be determined.';
    }
  }

  get verifiedOn(): string {
    if (!this.attendance?.verified_at) {
      return 'Not yet verified';
    }

    return this.formatDateTime(this.attendance.verified_at);
  }

  get remarks(): string {
    return this.attendance?.remarks?.trim() || '';
  }

  // ==========================================
  // RENDERED HOURS
  // ==========================================

  private calculateExpectedHours(
    record: AttendanceRecord
  ): number | null {

    if (!record.time_in || !record.time_out) {
      return null;
    }

    const timeIn = new Date(record.time_in).getTime();
    const timeOut = new Date(record.time_out).getTime();

    if (
      !Number.isFinite(timeIn) ||
      !Number.isFinite(timeOut) ||
      timeOut <= timeIn
    ) {
      return null;
    }

    const attendanceDate = this.toManilaDate(record.time_in);

    if (
      !this.isValidDateOnly(attendanceDate) ||
      attendanceDate !== record.attendance_date
    ) {
      return null;
    }

    const lunchStart = new Date(
      `${attendanceDate}T12:00:00+08:00`
    ).getTime();

    const lunchEnd = new Date(
      `${attendanceDate}T13:00:00+08:00`
    ).getTime();

    const lunchOverlap = Math.max(
      0,
      Math.min(timeOut, lunchEnd) -
      Math.max(timeIn, lunchStart)
    );

    const elapsedMilliseconds = timeOut - timeIn;

    const creditedMilliseconds = Math.max(
      0,
      elapsedMilliseconds - lunchOverlap
    );

    return Math.round(
      (creditedMilliseconds / 3600000) * 1000000
    ) / 1000000;
  }

  private getValidHours(
    record: AttendanceRecord
  ): number | null {

    const status = this.resolveStatus(record);

    if (status === 'rejected') {
      return 0;
    }

    if (status !== 'verified' && status !== 'pending') {
      return null;
    }

    const expectedHours = this.calculateExpectedHours(record);

    if (expectedHours === null) {
      return null;
    }

    if (
      record.total_hours_rendered === null ||
      record.total_hours_rendered === undefined ||
      String(record.total_hours_rendered).trim() === ''
    ) {
      return null;
    }

    const storedHours = Number(record.total_hours_rendered);

    if (
      !Number.isFinite(storedHours) ||
      storedHours < 0
    ) {
      return null;
    }

    // Allow a small tolerance for JavaScript timestamp
    // precision and database numeric rounding.
    if (Math.abs(storedHours - expectedHours) > 0.000001) {
      return null;
    }

    if (status === 'verified' && storedHours <= 0) {
      return null;
    }

    return storedHours;
  }

  get renderedHours(): string {
    if (!this.attendance) {
      return '—';
    }

    const hours = this.getValidHours(this.attendance);

    return hours === null
      ? '—'
      : `${hours.toFixed(2)} h`;
  }

  // ==========================================
  // PHOTO EVIDENCE
  // ==========================================

  private async resolvePhotoUrl(
    value: string | null,
    studentId: string,
    type: 'in' | 'out'
  ): Promise<string> {
    if (!value || !studentId) return '';
    try {
      const bucket = this.supabase.storage.from('attendance-photos');
      const marker = '__reference__';
      const base = new URL(bucket.getPublicUrl(marker).data.publicUrl);
      const parsed = new URL(value.trim());
      const prefix = base.pathname.slice(0, -marker.length);
      if (parsed.origin !== base.origin || parsed.protocol !== 'https:' ||
          parsed.username || parsed.password || parsed.search || parsed.hash ||
          !parsed.pathname.startsWith(prefix)) return '';
      const name = decodeURIComponent(parsed.pathname.slice(prefix.length));
      if (!name.startsWith(`${studentId}-`) || /[\\/]/.test(name) ||
          !new RegExp(`-time-${type}\\.(jpg|jpeg|png|webp)$`, 'i').test(name)) return '';
      const { data, error } = await bucket.createSignedUrl(name, 300);
      return error ? '' : data?.signedUrl || '';
    } catch {
      return '';
    }
  }

  get hasTimeInPhoto(): boolean {
    return !!this.timeInPhotoUrl &&
      !this.timeInPhotoFailed;
  }

  get hasTimeOutPhoto(): boolean {
    return !!this.timeOutPhotoUrl &&
      !this.timeOutPhotoFailed;
  }

  onPhotoError(type: 'in' | 'out'): void {
    if (type === 'in') {
      this.timeInPhotoFailed = true;
    } else {
      this.timeOutPhotoFailed = true;
    }

    this.refreshView();
  }

  getPhotoFileName(
    value: string | null | undefined
  ): string {

    if (!value) {
      return 'No photo recorded';
    }

    try {
      const path = value.split('?')[0];

      const fileName = path
        .split('/')
        .filter(Boolean)
        .pop();

      return fileName
        ? decodeURIComponent(fileName)
        : 'Attendance photo';

    } catch {
      return 'Attendance photo';
    }
  }

  async openPhoto(type: 'in' | 'out'): Promise<void> {
    if (this.destroyed || this.isLoading || this.errorMessage ||
        !this.loadedUserId || !this.attendance) return;
    const record = this.attendance;
    const userId = this.loadedUserId;
    const version = this.loadVersion;
    const request = ++this.photoRequest;
    const current = () => this.isCurrentRequest(version) &&
      this.photoRequest === request && this.loadedUserId === userId &&
      this.attendance?.id === record.id;
    this.selectedPhotoUrl = '';
    this.selectedPhotoTitle = '';
    try {
      await this.validateCoordinatorAccess(userId);
      if (!current()) return;
      const url = await this.resolvePhotoUrl(
        type === 'in' ? record.time_in_photo : record.time_out_photo,
        record.student_id, type
      );
      await this.validateCoordinatorAccess(userId);
      if (!current()) return;
      if (type === 'in') {
        this.timeInPhotoUrl = url;
        this.timeInPhotoFailed = !url;
      } else {
        this.timeOutPhotoUrl = url;
        this.timeOutPhotoFailed = !url;
      }
      if (url) {
        this.selectedPhotoUrl = url;
        this.selectedPhotoTitle = type === 'in' ? 'Time-in photo' : 'Time-out photo';
      }
    } catch {
      if (!current()) return;
      this.onPhotoError(type);
    } finally {
      if (current()) this.refreshView();
    }
  }

  closePhoto(): void {
    this.photoRequest++;
    this.selectedPhotoUrl = '';
    this.selectedPhotoTitle = '';
  }

  // ==========================================
  // LOCATION EVIDENCE
  // ==========================================

  private validCoordinates(
    latitude: number | null | undefined,
    longitude: number | null | undefined
  ): boolean {

    if (
      latitude === null ||
      latitude === undefined ||
      longitude === null ||
      longitude === undefined ||
      String(latitude).trim() === '' ||
      String(longitude).trim() === ''
    ) {
      return false;
    }

    const lat = Number(latitude);
    const lng = Number(longitude);

    return Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180;
  }

  get hasTimeInLocation(): boolean {
    return this.validCoordinates(
      this.attendance?.time_in_location_lat,
      this.attendance?.time_in_location_long
    );
  }

  get hasTimeOutLocation(): boolean {
    return this.validCoordinates(
      this.attendance?.time_out_location_lat,
      this.attendance?.time_out_location_long
    );
  }

  get timeInCoordinates(): string {
    if (!this.hasTimeInLocation) {
      return 'Location not recorded';
    }

    return `${
      Number(this.attendance?.time_in_location_lat).toFixed(5)
    }, ${
      Number(this.attendance?.time_in_location_long).toFixed(5)
    }`;
  }

  get timeOutCoordinates(): string {
    if (!this.hasTimeOutLocation) {
      return 'Location not recorded';
    }

    return `${
      Number(this.attendance?.time_out_location_lat).toFixed(5)
    }, ${
      Number(this.attendance?.time_out_location_long).toFixed(5)
    }`;
  }

  openLocation(type: 'in' | 'out'): void {

    if (
      !this.attendance ||
      this.destroyed ||
      this.isLoading ||
      this.errorMessage ||
      !this.loadedUserId
    ) {
      return;
    }

    const latitude = type === 'in'
      ? this.attendance.time_in_location_lat
      : this.attendance.time_out_location_lat;

    const longitude = type === 'in'
      ? this.attendance.time_in_location_long
      : this.attendance.time_out_location_long;

    if (!this.validCoordinates(latitude, longitude)) {
      return;
    }

    const coordinates =
      `${Number(latitude)},${Number(longitude)}`;

    const url =
      'https://www.google.com/maps/search/?api=1&query=' +
      encodeURIComponent(coordinates);

    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // ==========================================
  // DATE AND TIME FORMATTING
  // ==========================================

  private isValidDateOnly(value: string): boolean {

    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }

    const date = new Date(`${value}T00:00:00Z`);

    return Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value;
  }

  private toManilaDate(
    value: string | null | undefined
  ): string {

    if (!value) {
      return '';
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return this.isValidDateOnly(value) ? value : '';
    }

    const date = new Date(value);

    if (!Number.isFinite(date.getTime())) {
      return '';
    }

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);

    const year =
      parts.find(part => part.type === 'year')?.value;

    const month =
      parts.find(part => part.type === 'month')?.value;

    const day =
      parts.find(part => part.type === 'day')?.value;

    return `${year}-${month}-${day}`;
  }

  private parseDate(value: string): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return this.isValidDateOnly(value)
        ? new Date(`${value}T00:00:00+08:00`)
        : new Date(NaN);
    }

    return new Date(value);
  }

  formatDate(value: string | null | undefined): string {
    if (!value) {
      return '—';
    }

    const date = this.parseDate(value);

    if (!Number.isFinite(date.getTime())) {
      return '—';
    }

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'Asia/Manila'
    }).format(date);
  }

  formatLongDate(value: string | null | undefined): string {
    if (!value) {
      return '—';
    }

    const date = this.parseDate(value);

    if (!Number.isFinite(date.getTime())) {
      return '—';
    }

    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'Asia/Manila'
    }).format(date);
  }

  formatTime(value: string | null | undefined): string {
    if (!value) {
      return '—';
    }

    const date = new Date(value);

    if (!Number.isFinite(date.getTime())) {
      return '—';
    }

    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Manila'
    }).format(date);
  }

  formatDateTime(value: string | null | undefined): string {
    if (!value) {
      return '—';
    }

    return `${this.formatDate(value)} · ${this.formatTime(value)}`;
  }

  // ==========================================
  // DTR FUNCTIONALITY
  // ==========================================

  get canGenerateDtr(): boolean {
    return !!this.student &&
      !!this.attendance &&
      !!this.loadedUserId &&
      !this.destroyed &&
      !this.errorMessage &&
      !this.isGeneratingDtr &&
      !this.isLoading &&
      navigator.onLine;
  }

  async openDtr(): Promise<void> {
    await this.generateDtr('open');
  }

  async exportDtr(): Promise<void> {
    await this.generateDtr('download');
  }

  async printDtr(): Promise<void> {
    await this.generateDtr('print');
  }

  private async fetchDtrRecords(
    studentId: string,
    startDate: string,
    endDate: string
  ): Promise<AttendanceRecord[]> {

    const records: AttendanceRecord[] = [];
    const uniqueIds = new Set<string>();
    const uniqueDates = new Set<string>();

    const batchSize = 500;
    let offset = 0;
    let expectedCount: number | null = null;

    while (true) {

      if (this.destroyed) {
        throw new Error('The attendance page is no longer active.');
      }

      const { data, error, count } = await this.supabase
        .from('attendance')
        .select(`
          id,
          student_id,
          attendance_date,
          time_in,
          time_out,
          total_hours_rendered,
          verification_status,
          sync_status,
          verified_by,
          verified_at,
          remarks
        `, { count: 'exact' })
        .eq('student_id', studentId)
        .eq('sync_status', 'synced')
        .gte('attendance_date', startDate)
        .lte('attendance_date', endDate)
        .order('attendance_date', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + batchSize - 1);

      if (error || count === null) {
        throw new Error('Unable to retrieve complete DTR records.');
      }

      if (expectedCount === null) {
        expectedCount = count;
      }

      if (count !== expectedCount) {
        throw new Error(
          'Attendance records changed during retrieval. Please generate the DTR again.'
        );
      }

      const batch =
        (data ?? []) as unknown as AttendanceRecord[];

      for (const record of batch) {

        if (
          record.student_id !== studentId ||
          record.sync_status !== 'synced' ||
          !this.isValidDateOnly(record.attendance_date) ||
          record.attendance_date < startDate ||
          record.attendance_date > endDate
        ) {
          throw new Error('An invalid DTR attendance record was detected.');
        }

        if (
          uniqueIds.has(record.id) ||
          uniqueDates.has(record.attendance_date)
        ) {
          throw new Error(
            'Duplicate attendance records were detected. Please review the student’s attendance before generating the DTR.'
          );
        }

        uniqueIds.add(record.id);
        uniqueDates.add(record.attendance_date);
        records.push(record);
      }

      if (records.length === expectedCount) {
        break;
      }

      if (
        batch.length === 0 ||
        records.length > expectedCount
      ) {
        throw new Error(
          'DTR retrieval was incomplete. Please try again.'
        );
      }

      offset += batch.length;
    }

    return records;
  }

  private async generateDtr(action: DtrAction): Promise<void> {

    if (
      !this.canGenerateDtr ||
      !this.student ||
      !this.attendance
    ) {
      return;
    }

    const student = this.student;
    const attendanceId = this.attendance.id;
    const userId = this.loadedUserId;
    const version = this.loadVersion;

    const isCurrent = (): boolean =>
      this.isCurrentRequest(version) &&
      this.loadedUserId === userId &&
      this.student?.id === student.id &&
      this.attendance?.id === attendanceId;

    let previewWindow: Window | null = null;

    this.dtrErrorMessage = '';
    this.dtrSuccessMessage = '';

    if (action === 'open' || action === 'print') {

      previewWindow = window.open('', '_blank');

      if (!previewWindow) {
        this.dtrErrorMessage =
          'Please allow browser pop-ups to open or print the DTR.';

        return;
      }

      previewWindow.opener = null;
    }

    this.isGeneratingDtr = true;

    try {
      await this.validateCoordinatorAccess(userId);

      if (!isCurrent()) {
        throw new Error('The attendance page or session has changed.');
      }

      const assignments =
        await this.fetchStudentAssignments(student.id);

      const knownStartDates = [
        student.ojt_start_date,
        ...assignments.map(item => item.start_date)
      ].filter(
        (value): value is string =>
          !!value && this.isValidDateOnly(value)
      ).sort();

      const startDate = knownStartDates[0];

      if (!startDate) {
        throw new Error(
          'The student has no recorded internship start date.'
        );
      }

      const today = this.toManilaDate(new Date().toISOString());

      if (
        student.ojt_end_date &&
        !this.isValidDateOnly(student.ojt_end_date)
      ) {
        throw new Error('The internship end date is invalid.');
      }

      const endDate =
        student.ojt_end_date &&
        student.ojt_end_date < today
          ? student.ojt_end_date
          : today;

      if (endDate < startDate) {
        throw new Error(
          'The internship period is not valid for DTR generation.'
        );
      }

      const records = await this.fetchDtrRecords(
        student.student_id,
        startDate,
        endDate
      );

      if (!records.length) {
        throw new Error(
          'No synchronized attendance records were found within the internship period.'
        );
      }

      // Do not silently include or exclude inconsistent
      // official attendance hours from a generated DTR.
      const inconsistentVerifiedRecord = records.find(record =>
        record.verification_status === 'verified' &&
        (
          this.resolveStatus(record) !== 'verified' ||
          this.getValidHours(record) === null
        )
      );

      if (inconsistentVerifiedRecord) {
        throw new Error(
          'A verified attendance record contains invalid rendered hours. Please reconcile the record before generating the DTR.'
        );
      }

      const documentDefinition = this.buildDtrDocument(
        student,
        records,
        startDate,
        endDate
      );

      await this.validateCoordinatorAccess(userId);

      if (!isCurrent()) {
        throw new Error('The attendance page or session has changed.');
      }

      if (
        previewWindow &&
        previewWindow.closed
      ) {
        throw new Error('The DTR preview window was closed.');
      }

      const pdf = pdfMake.createPdf(documentDefinition);

      const safeStudentId = student.student_id.replace(
        /[^a-zA-Z0-9_-]/g,
        '_'
      );

      const fileName =
        `InternTrack_DTR_${safeStudentId}_${endDate}.pdf`;

      switch (action) {

        case 'open':
          pdf.open(previewWindow!);
          this.dtrSuccessMessage = 'DTR preview requested.';
          break;

        case 'download':
          pdf.download(fileName);
          this.dtrSuccessMessage = 'DTR download requested.';
          break;

        case 'print':
          pdf.print(previewWindow!);
          this.dtrSuccessMessage = 'DTR print requested.';
          break;
      }

    } catch (error) {

      previewWindow?.close();

      console.error('DTR generation error:', error);

      if (isCurrent()) {
        this.dtrErrorMessage =
          error instanceof Error
            ? error.message
            : 'Unable to generate the DTR. Please try again.';
      }

    } finally {
      if (!this.destroyed) {
        this.ngZone.run(() => {
          this.isGeneratingDtr = false;
          this.refreshView();
        });
      }
    }
  }

  // ==========================================
  // DTR PDF DOCUMENT
  // ==========================================

  private buildDtrDocument(
    student: StudentRecord,
    records: AttendanceRecord[],
    startDate: string,
    endDate: string
  ): TDocumentDefinitions {
    let verifiedHours = 0;
    let provisionalHours = 0;
    let invalidPendingHours = 0;

    const templateRecords: DtrTemplateRecord[] = records.map(record => {
      const status = this.resolveStatus(record);
      const hours = this.getValidHours(record);
      if (status === 'verified' && hours !== null) verifiedHours += hours;
      if (status === 'pending') {
        if (hours !== null) provisionalHours += hours;
        else invalidPendingHours++;
      }
      return {
        date: record.attendance_date,
        timeIn: this.formatTime(record.time_in),
        timeOut: this.formatTime(record.time_out),
        minutes: hours === null ? 0 : hours * 60,
        status: status === 'pending' ? 'provisional' : status,
        syncStatus: 'synced',
        remarks: [record.remarks?.trim(), hours === null ? 'Rendered hours unavailable or require reconciliation; not credited.' : ''].filter(Boolean).join(' ')
      };
    });

    const required = Number(student.required_hours);
    const hasRequired = student.required_hours !== null && Number.isFinite(required) && required > 0;
    const summary = [
      `Required internship hours: ${hasRequired ? required.toFixed(2) : 'Not recorded'}`,
      `Total verified hours: ${verifiedHours.toFixed(2)}`,
      `Pending verification hours: ${provisionalHours.toFixed(2)}`,
      `Remaining required hours: ${hasRequired ? Math.max(0, required - verifiedHours).toFixed(2) : 'Not recorded'}`,
      'The current company may differ from earlier internship placements.',
      'Rows with unavailable rendered hours are not credited.',
      invalidPendingHours ? `${invalidPendingHours} pending record(s) require hours reconciliation.` : ''
    ].filter(Boolean).join('\n');

    return createDtrTemplate({
      studentName: student.full_name,
      studentId: student.student_id,
      schoolName: student.school_name || 'Pamantasan ng Lungsod ng Valenzuela',
      course: student.course || undefined,
      company: student.company_name || 'Not recorded',
      startDate,
      endDate,
      records: templateRecords,
      isCachedData: false,
      includeEmptyDates: false,
      includeRemarks: true,
      reviewerRole: 'Authorized Reviewer',
      placementNote: summary
    });
  }

  // ==========================================
  // MESSAGE CONTROLS
  // ==========================================

  dismissDtrError(): void {
    this.dtrErrorMessage = '';
  }

  dismissDtrSuccess(): void {
    this.dtrSuccessMessage = '';
  }

  // ==========================================
  // NAVIGATION
  // ==========================================

  goBack(): void {
    void this.router.navigate([
      '/coordinator/attendance'
    ]);
  }
}
