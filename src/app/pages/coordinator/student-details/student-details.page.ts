
import {
  Component,
  OnInit,
  inject,
  ChangeDetectorRef,
  NgZone
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';

import {
  arrowBackOutline,
  arrowForwardOutline,
  mailOutline,
  shieldCheckmarkOutline,
  businessOutline,
  createOutline,
  downloadOutline,
  chevronForwardOutline,
  powerOutline,
  refreshOutline,
  documentTextOutline,
  personOutline,
  closeOutline,
  checkmarkCircleOutline,
  informationCircleOutline,
  alertCircleOutline
} from 'ionicons/icons';

import { SupabaseService } from '../../../services/supabase.service';

import {
  createDtrTemplate,
  type DtrTemplateRecord
} from '../../../utils/dtr-template';

import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';

(pdfMake as any).vfs =
  (pdfFonts as any).pdfMake?.vfs ??
  (pdfFonts as any).vfs ??
  pdfFonts;

// =========================================
// INTERFACES
// =========================================

type DetailsTab =
  | 'overview'
  | 'attendance'
  | 'reports'
  | 'assignments';

type InternshipStatus =
  | 'ongoing'
  | 'unassigned'
  | 'needs_follow_up'
  | 'hours_completed'
  | 'inactive'
  | 'not_started';

interface StudentDetails {
  id: string;
  student_id: string;
  full_name: string;
  email: string | null;
  course: string | null;
  year_level: string | null;
  school_name: string | null;
  company_name: string | null;
  company_location: string | null;
  department: string | null;
  required_hours: number;
  ojt_start_date: string | null;
  ojt_end_date: string | null;
  account_status: string;
}

interface SupervisorDetails {
  id: string;
  full_name: string;
  email: string;
  company_name: string;
  department: string | null;
  position: string | null;
  contact_number: string | null;
}

interface AssignmentHistoryEntry {
  action?: string;
  previous_assignment_id?: string;
  previous_company?: string;
  previous_supervisor_id?: string;
  previous_start_date?: string | null;
  previous_end_date?: string | null;
  new_company?: string;
  new_supervisor_id?: string;
  reason?: string;
  changed_at?: string;
  changed_by?: string;
}

interface InternshipAssignment {
  id: string;
  student_id: string;
  supervisor_id: string;
  company_name: string;
  assigned_date: string;
  assignment_status: string;
  assignment_history?: AssignmentHistoryEntry[] | null;
  supervisor?: SupervisorDetails | null;
}

interface AttendanceRecord {
  id: string;
  student_id: string;
  attendance_date: string;
  time_in: string | null;
  time_out: string | null;
  total_hours_rendered: number | null;
  verification_status: string;
  sync_status: string;
  remarks: string | null;
}

interface WeeklyReport {
  id: number;
  student_id: string;
  week: number;
  period: string;
  status: string;
  accomplishments: string | null;
  feedback: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
}

interface AcademicForm {
  course: string;
  yearLevel: string;
  requiredHours: number | null;
  startDate: string;
  endDate: string;
}

interface AssignmentForm {
  companyName: string;
  supervisorId: string;
  startDate: string;
  endDate: string;
  reason: string;
}

interface RpcResult {
  success: boolean;
  message?: string;
  student_id?: string;
  assignment_id?: string;
  company_name?: string;
  supervisor_name?: string;
}

// =========================================
// COMPONENT
// =========================================

@Component({
  selector: 'app-student-details',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonIcon
  ],
  templateUrl: './student-details.page.html',
  styleUrls: ['./student-details.page.scss']
})

export class StudentDetailsPage implements OnInit {

  // =========================================
  // SERVICES
  // =========================================

  private readonly supabaseService =
    inject(SupabaseService);

  private readonly supabase =
    this.supabaseService.getClient();

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly cdr = inject(ChangeDetectorRef);
  private readonly ngZone = inject(NgZone);

  // =========================================
  // PAGE STATE
  // =========================================

  student: StudentDetails | null = null;

  assignments: InternshipAssignment[] = [];

  currentAssignment: InternshipAssignment | null = null;

  attendanceRecords: AttendanceRecord[] = [];

  weeklyReports: WeeklyReport[] = [];

  activeTab: DetailsTab = 'overview';

  isLoading = true;

  downloadingDTR = false;

  errorMessage = '';

  downloadError = '';

  downloadMessage = '';

  managementMessage = '';

  private loadingInProgress = false;

  private studentUuid = '';

  // =========================================
  // MANAGEMENT PERMISSIONS
  // =========================================

  readonly canEditAcademicInfo = true;

  get canReassignIntern(): boolean {
    return this.student?.account_status === 'active';
  }

  readonly canDeactivateAccount = false;

  // =========================================
  // MODAL STATE
  // =========================================

  showAcademicModal = false;

  showAssignmentModal = false;

  showReviewModal = false;

  savingAcademicInfo = false;

  savingAssignment = false;

  loadingSupervisors = false;

  academicError = '';

  assignmentError = '';

  availableSupervisors: SupervisorDetails[] = [];

  private reviewedAssignment: AssignmentForm | null = null;

  private assignmentRequestVersion = 0;

  // =========================================
  // ACADEMIC FORM
  // =========================================

  academicForm: AcademicForm = {
    course: '',
    yearLevel: '',
    requiredHours: null,
    startDate: '',
    endDate: ''
  };

  availableCourses: string[] = [];

  readonly defaultYearLevels = [
    '1st Year',
    '2nd Year',
    '3rd Year',
    '4th Year',
    '5th Year'
  ];

  get yearLevelOptions(): string[] {

    const values = [
      ...this.defaultYearLevels,
      this.student?.year_level || '',
      this.academicForm.yearLevel
    ];

    return [...new Set(values.filter(Boolean))];

  }

  // =========================================
  // ASSIGNMENT FORM
  // =========================================

  assignmentForm: AssignmentForm = {
    companyName: '',
    supervisorId: '',
    startDate: '',
    endDate: '',
    reason: ''
  };

  get availableCompanies(): string[] {

    return [
      ...new Set(
        this.availableSupervisors
          .map(supervisor => supervisor.company_name)
          .filter(Boolean)
      )
    ].sort((a, b) => a.localeCompare(b));

  }

  get filteredSupervisors(): SupervisorDetails[] {

    if (!this.assignmentForm.companyName) {
      return [];
    }

    return this.availableSupervisors.filter(
      supervisor =>
        supervisor.company_name ===
        this.assignmentForm.companyName
    );

  }

  get selectedSupervisor(): SupervisorDetails | null {

    return this.filteredSupervisors.find(
      supervisor =>
        supervisor.id === this.assignmentForm.supervisorId
    ) ?? null;

  }

  get selectedSupervisorName(): string {

    return this.selectedSupervisor?.full_name ||
      'Not selected';

  }

  get assignmentModalTitle(): string {

    return this.currentAssignment
      ? 'Change internship assignment'
      : 'Assign student intern';

  }

  get assignmentButtonLabel(): string {

    return this.currentAssignment
      ? 'Reassign intern'
      : 'Assign intern';

  }

  get hasOpenModal(): boolean {

    return this.showAcademicModal ||
      this.showAssignmentModal ||
      this.showReviewModal;

  }

  // =========================================
  // TABS
  // =========================================

  readonly tabs: {
    id: DetailsTab;
    label: string;
  }[] = [
    {
      id: 'overview',
      label: 'Overview'
    },
    {
      id: 'attendance',
      label: 'Attendance History'
    },
    {
      id: 'reports',
      label: 'Weekly Reports'
    },
    {
      id: 'assignments',
      label: 'Assignment History'
    }
  ];

  // =========================================
  // PAGINATION
  // =========================================

  readonly attendancePageSize = 10;

  attendancePage = 1;

  // =========================================
  // CONSTRUCTOR
  // =========================================

  constructor() {

    addIcons({
      arrowBackOutline,
      arrowForwardOutline,
      mailOutline,
      shieldCheckmarkOutline,
      businessOutline,
      createOutline,
      downloadOutline,
      chevronForwardOutline,
      powerOutline,
      refreshOutline,
      documentTextOutline,
      personOutline,
      closeOutline,
      checkmarkCircleOutline,
      informationCircleOutline,
      alertCircleOutline
    });

  }

  // =========================================
  // INITIALIZATION
  // =========================================

  ngOnInit(): void {

    this.studentUuid =
      this.route.snapshot.paramMap.get('studentId') || '';

    if (!this.studentUuid) {

      this.isLoading = false;

      this.errorMessage =
        'No student record was selected.';

      return;

    }

    void this.loadStudentDetails();

  }

  // =========================================
  // LOAD STUDENT DETAILS
  // =========================================

  async loadStudentDetails(): Promise<void> {

    if (this.loadingInProgress) {
      return;
    }

    this.loadingInProgress = true;
    this.isLoading = true;
    this.errorMessage = '';

    this.cdr.markForCheck();

    try {

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
          company_location,
          department,
          required_hours,
          ojt_start_date,
          ojt_end_date,
          account_status
        `)
        .eq('id', this.studentUuid)
        .maybeSingle();

      if (studentError) {
        throw studentError;
      }

      if (!studentData) {

        throw new Error(
          'Student record was not found or is inaccessible.'
        );

      }

      const student = studentData as StudentDetails;

      const [
        assignmentResult,
        attendance,
        reportsResult
      ] = await Promise.all([

        this.supabase
          .from('intern_supervisor_assignments')
          .select(`
            id,
            student_id,
            supervisor_id,
            company_name,
            assigned_date,
            assignment_status,
            assignment_history
          `)
          .eq('student_id', student.id)
          .order('assigned_date', {
            ascending: false
          }),

        this.fetchAttendanceRecords(
          student.student_id
        ),

        this.supabase
          .from('reports')
          .select(`
            id,
            student_id,
            week,
            period,
            status,
            accomplishments,
            feedback,
            submitted_at,
            reviewed_at
          `)
          .eq('student_id', student.student_id)
          .order('week', {
            ascending: false
          })

      ]);

      if (assignmentResult.error) {
        throw assignmentResult.error;
      }

      if (reportsResult.error) {
        throw reportsResult.error;
      }

      const assignments =
        (assignmentResult.data ?? []) as InternshipAssignment[];

      const supervisorIds = [
        ...new Set(
          assignments
            .map(item => item.supervisor_id)
            .filter(Boolean)
        )
      ];

      const supervisorMap =
        new Map<string, SupervisorDetails>();

      if (supervisorIds.length > 0) {

        const {
          data: supervisors,
          error: supervisorError
        } = await this.supabase
          .from('company_supervisors')
          .select(`
            id,
            full_name,
            email,
            company_name,
            department,
            position,
            contact_number
          `)
          .in('id', supervisorIds);

        if (supervisorError) {
          throw supervisorError;
        }

        for (const supervisor of supervisors ?? []) {

          supervisorMap.set(
            supervisor.id,
            supervisor as SupervisorDetails
          );

        }

      }

      const mappedAssignments = assignments.map(
        assignment => ({
          ...assignment,
          supervisor:
            supervisorMap.get(
              assignment.supervisor_id
            ) ?? null
        })
      );

      this.ngZone.run(() => {

        this.student = student;

        this.assignments = mappedAssignments;

        this.currentAssignment =
          mappedAssignments.find(
            assignment =>
              assignment.assignment_status === 'active'
          ) ?? null;

        this.attendanceRecords = attendance;

        this.weeklyReports =
          (reportsResult.data ?? []) as WeeklyReport[];

        this.attendancePage = 1;

      });

    } catch (error) {

      console.error(
        'Unable to load student details:',
        error
      );

      this.student = null;

      this.errorMessage =
        'Unable to load student details. Please try again.';

    } finally {

      this.ngZone.run(() => {

        this.loadingInProgress = false;

        this.isLoading = false;

        this.cdr.detectChanges();

      });

    }

  }

  // =========================================
  // EDIT ACADEMIC INFORMATION
  // =========================================

  async openAcademicModal(): Promise<void> {

    if (
      !this.student ||
      this.isLoading ||
      this.hasOpenModal ||
      this.savingAcademicInfo
    ) {
      return;
    }

    this.academicError = '';
    this.managementMessage = '';

    this.academicForm = {
      course: this.student.course || '',
      yearLevel: this.student.year_level || '',
      requiredHours: this.student.required_hours,
      startDate: this.student.ojt_start_date || '',
      endDate: this.student.ojt_end_date || ''
    };

    this.availableCourses = [
      ...new Set(
        [
          'BSIT',
          this.student.course || ''
        ].filter(Boolean)
      )
    ];

    this.showAcademicModal = true;

    this.cdr.markForCheck();

    try {

      const { data, error } = await this.supabase
        .from('students')
        .select('course')
        .not('course', 'is', null)
        .order('course', {
          ascending: true
        });

      if (error) {
        throw error;
      }

      const courses = (data ?? [])
        .map(item => String(item.course || '').trim())
        .filter(Boolean);

      this.availableCourses = [
        ...new Set([
          ...this.availableCourses,
          ...courses
        ])
      ].sort((a, b) => a.localeCompare(b));

    } catch (error) {

      console.error(
        'Unable to retrieve course options:',
        error
      );

      // Retain the student's current course.

    } finally {

      this.refreshView();

    }

  }

  closeAcademicModal(): void {

    if (this.savingAcademicInfo) {
      return;
    }

    this.showAcademicModal = false;
    this.academicError = '';

  }

  private validateAcademicForm(): string {

    const form = this.academicForm;

    if (!form.course.trim()) {
      return 'Please select a course.';
    }

    if (!form.yearLevel.trim()) {
      return 'Please select a year level.';
    }

    const requiredHours = Number(form.requiredHours);

    if (
      !Number.isInteger(requiredHours) ||
      requiredHours <= 0 ||
      requiredHours > 2147483647
    ) {

      return 'Required hours must be a valid positive whole number.';

    }

    if (
      !form.startDate ||
      !this.isValidDate(form.startDate)
    ) {

      return 'Please enter a valid internship start date.';

    }

    if (
      form.endDate &&
      !this.isValidDate(form.endDate)
    ) {

      return 'Please enter a valid internship end date.';

    }

    if (
      form.endDate &&
      form.endDate < form.startDate
    ) {

      return 'The end date cannot be earlier than the start date.';

    }

    return '';

  }

  async saveAcademicInfo(): Promise<void> {

    if (
      !this.student ||
      !this.showAcademicModal ||
      this.savingAcademicInfo
    ) {
      return;
    }

    this.academicError =
      this.validateAcademicForm();

    if (this.academicError) {
      return;
    }

    const studentId = this.student.id;

    const form = {
      ...this.academicForm
    };

    this.savingAcademicInfo = true;

    this.cdr.markForCheck();

    try {

      const { data, error } = await this.supabase.rpc(
        'update_student_academic_info',
        {
          p_student_id: studentId,
          p_course: form.course.trim(),
          p_year_level: form.yearLevel.trim(),
          p_required_hours: Number(form.requiredHours),
          p_start_date: form.startDate,
          p_end_date: form.endDate || null
        }
      );

      if (error) {
        throw error;
      }

      const result = data as RpcResult | null;

      if (!result?.success) {

        throw new Error(
          result?.message ||
          'Unable to update academic information.'
        );

      }

      this.showAcademicModal = false;

      this.managementMessage =
        result.message ||
        'Academic information updated successfully.';

      this.downloadMessage = '';
      this.downloadError = '';

      await this.loadStudentDetails();

    } catch (error) {

      console.error(
        'Unable to update academic information:',
        error
      );

      this.academicError = this.getErrorMessage(
        error,
        'Unable to save academic information. Please try again.'
      );

    } finally {

      this.savingAcademicInfo = false;

      this.refreshView();

    }

  }

  // =========================================
  // OPEN INTERNSHIP ASSIGNMENT MODAL
  // =========================================

  async openAssignmentModal(): Promise<void> {

    if (
      !this.student ||
      !this.canReassignIntern ||
      this.isLoading ||
      this.hasOpenModal ||
      this.savingAssignment
    ) {
      return;
    }

    this.assignmentError = '';

    this.managementMessage = '';

    this.availableSupervisors = [];

    this.reviewedAssignment = null;

    this.assignmentForm = {
      companyName: '',
      supervisorId: '',
      startDate:
        this.student.ojt_start_date ||
        this.getToday(),
      endDate:
        this.student.ojt_end_date || '',
      reason: ''
    };

    this.showAssignmentModal = true;

    this.showReviewModal = false;

    await this.loadAvailableSupervisors();

  }

  // =========================================
  // LOAD ACTIVE COMPANY SUPERVISORS
  // =========================================

  async loadAvailableSupervisors(): Promise<void> {

    const requestVersion =
      ++this.assignmentRequestVersion;

    this.loadingSupervisors = true;

    this.assignmentError = '';

    this.cdr.markForCheck();

    try {

      const supervisors: SupervisorDetails[] = [];

      const batchSize = 500;

      let offset = 0;

      while (true) {

        const { data, error } = await this.supabase
          .from('company_supervisors')
          .select(`
            id,
            full_name,
            email,
            company_name,
            department,
            position,
            contact_number
          `)
          .eq('account_status', 'active')
          .order('company_name', {
            ascending: true
          })
          .order('full_name', {
            ascending: true
          })
          .order('id', {
            ascending: true
          })
          .range(
            offset,
            offset + batchSize - 1
          );

        if (error) {
          throw error;
        }

        if (
          requestVersion !==
          this.assignmentRequestVersion
        ) {
          return;
        }

        const batch =
          (data ?? []) as SupervisorDetails[];

        supervisors.push(...batch);

        if (batch.length < batchSize) {
          break;
        }

        offset += batch.length;

      }

      if (
        requestVersion !==
        this.assignmentRequestVersion
      ) {
        return;
      }

      this.availableSupervisors = supervisors;

      if (!this.availableSupervisors.length) {

        this.assignmentError =
          'No active company supervisors are available.';

      }

    } catch (error) {

      if (
        requestVersion !==
        this.assignmentRequestVersion
      ) {
        return;
      }

      console.error(
        'Unable to load company supervisors:',
        error
      );

      this.availableSupervisors = [];

      this.assignmentError =
        'Unable to retrieve company supervisors. Please try again.';

    } finally {

      if (
        requestVersion ===
        this.assignmentRequestVersion
      ) {

        this.loadingSupervisors = false;

        this.refreshView();

      }

    }

  }

  // =========================================
  // COMPANY SELECTION
  // =========================================

  onCompanyChange(companyName: string): void {

    this.assignmentForm.companyName = companyName;

    this.assignmentForm.supervisorId = '';

    this.assignmentError = '';

    this.reviewedAssignment = null;

  }

  onSupervisorChange(supervisorId: string): void {

    this.assignmentForm.supervisorId = supervisorId;

    this.assignmentError = '';

    this.reviewedAssignment = null;

  }

  // =========================================
  // CLOSE ASSIGNMENT MODAL
  // =========================================

  closeAssignmentModal(): void {

    if (this.savingAssignment) {
      return;
    }

    this.assignmentRequestVersion++;

    this.showAssignmentModal = false;

    this.showReviewModal = false;

    this.loadingSupervisors = false;

    this.assignmentError = '';

    this.reviewedAssignment = null;

  }

  // =========================================
  // VALIDATE ASSIGNMENT FORM
  // =========================================

  private validateAssignmentForm(
    form: AssignmentForm = this.assignmentForm
  ): string {

    if (!this.student) {
      return 'Student information is unavailable.';
    }

    if (this.student.account_status !== 'active') {
      return 'Only active students can be assigned.';
    }

    if (this.loadingSupervisors) {
      return 'Please wait while supervisors are loading.';
    }

    if (!form.companyName.trim()) {
      return 'Please select a partner company.';
    }

    if (!form.supervisorId) {
      return 'Please select a company supervisor.';
    }

    const supervisor =
      this.availableSupervisors.find(
        item =>
          item.id === form.supervisorId &&
          item.company_name === form.companyName
      );

    if (!supervisor) {

      return 'The selected supervisor is not available for this company.';

    }

    if (
      this.currentAssignment &&
      this.currentAssignment.supervisor_id ===
        form.supervisorId &&
      this.currentAssignment.company_name ===
        form.companyName
    ) {

      return 'The student is already assigned to this company and supervisor.';

    }

    if (
      !form.startDate ||
      !this.isValidDate(form.startDate)
    ) {

      return 'Please enter a valid internship start date.';

    }

    if (
      form.endDate &&
      !this.isValidDate(form.endDate)
    ) {

      return 'Please enter a valid internship end date.';

    }

    if (
      form.endDate &&
      form.endDate < form.startDate
    ) {

      return 'The end date cannot be earlier than the start date.';

    }

    if (!form.reason.trim()) {

      return 'Please provide a reason for this assignment.';

    }

    if (form.reason.trim().length > 2000) {

      return 'The reason must not exceed 2,000 characters.';

    }

    return '';

  }

  // =========================================
  // REVIEW ASSIGNMENT
  // =========================================

  reviewAssignment(): void {

    if (
      !this.showAssignmentModal ||
      this.savingAssignment
    ) {
      return;
    }

    this.assignmentError =
      this.validateAssignmentForm();

    if (this.assignmentError) {
      return;
    }

    this.reviewedAssignment = {
      ...this.assignmentForm,
      reason: this.assignmentForm.reason.trim()
    };

    this.showAssignmentModal = false;

    this.showReviewModal = true;

  }

  backToAssignmentForm(): void {

    if (this.savingAssignment) {
      return;
    }

    this.showReviewModal = false;

    this.showAssignmentModal = true;

    this.reviewedAssignment = null;

    this.assignmentError = '';

  }

  closeReviewModal(): void {

    this.closeAssignmentModal();

  }

  // =========================================
  // CONFIRM AND SAVE ASSIGNMENT
  // =========================================

  async confirmAssignment(): Promise<void> {

    if (
      !this.student ||
      !this.showReviewModal ||
      !this.reviewedAssignment ||
      this.savingAssignment
    ) {
      return;
    }

    const form = {
      ...this.reviewedAssignment
    };

    this.assignmentError =
      this.validateAssignmentForm(form);

    if (this.assignmentError) {
      return;
    }

    const studentId = this.student.id;

    this.savingAssignment = true;

    this.cdr.markForCheck();

    try {

      // Check whether another coordinator changed
      // the active assignment while the modal was open.

      const {
        data: latestAssignment,
        error: latestError
      } = await this.supabase
        .from('intern_supervisor_assignments')
        .select('id')
        .eq('student_id', studentId)
        .eq('assignment_status', 'active')
        .maybeSingle();

      if (latestError) {
        throw latestError;
      }

      const expectedAssignmentId =
        this.currentAssignment?.id || null;

      const latestAssignmentId =
        latestAssignment?.id || null;

      if (
        expectedAssignmentId !== latestAssignmentId
      ) {

        throw new Error(
          'The current assignment has changed. Close this form and refresh the student details before continuing.'
        );

      }

      const { data, error } = await this.supabase.rpc(
        'reassign_student_intern',
        {
          p_student_id: studentId,
          p_supervisor_id: form.supervisorId,
          p_start_date: form.startDate,
          p_end_date: form.endDate || null,
          p_reason: form.reason.trim()
        }
      );

      if (error) {
        throw error;
      }

      const result = data as RpcResult | null;

      if (!result?.success) {

        throw new Error(
          result?.message ||
          'Unable to save internship assignment.'
        );

      }

      this.showAssignmentModal = false;

      this.showReviewModal = false;

      this.reviewedAssignment = null;

      this.managementMessage =
        result.message ||
        'Internship assignment saved successfully.';

      this.assignmentError = '';

      this.downloadMessage = '';

      this.downloadError = '';

      await this.loadStudentDetails();

      if (this.student) {

        this.activeTab = 'assignments';

      }

    } catch (error) {

      console.error(
        'Unable to save internship assignment:',
        error
      );

      this.assignmentError = this.getErrorMessage(
        error,
        'Unable to save the internship assignment. Please try again.'
      );

    } finally {

      this.savingAssignment = false;

      this.refreshView();

    }

  }

  // =========================================
  // ASSIGNMENT HISTORY HELPERS
  // =========================================

  getAssignmentStatusLabel(status: string): string {

    const labels: Record<string, string> = {
      active: 'Active',
      inactive: 'Previous assignment',
      ended: 'Ended'
    };

    return labels[status] || status;

  }

  getAssignmentReason(
    assignment: InternshipAssignment
  ): string {

    const history = Array.isArray(
      assignment.assignment_history
    )
      ? assignment.assignment_history
      : [];

    if (!history.length) {
      return 'No reason recorded.';
    }

    const relevantEntry = [...history]
      .reverse()
      .find(entry => {

        if (
          assignment.assignment_status === 'active'
        ) {

          return entry.new_supervisor_id ===
            assignment.supervisor_id;

        }

        return entry.previous_assignment_id ===
          assignment.id;

      });

    return relevantEntry?.reason ||
      'No reason recorded.';

  }

  getAssignmentChangedDate(
    assignment: InternshipAssignment
  ): string | null {

    const history = Array.isArray(
      assignment.assignment_history
    )
      ? assignment.assignment_history
      : [];

    const relevantEntry = [...history]
      .reverse()
      .find(entry =>
        entry.previous_assignment_id ===
          assignment.id
      );

    return relevantEntry?.changed_at || null;

  }

  // =========================================
  // ATTENDANCE DATA RETRIEVAL
  // =========================================

  private async fetchAttendanceRecords(
    studentId: string
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
          remarks
        `)
        .eq('student_id', studentId)
        .eq('sync_status', 'synced')
        .order('attendance_date', {
          ascending: false
        })
        .order('id', {
          ascending: true
        })
        .range(
          offset,
          offset + batchSize - 1
        );

      if (error) {
        throw error;
      }

      const batch =
        (data ?? []) as AttendanceRecord[];

      records.push(...batch);

      if (batch.length < batchSize) {
        break;
      }

      offset += batch.length;

    }

    return records;

  }

  // =========================================
  // INTERNSHIP HOURS
  // =========================================

  get requiredHours(): number {

    return Math.max(
      0,
      Number(this.student?.required_hours) || 0
    );

  }

  get verifiedHours(): number {

    return this.attendanceRecords
      .filter(record =>
        record.verification_status === 'verified' &&
        record.sync_status === 'synced' &&
        this.isCompleteAttendance(record)
      )
      .reduce(
        (total, record) =>
          total + this.getRecordHours(record),
        0
      );

  }

  get provisionalHours(): number {

    return this.attendanceRecords
      .filter(record =>
        record.verification_status === 'provisional' &&
        record.sync_status === 'synced' &&
        this.isCompleteAttendance(record)
      )
      .reduce(
        (total, record) =>
          total + this.getRecordHours(record),
        0
      );

  }

  get remainingHours(): number {

    return Math.max(
      0,
      this.requiredHours - this.verifiedHours
    );

  }

  get progress(): number {

    if (this.requiredHours <= 0) {
      return 0;
    }

    return Math.min(
      100,
      Math.floor(
        (this.verifiedHours / this.requiredHours) * 100
      )
    );

  }

  private isCompleteAttendance(
    record: AttendanceRecord
  ): boolean {

    if (!record.time_in || !record.time_out) {
      return false;
    }

    const start = Date.parse(record.time_in);

    const end = Date.parse(record.time_out);

    return Number.isFinite(start) &&
      Number.isFinite(end) &&
      end > start;

  }

  getRecordHours(
    record: AttendanceRecord
  ): number {

    if (!this.isCompleteAttendance(record)) {
      return 0;
    }

    if (
      record.total_hours_rendered !== null &&
      record.total_hours_rendered !== undefined
    ) {

      const hours =
        Number(record.total_hours_rendered);

      if (
        Number.isFinite(hours) &&
        hours >= 0
      ) {

        return hours;

      }

    }

    const start = Date.parse(record.time_in!);

    const end = Date.parse(record.time_out!);

    return (end - start) / (1000 * 60 * 60);

  }

  getCreditedHours(
    record: AttendanceRecord
  ): number {

    if (
      record.verification_status !== 'verified' ||
      record.sync_status !== 'synced'
    ) {

      return 0;

    }

    return this.getRecordHours(record);

  }

  // =========================================
  // STUDENT INTERNSHIP STATUS
  // =========================================

  get internshipStatus(): InternshipStatus {

    if (
      this.student?.account_status !== 'active'
    ) {

      return 'inactive';

    }

    if (!this.currentAssignment) {
      return 'unassigned';
    }

    if (
      this.requiredHours > 0 &&
      this.verifiedHours >= this.requiredHours
    ) {

      return 'hours_completed';

    }

    const today = this.getToday();

    const start = this.student?.ojt_start_date;

    const end = this.student?.ojt_end_date;

    if (start && start > today) {
      return 'not_started';
    }

    if (end && end < today) {
      return 'needs_follow_up';
    }

    return 'ongoing';

  }

  get internshipStatusLabel(): string {

    const labels: Record<InternshipStatus, string> = {
      ongoing: 'Ongoing',
      unassigned: 'Unassigned',
      needs_follow_up: 'Needs follow-up',
      hours_completed: 'Hours completed',
      inactive: 'Inactive',
      not_started: 'Not started'
    };

    return labels[this.internshipStatus];

  }

  // =========================================
  // ATTENDANCE STATUS
  // =========================================

  getAttendanceStatus(
    record: AttendanceRecord
  ): string {

    if (
      record.verification_status === 'rejected'
    ) {

      return 'Rejected';

    }

    if (!this.isCompleteAttendance(record)) {

      return 'Incomplete';

    }

    if (
      record.verification_status === 'verified'
    ) {

      return 'Verified';

    }

    if (
      record.verification_status === 'provisional'
    ) {

      return 'Provisional';

    }

    return 'Unknown';

  }

  getAttendanceStatusClass(
    record: AttendanceRecord
  ): string {

    return this.getAttendanceStatus(record)
      .toLowerCase();

  }

  get verifiedAttendanceCount(): number {

    return this.attendanceRecords.filter(
      record =>
        this.getAttendanceStatus(record) === 'Verified'
    ).length;

  }

  get provisionalAttendanceCount(): number {

    return this.attendanceRecords.filter(
      record =>
        this.getAttendanceStatus(record) === 'Provisional'
    ).length;

  }

  get rejectedAttendanceCount(): number {

    return this.attendanceRecords.filter(
      record =>
        record.verification_status === 'rejected'
    ).length;

  }

  get incompleteAttendanceCount(): number {

    return this.attendanceRecords.filter(
      record =>
        this.getAttendanceStatus(record) === 'Incomplete'
    ).length;

  }

  // =========================================
  // WEEKLY REPORTS
  // =========================================

  get approvedReportsCount(): number {

    return this.weeklyReports.filter(
      report => report.status === 'approved'
    ).length;

  }

  get pendingReportsCount(): number {

    return this.weeklyReports.filter(
      report => report.status === 'pending_review'
    ).length;

  }

  get returnedReportsCount(): number {

    return this.weeklyReports.filter(
      report => report.status === 'returned'
    ).length;

  }

  get submittedReportsCount(): number {

    return this.weeklyReports.filter(
      report =>
        report.status === 'approved' ||
        report.status === 'pending_review' ||
        report.status === 'returned'
    ).length;

  }

  getReportStatusLabel(
    status: string
  ): string {

    const labels: Record<string, string> = {
      draft: 'Draft',
      pending_review: 'Pending review',
      approved: 'Approved',
      returned: 'Returned'
    };

    return labels[status] || status;

  }

  // =========================================
  // PLACEMENT INFORMATION
  // =========================================

  get companyName(): string {

    return this.currentAssignment?.company_name ||
      'Unassigned';

  }

  get supervisorName(): string {

    return this.currentAssignment
      ?.supervisor?.full_name ||
      'Not specified';

  }

  get internshipPeriod(): string {

    const start = this.student?.ojt_start_date;

    const end = this.student?.ojt_end_date;

    if (!start && !end) {
      return 'Not specified';
    }

    if (start && !end) {

      return `${this.formatDate(start)} – Ongoing`;

    }

    return `${this.formatDate(start)} – ${this.formatDate(end)}`;

  }

  // =========================================
  // ATTENDANCE PAGINATION
  // =========================================

  get attendanceTotalPages(): number {

    return Math.max(
      1,
      Math.ceil(
        this.attendanceRecords.length /
        this.attendancePageSize
      )
    );

  }

  get paginatedAttendance(): AttendanceRecord[] {

    const start =
      (this.attendancePage - 1) *
      this.attendancePageSize;

    return this.attendanceRecords.slice(
      start,
      start + this.attendancePageSize
    );

  }

  changeAttendancePage(page: number): void {

    if (
      page < 1 ||
      page > this.attendanceTotalPages
    ) {

      return;

    }

    this.attendancePage = page;

  }

  // =========================================
  // TAB NAVIGATION
  // =========================================

  setActiveTab(tab: DetailsTab): void {

    this.activeTab = tab;

  }

  backToStudents(): void {

    if (
      this.savingAcademicInfo ||
      this.savingAssignment
    ) {

      return;

    }

    void this.router.navigate([
      '/coordinator/student-interns'
    ]);

  }

  dismissManagementMessage(): void {

    this.managementMessage = '';

  }

  // =========================================
  // DTR HISTORICAL COVERAGE
  // =========================================

  private getDTRStartDate(
    student: StudentDetails
  ): string | null {

    const dates: string[] = [];

    if (
      student.ojt_start_date &&
      this.isValidDate(student.ojt_start_date)
    ) {

      dates.push(student.ojt_start_date);

    }

    // Preserve the previous internship start date
    // recorded during reassignment.

    for (const assignment of this.assignments) {

      const history = Array.isArray(
        assignment.assignment_history
      )
        ? assignment.assignment_history
        : [];

      for (const entry of history) {

        const previousStart =
          entry.previous_start_date;

        if (
          previousStart &&
          this.isValidDate(previousStart)
        ) {

          dates.push(previousStart);

        }

      }

    }

    return dates.sort()[0] || null;

  }

  // =========================================
  // DOWNLOAD DAILY TIME RECORD
  // =========================================

  
async downloadDTR(): Promise<void> {

  if (
    this.downloadingDTR ||
    this.isLoading ||
    this.savingAcademicInfo ||
    this.savingAssignment ||
    !this.student
  ) {
    return;
  }

  this.downloadingDTR = true;
  this.downloadError = '';
  this.downloadMessage = '';

  this.cdr.markForCheck();

  try {

    const student = this.student;
    const today = this.getToday();
    const start = this.getDTRStartDate(student);
    const registeredEnd = student.ojt_end_date;

    if (!start || !this.isValidDate(start)) {
      throw new Error(
        'A valid internship start date is required.'
      );
    }

    if (start > today) {
      throw new Error(
        'The internship has not started yet.'
      );
    }

    if (
      registeredEnd &&
      (
        !this.isValidDate(registeredEnd) ||
        registeredEnd < start
      )
    ) {
      throw new Error(
        'The registered internship end date is invalid.'
      );
    }

    const end =
      registeredEnd && registeredEnd < today
        ? registeredEnd
        : today;

    const allRecords =
      await this.fetchAttendanceRecords(
        student.student_id
      );

    const records = allRecords
      .filter(record =>
        record.attendance_date >= start &&
        record.attendance_date <= end
      )
      .sort((a, b) =>
        a.attendance_date.localeCompare(
          b.attendance_date
        )
      );

    const templateRecords: DtrTemplateRecord[] =
      records.map(record => {

        const status: DtrTemplateRecord['status'] =
          record.verification_status === 'verified'
            ? 'verified'
            : record.verification_status === 'rejected'
              ? 'rejected'
              : 'provisional';

        return {
          date: record.attendance_date,

          timeIn: record.time_in
            ? this.formatTime(record.time_in)
            : '',

          timeOut: record.time_out
            ? this.formatTime(record.time_out)
            : '',

          minutes:
            this.isCompleteAttendance(record) &&
            (status === 'verified' || status === 'provisional')
              ? Math.round(this.getRecordHours(record) * 60)
              : 0,

          status,
          syncStatus: 'synced'
        };

      });

    const documentDefinition = createDtrTemplate({
      studentName: student.full_name,
      studentId: student.student_id,

      schoolName:
        student.school_name ||
        'Pamantasan ng Lungsod ng Valenzuela',

      course: student.course || 'Not specified',

      company: this.companyName,

      supervisorName: this.supervisorName,

      startDate: start,
      endDate: end,

      records: templateRecords,

      isCachedData: false
    });

    const safeStudentId =
      student.student_id.replace(
        /[^a-zA-Z0-9_-]/g,
        '_'
      );

    const filename =
      `InternTrack-DTR-${safeStudentId}-${start}-to-${end}.pdf`;

    await pdfMake
      .createPdf(documentDefinition)
      .download(filename);

    this.downloadMessage =
      'DTR download has been generated.';

  } catch (error) {

    console.error(
      'Unable to download DTR:',
      error
    );

    this.downloadError = this.getErrorMessage(
      error,
      'Unable to download DTR. Please try again.'
    );

  } finally {

    this.downloadingDTR = false;

    this.refreshView();

  }

}


  // =========================================
  // DISPLAY HELPERS
  // =========================================

  getInitials(name: string | null): string {

    return (name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part =>
        part.charAt(0).toUpperCase()
      )
      .join('') || 'ST';

  }

  formatHours(value: number): string {

    return new Intl.NumberFormat('en-PH', {

      minimumFractionDigits: 0,

      maximumFractionDigits: 2

    }).format(

      Number.isFinite(value) ? value : 0

    );

  }

  formatDate(
    value: string | null | undefined
  ): string {

    if (!value) {
      return 'Not specified';
    }

    const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00+08:00`)
      : new Date(value);

    if (!Number.isFinite(date.getTime())) {
      return 'Not specified';
    }

    return new Intl.DateTimeFormat('en-US', {

      timeZone: 'Asia/Manila',

      month: 'short',

      day: 'numeric',

      year: 'numeric'

    }).format(date);

  }

  formatTime(
    value: string | null
  ): string {

    if (!value) {
      return '—';
    }

    const date = new Date(value);

    if (!Number.isFinite(date.getTime())) {
      return '—';
    }

    return new Intl.DateTimeFormat('en-US', {

      timeZone: 'Asia/Manila',

      hour: 'numeric',

      minute: '2-digit',

      hour12: true

    }).format(date);

  }

  // =========================================
  // DATE HELPERS
  // =========================================

  private getToday(): string {

    const parts = new Intl.DateTimeFormat('en-US', {

      timeZone: 'Asia/Manila',

      year: 'numeric',

      month: '2-digit',

      day: '2-digit'

    }).formatToParts(new Date());

    const year = parts.find(
      part => part.type === 'year'
    )?.value;

    const month = parts.find(
      part => part.type === 'month'
    )?.value;

    const day = parts.find(
      part => part.type === 'day'
    )?.value;

    return `${year}-${month}-${day}`;

  }

  private isValidDate(value: string): boolean {

    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {

      return false;

    }

    const date = new Date(
      `${value}T00:00:00Z`
    );

    return Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value;

  }

  // =========================================
  // ERROR HANDLING
  // =========================================

  private getErrorMessage(
    error: unknown,
    fallback: string
  ): string {

    if (error instanceof Error) {

      return error.message || fallback;

    }

    if (
      typeof error === 'object' &&
      error !== null &&
      'message' in error
    ) {

      const message = (
        error as { message?: unknown }
      ).message;

      if (
        typeof message === 'string' &&
        message.trim()
      ) {

        return message;

      }

    }

    return fallback;

  }

  // =========================================
  // CHANGE DETECTION
  // =========================================

  private refreshView(): void {

    this.ngZone.run(() => {

      this.cdr.detectChanges();

    });

  }

}
