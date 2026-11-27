
import {
  Component,
  inject,
  OnInit,
  ChangeDetectorRef,
  NgZone
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';

import {
  searchOutline,
  chevronDownOutline,
  chevronBackOutline,
  chevronForwardOutline,
  refreshOutline,
  peopleOutline,
  addOutline,
  closeOutline,
  eyeOutline,
  eyeOffOutline,
  checkmarkCircleOutline,
  alertCircleOutline,
  informationCircleOutline,
  personAddOutline
} from 'ionicons/icons';

import { SupabaseService } from '../../../services/supabase.service';

// =========================================
// INTERFACES AND TYPES
// =========================================

type InternshipStatus =
  | 'ongoing'
  | 'unassigned'
  | 'needs_follow_up'
  | 'hours_completed'
  | 'inactive'
  | 'not_started';

interface StudentIntern {
  id: string;
  studentId: string;
  fullName: string;
  email: string;
  course: string;
  yearLevel: string;
  companyName: string;
  requiredHours: number;
  verifiedHours: number;
  progress: number;
  status: InternshipStatus;
  initials: string;
  avatarColor: string;
  hasAssignment: boolean;
}

interface StudentRegistrationForm {
  studentId: string;
  fullName: string;
  email: string;
  course: string;
  yearLevel: string;
  schoolName: string;
  requiredHours: number;
  temporaryPassword: string;
}

interface StudentRegistrationResponse {
  success: boolean;
  message: string;
  confirmationRequired?: boolean;
  confirmationEmailSent?: boolean | null;

  student?: {
    id: string;
    student_id: string;
    full_name: string;
    email: string;
    account_status: string;
  };
}

// =========================================
// COMPONENT
// =========================================

@Component({
  selector: 'app-student-interns',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonIcon
  ],
  templateUrl: './student-interns.page.html',
  styleUrls: ['./student-interns.page.scss']
})

export class StudentInternsPage implements OnInit {

  // =========================================
  // SERVICES
  // =========================================

  private readonly supabaseService =
    inject(SupabaseService);

  private readonly supabase =
    this.supabaseService.getClient();

  private readonly router =
    inject(Router);

  private readonly cdr =
    inject(ChangeDetectorRef);

  private readonly ngZone =
    inject(NgZone);

  // =========================================
  // PAGE STATE
  // =========================================

  isLoading = true;

  private loadingInProgress = false;

  errorMessage = '';

  successMessage = '';

  students: StudentIntern[] = [];

  searchTerm = '';

  selectedCourse = 'all';

  selectedCompany = 'all';

  selectedStatus = 'all';

  currentPage = 1;

  readonly pageSize = 8;

  // =========================================
  // STUDENT REGISTRATION STATE
  // =========================================

  showAddStudentModal = false;

  isCreatingStudent = false;

  showTemporaryPassword = false;

  registrationError = '';

  registrationForm: StudentRegistrationForm =
    this.createEmptyRegistrationForm();

  // =========================================
  // REGISTRATION OPTIONS
  // =========================================

  readonly courseOptions = [
    'BSIT',
    'BSCS',
    'BSIS',
    'BSCpE',
    'Other'
  ];

  readonly yearLevelOptions = [
    '1st Year',
    '2nd Year',
    '3rd Year',
    '4th Year',
    '5th Year'
  ];

  // =========================================
  // CONSTRUCTOR
  // =========================================

  constructor() {

    addIcons({
      searchOutline,
      chevronDownOutline,
      chevronBackOutline,
      chevronForwardOutline,
      refreshOutline,
      peopleOutline,
      addOutline,
      closeOutline,
      eyeOutline,
      eyeOffOutline,
      checkmarkCircleOutline,
      alertCircleOutline,
      informationCircleOutline,
      personAddOutline
    });

  }

  // =========================================
  // INITIALIZATION
  // =========================================

  ngOnInit(): void {

    void this.loadStudents();

  }

  // =========================================
  // CREATE EMPTY REGISTRATION FORM
  // =========================================

  private createEmptyRegistrationForm():
    StudentRegistrationForm {

    return {
      studentId: '',
      fullName: '',
      email: '',
      course: 'BSIT',
      yearLevel: '4th Year',
      schoolName:
        'Pamantasan ng Lungsod ng Valenzuela',
      requiredHours: 486,
      temporaryPassword: ''
    };

  }

  // =========================================
  // OPEN STUDENT REGISTRATION MODAL
  // =========================================

  openAddStudentModal(): void {

    if (
      this.isCreatingStudent ||
      this.isLoading
    ) {
      return;
    }

    this.registrationForm =
      this.createEmptyRegistrationForm();

    this.registrationError = '';

    this.successMessage = '';

    this.showTemporaryPassword = false;

    this.showAddStudentModal = true;

    this.cdr.markForCheck();

  }

  // =========================================
  // CLOSE STUDENT REGISTRATION MODAL
  // =========================================

  closeAddStudentModal(): void {

    if (this.isCreatingStudent) {
      return;
    }

    this.showAddStudentModal = false;

    this.registrationError = '';

    this.showTemporaryPassword = false;

    this.registrationForm =
      this.createEmptyRegistrationForm();

    this.cdr.markForCheck();

  }

  // =========================================
  // PASSWORD VISIBILITY
  // =========================================

  toggleTemporaryPassword(): void {

    this.showTemporaryPassword =
      !this.showTemporaryPassword;

  }

  // =========================================
  // CLEAR REGISTRATION ERROR
  // =========================================

  clearRegistrationError(): void {

    if (this.registrationError) {
      this.registrationError = '';
    }

  }

  // =========================================
  // DISMISS SUCCESS MESSAGE
  // =========================================

  dismissSuccessMessage(): void {

    this.successMessage = '';

  }

  // =========================================
  // NORMALIZE REGISTRATION FORM
  // =========================================

  private normalizeRegistrationForm():
    StudentRegistrationForm {

    const form = this.registrationForm;

    return {
      studentId:
        String(form.studentId ?? '').trim(),

      fullName:
        String(form.fullName ?? '').trim(),

      email:
        String(form.email ?? '')
          .trim()
          .toLowerCase(),

      course:
        String(form.course ?? '').trim(),

      yearLevel:
        String(form.yearLevel ?? '').trim(),

      schoolName:
        String(form.schoolName ?? '').trim(),

      requiredHours:
        Number(form.requiredHours),

      temporaryPassword:
        String(form.temporaryPassword ?? '')
    };

  }

  // =========================================
  // REGISTRATION VALIDATION
  // =========================================

  private validateRegistrationForm(
    form: StudentRegistrationForm
  ): string | null {

    // Student ID

    if (!form.studentId) {
      return 'Student ID is required.';
    }

    const studentIdPattern =
      /^[A-Za-z0-9-]{1,30}$/;

    if (!studentIdPattern.test(form.studentId)) {
      return 'Please enter a valid Student ID.';
    }

    // Full name

    if (!form.fullName) {
      return 'Full name is required.';
    }

    if (form.fullName.length > 150) {
      return 'Full name must not exceed 150 characters.';
    }

    // Email address

    if (!form.email) {
      return 'Email address is required.';
    }

    const emailPattern =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (
      !emailPattern.test(form.email) ||
      form.email.length > 254
    ) {
      return 'Please enter a valid email address.';
    }

    // Course

    if (!form.course) {
      return 'Course is required.';
    }

    if (form.course.length > 150) {
      return 'Course must not exceed 150 characters.';
    }

    // Year level

    if (!form.yearLevel) {
      return 'Year level is required.';
    }

    if (form.yearLevel.length > 30) {
      return 'Year level must not exceed 30 characters.';
    }

    // School name

    if (!form.schoolName) {
      return 'School name is required.';
    }

    if (form.schoolName.length > 200) {
      return 'School name must not exceed 200 characters.';
    }

    // Required internship hours

    if (
      !Number.isInteger(form.requiredHours) ||
      form.requiredHours <= 0 ||
      form.requiredHours > 10000
    ) {
      return 'Please enter valid required internship hours.';
    }

    // Temporary password

    if (!form.temporaryPassword.trim()) {
      return 'Temporary password is required.';
    }

    if (form.temporaryPassword.length < 8) {
      return 'Temporary password must contain at least 8 characters.';
    }

    const passwordBytes =
      new TextEncoder()
        .encode(form.temporaryPassword)
        .length;

    if (passwordBytes > 72) {
      return 'Temporary password must not exceed 72 bytes.';
    }

    // Local duplicate Student ID checking

    const duplicateStudentId =
      this.students.some(student =>
        student.studentId === form.studentId
      );

    if (duplicateStudentId) {
      return 'This Student ID is already registered.';
    }

    // Local duplicate email checking

    const duplicateEmail =
      this.students.some(student =>
        student.email.trim().toLowerCase() ===
        form.email
      );

    if (duplicateEmail) {
      return 'This email address is already registered.';
    }

    return null;

  }

  // =========================================
  // REGISTRATION FORM VALIDITY
  // =========================================

  get canCreateStudent(): boolean {

    if (
      this.isCreatingStudent ||
      this.isLoading
    ) {
      return false;
    }

    const form =
      this.normalizeRegistrationForm();

    return (
      this.validateRegistrationForm(form) === null
    );

  }

  // =========================================
  // EXTRACT EDGE FUNCTION ERROR
  // =========================================

  private async getRegistrationErrorMessage(
    error: unknown
  ): Promise<string> {

    const fallback =
      'Unable to create student intern. Please try again.';

    if (
      !error ||
      typeof error !== 'object'
    ) {
      return fallback;
    }

    const functionError = error as {
      message?: string;
      context?: unknown;
    };

    const context = functionError.context;

    if (context instanceof Response) {

      try {

        const response =
          await context.clone().json();

        if (
          typeof response?.message === 'string' &&
          response.message.trim()
        ) {
          return response.message;
        }

        if (
          typeof response?.error === 'string' &&
          response.error.trim()
        ) {
          return response.error;
        }

      } catch {

        // Response may not contain valid JSON.

      }

      if (context.status === 401) {
        return 'Your session has expired. Please log in again.';
      }

      if (context.status === 403) {
        return 'You are not authorized to register student interns.';
      }

      if (context.status === 409) {
        return 'Student ID or email address already exists.';
      }

      if (context.status === 429) {
        return 'Too many requests. Please try again later.';
      }

    }

    return fallback;

  }

  // =========================================
  // CREATE STUDENT INTERN ACCOUNT
  // =========================================

  async createStudentIntern(): Promise<void> {

    if (
      this.isCreatingStudent ||
      this.isLoading ||
      !this.showAddStudentModal
    ) {
      return;
    }

    this.registrationError = '';

    this.successMessage = '';

    const form =
      this.normalizeRegistrationForm();

    const validationError =
      this.validateRegistrationForm(form);

    if (validationError) {

      this.registrationError =
        validationError;

      this.cdr.markForCheck();

      return;

    }

    this.isCreatingStudent = true;

    this.cdr.markForCheck();

    let accountCreated = false;

    try {

      // =====================================
      // VERIFY CURRENT SESSION
      // =====================================

      const {
        data: sessionData,
        error: sessionError
      } = await this.supabase.auth.getSession();

      if (
        sessionError ||
        !sessionData.session?.access_token
      ) {

        this.registrationError =
          'Your session has expired. Please log in again.';

        return;

      }

      // =====================================
      // INVOKE STUDENT REGISTRATION FUNCTION
      // =====================================

      const {
        data,
        error
      } = await this.supabase.functions.invoke(
        'create-student-intern',
        {
          body: {
            studentId: form.studentId,
            fullName: form.fullName,
            email: form.email,
            course: form.course,
            yearLevel: form.yearLevel,
            schoolName: form.schoolName,
            requiredHours: form.requiredHours,
            temporaryPassword:
              form.temporaryPassword
          },

          headers: {
            Authorization:
              `Bearer ${sessionData.session.access_token}`
          }
        }
      );

      // =====================================
      // HANDLE EDGE FUNCTION ERROR
      // =====================================

      if (error) {

        this.registrationError =
          await this.getRegistrationErrorMessage(
            error
          );

        return;

      }

      const result =
        data as StudentRegistrationResponse | null;

      if (
        !result ||
        result.success !== true
      ) {

        this.registrationError =
          result?.message ||
          'Student registration could not be confirmed. Check existing accounts before retrying.';

        return;

      }

      accountCreated = true;

      // =====================================
      // HANDLE SUCCESSFUL REGISTRATION
      // =====================================

      const registeredName =
        result.student?.full_name ||
        form.fullName;

      if (
        result.confirmationRequired === true &&
        result.confirmationEmailSent === false
      ) {

        this.successMessage =
          `${registeredName} was registered successfully, but the confirmation email could not be sent.`;

      } else if (
        result.confirmationRequired === true
      ) {

        this.successMessage =
          `${registeredName} was registered successfully. Email confirmation is required before login.`;

      } else {

        this.successMessage =
          `${registeredName} was registered successfully.`;

      }

      // Close registration modal.

      this.showAddStudentModal = false;

      this.showTemporaryPassword = false;

      this.registrationError = '';

      // Remove temporary password from form.

      this.registrationForm =
        this.createEmptyRegistrationForm();

      // Reset filters to display new students.

      this.resetFilters();

      // Refresh registered student list.

      await this.loadStudents();

      if (this.errorMessage) {

        this.successMessage +=
          ' The account was created, but the student list could not be refreshed.';

      }

    } catch {

      if (accountCreated) {

        this.successMessage =
          'Student account was created, but the page could not be refreshed.';

        this.showAddStudentModal = false;

        this.registrationForm =
          this.createEmptyRegistrationForm();

      } else {

        this.registrationError =
          'Registration could not be confirmed. Check existing accounts before retrying.';

      }

    } finally {

      this.ngZone.run(() => {

        this.isCreatingStudent = false;

        this.cdr.detectChanges();

      });

    }

  }

  // =========================================
  // LOAD SUPABASE DATA
  // =========================================

  async loadStudents(): Promise<void> {

    if (this.loadingInProgress) {
      return;
    }

    this.loadingInProgress = true;

    this.isLoading = true;

    this.errorMessage = '';

    this.cdr.markForCheck();

    try {

      // Retrieve registered student interns.

      const {
        data: students,
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
          required_hours,
          ojt_start_date,
          ojt_end_date,
          account_status
        `)

        .order('full_name', {
          ascending: true
        });

      if (studentError) {
        throw studentError;
      }

      const studentRows =
        students ?? [];

      if (!studentRows.length) {

        this.students = [];

        this.currentPage = 1;

        return;

      }

      // Student database UUIDs.

      const studentIds =
        studentRows.map(
          student => student.id
        );

      // Student school IDs.

      const schoolIds =
        studentRows.map(
          student => student.student_id
        );

      // Retrieve active assignments
      // and verified attendance.

      const [
        assignmentResult,
        attendanceResult
      ] = await Promise.all([

        this.supabase

          .from('intern_supervisor_assignments')

          .select(`
            id,
            student_id,
            supervisor_id,
            company_name,
            assigned_date,
            assignment_status
          `)

          .in('student_id', studentIds)

          .eq('assignment_status', 'active')

          .order('assigned_date', {
            ascending: false
          }),

        this.supabase

          .from('attendance')

          .select(`
            student_id,
            total_hours_rendered
          `)

          .in('student_id', schoolIds)

          .eq('verification_status', 'verified')

          .eq('sync_status', 'synced')

          .not('time_in', 'is', null)

          .not('time_out', 'is', null)

      ]);

      if (assignmentResult.error) {
        throw assignmentResult.error;
      }

      if (attendanceResult.error) {
        throw attendanceResult.error;
      }

      // =====================================
      // MAP ACTIVE COMPANY ASSIGNMENTS
      // =====================================

      const assignmentMap =
        new Map<string, string>();

      for (
        const assignment of
        assignmentResult.data ?? []
      ) {

        if (
          !assignmentMap.has(
            assignment.student_id
          )
        ) {

          assignmentMap.set(
            assignment.student_id,
            assignment.company_name
          );

        }

      }

      // =====================================
      // CALCULATE VERIFIED INTERNSHIP HOURS
      // =====================================

      const hoursMap =
        new Map<string, number>();

      for (
        const record of
        attendanceResult.data ?? []
      ) {

        const hours =
          Number(
            record.total_hours_rendered ?? 0
          );

        if (
          !Number.isFinite(hours) ||
          hours < 0
        ) {
          continue;
        }

        const existingHours =
          hoursMap.get(record.student_id) ?? 0;

        hoursMap.set(
          record.student_id,
          existingHours + hours
        );

      }

      // =====================================
      // PREPARE STUDENT RECORDS
      // =====================================

      this.students =
        studentRows.map((student, index) => {

          const requiredHours =
            Math.max(
              0,
              Number(student.required_hours) || 0
            );

          const verifiedHours =
            hoursMap.get(student.student_id) ?? 0;

          // Prevent displaying 100% before the
          // required internship hours are completed.

          const progress =
            requiredHours > 0

              ? Math.min(
                  100,
                  Math.floor(
                    (
                      verifiedHours /
                      requiredHours
                    ) * 100
                  )
                )

              : 0;

          const hasAssignment =
            assignmentMap.has(student.id);

          const companyName =
            assignmentMap.get(student.id) ||

            (
              hasAssignment
                ? 'Company not specified'
                : 'Unassigned'
            );

          const status =
            this.calculateStatus(
              student.account_status,
              hasAssignment,
              verifiedHours,
              requiredHours,
              student.ojt_start_date,
              student.ojt_end_date
            );

          return {

            id: student.id,

            studentId: student.student_id,

            fullName: student.full_name,

            email: student.email || '',

            course:
              student.course || 'Not specified',

            yearLevel:
              student.year_level
                ? String(student.year_level)
                : '',

            companyName,

            requiredHours,

            verifiedHours,

            progress,

            status,

            initials:
              this.getInitials(
                student.full_name
              ),

            avatarColor:
              this.getAvatarColor(index),

            hasAssignment

          };

        });

      this.currentPage = 1;

    } catch (error) {

      console.error(
        'Unable to load student interns:',
        error
      );

      this.students = [];

      this.errorMessage =
        'Unable to load student records. Please try again.';

    } finally {

      // Ensure Angular updates the page after
      // asynchronous Supabase requests are completed.

      this.ngZone.run(() => {

        this.loadingInProgress = false;

        this.isLoading = false;

        this.cdr.detectChanges();

      });

    }

  }

  // =========================================
  // INTERNSHIP STATUS CALCULATION
  // =========================================

  private calculateStatus(
    accountStatus: string | null,
    hasAssignment: boolean,
    verifiedHours: number,
    requiredHours: number,
    startDate: string | null,
    endDate: string | null
  ): InternshipStatus {

    // Inactive student account.

    if (accountStatus !== 'active') {

      return 'inactive';

    }

    // Student has no active supervisor assignment.

    if (!hasAssignment) {

      return 'unassigned';

    }

    // Student has completed the required hours.

    if (
      requiredHours > 0 &&
      verifiedHours >= requiredHours
    ) {

      return 'hours_completed';

    }

    // Internship schedule is not yet configured.

    if (
      !startDate ||
      !endDate ||
      requiredHours <= 0
    ) {

      return 'ongoing';

    }

    const start =
      new Date(
        `${startDate}T00:00:00`
      ).getTime();

    const end =
      new Date(
        `${endDate}T23:59:59`
      ).getTime();

    const today =
      Date.now();

    // Validate internship schedule.

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start
    ) {

      return 'ongoing';

    }

    // Internship has not started.

    if (today < start) {

      return 'not_started';

    }

    // Internship deadline has passed,
    // but required hours remain incomplete.

    if (today > end) {

      return 'needs_follow_up';

    }

    // Student is currently undergoing internship.

    return 'ongoing';

  }

  // =========================================
  // STATUS DISPLAY LABELS
  // =========================================

  getStatusLabel(
    status: InternshipStatus
  ): string {

    const labels:
      Record<InternshipStatus, string> = {

        ongoing: 'Ongoing',

        unassigned: 'Unassigned',

        needs_follow_up: 'Needs follow-up',

        hours_completed: 'Hours completed',

        inactive: 'Inactive',

        not_started: 'Not started'

      };

    return labels[status];

  }

  // =========================================
  // SUMMARY COUNTS
  // =========================================

  get totalStudents(): number {

    return this.students.length;

  }

  get activePlacements(): number {

    return this.students.filter(student =>

      student.hasAssignment &&

      student.status !== 'inactive' &&

      student.status !== 'hours_completed' &&

      student.status !== 'not_started'

    ).length;

  }

  get awaitingAssignments(): number {

    return this.students.filter(student =>

      student.status === 'unassigned'

    ).length;

  }

  // =========================================
  // FILTER OPTIONS
  // =========================================

  get courses(): string[] {

    return [

      ...new Set(

        this.students.map(
          student => student.course
        )

      )

    ].sort();

  }

  get companies(): string[] {

    return [

      ...new Set(

        this.students

          .filter(
            student => student.hasAssignment
          )

          .map(
            student => student.companyName
          )

      )

    ].sort();

  }

  // =========================================
  // SEARCH AND FILTERING
  // =========================================

  get filteredStudents(): StudentIntern[] {

    const search =
      this.searchTerm
        .trim()
        .toLowerCase();

    return this.students.filter(student => {

      const matchesSearch =

        !search ||

        String(student.fullName ?? '')
          .toLowerCase()
          .includes(search) ||

        String(student.studentId ?? '')
          .toLowerCase()
          .includes(search);

      const matchesCourse =

        this.selectedCourse === 'all' ||

        student.course === this.selectedCourse;

      const matchesCompany =

        this.selectedCompany === 'all' ||

        student.companyName ===
          this.selectedCompany;

      const matchesStatus =

        this.selectedStatus === 'all' ||

        student.status === this.selectedStatus;

      return (

        matchesSearch &&

        matchesCourse &&

        matchesCompany &&

        matchesStatus

      );

    });

  }

  onFilterChange(): void {

    this.currentPage = 1;

  }

  resetFilters(): void {

    this.searchTerm = '';

    this.selectedCourse = 'all';

    this.selectedCompany = 'all';

    this.selectedStatus = 'all';

    this.currentPage = 1;

  }

  // =========================================
  // PAGINATION
  // =========================================

  get totalPages(): number {

    return Math.max(

      1,

      Math.ceil(

        this.filteredStudents.length /
        this.pageSize

      )

    );

  }

  get paginatedStudents(): StudentIntern[] {

    const start =

      (this.currentPage - 1) *
      this.pageSize;

    return this.filteredStudents.slice(

      start,

      start + this.pageSize

    );

  }

  get pageNumbers(): number[] {

    const first = Math.max(

      1,

      Math.min(

        this.currentPage - 2,

        this.totalPages - 4

      )

    );

    const last = Math.min(

      this.totalPages,

      first + 4

    );

    return Array.from(

      {
        length: last - first + 1
      },

      (_, index) => first + index

    );

  }

  get showingFrom(): number {

    return this.filteredStudents.length

      ? (
          this.currentPage - 1
        ) * this.pageSize + 1

      : 0;

  }

  get showingTo(): number {

    return Math.min(

      this.currentPage * this.pageSize,

      this.filteredStudents.length

    );

  }

  goToPage(page: number): void {

    if (

      page < 1 ||

      page > this.totalPages

    ) {

      return;

    }

    this.currentPage = page;

  }

  // =========================================
  // STUDENT PROFILE NAVIGATION
  // =========================================

  viewStudent(
    student: StudentIntern
  ): void {

    void this.router.navigate([

      '/coordinator/student-interns',

      student.id

    ]);

  }

  // =========================================
  // DISPLAY HELPERS
  // =========================================

  private getInitials(
    name: string
  ): string {

    const parts =

      (name || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    return parts

      .slice(0, 2)

      .map(
        part =>
          part.charAt(0).toUpperCase()
      )

      .join('') || 'ST';

  }

  private getAvatarColor(
    index: number
  ): string {

    const colors = [

      'rose',

      'sky',

      'blue',

      'orange',

      'green',

      'violet'

    ];

    return colors[index % colors.length];

  }

  trackStudent(
    index: number,
    student: StudentIntern
  ): string {

    return student.id;

  }

}
