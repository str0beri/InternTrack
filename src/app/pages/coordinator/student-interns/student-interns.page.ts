
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
  peopleOutline
} from 'ionicons/icons';

import { SupabaseService } from '../../../services/supabase.service';

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

  private readonly supabaseService = inject(SupabaseService);
  private readonly supabase = this.supabaseService.getClient();

  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly ngZone = inject(NgZone);

  // =========================================
  // PAGE STATE
  // =========================================

  isLoading = true;

  private loadingInProgress = false;

  errorMessage = '';

  students: StudentIntern[] = [];

  searchTerm = '';

  selectedCourse = 'all';
  selectedCompany = 'all';
  selectedStatus = 'all';

  currentPage = 1;

  readonly pageSize = 8;

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
      peopleOutline
    });

  }

  ngOnInit(): void {

    void this.loadStudents();

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

      const studentRows = students ?? [];

      if (!studentRows.length) {

        this.students = [];
        this.currentPage = 1;

        return;

      }

      // Student database UUIDs.

      const studentIds = studentRows.map(
        student => student.id
      );

      // Student school IDs.

      const schoolIds = studentRows.map(
        student => student.student_id
      );

      // Retrieve active assignments and verified attendance.

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

      // =========================================
      // MAP ACTIVE COMPANY ASSIGNMENTS
      // =========================================

      const assignmentMap = new Map<string, string>();

      for (const assignment of assignmentResult.data ?? []) {

        if (!assignmentMap.has(assignment.student_id)) {

          assignmentMap.set(
            assignment.student_id,
            assignment.company_name
          );

        }

      }

      // =========================================
      // CALCULATE VERIFIED INTERNSHIP HOURS
      // =========================================

      const hoursMap = new Map<string, number>();

      for (const record of attendanceResult.data ?? []) {

        const hours = Number(
          record.total_hours_rendered ?? 0
        );

        if (!Number.isFinite(hours) || hours < 0) {
          continue;
        }

        const existingHours =
          hoursMap.get(record.student_id) ?? 0;

        hoursMap.set(
          record.student_id,
          existingHours + hours
        );

      }

      // =========================================
      // PREPARE STUDENT RECORDS
      // =========================================

      this.students = studentRows.map((student, index) => {

        const requiredHours = Math.max(
          0,
          Number(student.required_hours) || 0
        );

        const verifiedHours =
          hoursMap.get(student.student_id) ?? 0;

        // Prevent displaying 100% before the
        // required internship hours are completed.

        const progress = requiredHours > 0
          ? Math.min(
              100,
              Math.floor(
                (verifiedHours / requiredHours) * 100
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

        const status = this.calculateStatus(
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

          course: student.course || 'Not specified',

          yearLevel: student.year_level
            ? String(student.year_level)
            : '',

          companyName,

          requiredHours,

          verifiedHours,

          progress,

          status,

          initials: this.getInitials(
            student.full_name
          ),

          avatarColor: this.getAvatarColor(index),

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

    if (!startDate || !endDate || requiredHours <= 0) {

      return 'ongoing';

    }

    const start = new Date(
      `${startDate}T00:00:00`
    ).getTime();

    const end = new Date(
      `${endDate}T23:59:59`
    ).getTime();

    const today = Date.now();

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

  getStatusLabel(status: InternshipStatus): string {

    const labels: Record<InternshipStatus, string> = {

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
          .filter(student => student.hasAssignment)
          .map(student => student.companyName)
      )
    ].sort();

  }

  // =========================================
  // SEARCH AND FILTERING
  // =========================================

  get filteredStudents(): StudentIntern[] {

    const search = this.searchTerm
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

        student.companyName === this.selectedCompany;

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
        this.filteredStudents.length / this.pageSize
      )

    );

  }

  get paginatedStudents(): StudentIntern[] {

    const start =
      (this.currentPage - 1) * this.pageSize;

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

      ? (this.currentPage - 1) * this.pageSize + 1

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

  viewStudent(student: StudentIntern): void {

    void this.router.navigate([

      '/coordinator/student-interns',

      student.id

    ]);

  }

  // =========================================
  // DISPLAY HELPERS
  // =========================================

  private getInitials(name: string): string {

    const parts = (name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    return parts

      .slice(0, 2)

      .map(
        part => part.charAt(0).toUpperCase()
      )

      .join('') || 'ST';

  }

  private getAvatarColor(index: number): string {

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
