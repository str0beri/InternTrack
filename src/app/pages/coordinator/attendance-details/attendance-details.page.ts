import {
  Component,
  OnInit,
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

import {
  SupabaseService
} from '../../../services/supabase.service';

import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';

import type {
  TDocumentDefinitions,
  TableCell
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

type DtrAction =
  | 'open'
  | 'download'
  | 'print';

@Component({
  selector: 'app-attendance-details',
  templateUrl: './attendance-details.page.html',
  styleUrls: ['./attendance-details.page.scss'],
  standalone: true,
  imports: [IonToolbar, IonHeader, 
    CommonModule,
    IonIcon
  ]
})
export class AttendanceDetailsPage implements OnInit {

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

  private attendanceId = '';
  private loadingInProgress = false;

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

    if (!this.attendanceId) {
      this.errorMessage = 'No attendance record was selected.';
      this.isLoading = false;
      return;
    }

    void this.loadAttendanceDetails();
  }

  // ==========================================
  // LOAD ATTENDANCE DETAILS
  // ==========================================

  async loadAttendanceDetails(): Promise<void> {

    if (this.loadingInProgress) {
      return;
    }

    this.loadingInProgress = true;
    this.isLoading = true;
    this.errorMessage = '';

    this.timeInPhotoFailed = false;
    this.timeOutPhotoFailed = false;

    try {

      // Fetch selected attendance record.

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

      if (attendanceError) {
        throw attendanceError;
      }

      if (!attendanceData) {

        throw new Error(
          'Attendance record was not found or is unavailable.'
        );

      }

      const attendance =
        attendanceData as AttendanceRecord;


      // Fetch student information.

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

      if (studentError) {
        throw studentError;
      }

      if (!studentData) {

        throw new Error(
          'The student associated with this attendance record was not found.'
        );

      }

      const student =
        studentData as StudentRecord;


      // Fetch the student's placement history.

      const assignments =
        await this.fetchStudentAssignments(student.id);

      const assignment = this.resolvePlacement(
        assignments,
        attendance.attendance_date
      );


      // Fetch assigned supervisor.

      let supervisor: SupervisorRecord | null = null;

      if (assignment?.supervisor_id) {

        supervisor = await this.fetchSupervisor(
          'id',
          assignment.supervisor_id
        );

      }


      // Fetch the actual reviewing supervisor.
      // verified_by may reference a supervisor UUID
      // or the supervisor's linked authentication UUID.

      let reviewingSupervisor:
        SupervisorRecord | null = null;

      if (attendance.verified_by) {

        const reviewerId = attendance.verified_by;

        if (this.isUuid(reviewerId)) {

          reviewingSupervisor =
            await this.fetchSupervisor(
              'id',
              reviewerId
            );

          if (!reviewingSupervisor) {

            reviewingSupervisor =
              await this.fetchSupervisor(
                'user_id',
                reviewerId
              );

          }

        } else {

          reviewingSupervisor =
            await this.fetchSupervisor(
              'supervisor_id',
              reviewerId
            );

        }

      }


      // Resolve stored attendance photo URLs.

      const timeInPhotoUrl =
        this.resolvePhotoUrl(attendance.time_in_photo);

      const timeOutPhotoUrl =
        this.resolvePhotoUrl(attendance.time_out_photo);


      this.ngZone.run(() => {

        this.attendance = attendance;
        this.student = student;
        this.assignment = assignment || null;
        this.supervisor = supervisor;
        this.reviewingSupervisor = reviewingSupervisor;

        this.timeInPhotoUrl = timeInPhotoUrl;
        this.timeOutPhotoUrl = timeOutPhotoUrl;

        this.cdr.detectChanges();

      });

    } catch (error) {

      console.error(
        'Attendance details loading error:',
        error
      );

      this.ngZone.run(() => {

        this.errorMessage =
          error instanceof Error
            ? error.message
            : 'Unable to load attendance details. Please try again.';

      });

    } finally {

      this.ngZone.run(() => {

        this.isLoading = false;
        this.loadingInProgress = false;

        this.cdr.detectChanges();

      });

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
          assigned_date,
          start_date,
          end_date,
          assignment_status,
          assignment_history
        `)
        .eq('student_id', studentUuid)
        .order('id', { ascending: true })
        .range(offset, offset + batchSize - 1);

      if (error) {
        throw error;
      }

      const batch =
        (data ?? []) as AssignmentRecord[];

      records.push(...batch);

      if (batch.length < batchSize) {
        break;
      }

      offset += batchSize;

    }

    return records;

  }

  private resolvePlacement(
    assignments: AssignmentRecord[],
    attendanceDate: string
  ): AssignmentRecord | undefined {

    const matches = assignments.filter(assignment => {

      if (!assignment.start_date) {
        return false;
      }

      if (attendanceDate < assignment.start_date) {
        return false;
      }

      if (
        assignment.end_date &&
        attendanceDate > assignment.end_date
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

        if (!boundary || attendanceDate >= boundary) {
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
      throw error;
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

    const start = this.formatDate(
      this.assignment.start_date
    );

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
        (sum, character) =>
          sum + character.charCodeAt(0),
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

    if (!record.time_in || !record.time_out) {
      return 'incomplete';
    }

    const timeIn = new Date(record.time_in).getTime();
    const timeOut = new Date(record.time_out).getTime();

    if (
      !Number.isFinite(timeIn) ||
      !Number.isFinite(timeOut) ||
      timeOut < timeIn
    ) {
      return 'incomplete';
    }

    if (status === 'verified') {
      return 'verified';
    }

    if (
      status === 'provisional' ||
      status === 'pending'
    ) {
      return 'pending';
    }

    return 'unknown';

  }

  get attendanceStatus(): AttendanceStatus {

    return this.attendance
      ? this.resolveStatus(this.attendance)
      : 'unknown';

  }

  private statusLabel(
    status: AttendanceStatus
  ): string {

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

    return this.formatDateTime(
      this.attendance.verified_at
    );

  }

  get remarks(): string {
    return this.attendance?.remarks?.trim() || '';
  }

  // ==========================================
  // RENDERED HOURS
  // ==========================================

  private getValidHours(
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
      timeOut < timeIn
    ) {
      return null;
    }

    if (
      record.total_hours_rendered === null ||
      record.total_hours_rendered === undefined
    ) {
      return null;
    }

    const hours = Number(record.total_hours_rendered);

    return Number.isFinite(hours) && hours >= 0
      ? hours
      : null;

  }

  get renderedHours(): string {

    if (!this.attendance) {
      return '—';
    }

    const hours = this.getValidHours(this.attendance);

    return hours === null
      ? '—'
      : `${hours.toFixed(1)} h`;

  }

  // ==========================================
  // PHOTO EVIDENCE
  // ==========================================

  private resolvePhotoUrl(
    value: string | null
  ): string {

    if (!value) {
      return '';
    }

    const url = value.trim();

    try {

      const parsed = new URL(url);

      if (parsed.protocol === 'https:') {
        return parsed.href;
      }

    } catch {

      // Storage object paths require the existing
      // application's storage bucket configuration.

    }

    return '';

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

  openPhoto(type: 'in' | 'out'): void {

    if (type === 'in' && this.hasTimeInPhoto) {

      this.selectedPhotoUrl = this.timeInPhotoUrl;
      this.selectedPhotoTitle = 'Time-in photo';

    }

    if (type === 'out' && this.hasTimeOutPhoto) {

      this.selectedPhotoUrl = this.timeOutPhotoUrl;
      this.selectedPhotoTitle = 'Time-out photo';

    }

  }

  closePhoto(): void {

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
      longitude === undefined
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

    if (!this.attendance) {
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

    window.open(
      url,
      '_blank',
      'noopener,noreferrer'
    );

  }

  // ==========================================
  // DATE AND TIME FORMATTING
  // ==========================================

  private toManilaDate(
    value: string | null | undefined
  ): string {

    if (!value) {
      return '';
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
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

    return new Date(
      /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? `${value}T00:00:00+08:00`
        : value
    );

  }

  formatDate(
    value: string | null | undefined
  ): string {

    if (!value) {
      return '—';
    }

    const date = this.parseDate(value);

    if (Number.isNaN(date.getTime())) {
      return '—';
    }

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'Asia/Manila'
    }).format(date);

  }

  formatLongDate(
    value: string | null | undefined
  ): string {

    if (!value) {
      return '—';
    }

    const date = this.parseDate(value);

    if (Number.isNaN(date.getTime())) {
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

  formatTime(
    value: string | null | undefined
  ): string {

    if (!value) {
      return '—';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return '—';
    }

    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: 'Asia/Manila'
    }).format(date);

  }

  formatDateTime(
    value: string | null | undefined
  ): string {

    if (!value) {
      return '—';
    }

    return `${this.formatDate(value)} · ${
      this.formatTime(value)
    }`;

  }

  // ==========================================
  // DTR FUNCTIONALITY
  // ==========================================

  get canGenerateDtr(): boolean {

    return !!this.student &&
      !!this.attendance &&
      !this.isGeneratingDtr &&
      !this.isLoading;

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

    const batchSize = 500;
    let offset = 0;

    while (true) {

      const { data, error } = await this.supabase
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
        `)
        .eq('student_id', studentId)
        .eq('sync_status', 'synced')
        .gte('attendance_date', startDate)
        .lte('attendance_date', endDate)
        .order('attendance_date', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + batchSize - 1);

      if (error) {
        throw error;
      }

      const batch =
        (data ?? []) as unknown as AttendanceRecord[];

      records.push(...batch);

      if (batch.length < batchSize) {
        break;
      }

      offset += batchSize;

    }

    return records;

  }

  private async generateDtr(
    action: DtrAction
  ): Promise<void> {

    if (
      !this.canGenerateDtr ||
      !this.student ||
      !this.attendance
    ) {
      return;
    }

    // Open a browser window immediately to avoid
    // popup blocking after asynchronous requests.

    let previewWindow: Window | null = null;

    if (action === 'open' || action === 'print') {

      previewWindow = window.open('', '_blank');

      if (!previewWindow) {

        this.dtrErrorMessage =
          'Please allow browser pop-ups to open or print the DTR.';

        return;

      }

    }

    this.isGeneratingDtr = true;
    this.dtrErrorMessage = '';
    this.dtrSuccessMessage = '';

    try {

      const student = this.student;

      const assignments =
        await this.fetchStudentAssignments(student.id);

      // Include previous placements so reassignment
      // does not automatically exclude earlier hours.

      const knownStartDates = [
        student.ojt_start_date,
        ...assignments.map(item => item.start_date)
      ].filter(
        (value): value is string =>
          !!value &&
          /^\d{4}-\d{2}-\d{2}$/.test(value)
      ).sort();

      const startDate = knownStartDates[0];

      if (!startDate) {

        throw new Error(
          'The student has no recorded internship start date.'
        );

      }

      const today = this.toManilaDate(
        new Date().toISOString()
      );

      // Generate the current DTR up to today.
      // A missing internship end date is allowed.

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

      const uniqueIds = new Set(
        records.map(record => record.id)
      );

      const uniqueDates = new Set(
        records.map(record => record.attendance_date)
      );

      if (
        uniqueIds.size !== records.length ||
        uniqueDates.size !== records.length
      ) {

        throw new Error(
          'Duplicate attendance records were detected. Please review the student’s attendance before generating the DTR.'
        );

      }

      const documentDefinition =
        this.buildDtrDocument(
          student,
          records,
          startDate,
          endDate
        );

      const pdf = pdfMake.createPdf(
        documentDefinition
      );

      const safeStudentId =
        student.student_id.replace(
          /[^a-zA-Z0-9_-]/g,
          '_'
        );

      const fileName =
        `InternTrack_DTR_${safeStudentId}_${endDate}.pdf`;

      switch (action) {

        case 'open':

          pdf.open(previewWindow!);

          this.dtrSuccessMessage =
            'DTR preview requested.';

          break;

        case 'download':

          pdf.download(fileName);

          this.dtrSuccessMessage =
            'DTR download requested.';

          break;

        case 'print':

          pdf.print(previewWindow!);

          this.dtrSuccessMessage =
            'DTR print requested.';

          break;

      }

    } catch (error) {

      previewWindow?.close();

      console.error(
        'DTR generation error:',
        error
      );

      this.dtrErrorMessage =
        error instanceof Error
          ? error.message
          : 'Unable to generate the DTR. Please try again.';

    } finally {

      this.ngZone.run(() => {

        this.isGeneratingDtr = false;

        this.cdr.detectChanges();

      });

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

    const body: TableCell[][] = [

      [
        { text: 'Date', style: 'tableHeader' },
        { text: 'Time In', style: 'tableHeader' },
        { text: 'Time Out', style: 'tableHeader' },
        { text: 'Hours', style: 'tableHeader' },
        { text: 'Status', style: 'tableHeader' }
      ]

    ];

    for (const record of records) {

      const status = this.resolveStatus(record);
      const hours = this.getValidHours(record);

      if (hours !== null) {

        if (status === 'verified') {
          verifiedHours += hours;
        }

        if (status === 'pending') {
          provisionalHours += hours;
        }

      }

      body.push([

        this.formatDate(record.attendance_date),

        {
          text: this.formatTime(record.time_in),
          alignment: 'center'
        },

        {
          text: this.formatTime(record.time_out),
          alignment: 'center'
        },

        {
          text: hours === null
            ? '—'
            : hours.toFixed(2),
          alignment: 'center'
        },

        {
          text: this.statusLabel(status),
          alignment: 'center'
        }

      ]);

    }

    const requiredHours =
      Number(student.required_hours || 0);

    const remainingHours = Math.max(
      0,
      requiredHours - verifiedHours
    );

    return {

      pageSize: 'A4',

      pageMargins: [40, 38, 40, 45],

      defaultStyle: {
        fontSize: 10,
        color: '#172033'
      },

      content: [

        {
          text: student.school_name ||
            'Pamantasan ng Lungsod ng Valenzuela',
          alignment: 'center',
          bold: true,
          fontSize: 13,
          margin: [0, 0, 0, 5]
        },

        {
          text: 'DAILY TIME RECORD',
          alignment: 'center',
          bold: true,
          fontSize: 17,
          margin: [0, 0, 0, 4]
        },

        {
          text: 'InternTrack | Internship Attendance Record',
          alignment: 'center',
          color: '#64748b',
          fontSize: 9,
          margin: [0, 0, 0, 22]
        },

        {
          table: {

            widths: [100, '*'],

            body: [

              [
                { text: 'Student name:', bold: true },
                student.full_name
              ],

              [
                { text: 'Student ID:', bold: true },
                student.student_id
              ],

              [
                { text: 'Course:', bold: true },
                student.course || 'Not recorded'
              ],

              [
                { text: 'Current company:', bold: true },
                student.company_name || 'Not recorded'
              ],

              [
                { text: 'DTR period:', bold: true },
                `${this.formatDate(startDate)} – ${
                  this.formatDate(endDate)
                }`
              ]

            ]

          },

          layout: 'noBorders',

          margin: [0, 0, 0, 20]

        },

        {
          table: {

            headerRows: 1,

            widths: ['*', 65, 65, 55, 85],

            body

          },

          layout: {

            fillColor: (rowIndex: number) =>
              rowIndex === 0
                ? '#edf1f7'
                : rowIndex % 2 === 0
                  ? '#f8fafc'
                  : '#ffffff',

            hLineColor: () => '#dce2ea',

            vLineColor: () => '#dce2ea',

            paddingTop: () => 7,

            paddingBottom: () => 7

          },

          margin: [0, 0, 0, 20]

        },

        {
          text: 'Attendance Summary',
          bold: true,
          fontSize: 12,
          margin: [0, 0, 0, 8]
        },

        {
          table: {

            widths: ['*', 100],

            body: [

              [
                'Required internship hours',
                {
                  text: requiredHours.toFixed(2),
                  alignment: 'right'
                }
              ],

              [
                'Total verified hours',
                {
                  text: verifiedHours.toFixed(2),
                  alignment: 'right',
                  bold: true
                }
              ],

              [
                'Pending verification hours',
                {
                  text: provisionalHours.toFixed(2),
                  alignment: 'right'
                }
              ],

              [
                'Remaining required hours',
                {
                  text: remainingHours.toFixed(2),
                  alignment: 'right',
                  bold: true
                }
              ]

            ]

          },

          layout: 'lightHorizontalLines',

          margin: [0, 0, 0, 15]

        },

        {
          text: 'Only complete, synchronized, verified attendance records with valid rendered hours are included in the official verified total. Pending, incomplete, and rejected records are not counted toward completed OJT hours.',
          fontSize: 9,
          color: '#64748b',
          margin: [0, 0, 0, 25]
        },

        {
          columns: [

            {
              stack: [

                {
                  text: '____________________________',
                  alignment: 'center'
                },

                {
                  text: 'Student Intern',
                  alignment: 'center',
                  margin: [0, 5, 0, 0]
                }

              ]

            },

            {
              stack: [

                {
                  text: '____________________________',
                  alignment: 'center'
                },

                {
                  text: 'Authorized Reviewer',
                  alignment: 'center',
                  margin: [0, 5, 0, 0]
                }

              ]

            }

          ],

          margin: [0, 20, 0, 0]

        }

      ],

      styles: {

        tableHeader: {

          bold: true,

          fontSize: 10,

          alignment: 'center',

          color: '#172033'

        }

      },

      footer: (
        currentPage: number,
        pageCount: number
      ) => ({

        columns: [

          {
            text: 'Generated by InternTrack',
            fontSize: 8,
            color: '#64748b'
          },

          {
            text: `Page ${currentPage} of ${pageCount}`,
            alignment: 'right',
            fontSize: 8,
            color: '#64748b'
          }

        ],

        margin: [40, 10, 40, 0]

      })

    };

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
