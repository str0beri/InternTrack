
import {
  Component,
  OnInit,
  inject,
  ChangeDetectorRef,
  NgZone
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular';

import { addIcons } from 'ionicons';

import {
  addOutline,
  searchOutline,
  eyeOutline,
  eyeOffOutline,
  chevronBackOutline,
  chevronForwardOutline,
  chevronDownOutline,
  refreshOutline,
  peopleOutline,
  alertCircleOutline,
  closeOutline,
  checkmarkCircleOutline,
  informationCircleOutline,
  warningOutline
} from 'ionicons/icons';

import {
  SupabaseService
} from '../../../services/supabase.service';


// =========================================
// INTERFACES
// =========================================

interface SupervisorRecord {
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
}

interface AssignmentRecord {
  id: string;
  student_id: string;
  supervisor_id: string;
  assignment_status: string;
}

interface CompanySupervisor {
  id: string;
  userId: string | null;
  supervisorId: string;
  fullName: string;
  email: string;
  companyName: string;
  department: string;
  position: string;
  contactNumber: string;
  accountStatus: string;
  dateRegistered: string | null;
  internCount: number;
  initials: string;
  avatarColor: string;
}

interface AddSupervisorForm {
  fullName: string;
  email: string;
  contactNumber: string;
  companyName: string;
  position: string;
  department: string;
  temporaryPassword: string;
}

interface RegistrationResponse {
  success: boolean;
  message: string;
  confirmationEmailSent?: boolean;

  supervisor?: {
    id: string;
    supervisor_id: string;
    full_name: string;
    email: string;
    company_name: string;
    account_status: string;
  };
}


// =========================================
// COMPONENT
// =========================================

@Component({
  selector: 'app-company-supervisors',
  templateUrl: './company-supervisors.page.html',
  styleUrls: ['./company-supervisors.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonIcon
  ]
})

export class CompanySupervisorsPage implements OnInit {

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

  supervisors: CompanySupervisor[] = [];

  isLoading = true;

  errorMessage = '';

  successMessage = '';

  warningMessage = '';

  private loadingInProgress = false;


  // =========================================
  // FILTERS
  // =========================================

  searchQuery = '';

  selectedCompany = 'all';

  selectedStatus = 'all';


  // =========================================
  // PAGINATION
  // =========================================

  currentPage = 1;

  readonly pageSize = 8;


  // =========================================
  // ADD SUPERVISOR MODAL STATE
  // =========================================

  showAddModal = false;

  isCreatingSupervisor = false;

  showPassword = false;

  addErrorMessage = '';

  addForm: AddSupervisorForm =
    this.createEmptyForm();


  // =========================================
  // CONSTRUCTOR
  // =========================================

  constructor() {

    addIcons({
      addOutline,
      searchOutline,
      eyeOutline,
      eyeOffOutline,
      chevronBackOutline,
      chevronForwardOutline,
      chevronDownOutline,
      refreshOutline,
      peopleOutline,
      alertCircleOutline,
      closeOutline,
      checkmarkCircleOutline,
      informationCircleOutline,
      warningOutline
    });

  }


  // =========================================
  // LIFECYCLE
  // =========================================

  ngOnInit(): void {

    void this.loadSupervisors();

  }

  ionViewWillEnter(): void {

    void this.loadSupervisors();

  }


  // =========================================
  // LOAD SUPERVISORS
  // =========================================

  async loadSupervisors(): Promise<void> {

    if (this.loadingInProgress) {
      return;
    }

    this.loadingInProgress = true;

    this.ngZone.run(() => {

      this.isLoading = true;

      this.errorMessage = '';

      this.cdr.detectChanges();

    });

    try {

      const [
        supervisorRecords,
        assignmentRecords
      ] = await Promise.all([
        this.fetchSupervisorRecords(),
        this.fetchActiveAssignments()
      ]);


      // Count unique active student placements.

      const assignedStudents =
        new Map<string, Set<string>>();

      for (const assignment of assignmentRecords) {

        if (!assignedStudents.has(
          assignment.supervisor_id
        )) {

          assignedStudents.set(
            assignment.supervisor_id,
            new Set<string>()
          );

        }

        assignedStudents
          .get(assignment.supervisor_id)
          ?.add(assignment.student_id);

      }


      // Convert database records into UI records.

      const mappedSupervisors =
        supervisorRecords.map((record) => {

          const fullName =
            record.full_name?.trim() ||
            'Unnamed supervisor';

          return {

            id: record.id,

            userId: record.user_id,

            supervisorId:
              record.supervisor_id ||
              'Not available',

            fullName,

            email:
              record.email ||
              'Not provided',

            companyName:
              record.company_name?.trim() ||
              'Not specified',

            department:
              record.department?.trim() ||
              'Not specified',

            position:
              record.position?.trim() ||
              'Company Supervisor',

            contactNumber:
              record.contact_number ||
              'Not provided',

            accountStatus:
              record.account_status ||
              'inactive',

            dateRegistered:
              record.date_registered,

            internCount:
              assignedStudents.get(record.id)?.size ?? 0,

            initials:
              this.getInitials(fullName),

            avatarColor:
              this.getAvatarColor(record.id)

          };

        });

      this.ngZone.run(() => {

        this.supervisors = mappedSupervisors;

        if (
          this.selectedCompany !== 'all' &&
          !this.companyOptions.includes(
            this.selectedCompany
          )
        ) {

          this.selectedCompany = 'all';

        }

        this.currentPage = 1;

        this.cdr.detectChanges();

      });

    } catch (error: unknown) {

      console.error(
        'Failed to load company supervisors:',
        error
      );

      this.ngZone.run(() => {

        this.errorMessage =
          this.getErrorMessage(error);

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
  // FETCH SUPERVISOR RECORDS
  // =========================================

  private async fetchSupervisorRecords():
    Promise<SupervisorRecord[]> {

    const records: SupervisorRecord[] = [];

    const batchSize = 500;

    let offset = 0;

    while (true) {

      const { data, error } = await this.supabase
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
          date_registered
        `)
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

      const batch =
        (data ?? []) as SupervisorRecord[];

      records.push(...batch);

      if (batch.length < batchSize) {
        break;
      }

      offset += batchSize;

    }

    return records;

  }


  // =========================================
  // FETCH ACTIVE ASSIGNMENTS
  // =========================================

  private async fetchActiveAssignments():
    Promise<AssignmentRecord[]> {

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
          assignment_status
        `)
        .eq('assignment_status', 'active')
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
  // SUMMARY COUNTS
  // =========================================

  get totalSupervisors(): number {

    return this.supervisors.length;

  }

  get activeSupervisors(): number {

    return this.supervisors.filter(
      supervisor =>
        supervisor.accountStatus === 'active'
    ).length;

  }

  get inactiveSupervisors(): number {

    return this.supervisors.filter(
      supervisor =>
        supervisor.accountStatus !== 'active'
    ).length;

  }

  get partnerCompanies(): number {

    const companies = new Set(

      this.supervisors
        .map(supervisor =>
          supervisor.companyName
            .trim()
            .toLowerCase()
        )
        .filter(company =>
          company !== '' &&
          company !== 'not specified'
        )

    );

    return companies.size;

  }

  get summaryText(): string {

    const supervisorLabel =
      this.totalSupervisors === 1
        ? 'supervisor'
        : 'supervisors';

    const accountLabel =
      this.activeSupervisors === 1
        ? 'account'
        : 'accounts';

    const companyLabel =
      this.partnerCompanies === 1
        ? 'partner company'
        : 'partner companies';

    return (

      `${this.totalSupervisors} registered ` +

      `host-company ${supervisorLabel} · ` +

      `${this.activeSupervisors} active ` +

      `${accountLabel} · ` +

      `${this.partnerCompanies} ${companyLabel}.`

    );

  }


  // =========================================
  // COMPANY FILTER OPTIONS
  // =========================================

  get companyOptions(): string[] {

    return Array.from(

      new Set(

        this.supervisors
          .map(supervisor =>
            supervisor.companyName
          )
          .filter(company =>
            company !== 'Not specified'
          )

      )

    ).sort((a, b) => a.localeCompare(b));

  }


  // =========================================
  // FILTERED SUPERVISORS
  // =========================================

  get filteredSupervisors(): CompanySupervisor[] {

    const query =
      this.searchQuery.trim().toLowerCase();

    return this.supervisors.filter(supervisor => {

      const matchesSearch =
        !query ||
        [
          supervisor.fullName,
          supervisor.supervisorId,
          supervisor.email,
          supervisor.department,
          supervisor.position,
          supervisor.companyName
        ].some(value =>
          value.toLowerCase().includes(query)
        );

      const matchesCompany =
        this.selectedCompany === 'all' ||
        supervisor.companyName ===
          this.selectedCompany;

      const matchesStatus =
        this.selectedStatus === 'all' ||
        (
          this.selectedStatus === 'active'
            ? supervisor.accountStatus === 'active'
            : supervisor.accountStatus !== 'active'
        );

      return (
        matchesSearch &&
        matchesCompany &&
        matchesStatus
      );

    });

  }

  get filteredCount(): number {

    return this.filteredSupervisors.length;

  }

  get hasActiveFilters(): boolean {

    return (
      this.searchQuery.trim() !== '' ||
      this.selectedCompany !== 'all' ||
      this.selectedStatus !== 'all'
    );

  }


  // =========================================
  // FILTER EVENTS
  // =========================================

  onSearchChange(): void {

    this.currentPage = 1;

  }

  onFilterChange(): void {

    this.currentPage = 1;

  }

  clearFilters(): void {

    this.searchQuery = '';

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
        this.filteredCount / this.pageSize
      )
    );

  }

  get paginatedSupervisors():
    CompanySupervisor[] {

    const startIndex =
      (this.currentPage - 1) * this.pageSize;

    return this.filteredSupervisors.slice(
      startIndex,
      startIndex + this.pageSize
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

    const total = this.totalPages;

    const maxVisiblePages = 5;

    if (total <= maxVisiblePages) {

      return Array.from(
        { length: total },
        (_, index) => index + 1
      );

    }

    let start = Math.max(
      1,
      this.currentPage - 2
    );

    const end = Math.min(
      total,
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
  // ADD SUPERVISOR FORM
  // =========================================

  private createEmptyForm(): AddSupervisorForm {

    return {
      fullName: '',
      email: '',
      contactNumber: '',
      companyName: '',
      position: '',
      department: '',
      temporaryPassword: ''
    };

  }

  get canAddSupervisor(): boolean {

    return (
      !this.isLoading &&
      !this.isCreatingSupervisor &&
      !this.errorMessage
    );

  }

  openAddModal(): void {

    if (!this.canAddSupervisor) {
      return;
    }

    this.addForm = this.createEmptyForm();

    this.addErrorMessage = '';

    this.successMessage = '';

    this.warningMessage = '';

    this.showPassword = false;

    this.showAddModal = true;

  }

  closeAddModal(): void {

    if (this.isCreatingSupervisor) {
      return;
    }

    this.showAddModal = false;

    this.showPassword = false;

    this.addErrorMessage = '';

    this.addForm = this.createEmptyForm();

  }

  togglePasswordVisibility(): void {

    this.showPassword = !this.showPassword;

  }

  onAddFormChange(): void {

    this.addErrorMessage = '';

  }


  // =========================================
  // FORM VALIDATION
  // =========================================

  get isEmailValid(): boolean {

    const email =
      this.addForm.email.trim();

    const emailPattern =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    return (
      emailPattern.test(email) &&
      email.length <= 254
    );

  }

  get isPasswordValid(): boolean {

    const password =
      this.addForm.temporaryPassword;

    return (
      password.length >= 8 &&
      password.length <= 72 &&
      password.trim().length > 0
    );

  }

  get emailAlreadyExists(): boolean {

    const email =
      this.addForm.email.trim().toLowerCase();

    if (!email) {
      return false;
    }

    return this.supervisors.some(
      supervisor =>
        supervisor.email
          .trim()
          .toLowerCase() === email
    );

  }

  get canCreateSupervisor(): boolean {

    const form = this.addForm;

    return (

      !this.isCreatingSupervisor &&

      form.fullName.trim().length > 0 &&
      form.fullName.trim().length <= 150 &&

      this.isEmailValid &&

      !this.emailAlreadyExists &&

      form.companyName.trim().length > 0 &&
      form.companyName.trim().length <= 150 &&

      form.position.trim().length > 0 &&
      form.position.trim().length <= 100 &&

      form.department.trim().length > 0 &&
      form.department.trim().length <= 100 &&

      form.contactNumber.trim().length <= 30 &&

      this.isPasswordValid

    );

  }

  private validateAddForm(): string {

    const form = this.addForm;

    if (!form.fullName.trim()) {
      return 'Please enter the supervisor’s full name.';
    }

    if (!this.isEmailValid) {
      return 'Please enter a valid company email.';
    }

    if (this.emailAlreadyExists) {
      return 'This supervisor email is already registered.';
    }

    if (!form.companyName.trim()) {
      return 'Please enter the company name.';
    }

    if (!form.position.trim()) {
      return 'Please enter the supervisor’s position.';
    }

    if (!form.department.trim()) {
      return 'Please enter the department or unit.';
    }

    if (!this.isPasswordValid) {

      return (
        'The temporary password must contain ' +
        '8 to 72 characters.'
      );

    }

    if (
      form.fullName.trim().length > 150 ||
      form.companyName.trim().length > 150 ||
      form.position.trim().length > 100 ||
      form.department.trim().length > 100 ||
      form.contactNumber.trim().length > 30
    ) {

      return (
        'One or more fields exceed ' +
        'the allowed character limit.'
      );

    }

    return '';

  }


  // =========================================
  // CREATE SUPERVISOR ACCOUNT
  // =========================================

  async createSupervisor(): Promise<void> {

    if (
      this.isCreatingSupervisor ||
      !this.showAddModal
    ) {
      return;
    }

    this.addErrorMessage = '';

    const validationError =
      this.validateAddForm();

    if (validationError) {

      this.addErrorMessage = validationError;

      return;

    }

    this.isCreatingSupervisor = true;

    this.showPassword = false;

    this.cdr.detectChanges();

    try {

      // Verify that a current session exists.

      const {
        data: sessionData,
        error: sessionError
      } = await this.supabase.auth.getSession();

      if (
        sessionError ||
        !sessionData.session?.access_token
      ) {

        throw new Error(
          'Your session has expired. ' +
          'Please log in again.'
        );

      }


      // Use the registered company spelling
      // when an existing company matches.

      const enteredCompany =
        this.addForm.companyName.trim();

      const existingCompany =
        this.companyOptions.find(
          company =>
            company.toLowerCase() ===
            enteredCompany.toLowerCase()
        );

      const payload = {

        fullName:
          this.addForm.fullName.trim(),

        email:
          this.addForm.email
            .trim()
            .toLowerCase(),

        contactNumber:
          this.addForm.contactNumber.trim(),

        companyName:
          existingCompany || enteredCompany,

        position:
          this.addForm.position.trim(),

        department:
          this.addForm.department.trim(),

        temporaryPassword:
          this.addForm.temporaryPassword

      };


      // Call the secure backend function.
      // No service-role key is used here.

      const { data, error } =
        await this.supabase.functions.invoke(
          'create-company-supervisor',
          {
            body: payload,

            headers: {
              Authorization:
                `Bearer ${sessionData.session.access_token}`
            }
          }
        );

      if (error) {

        const message =
          await this.getRegistrationError(error);

        throw new Error(message);

      }

      const result =
        data as RegistrationResponse | null;

      if (
        !result ||
        result.success !== true ||
        !result.supervisor?.id
      ) {

        throw new Error(

          result?.message ||

          'The registration result could not be verified. ' +
          'Refresh the list before trying again.'

        );

      }

      const registeredSupervisor =
        result.supervisor;


      // =====================================
      // SUCCESSFUL REGISTRATION
      // =====================================

      this.ngZone.run(() => {

        this.showAddModal = false;

        this.showPassword = false;

        this.addErrorMessage = '';

        this.addForm = this.createEmptyForm();

        this.successMessage =

          `${registeredSupervisor.full_name} ` +

          `has been registered successfully ` +

          `as ${registeredSupervisor.supervisor_id}.`;

        this.warningMessage = '';

        if (
          result.confirmationEmailSent === false
        ) {

          this.warningMessage =

            'The account was created, but the email ' +

            'confirmation could not be sent. ' +

            'Email confirmation is still required.';

        } else if (
          result.confirmationEmailSent === true
        ) {

          this.warningMessage =

            'A confirmation email was requested. ' +

            'The supervisor must confirm their email ' +

            'before signing in.';

        }

        this.clearFilters();

        this.cdr.detectChanges();

      });


      // Refresh actual database records.

      await this.loadSupervisors();


      // Navigate to the page containing
      // the newly registered supervisor.

      this.ngZone.run(() => {

        if (!this.errorMessage) {

          const newSupervisorIndex =
            this.filteredSupervisors.findIndex(
              supervisor =>
                supervisor.id ===
                registeredSupervisor.id
            );

          if (newSupervisorIndex >= 0) {

            this.currentPage =
              Math.floor(
                newSupervisorIndex / this.pageSize
              ) + 1;

          } else {

            this.warningMessage +=

              ' The new record is not visible yet. ' +

              'Refresh the list to check its status.';

          }

        }

        this.cdr.detectChanges();

      });

    } catch (error: unknown) {

      this.ngZone.run(() => {

        this.addErrorMessage =
          this.getErrorMessage(error);

        this.cdr.detectChanges();

      });

    } finally {

      this.ngZone.run(() => {

        this.isCreatingSupervisor = false;

        this.cdr.detectChanges();

      });

    }

  }


  // =========================================
  // EDGE FUNCTION ERROR HANDLING
  // =========================================

  private async getRegistrationError(
    error: unknown
  ): Promise<string> {

    if (
      typeof error === 'object' &&
      error !== null &&
      'context' in error
    ) {

      const context =
        (error as { context?: unknown }).context;

      if (context instanceof Response) {

        try {

          const body =
            await context.clone().json();

          if (
            typeof body?.message === 'string' &&
            body.message.trim()
          ) {

            return body.message;

          }

        } catch {

          // Fall back to the HTTP status.

        }

        switch (context.status) {

          case 400:

            return (
              'Invalid registration information. ' +
              'Please review the form.'
            );

          case 401:

            return (
              'Your session has expired or could ' +
              'not be verified. Please log in again.'
            );

          case 403:

            return (
              'You do not have permission ' +
              'to register company supervisors.'
            );

          case 409:

            return (
              'An account with this email ' +
              'already exists.'
            );

          case 429:

            return (
              'Too many requests. ' +
              'Please try again later.'
            );

          default:

            return (

              'Registration could not be confirmed. ' +

              'Refresh the supervisor list before ' +

              'submitting again.'

            );

        }

      }

    }

    return (

      'Unable to confirm the registration. ' +

      'Check your connection and refresh the ' +

      'supervisor list before trying again.'

    );

  }


  // =========================================
  // FEEDBACK MESSAGES
  // =========================================

  dismissSuccessMessage(): void {

    this.successMessage = '';

  }

  dismissWarningMessage(): void {

    this.warningMessage = '';

  }

  dismissAddError(): void {

    this.addErrorMessage = '';

  }


  // =========================================
  // NAVIGATION
  // =========================================

  viewSupervisor(
    supervisor: CompanySupervisor
  ): void {

    if (this.isCreatingSupervisor) {
      return;
    }

    void this.router.navigate([
      '/coordinator/company-supervisors',
      supervisor.id
    ]);

  }


  // =========================================
  // REFRESH
  // =========================================

  retryLoad(): void {

    void this.loadSupervisors();

  }


  // =========================================
  // ACCOUNT STATUS
  // =========================================

  getStatusLabel(status: string): string {

    switch (status.toLowerCase()) {

      case 'active':
        return 'Active';

      case 'inactive':
        return 'Inactive';

      case 'disabled':
        return 'Disabled';

      default:
        return 'Unknown';

    }

  }

  getStatusClass(status: string): string {

    return status === 'active'
      ? 'active'
      : 'inactive';

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

    const parts = name

      .trim()

      .split(/\s+/)

      .filter(part => {

        const normalized = part
          .replace(/\./g, '')
          .toLowerCase();

        return !ignoredPrefixes.has(
          normalized
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
  // GENERAL ERROR HANDLING
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

      'Please check your connection ' +

      'and try again.'

    );

  }


  // =========================================
  // TRACK BY
  // =========================================

  trackBySupervisor(
    _index: number,
    supervisor: CompanySupervisor
  ): string {

    return supervisor.id;

  }

  trackByPage(
    _index: number,
    page: number
  ): number {

    return page;

  }

}
