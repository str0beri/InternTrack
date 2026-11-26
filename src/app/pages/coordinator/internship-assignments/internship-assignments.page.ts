import {
  Component,
  OnInit,
  ChangeDetectorRef,
  NgZone,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonIcon, IonHeader, IonToolbar } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  addOutline,
  searchOutline,
  chevronDownOutline,
  chevronBackOutline,
  chevronForwardOutline,
  eyeOutline,
  closeOutline,
  informationCircleOutline,
  alertCircleOutline,
  checkmarkCircleOutline,
  businessOutline,
  refreshOutline,
  calendarOutline
} from 'ionicons/icons';
import { SupabaseService } from '../../../services/supabase.service';
interface Student {
  id: string;
  student_id: string;
  full_name: string;
  account_status: string;
  ojt_start_date: string | null;
  ojt_end_date: string | null;
}
interface Supervisor {
  id: string;
  supervisor_id: string;
  full_name: string;
  company_name: string;
  department: string | null;
  account_status: string;
}
interface Assignment {
  id: string;
  student_id: string;
  supervisor_id: string;
  company_name: string;
  assigned_date: string | null;
  start_date: string | null;
  end_date: string | null;
  assignment_status: string;
  assignment_history: any[];
  studentName: string;
  studentNumber: string;
  supervisorName: string;
  department: string;
  initials: string;
  avatarColor: string;
}
interface AssignmentForm {
  studentId: string;
  companyName: string;
  supervisorId: string;
  startDate: string;
  endDate: string;
  reason: string;
}
@Component({
  selector: 'app-internship-assignments',
  templateUrl: './internship-assignments.page.html',
  styleUrls: ['./internship-assignments.page.scss'],
  standalone: true,
  imports: [IonToolbar, IonHeader, 
    CommonModule,
    FormsModule,
    IonIcon
  ]
})
export class InternshipAssignmentsPage implements OnInit {
  private supabaseService = inject(SupabaseService);
  private supabase = this.supabaseService.getClient();
  private cdr = inject(ChangeDetectorRef);
  private ngZone = inject(NgZone);
  students: Student[] = [];
  supervisors: Supervisor[] = [];
  assignments: Assignment[] = [];
  isLoading = true;
  isSaving = false;
  private loadingInProgress = false;
  errorMessage = '';
  successMessage = '';
  formErrorMessage = '';
  searchQuery = '';
  selectedCompany = 'all';
  selectedStatus = 'all';
  currentPage = 1;
  readonly pageSize = 10;
  showAssignmentModal = false;
  showReviewModal = false;
  showViewModal = false;
  modalMode: 'new' | 'change' = 'new';
  selectedAssignment: Assignment | null = null;
  viewedAssignment: Assignment | null = null;
  assignmentForm: AssignmentForm = this.emptyForm();
  constructor() {
    addIcons({
      addOutline,
      searchOutline,
      chevronDownOutline,
      chevronBackOutline,
      chevronForwardOutline,
      eyeOutline,
      closeOutline,
      informationCircleOutline,
      alertCircleOutline,
      checkmarkCircleOutline,
      businessOutline,
      refreshOutline,
      calendarOutline
    });
  }
  ngOnInit(): void {
    void this.loadAssignments();
  }
  ionViewWillEnter(): void {
    void this.loadAssignments();
  }
  private emptyForm(): AssignmentForm {
    return {
      studentId: '',
      companyName: '',
      supervisorId: '',
      startDate: '',
      endDate: '',
      reason: ''
    };
  }
  // ==========================================
  // DATABASE
  // ==========================================
  private async fetchAll<T>(
    table: string,
    columns: string
  ): Promise<T[]> {
    const records: T[] = [];
    const batchSize = 500;
    let offset = 0;
    while (true) {
      const { data, error } = await this.supabase
        .from(table)
        .select(columns)
        .order('id', { ascending: true })
        .range(offset, offset + batchSize - 1);
      if (error) {
        throw error;
      }
      const batch = (data ?? []) as unknown as T[];
      records.push(...batch);
      if (batch.length < batchSize) {
        break;
      }
      offset += batchSize;
    }
    return records;
  }
  async loadAssignments(): Promise<void> {
    if (this.loadingInProgress) {
      return;
    }
    this.loadingInProgress = true;
    this.isLoading = true;
    this.errorMessage = '';
    try {
      const [
        students,
        supervisors,
        rawAssignments
      ] = await Promise.all([
        this.fetchAll<Student>(
          'students',
          `
            id,
            student_id,
            full_name,
            account_status,
            ojt_start_date,
            ojt_end_date
          `
        ),
        this.fetchAll<Supervisor>(
          'company_supervisors',
          `
            id,
            supervisor_id,
            full_name,
            company_name,
            department,
            account_status
          `
        ),
        this.fetchAll<any>(
          'intern_supervisor_assignments',
          `
            id,
            student_id,
            supervisor_id,
            company_name,
            assigned_date,
            start_date,
            end_date,
            assignment_status,
            assignment_history
          `
        )
      ]);
      const studentMap = new Map(
        students.map(student => [student.id, student])
      );
      const supervisorMap = new Map(
        supervisors.map(supervisor => [
          supervisor.id,
          supervisor
        ])
      );
      const assignments: Assignment[] =
        rawAssignments.map(record => {
          const student = studentMap.get(
            record.student_id
          );
          const supervisor = supervisorMap.get(
            record.supervisor_id
          );
          const studentName =
            student?.full_name || 'Unknown student';
          return {
            id: record.id,
            student_id: record.student_id,
            supervisor_id: record.supervisor_id,
            company_name: record.company_name,
            assigned_date: record.assigned_date,
            start_date: record.start_date,
            end_date: record.end_date,
            assignment_status:
              record.assignment_status || 'unknown',
            assignment_history:
              Array.isArray(record.assignment_history)
                ? record.assignment_history
                : [],
            studentName,
            studentNumber:
              student?.student_id || 'Not available',
            supervisorName:
              supervisor?.full_name || 'Unknown supervisor',
            department:
              supervisor?.department || '',
            initials: this.getInitials(studentName),
            avatarColor:
              this.getAvatarColor(record.student_id || record.id)
          };
        });
      assignments.sort((a, b) => {
        const dateA = a.assigned_date
          ? new Date(a.assigned_date).getTime()
          : 0;
        const dateB = b.assigned_date
          ? new Date(b.assigned_date).getTime()
          : 0;
        return dateB - dateA ||
          a.id.localeCompare(b.id);
      });
      this.ngZone.run(() => {
        this.students = students;
        this.supervisors = supervisors;
        this.assignments = assignments;
        this.currentPage = Math.min(
          this.currentPage,
          this.totalPages
        );
        this.cdr.detectChanges();
      });
    } catch (error) {
      console.error('Assignment loading error:', error);
      this.ngZone.run(() => {
        this.errorMessage =
          'Unable to load internship assignments. Please try again.';
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
    void this.loadAssignments();
  }
  // ==========================================
  // SUMMARY
  // ==========================================
  get totalAssignments(): number {
    return this.assignments.length;
  }
  get activeAssignments(): Assignment[] {
    return this.assignments.filter(
      assignment =>
        assignment.assignment_status === 'active'
    );
  }
  get activePlacementCount(): number {
    return this.activeAssignments.length;
  }
  get partnerCompanyCount(): number {
    return new Set(
      this.activeAssignments.map(
        assignment => assignment.company_name
      )
    ).size;
  }
  get unassignedStudents(): Student[] {
    const assignedIds = new Set(
      this.activeAssignments.map(
        assignment => assignment.student_id
      )
    );
    return this.students
      .filter(student =>
        student.account_status === 'active' &&
        !assignedIds.has(student.id)
      )
      .sort((a, b) =>
        a.full_name.localeCompare(b.full_name)
      );
  }
  get unassignedCount(): number {
    return this.unassignedStudents.length;
  }
  get summaryText(): string {
    const placements = this.activePlacementCount;
    const unassigned = this.unassignedCount;
    return `${placements} active ${placements === 1 ? 'placement' : 'placements'} · ${unassigned} ${unassigned === 1 ? 'intern' : 'interns'} awaiting assignment.`;
  }
  // ==========================================
  // SEARCH AND FILTERS
  // ==========================================
  get companyOptions(): string[] {
    return Array.from(
      new Set(
        this.assignments
          .map(assignment => assignment.company_name)
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
  }
  get filteredAssignments(): Assignment[] {
    const query =
      this.searchQuery.trim().toLowerCase();
    return this.assignments.filter(assignment => {
      const matchesSearch =
        !query ||
        [
          assignment.studentName,
          assignment.studentNumber,
          assignment.company_name,
          assignment.supervisorName,
          assignment.department
        ].some(value =>
          (value || '').toLowerCase().includes(query)
        );
      const matchesCompany =
        this.selectedCompany === 'all' ||
        assignment.company_name === this.selectedCompany;
      const matchesStatus =
        this.selectedStatus === 'all' ||
        this.getStatusKey(assignment) ===
          this.selectedStatus;
      return matchesSearch &&
        matchesCompany &&
        matchesStatus;
    });
  }
  get filteredCount(): number {
    return this.filteredAssignments.length;
  }
  get hasActiveFilters(): boolean {
    return !!this.searchQuery.trim() ||
      this.selectedCompany !== 'all' ||
      this.selectedStatus !== 'all';
  }
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
  // ==========================================
  // PAGINATION
  // ==========================================
  get totalPages(): number {
    return Math.max(
      1,
      Math.ceil(this.filteredCount / this.pageSize)
    );
  }
  get paginatedAssignments(): Assignment[] {
    const start =
      (this.currentPage - 1) * this.pageSize;
    return this.filteredAssignments.slice(
      start,
      start + this.pageSize
    );
  }
  get showingFrom(): number {
    return this.filteredCount === 0
      ? 0
      : (this.currentPage - 1) * this.pageSize + 1;
  }
  get showingTo(): number {
    return Math.min(
      this.currentPage * this.pageSize,
      this.filteredCount
    );
  }
  get pageNumbers(): number[] {
    const maxVisible = 5;
    let start = Math.max(
      1,
      this.currentPage - 2
    );
    const end = Math.min(
      this.totalPages,
      start + maxVisible - 1
    );
    start = Math.max(
      1,
      end - maxVisible + 1
    );
    return Array.from(
      { length: end - start + 1 },
      (_, index) => start + index
    );
  }
  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
    }
  }
  previousPage(): void {
    this.goToPage(this.currentPage - 1);
  }
  nextPage(): void {
    this.goToPage(this.currentPage + 1);
  }
  // ==========================================
  // ASSIGNMENT FORM OPTIONS
  // ==========================================
  get activeSupervisors(): Supervisor[] {
    return this.supervisors.filter(
      supervisor =>
        supervisor.account_status === 'active'
    );
  }
  get availableCompanies(): string[] {
    return Array.from(
      new Set(
        this.activeSupervisors
          .map(supervisor => supervisor.company_name)
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
  }
  get availableSupervisors(): Supervisor[] {
    if (!this.assignmentForm.companyName) {
      return [];
    }
    return this.activeSupervisors
      .filter(supervisor =>
        supervisor.company_name ===
          this.assignmentForm.companyName
      )
      .sort((a, b) =>
        a.full_name.localeCompare(b.full_name)
      );
  }
  get selectedStudent(): Student | undefined {
    return this.students.find(
      student =>
        student.id === this.assignmentForm.studentId
    );
  }
  get selectedSupervisor(): Supervisor | undefined {
    return this.availableSupervisors.find(
      supervisor =>
        supervisor.id === this.assignmentForm.supervisorId
    );
  }
  get canAddAssignment(): boolean {
    return !this.isLoading &&
      !this.errorMessage &&
      this.unassignedCount > 0 &&
      this.activeSupervisors.length > 0;
  }
  get isChangeMode(): boolean {
    return this.modalMode === 'change';
  }
  get assignmentModalTitle(): string {
    return this.isChangeMode
      ? 'Change internship assignment'
      : 'New internship assignment';
  }
  get assignmentModalDescription(): string {
    return this.isChangeMode
      ? 'Changing an active placement requires a written reason and keeps the previous assignment in history.'
      : 'Place an unassigned intern with one of the registered partner companies.';
  }
  // ==========================================
  // NEW ASSIGNMENT
  // ==========================================
  openNewAssignment(): void {
    if (!this.canAddAssignment) {
      return;
    }
    this.modalMode = 'new';
    this.selectedAssignment = null;
    this.assignmentForm = this.emptyForm();
    this.formErrorMessage = '';
    this.showAssignmentModal = true;
  }
  onStudentChange(): void {
    const student = this.selectedStudent;
    this.assignmentForm.startDate =
      student?.ojt_start_date || '';
    this.assignmentForm.endDate =
      student?.ojt_end_date || '';
    this.formErrorMessage = '';
  }
  onCompanyChange(): void {
    this.assignmentForm.supervisorId = '';
    this.formErrorMessage = '';
  }
  onFormChange(): void {
    this.formErrorMessage = '';
  }
  // ==========================================
  // CHANGE ASSIGNMENT
  // ==========================================
  openManageAssignment(
    assignment: Assignment
  ): void {
    if (assignment.assignment_status !== 'active') {
      this.openViewAssignment(assignment);
      return;
    }
    this.modalMode = 'change';
    this.selectedAssignment = assignment;
    this.assignmentForm = {
      studentId: assignment.student_id,
      companyName: assignment.company_name,
      supervisorId: assignment.supervisor_id,
      startDate: assignment.start_date || '',
      endDate: assignment.end_date || '',
      reason: ''
    };
    this.formErrorMessage = '';
    this.showAssignmentModal = true;
  }
  get isSamePlacement(): boolean {
    if (!this.isChangeMode ||
        !this.selectedAssignment) {
      return false;
    }
    return (
      this.assignmentForm.supervisorId ===
        this.selectedAssignment.supervisor_id &&
      this.assignmentForm.companyName ===
        this.selectedAssignment.company_name
    );
  }
  get isDateRangeValid(): boolean {
    const { startDate, endDate } =
      this.assignmentForm;
    if (!startDate) {
      return false;
    }
    return !endDate || endDate >= startDate;
  }
  get canReviewAssignment(): boolean {
    const form = this.assignmentForm;
    const validStudent = this.isChangeMode
      ? this.selectedAssignment?.student_id ===
          form.studentId
      : this.unassignedStudents.some(
          student => student.id === form.studentId
        );
    return !this.isSaving &&
      !!validStudent &&
      this.selectedStudent?.account_status === 'active' &&
      !!form.companyName &&
      !!this.selectedSupervisor &&
      this.isDateRangeValid &&
      !this.isSamePlacement &&
      (!this.isChangeMode || !!form.reason.trim()) &&
      form.reason.length <= 1000;
  }
  closeAssignmentModal(): void {
    if (this.isSaving) {
      return;
    }
    this.showAssignmentModal = false;
    this.showReviewModal = false;
    this.formErrorMessage = '';
    this.selectedAssignment = null;
    this.assignmentForm = this.emptyForm();
  }
  // ==========================================
  // REVIEW ASSIGNMENT
  // ==========================================
  reviewAssignment(): void {
    if (!this.canReviewAssignment) {
      this.formErrorMessage =
        'Please complete all required fields and select a valid placement.';
      return;
    }
    this.formErrorMessage = '';
    this.showAssignmentModal = false;
    this.showReviewModal = true;
  }
  backToAssignmentForm(): void {
    if (this.isSaving) {
      return;
    }
    this.formErrorMessage = '';
    this.showReviewModal = false;
    this.showAssignmentModal = true;
  }
  get confirmationLabel(): string {
    return this.isChangeMode
      ? 'Confirm reassignment'
      : 'Confirm assignment';
  }
  // ==========================================
  // SAVE ASSIGNMENT
  // ==========================================
  async confirmAssignment(): Promise<void> {
    if (this.isSaving || !this.canReviewAssignment) {
      return;
    }
    this.isSaving = true;
    this.formErrorMessage = '';
    this.successMessage = '';
    const form = { ...this.assignmentForm };
    try {
      // Recheck the current placement before saving.
      const {
        data: currentPlacement,
        error: placementError
      } = await this.supabase
        .from('intern_supervisor_assignments')
        .select('id, supervisor_id, company_name')
        .eq('student_id', form.studentId)
        .eq('assignment_status', 'active')
        .maybeSingle();
      if (placementError) {
        throw placementError;
      }
      if (!this.isChangeMode && currentPlacement) {
        throw new Error(
          'This student already has an active assignment. Close this form and refresh the page.'
        );
      }
      if (
        this.isChangeMode &&
        currentPlacement?.id !==
          this.selectedAssignment?.id
      ) {
        throw new Error(
          'The current assignment has changed. Close this form and refresh the page.'
        );
      }
      const { data, error } = await this.supabase.rpc(
        'reassign_student_intern',
        {
          p_student_id: form.studentId,
          p_supervisor_id: form.supervisorId,
          p_start_date: form.startDate,
          p_end_date: form.endDate || null,
          p_reason: this.isChangeMode
            ? form.reason.trim()
            : 'Initial internship assignment'
        }
      );
      if (error) {
        throw error;
      }
      if (!data?.success) {
        throw new Error(
          data?.message ||
          'The assignment could not be confirmed.'
        );
      }
      this.ngZone.run(() => {
        this.successMessage = this.isChangeMode
          ? 'Internship assignment changed successfully. The previous placement has been retained in history.'
          : 'New internship assignment created successfully.';
        this.showAssignmentModal = false;
        this.showReviewModal = false;
        this.selectedAssignment = null;
        this.assignmentForm = this.emptyForm();
        this.currentPage = 1;
        this.cdr.detectChanges();
      });
      await this.loadAssignments();
    } catch (error: any) {
      console.error('Assignment saving error:', error);
      this.ngZone.run(() => {
        this.formErrorMessage =
          error?.message ||
          'Unable to save the internship assignment. Please try again.';
      });
    } finally {
      this.ngZone.run(() => {
        this.isSaving = false;
        this.cdr.detectChanges();
      });
    }
  }
  // ==========================================
  // HISTORICAL ASSIGNMENT
  // ==========================================
  openViewAssignment(
    assignment: Assignment
  ): void {
    this.viewedAssignment = assignment;
    this.showViewModal = true;
  }
  closeViewModal(): void {
    this.showViewModal = false;
    this.viewedAssignment = null;
  }
  get viewedAssignmentReason(): string {
    const assignment = this.viewedAssignment;
    if (!assignment) {
      return '';
    }
    const event = [
      ...assignment.assignment_history
    ].reverse().find(item =>
      item?.previous_assignment_id === assignment.id
    );
    return event?.reason || 'No reason recorded.';
  }
  get viewedAssignmentChangedAt(): string {
    const assignment = this.viewedAssignment;
    if (!assignment) {
      return '';
    }
    const event = [
      ...assignment.assignment_history
    ].reverse().find(item =>
      item?.previous_assignment_id === assignment.id
    );
    return event?.changed_at
      ? this.formatDate(event.changed_at)
      : 'Not recorded';
  }
  // ==========================================
  // STATUS HELPERS
  // ==========================================
  getStatusKey(assignment: Assignment): string {
    const status = assignment.assignment_status;
    if (status === 'active') {
      return 'active';
    }
    if (status === 'ended') {
      return 'ended';
    }
    if (status === 'inactive') {
      const wasReassigned =
        assignment.assignment_history.some(event =>
          event?.previous_assignment_id ===
            assignment.id
        );
      return wasReassigned
        ? 'reassigned'
        : 'inactive';
    }
    return 'unknown';
  }
  getStatusLabel(assignment: Assignment): string {
    const labels: Record<string, string> = {
      active: 'Active',
      reassigned: 'Reassigned',
      inactive: 'Inactive',
      ended: 'Ended',
      unknown: 'Unknown'
    };
    return labels[this.getStatusKey(assignment)] ||
      'Unknown';
  }
  getStatusClass(assignment: Assignment): string {
    return `status-${this.getStatusKey(assignment)}`;
  }
  // ==========================================
  // DATE FORMATTING
  // ==========================================
  private parseDate(value: string): Date {
    const dateOnly =
      /^\d{4}-\d{2}-\d{2}$/.test(value);
    return new Date(
      dateOnly
        ? `${value}T00:00:00+08:00`
        : value
    );
  }
  formatDate(value: string | null): string {
    if (!value) {
      return 'Not specified';
    }
    const date = this.parseDate(value);
    if (Number.isNaN(date.getTime())) {
      return 'Not specified';
    }
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'Asia/Manila'
    }).format(date);
  }
  formatPeriod(
    startDate: string | null,
    endDate: string | null
  ): string {
    if (!startDate) {
      return 'Not specified';
    }
    if (!endDate) {
      return `${this.formatDate(startDate)} – Ongoing`;
    }
    const start = this.parseDate(startDate);
    const end = this.parseDate(endDate);
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime())
    ) {
      return 'Not specified';
    }
    if (startDate.slice(0, 4) === endDate.slice(0, 4)) {
      const shortStart =
        new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          timeZone: 'Asia/Manila'
        }).format(start);
      return `${shortStart} – ${this.formatDate(endDate)}`;
    }
    return `${this.formatDate(startDate)} – ${this.formatDate(endDate)}`;
  }
  // ==========================================
  // AVATAR HELPERS
  // ==========================================
  getInitials(name: string): string {
    const parts = name.trim()
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
  getAvatarColor(value: string): string {
    const colors = [
      'blue',
      'purple',
      'green',
      'orange',
      'rose',
      'slate'
    ];
    const hash = Array.from(value).reduce(
      (sum, character) =>
        sum + character.charCodeAt(0),
      0
    );
    return colors[hash % colors.length];
  }
  // ==========================================
  // GENERAL HELPERS
  // ==========================================
  dismissSuccessMessage(): void {
    this.successMessage = '';
  }
  dismissFormError(): void {
    this.formErrorMessage = '';
  }
  trackByAssignment(
    index: number,
    assignment: Assignment
  ): string {
    return assignment.id;
  }
  trackByStudent(
    index: number,
    student: Student
  ): string {
    return student.id;
  }
  trackBySupervisor(
    index: number,
    supervisor: Supervisor
  ): string {
    return supervisor.id;
  }
  trackByPage(
    index: number,
    page: number
  ): number {
    return page;
  }
}
