
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
  createOutline,
  mailOutline,
  callOutline,
  businessOutline,
  personOutline,
  peopleOutline,
  shieldCheckmarkOutline,
  powerOutline,
  refreshOutline,
  chevronForwardOutline,
  chevronBackOutline,
  chevronDownOutline,
  searchOutline,
  alertCircleOutline,
  informationCircleOutline,
  closeOutline,
  checkmarkCircleOutline,
  warningOutline
} from 'ionicons/icons';

import {
  SupabaseService
} from '../../../services/supabase.service';

// =========================================
// INTERFACES
// =========================================

interface SupervisorDetails {
  id: string;
  user_id: string | null;
  supervisor_id: string;
  full_name: string;
  email: string;
  company_name: string;
  department: string | null;
  position: string | null;
  contact_number: string | null;
  account_status: string;
  date_registered: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface StudentRecord {
  id: string;
  student_id: string;
  full_name: string;
  email: string | null;
  course: string | null;
  year_level: string | null;
  required_hours: number | null;
  ojt_start_date: string | null;
  ojt_end_date: string | null;
  account_status: string;
}

interface AssignmentRecord {
  id: string;
  student_id: string;
  supervisor_id: string;
  company_name: string;
  assigned_date: string;
  assignment_status: string;
  assignment_history: unknown;
}

interface AttendanceRecord {
  id: string;
  student_id: string;
  attendance_date: string;
  time_in: string | null;
  time_out: string | null;
  total_hours_rendered: number | string | null;
  verification_status: string;
  sync_status: string;
}

interface AssignedIntern {
  id: string;
  assignmentId: string;
  studentId: string;
  fullName: string;
  email: string;
  course: string;
  yearLevel: string;
  requiredHours: number;
  verifiedHours: number;
  remainingHours: number;
  progress: number;
  startDate: string | null;
  endDate: string | null;
  assignedDate: string;
  assignmentStatus: string;
  accountStatus: string;
  internshipStatus: string;
  initials: string;
  avatarColor: string;
}

interface EditSupervisorForm {
  fullName: string;
  email: string;
  contactNumber: string;
  position: string;
  department: string;
}

interface RpcResponse {
  success: boolean;
  message?: string;
  supervisor_id?: string;
  account_status?: string;
  full_name?: string;
  contact_number?: string | null;
  position?: string;
  department?: string;
  updated_at?: string;
}

type SupervisorTab =
  | 'overview'
  | 'interns'
  | 'history';

type AccountAction =
  | 'deactivate'
  | 'reactivate';

// =========================================
// COMPONENT
// =========================================

@Component({
  selector: 'app-supervisor-details',
  templateUrl: './supervisor-details.page.html',
  styleUrls: ['./supervisor-details.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonIcon
  ]
})
export class SupervisorDetailsPage implements OnInit {

  private readonly supabaseService =
    inject(SupabaseService);

  private readonly supabase =
    this.supabaseService.getClient();

  private readonly route =
    inject(ActivatedRoute);

  private readonly router =
    inject(Router);

  private readonly cdr =
    inject(ChangeDetectorRef);

  private readonly ngZone =
    inject(NgZone);

  // =========================================
  // PAGE STATE
  // =========================================

  supervisor: SupervisorDetails | null = null;

  assignments: AssignmentRecord[] = [];

  assignedInterns: AssignedIntern[] = [];

  activeTab: SupervisorTab = 'overview';

  isLoading = true;

  errorMessage = '';

  successMessage = '';

  actionErrorMessage = '';

  private supervisorUuid = '';

  private loadingInProgress = false;

  // =========================================
  // EDIT SUPERVISOR MODAL STATE
  // =========================================

  showEditModal = false;

  isSavingEdit = false;

  editErrorMessage = '';

  editForm: EditSupervisorForm = {
    fullName: '',
    email: '',
    contactNumber: '',
    position: '',
    department: ''
  };

  // =========================================
  // ACCOUNT STATUS MODAL STATE
  // =========================================

  showAccountModal = false;

  isUpdatingAccount = false;

  accountErrorMessage = '';

  accountAction: AccountAction = 'deactivate';

  // =========================================
  // SEARCH AND FILTERS
  // =========================================

  searchQuery = '';

  selectedStatus = 'all';

  // =========================================
  // PAGINATION
  // =========================================

  currentPage = 1;

  readonly pageSize = 5;

  // =========================================
  // CONSTRUCTOR
  // =========================================

  constructor() {

    addIcons({
      arrowBackOutline,
      arrowForwardOutline,
      createOutline,
      mailOutline,
      callOutline,
      businessOutline,
      personOutline,
      peopleOutline,
      shieldCheckmarkOutline,
      powerOutline,
      refreshOutline,
      chevronForwardOutline,
      chevronBackOutline,
      chevronDownOutline,
      searchOutline,
      alertCircleOutline,
      informationCircleOutline,
      closeOutline,
      checkmarkCircleOutline,
      warningOutline
    });

  }

  // =========================================
  // LIFECYCLE
  // =========================================

  ngOnInit(): void {

    this.supervisorUuid =
      this.route.snapshot.paramMap.get(
        'supervisorId'
      ) ||
      this.route.snapshot.paramMap.get('id') ||
      '';

    if (!this.supervisorUuid) {

      this.errorMessage =
        'No supervisor was selected.';

      this.isLoading = false;

      return;

    }

    void this.loadSupervisorDetails();

  }

  ionViewWillEnter(): void {

    if (this.supervisorUuid) {
      void this.loadSupervisorDetails();
    }

  }

  // =========================================
  // LOAD SUPERVISOR DETAILS
  // =========================================

  async loadSupervisorDetails(
    showLoading = true
  ): Promise<void> {

    if (
      this.loadingInProgress ||
      !this.supervisorUuid
    ) {
      return;
    }

    this.loadingInProgress = true;

    this.ngZone.run(() => {

      if (showLoading) {
        this.isLoading = true;
      }

      this.errorMessage = '';

      this.cdr.detectChanges();

    });

    try {

      const {
        data: supervisorData,
        error: supervisorError
      } = await this.supabase
        .from('company_supervisors')
        .select(`
          id,
          user_id,
          supervisor_id,
          full_name,
          email,
          company_name,
          department,
          position,
          contact_number,
          account_status,
          date_registered,
          created_at,
          updated_at
        `)
        .eq('id', this.supervisorUuid)
        .maybeSingle();

      if (supervisorError) {
        throw supervisorError;
      }

      if (!supervisorData) {

        throw new Error(
          'The selected supervisor could not be found.'
        );

      }

      const supervisor =
        supervisorData as SupervisorDetails;

      const assignments =
        await this.fetchAssignments(
          supervisor.id
        );

      const studentUuids = Array.from(
        new Set(
          assignments.map(
            assignment => assignment.student_id
          )
        )
      );

      const students =
        await this.fetchStudents(
          studentUuids
        );

      const studentSchoolIds = Array.from(
        new Set(
          students.map(
            student => student.student_id
          )
        )
      );

      const attendance =
        await this.fetchVerifiedAttendance(
          studentSchoolIds
        );

      const studentMap = new Map(
        students.map(student => [
          student.id,
          student
        ])
      );

      const verifiedHoursMap =
        new Map<string, number>();

      const processedAttendanceIds =
        new Set<string>();

      for (const record of attendance) {

        if (
          processedAttendanceIds.has(record.id)
        ) {
          continue;
        }

        processedAttendanceIds.add(record.id);

        if (
          record.verification_status !== 'verified' ||
          record.sync_status !== 'synced' ||
          !record.time_in ||
          !record.time_out
        ) {
          continue;
        }

        const timeIn =
          new Date(record.time_in).getTime();

        const timeOut =
          new Date(record.time_out).getTime();

        if (
          !Number.isFinite(timeIn) ||
          !Number.isFinite(timeOut) ||
          timeOut < timeIn
        ) {
          continue;
        }

        const hours = Number(
          record.total_hours_rendered ?? 0
        );

        if (
          !Number.isFinite(hours) ||
          hours < 0
        ) {
          continue;
        }

        const existingHours =
          verifiedHoursMap.get(
            record.student_id
          ) ?? 0;

        verifiedHoursMap.set(
          record.student_id,
          existingHours + hours
        );

      }

      const mappedInterns: AssignedIntern[] = [];

      for (const assignment of assignments) {

        const student =
          studentMap.get(
            assignment.student_id
          );

        if (!student) {
          continue;
        }

        const requiredHours = Math.max(
          0,
          Number(
            student.required_hours ?? 0
          ) || 0
        );

        const verifiedHours =
          this.roundHours(
            verifiedHoursMap.get(
              student.student_id
            ) ?? 0
          );

        const remainingHours =
          this.roundHours(
            Math.max(
              0,
              requiredHours - verifiedHours
            )
          );

        const progress =
          requiredHours > 0
            ? Math.min(
                100,
                Math.max(
                  0,
                  Math.round(
                    verifiedHours /
                    requiredHours * 100
                  )
                )
              )
            : 0;

        const internshipStatus =
          this.calculateInternshipStatus(
            student,
            assignment,
            verifiedHours
          );

        mappedInterns.push({

          id: student.id,

          assignmentId: assignment.id,

          studentId: student.student_id,

          fullName:
            student.full_name ||
            'Unnamed student',

          email:
            student.email ||
            'Not provided',

          course:
            student.course ||
            'Not specified',

          yearLevel:
            student.year_level ||
            'Not specified',

          requiredHours,

          verifiedHours,

          remainingHours,

          progress,

          startDate:
            student.ojt_start_date,

          endDate:
            student.ojt_end_date,

          assignedDate:
            assignment.assigned_date,

          assignmentStatus:
            assignment.assignment_status,

          accountStatus:
            student.account_status,

          internshipStatus,

          initials:
            this.getInitials(
              student.full_name
            ),

          avatarColor:
            this.getAvatarColor(
              student.id
            )

        });

      }

      mappedInterns.sort((a, b) => {

        const aActive =
          a.assignmentStatus === 'active';

        const bActive =
          b.assignmentStatus === 'active';

        if (aActive !== bActive) {
          return aActive ? -1 : 1;
        }

        return a.fullName.localeCompare(
          b.fullName
        );

      });

      this.ngZone.run(() => {

        this.supervisor = supervisor;

        this.assignments = assignments;

        this.assignedInterns = mappedInterns;

        this.currentPage = Math.min(
          this.currentPage,
          this.totalPages
        );

        this.cdr.detectChanges();

      });

    } catch (error: unknown) {

      console.error(
        'Failed to load supervisor details:',
        error
      );

      this.ngZone.run(() => {

        if (showLoading || !this.supervisor) {

          this.errorMessage =
            this.getErrorMessage(error);

        } else {

          this.actionErrorMessage =
            'Unable to refresh the latest supervisor details. ' +
            'Please reload the page.';

        }

        this.cdr.detectChanges();

      });

    } finally {

      this.loadingInProgress = false;

      this.ngZone.run(() => {

        this.isLoading = false;

        this.cdr.detectChanges();

      });

    }

  }

  // =========================================
  // FETCH ASSIGNMENTS
  // =========================================

  private async fetchAssignments(
    supervisorId: string
  ): Promise<AssignmentRecord[]> {

    const records: AssignmentRecord[] = [];

    const batchSize = 500;

    let offset = 0;

    while (true) {

      const { data, error } =
        await this.supabase
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
          .eq(
            'supervisor_id',
            supervisorId
          )
          .order('assigned_date', {
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
        (data ?? []) as AssignmentRecord[];

      records.push(...batch);

      if (batch.length < batchSize) {
        break;
      }

      offset += batchSize;

    }

    return records;

  }

  // =========================================
  // FETCH STUDENTS
  // =========================================

  private async fetchStudents(
    studentUuids: string[]
  ): Promise<StudentRecord[]> {

    if (studentUuids.length === 0) {
      return [];
    }

    const records: StudentRecord[] = [];

    const chunkSize = 100;

    for (
      let index = 0;
      index < studentUuids.length;
      index += chunkSize
    ) {

      const chunk = studentUuids.slice(
        index,
        index + chunkSize
      );

      const { data, error } =
        await this.supabase
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
          .in('id', chunk);

      if (error) {
        throw error;
      }

      records.push(
        ...((data ?? []) as StudentRecord[])
      );

    }

    return records;

  }

  // =========================================
  // FETCH VERIFIED ATTENDANCE
  // =========================================

  private async fetchVerifiedAttendance(
    studentIds: string[]
  ): Promise<AttendanceRecord[]> {

    if (studentIds.length === 0) {
      return [];
    }

    const records: AttendanceRecord[] = [];

    const chunkSize = 100;

    const batchSize = 500;

    for (
      let index = 0;
      index < studentIds.length;
      index += chunkSize
    ) {

      const chunk = studentIds.slice(
        index,
        index + chunkSize
      );

      let offset = 0;

      while (true) {

        const { data, error } =
          await this.supabase
            .from('attendance')
            .select(`
              id,
              student_id,
              attendance_date,
              time_in,
              time_out,
              total_hours_rendered,
              verification_status,
              sync_status
            `)
            .in('student_id', chunk)
            .eq(
              'verification_status',
              'verified'
            )
            .eq(
              'sync_status',
              'synced'
            )
            .not(
              'time_in',
              'is',
              null
            )
            .not(
              'time_out',
              'is',
              null
            )
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

        offset += batchSize;

      }

    }

    return records;

  }

  // =========================================
  // MANAGEMENT ACTION AVAILABILITY
  // =========================================

  get isProcessingAction(): boolean {

    return (
      this.isSavingEdit ||
      this.isUpdatingAccount ||
      this.loadingInProgress
    );

  }

  get canEditSupervisor(): boolean {

    return (
      Boolean(this.supervisor) &&
      !this.isLoading &&
      !this.errorMessage &&
      !this.isProcessingAction
    );

  }

  get canDeactivateSupervisor(): boolean {

    return (
      Boolean(this.supervisor?.user_id) &&
      this.supervisor?.account_status === 'active' &&
      !this.isLoading &&
      !this.errorMessage &&
      !this.isProcessingAction
    );

  }

  get canReactivateSupervisor(): boolean {

    return (
      Boolean(this.supervisor?.user_id) &&
      this.supervisor?.account_status === 'inactive' &&
      !this.isLoading &&
      !this.errorMessage &&
      !this.isProcessingAction
    );

  }

  // =========================================
  // EDIT SUPERVISOR INFORMATION
  // =========================================

  openEditModal(): void {

    if (
      !this.supervisor ||
      !this.canEditSupervisor ||
      this.showAccountModal
    ) {
      return;
    }

    this.clearActionMessages();

    this.editErrorMessage = '';

    this.editForm = {

      fullName:
        this.supervisor.full_name ?? '',

      email:
        this.supervisor.email ?? '',

      contactNumber:
        this.supervisor.contact_number ?? '',

      position:
        this.supervisor.position ?? '',

      department:
        this.supervisor.department ?? ''

    };

    this.showEditModal = true;

  }

  closeEditModal(): void {

    if (this.isSavingEdit) {
      return;
    }

    this.showEditModal = false;

    this.editErrorMessage = '';

  }

  // =========================================
  // EDIT FORM VALIDATION
  // =========================================

  get isEditFormValid(): boolean {

    return (

      this.editForm.fullName.trim().length > 0 &&

      this.editForm.fullName.trim().length <= 150 &&

      this.editForm.position.trim().length > 0 &&

      this.editForm.position.trim().length <= 100 &&

      this.editForm.department.trim().length > 0 &&

      this.editForm.department.trim().length <= 100 &&

      this.editForm.contactNumber.trim().length <= 30

    );

  }

  get hasEditChanges(): boolean {

    if (!this.supervisor) {
      return false;
    }

    return (

      this.editForm.fullName.trim() !==
        (this.supervisor.full_name ?? '').trim() ||

      this.editForm.contactNumber.trim() !==
        (this.supervisor.contact_number ?? '').trim() ||

      this.editForm.position.trim() !==
        (this.supervisor.position ?? '').trim() ||

      this.editForm.department.trim() !==
        (this.supervisor.department ?? '').trim()

    );

  }

  get canSaveEdit(): boolean {

    return (
      this.isEditFormValid &&
      this.hasEditChanges &&
      !this.isProcessingAction
    );

  }

  private validateEditForm(): string {

    if (!this.editForm.fullName.trim()) {

      return 'Full name is required.';

    }

    if (
      this.editForm.fullName.trim().length > 150
    ) {

      return 'Full name must not exceed 150 characters.';

    }

    if (!this.editForm.position.trim()) {

      return 'Position is required.';

    }

    if (
      this.editForm.position.trim().length > 100
    ) {

      return 'Position must not exceed 100 characters.';

    }

    if (!this.editForm.department.trim()) {

      return 'Department is required.';

    }

    if (
      this.editForm.department.trim().length > 100
    ) {

      return 'Department must not exceed 100 characters.';

    }

    if (
      this.editForm.contactNumber.trim().length > 30
    ) {

      return 'Contact number must not exceed 30 characters.';

    }

    return '';

  }

  // =========================================
  // SAVE SUPERVISOR INFORMATION RPC
  // =========================================

  async saveSupervisorInformation(): Promise<void> {

    if (
      !this.supervisor ||
      !this.showEditModal ||
      this.isProcessingAction
    ) {
      return;
    }

    this.editErrorMessage = '';

    const validationError =
      this.validateEditForm();

    if (validationError) {

      this.editErrorMessage =
        validationError;

      return;

    }

    if (!this.hasEditChanges) {

      this.editErrorMessage =
        'No changes were made.';

      return;

    }

    const supervisorId =
      this.supervisor.id;

    const form = {

      fullName:
        this.editForm.fullName.trim(),

      contactNumber:
        this.editForm.contactNumber.trim(),

      position:
        this.editForm.position.trim(),

      department:
        this.editForm.department.trim()

    };

    this.isSavingEdit = true;

    try {

      const { data, error } =
        await this.supabase.rpc(
          'update_supervisor_information',
          {

            p_supervisor_id:
              supervisorId,

            p_full_name:
              form.fullName,

            p_contact_number:
              form.contactNumber,

            p_position:
              form.position,

            p_department:
              form.department

          }
        );

      if (error) {
        throw error;
      }

      const result =
        data as RpcResponse | null;

      if (!result?.success) {

        throw new Error(
          result?.message ||
          'Unable to update supervisor information.'
        );

      }

      this.ngZone.run(() => {

        if (
          this.supervisor &&
          this.supervisor.id === supervisorId
        ) {

          this.supervisor = {

            ...this.supervisor,

            full_name:
              result.full_name ??
              form.fullName,

            contact_number:
              result.contact_number !== undefined
                ? result.contact_number
                : form.contactNumber || null,

            position:
              result.position ??
              form.position,

            department:
              result.department ??
              form.department,

            updated_at:
              result.updated_at ??
              this.supervisor.updated_at

          };

        }

        this.showEditModal = false;

        this.editErrorMessage = '';

        this.successMessage =
          result.message ||
          'Supervisor information updated successfully.';

        this.cdr.detectChanges();

      });

      await this.loadSupervisorDetails(false);

    } catch (error: unknown) {

      console.error(
        'Failed to update supervisor information:',
        error
      );

      this.ngZone.run(() => {

        this.editErrorMessage =
          this.getErrorMessage(error);

        this.cdr.detectChanges();

      });

    } finally {

      this.ngZone.run(() => {

        this.isSavingEdit = false;

        this.cdr.detectChanges();

      });

    }

  }

  // =========================================
  // DEACTIVATE ACCOUNT MODAL
  // =========================================

  openDeactivateModal(): void {

    if (
      !this.canDeactivateSupervisor ||
      this.showEditModal
    ) {
      return;
    }

    this.clearActionMessages();

    this.accountAction = 'deactivate';

    this.accountErrorMessage = '';

    this.showAccountModal = true;

  }

  // =========================================
  // REACTIVATE ACCOUNT MODAL
  // =========================================

  openReactivateModal(): void {

    if (
      !this.canReactivateSupervisor ||
      this.showEditModal
    ) {
      return;
    }

    this.clearActionMessages();

    this.accountAction = 'reactivate';

    this.accountErrorMessage = '';

    this.showAccountModal = true;

  }

  closeAccountModal(): void {

    if (this.isUpdatingAccount) {
      return;
    }

    this.showAccountModal = false;

    this.accountErrorMessage = '';

  }

  // =========================================
  // ACCOUNT MODAL GETTERS
  // =========================================

  get isDeactivationAction(): boolean {

    return (
      this.accountAction === 'deactivate'
    );

  }

  get isDeactivationBlocked(): boolean {

    return (
      this.isDeactivationAction &&
      this.activeInternCount > 0
    );

  }

  get accountModalTitle(): string {

    return this.isDeactivationAction
      ? 'Deactivate supervisor account?'
      : 'Reactivate supervisor account?';

  }

  get accountModalDescription(): string {

    if (this.isDeactivationAction) {

      return (
        `You are about to deactivate the account of ` +
        `${this.supervisorName}. Existing internship ` +
        `records and assignment history will be retained.`
      );

    }

    return (
      `You are about to reactivate the account of ` +
      `${this.supervisorName}. The supervisor's application ` +
      `account status will be restored to active.`
    );

  }

  get accountConfirmLabel(): string {

    return this.isDeactivationAction
      ? 'Deactivate account'
      : 'Reactivate account';

  }

  get accountProcessingLabel(): string {

    return this.isDeactivationAction
      ? 'Deactivating...'
      : 'Reactivating...';

  }

  get canConfirmAccountAction(): boolean {

    if (
      !this.supervisor ||
      !this.supervisor.user_id ||
      this.isProcessingAction ||
      this.isDeactivationBlocked
    ) {
      return false;
    }

    if (this.isDeactivationAction) {

      return (
        this.supervisor.account_status === 'active'
      );

    }

    return (
      this.supervisor.account_status === 'inactive'
    );

  }

  // =========================================
  // UPDATE ACCOUNT STATUS RPC
  // =========================================

  async confirmAccountAction(): Promise<void> {

    if (
      !this.supervisor ||
      !this.showAccountModal ||
      this.isProcessingAction
    ) {
      return;
    }

    this.accountErrorMessage = '';

    if (!this.supervisor.user_id) {

      this.accountErrorMessage =
        'This supervisor has no linked user account.';

      return;

    }

    if (this.isDeactivationBlocked) {

      this.accountErrorMessage =
        'Reassign all active student interns before deactivating this account.';

      return;

    }

    if (!this.canConfirmAccountAction) {

      this.accountErrorMessage =
        'This account status change is not available.';

      return;

    }

    const supervisorId =
      this.supervisor.id;

    const requestedStatus =
      this.isDeactivationAction
        ? 'inactive'
        : 'active';

    this.isUpdatingAccount = true;

    try {

      const { data, error } =
        await this.supabase.rpc(
          'update_supervisor_account_status',
          {

            p_supervisor_id:
              supervisorId,

            p_account_status:
              requestedStatus

          }
        );

      if (error) {
        throw error;
      }

      const result =
        data as RpcResponse | null;

      if (!result?.success) {

        throw new Error(
          result?.message ||
          'Unable to update the supervisor account status.'
        );

      }

      this.ngZone.run(() => {

        if (
          this.supervisor &&
          this.supervisor.id === supervisorId
        ) {

          this.supervisor = {

            ...this.supervisor,

            account_status:
              result.account_status ??
              requestedStatus

          };

        }

        this.showAccountModal = false;

        this.accountErrorMessage = '';

        this.successMessage =
          result.message ||
          (
            requestedStatus === 'inactive'
              ? 'Supervisor account deactivated successfully.'
              : 'Supervisor account reactivated successfully.'
          );

        this.cdr.detectChanges();

      });

      await this.loadSupervisorDetails(false);

    } catch (error: unknown) {

      console.error(
        'Failed to update supervisor account status:',
        error
      );

      this.ngZone.run(() => {

        this.accountErrorMessage =
          this.getErrorMessage(error);

        this.cdr.detectChanges();

      });

    } finally {

      this.ngZone.run(() => {

        this.isUpdatingAccount = false;

        this.cdr.detectChanges();

      });

    }

  }

  // =========================================
  // MESSAGE MANAGEMENT
  // =========================================

  clearActionMessages(): void {

    this.successMessage = '';

    this.actionErrorMessage = '';

  }

  dismissSuccessMessage(): void {

    this.successMessage = '';

  }

  dismissActionError(): void {

    this.actionErrorMessage = '';

  }

  // =========================================
  // SUPERVISOR PROFILE GETTERS
  // =========================================

  get supervisorName(): string {

    return this.supervisor?.full_name ||
      'Company Supervisor';

  }

  get supervisorInitials(): string {

    return this.getInitials(
      this.supervisorName
    );

  }

  get supervisorAvatarColor(): string {

    return this.getAvatarColor(
      this.supervisor?.id || ''
    );

  }

  get supervisorPosition(): string {

    return this.supervisor?.position ||
      'Company Supervisor';

  }

  get supervisorDepartment(): string {

    return this.supervisor?.department ||
      'Not specified';

  }

  get companyName(): string {

    return this.supervisor?.company_name ||
      'Not specified';

  }

  get supervisorEmail(): string {

    return this.supervisor?.email ||
      'Not provided';

  }

  get contactNumber(): string {

    return this.supervisor?.contact_number ||
      'Not provided';

  }

  get isActiveAccount(): boolean {

    return (
      this.supervisor?.account_status === 'active'
    );

  }

  get accountStatusLabel(): string {

    return this.getStatusLabel(
      this.supervisor?.account_status ||
      'unknown'
    );

  }

  get hasLinkedAccount(): boolean {

    return Boolean(
      this.supervisor?.user_id
    );

  }

  get systemAccessLabel(): string {

    if (!this.hasLinkedAccount) {
      return 'No linked account';
    }

    return this.isActiveAccount
      ? 'Active profile'
      : 'Inactive profile';

  }

  get accountNoticeMessage(): string {

    if (!this.hasLinkedAccount) {

      return (
        'This supervisor does not have a linked ' +
        'user account. Account status changes are unavailable.'
      );

    }

    if (
      this.supervisor?.account_status === 'disabled'
    ) {

      return (
        'This account is administratively disabled ' +
        'and requires separate authorization.'
      );

    }

    if (!this.isActiveAccount) {

      return (
        'This supervisor account is inactive. ' +
        'Existing internship records and assignment ' +
        'history are retained.'
      );

    }

    if (this.activeInternCount > 0) {

      return (
        'Reassign all active student interns before ' +
        'deactivating this supervisor account.'
      );

    }

    return (
      'Deactivating this account will retain all ' +
      'existing internship records and assignment history.'
    );

  }

  // =========================================
  // ASSIGNMENT SUMMARY
  // =========================================

  get activeInterns(): AssignedIntern[] {

    return this.assignedInterns.filter(
      intern =>
        intern.assignmentStatus === 'active'
    );

  }

  get historicalInterns(): AssignedIntern[] {

    return this.assignedInterns.filter(
      intern =>
        intern.assignmentStatus !== 'active'
    );

  }

  get totalAssignedInterns(): number {

    return new Set(
      this.assignments.map(
        assignment => assignment.student_id
      )
    ).size;

  }

  get activeInternCount(): number {

    return new Set(
      this.assignments
        .filter(
          assignment =>
            assignment.assignment_status === 'active'
        )
        .map(
          assignment => assignment.student_id
        )
    ).size;

  }

  get previousAssignmentCount(): number {

    return this.assignments.filter(
      assignment =>
        assignment.assignment_status !== 'active'
    ).length;

  }

  get endedAssignmentCount(): number {

    return this.assignments.filter(
      assignment =>
        assignment.assignment_status === 'ended'
    ).length;

  }

  get hoursCompletedCount(): number {

    return this.activeInterns.filter(
      intern =>
        intern.requiredHours > 0 &&
        intern.verifiedHours >= intern.requiredHours
    ).length;

  }

  get needsFollowUpCount(): number {

    return this.activeInterns.filter(
      intern =>
        intern.internshipStatus === 'needs_follow_up'
    ).length;

  }

  get previewInterns(): AssignedIntern[] {

    return this.activeInterns.slice(0, 3);

  }

  // =========================================
  // INTERNSHIP STATUS
  // =========================================

  private calculateInternshipStatus(
    student: StudentRecord,
    assignment: AssignmentRecord,
    verifiedHours: number
  ): string {

    if (
      assignment.assignment_status === 'ended'
    ) {
      return 'ended';
    }

    if (
      assignment.assignment_status !== 'active'
    ) {
      return 'inactive';
    }

    if (
      student.account_status !== 'active'
    ) {
      return 'inactive';
    }

    const requiredHours =
      Number(student.required_hours ?? 0);

    if (
      requiredHours > 0 &&
      verifiedHours >= requiredHours
    ) {
      return 'hours_completed';
    }

    const today =
      this.getManilaToday();

    const start =
      student.ojt_start_date;

    const end =
      student.ojt_end_date;

    if (start && today < start) {
      return 'not_started';
    }

    if (end && today > end) {
      return 'needs_follow_up';
    }

    if (
      !start ||
      !end ||
      requiredHours <= 0
    ) {
      return 'ongoing';
    }

    const startTime =
      Date.parse(`${start}T00:00:00Z`);

    const endTime =
      Date.parse(`${end}T00:00:00Z`);

    const todayTime =
      Date.parse(`${today}T00:00:00Z`);

    if (
      !Number.isFinite(startTime) ||
      !Number.isFinite(endTime) ||
      !Number.isFinite(todayTime) ||
      endTime < startTime
    ) {
      return 'ongoing';
    }

    const dayMs =
      24 * 60 * 60 * 1000;

    const totalDays =
      Math.floor(
        (endTime - startTime) / dayMs
      ) + 1;

    const elapsedDays = Math.max(
      0,
      Math.min(
        totalDays,
        Math.floor(
          (todayTime - startTime) / dayMs
        )
      )
    );

    const expectedProgress =
      elapsedDays / totalDays * 100;

    const actualProgress =
      verifiedHours / requiredHours * 100;

    if (
      expectedProgress - actualProgress > 10
    ) {
      return 'needs_follow_up';
    }

    return 'ongoing';

  }

  // =========================================
  // TAB NAVIGATION
  // =========================================

  setActiveTab(tab: SupervisorTab): void {

    this.activeTab = tab;

    this.searchQuery = '';

    this.selectedStatus = 'all';

    this.currentPage = 1;

  }

  viewAllInterns(): void {

    this.setActiveTab('interns');

  }

  viewAssignmentHistory(): void {

    this.setActiveTab('history');

  }

  viewAffectedInterns(): void {

    if (this.isUpdatingAccount) {
      return;
    }

    this.closeAccountModal();

    this.viewAllInterns();

  }

  // =========================================
  // SEARCH AND FILTERS
  // =========================================

  get filteredInterns(): AssignedIntern[] {

    const source =
      this.activeTab === 'history'
        ? this.historicalInterns
        : this.activeInterns;

    const query =
      this.searchQuery.trim().toLowerCase();

    return source.filter(intern => {

      const matchesSearch =
        !query ||
        [
          intern.fullName,
          intern.studentId,
          intern.email,
          intern.course,
          intern.yearLevel
        ].some(value =>
          value.toLowerCase().includes(query)
        );

      const matchesStatus =
        this.selectedStatus === 'all' ||
        intern.internshipStatus ===
          this.selectedStatus;

      return (
        matchesSearch &&
        matchesStatus
      );

    });

  }

  get filteredCount(): number {

    return this.filteredInterns.length;

  }

  get hasActiveFilters(): boolean {

    return (
      this.searchQuery.trim() !== '' ||
      this.selectedStatus !== 'all'
    );

  }

  onSearchChange(): void {

    this.currentPage = 1;

  }

  onFilterChange(): void {

    this.currentPage = 1;

  }

  clearFilters(): void {

    this.searchQuery = '';

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
        this.filteredCount / this.pageSize
      )
    );

  }

  get paginatedInterns(): AssignedIntern[] {

    const start =
      (this.currentPage - 1) * this.pageSize;

    return this.filteredInterns.slice(
      start,
      start + this.pageSize
    );

  }

  get showingFrom(): number {

    if (this.filteredCount === 0) {
      return 0;
    }

    return (
      (this.currentPage - 1) *
      this.pageSize + 1
    );

  }

  get showingTo(): number {

    return Math.min(
      this.currentPage * this.pageSize,
      this.filteredCount
    );

  }

  get pageNumbers(): number[] {

    const maxVisiblePages = 5;

    let start = Math.max(
      1,
      this.currentPage - 2
    );

    const end = Math.min(
      this.totalPages,
      start + maxVisiblePages - 1
    );

    start = Math.max(
      1,
      end - maxVisiblePages + 1
    );

    return Array.from(
      { length: end - start + 1 },
      (_, index) => start + index
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

  previousPage(): void {

    this.goToPage(
      this.currentPage - 1
    );

  }

  nextPage(): void {

    this.goToPage(
      this.currentPage + 1
    );

  }

  // =========================================
  // NAVIGATION
  // =========================================

  goBack(): void {

    if (
      this.isSavingEdit ||
      this.isUpdatingAccount
    ) {
      return;
    }

    void this.router.navigate([
      '/coordinator/company-supervisors'
    ]);

  }

  viewStudent(intern: AssignedIntern): void {

    if (
      this.isSavingEdit ||
      this.isUpdatingAccount
    ) {
      return;
    }

    void this.router.navigate([
      '/coordinator/student-interns',
      intern.id
    ]);

  }

  retryLoad(): void {

    this.clearActionMessages();

    void this.loadSupervisorDetails();

  }

  // =========================================
  // STATUS LABELS
  // =========================================

  getStatusLabel(status: string): string {

    switch (status.toLowerCase()) {

      case 'active':
        return 'Active';

      case 'inactive':
        return 'Inactive';

      case 'disabled':
        return 'Disabled';

      case 'ongoing':
        return 'Ongoing';

      case 'not_started':
        return 'Not started';

      case 'needs_follow_up':
        return 'Needs follow-up';

      case 'hours_completed':
        return 'Hours completed';

      case 'ended':
        return 'Ended';

      default:
        return 'Unknown';

    }

  }

  getStatusClass(status: string): string {

    switch (status) {

      case 'active':
        return 'active';

      case 'ongoing':
        return 'ongoing';

      case 'hours_completed':
        return 'hours-completed';

      case 'needs_follow_up':
        return 'needs-follow-up';

      case 'not_started':
        return 'not-started';

      case 'disabled':
        return 'disabled';

      case 'ended':
        return 'ended';

      default:
        return 'inactive';

    }

  }

  // =========================================
  // DATE FORMATTING
  // =========================================

  formatDate(
    value: string | null | undefined
  ): string {

    if (!value) {
      return 'Not specified';
    }

    const normalizedValue =
      /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? `${value}T00:00:00+08:00`
        : value;

    const date =
      new Date(normalizedValue);

    if (!Number.isFinite(date.getTime())) {
      return 'Not specified';
    }

    return new Intl.DateTimeFormat(
      'en-US',
      {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'Asia/Manila'
      }
    ).format(date);

  }

  formatInternshipPeriod(
    start: string | null,
    end: string | null
  ): string {

    if (!start && !end) {
      return 'Not scheduled';
    }

    if (start && !end) {

      return (
        `${this.formatDate(start)} onwards`
      );

    }

    if (!start && end) {

      return (
        `Until ${this.formatDate(end)}`
      );

    }

    return (
      `${this.formatDate(start)} – ` +
      `${this.formatDate(end)}`
    );

  }

  private getManilaToday(): string {

    const parts = new Intl.DateTimeFormat(
      'en-US',
      {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }
    ).formatToParts(new Date());

    const year =
      parts.find(
        part => part.type === 'year'
      )?.value;

    const month =
      parts.find(
        part => part.type === 'month'
      )?.value;

    const day =
      parts.find(
        part => part.type === 'day'
      )?.value;

    return `${year}-${month}-${day}`;

  }

  // =========================================
  // HOURS FORMATTING
  // =========================================

  private roundHours(value: number): number {

    return Math.round(value * 100) / 100;

  }

  formatHours(value: number): string {

    if (!Number.isFinite(value)) {
      return '0';
    }

    return new Intl.NumberFormat(
      'en-US',
      {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      }
    ).format(value);

  }

  // =========================================
  // AVATAR INITIALS
  // =========================================

  private getInitials(name: string): string {

    const ignoredPrefixes = new Set([
      'mr',
      'mrs',
      'ms',
      'dr',
      'engr',
      'atty',
      'prof',
      'ma'
    ]);

    const parts = (name || '')
      .trim()
      .split(/\s+/)
      .filter(part => {

        const normalized = part
          .replace(/\./g, '')
          .toLowerCase();

        return (
          normalized !== '' &&
          !ignoredPrefixes.has(normalized)
        );

      });

    if (parts.length === 0) {
      return 'CS';
    }

    if (parts.length === 1) {

      return parts[0]
        .substring(0, 2)
        .toUpperCase();

    }

    return (
      parts[0].charAt(0) +
      parts[parts.length - 1].charAt(0)
    ).toUpperCase();

  }

  // =========================================
  // AVATAR COLORS
  // =========================================

  private getAvatarColor(id: string): string {

    const colors = [
      'rose',
      'green',
      'blue',
      'purple',
      'orange'
    ];

    let hash = 0;

    for (
      let index = 0;
      index < id.length;
      index++
    ) {

      hash =
        id.charCodeAt(index) +
        ((hash << 5) - hash);

    }

    return colors[
      Math.abs(hash) % colors.length
    ];

  }

  // =========================================
  // ERROR HANDLING
  // =========================================

  private getErrorMessage(
    error: unknown
  ): string {

    if (error instanceof Error) {
      return error.message;
    }

    if (
      typeof error === 'object' &&
      error !== null &&
      'message' in error
    ) {
      return String(error.message);
    }

    return (
      'Unable to complete the request. ' +
      'Please check your connection and try again.'
    );

  }

  // =========================================
  // TRACK BY
  // =========================================

  trackByIntern(
    _index: number,
    intern: AssignedIntern
  ): string {

    return intern.assignmentId;

  }

  trackByAssignment(
    _index: number,
    assignment: AssignmentRecord
  ): string {

    return assignment.id;

  }

  trackByPage(
    _index: number,
    page: number
  ): number {

    return page;

  }

}
