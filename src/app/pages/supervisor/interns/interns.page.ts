import { CommonModule } from '@angular/common';

import {
  ChangeDetectorRef,
  Component,
  inject,
  type OnInit
} from '@angular/core';

import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { AuthService } from '../../../services/auth.service';
import { SupabaseService } from '../../../services/supabase.service';


// ==========================================
// TYPE DEFINITIONS
// ==========================================

type InternStatus =
  | 'ongoing'
  | 'needs-follow-up'
  | 'completed';

type StatusFilter = 'all' | InternStatus;

type ProgressColor = 'blue' | 'green' | 'orange';

type AvatarColor =
  | 'blue'
  | 'slate'
  | 'orange'
  | 'green'
  | 'purple';


// ==========================================
// INTERN INTERFACE
// ==========================================

interface Intern {
  id: string;
  name: string;
  initials: string;

  email: string;
  course: string;
  department: string;
  yearLevel: string;
  companyName: string;

  completedHours: number;
  provisionalHours: number;
  requiredHours: number;

  progress: number;
  progressColor: ProgressColor;

  status: string;
  statusClass: InternStatus;

  avatarColor: AvatarColor;

  startDate: string;
  endDate: string;
}


// ==========================================
// ATTENDANCE HOURS INTERFACE
// ==========================================

interface AttendanceHours {
  verified: number;
  provisional: number;
}


// ==========================================
// COMPONENT
// ==========================================

@Component({
  selector: 'app-interns',

  standalone: true,

  imports: [
    CommonModule,
    FormsModule
  ],

  templateUrl: './interns.page.html',

  styleUrls: ['./interns.page.scss']
})
export class InternsPage implements OnInit {

  // ==========================================
  // SERVICES
  // ==========================================

  private readonly router =
    inject(Router);

  private readonly supabaseService =
    inject(SupabaseService);

  private readonly supabase =
    this.supabaseService.getClient();

  private readonly authService =
    inject(AuthService);

  private readonly cdr =
    inject(ChangeDetectorRef);


  // ==========================================
  // PAGE STATE
  // ==========================================

  interns: Intern[] = [];

  loading = true;

  loadError = '';

  companyName = '';


  // ==========================================
  // FILTER STATE
  // ==========================================

  searchQuery = '';

  selectedCourse = 'all';

  selectedStatus: StatusFilter = 'all';


  // ==========================================
  // PAGINATION STATE
  // ==========================================

  currentPage = 1;

  readonly pageSize = 8;


  // ==========================================
  // REQUEST TRACKING
  // ==========================================

  private loadVersion = 0;


  // ==========================================
  // INITIALIZATION
  // ==========================================

  ngOnInit(): void {

    void this.loadData();

  }


  // ==========================================
  // LOAD ACTUAL SUPABASE DATA
  // ==========================================

  async loadData(): Promise<void> {

    const requestVersion = ++this.loadVersion;

    this.loading = true;

    this.loadError = '';

    this.interns = [];

    this.companyName = '';

    this.currentPage = 1;

    this.cdr.markForCheck();

    try {

      // Get authenticated supervisor account.

      const userId =
        this.authService.getCurrentUser()?.id;

      if (!userId) {

        throw new Error(
          'Your account session is unavailable. Please sign in again.'
        );

      }


      // ======================================
      // GET SUPERVISOR PROFILE
      // ======================================

      const {
        data: supervisor,
        error: supervisorError
      } = await this.supabase

        .from('company_supervisors')

        .select('id, company_name')

        .eq('user_id', userId)

        .single();


      if (supervisorError) {

        throw supervisorError;

      }

      if (!supervisor) {

        throw new Error(
          'No supervisor profile was found.'
        );

      }


      if (!this.isCurrentRequest(requestVersion, userId)) {

        return;

      }


      this.companyName =
        supervisor.company_name || '';


      // ======================================
      // GET ASSIGNED INTERNS
      // ======================================

      const {
        data: assignments,
        error: assignmentsError
      } = await this.supabase

        .from('intern_supervisor_assignments')

        .select(`
          student_id,
          students!student_id(
            id,
            student_id,
            full_name,
            course,
            email,
            department,
            year_level,
            company_name,
            ojt_start_date,
            ojt_end_date,
            required_hours
          )
        `)

        .eq('supervisor_id', supervisor.id)

        .eq('assignment_status', 'active');


      if (assignmentsError) {

        throw assignmentsError;

      }


      if (!this.isCurrentRequest(requestVersion, userId)) {

        return;

      }


      // ======================================
      // EXTRACT STUDENT RECORDS
      // ======================================

      const assignedStudents = (assignments || [])

        .map(assignment => {

          return Array.isArray(assignment.students)

            ? assignment.students[0]

            : assignment.students;

        })

        .filter(student => !!student);


      // Remove duplicate student assignments.

      const uniqueStudents = Array.from(

        new Map(

          assignedStudents

            .filter(student => !!student?.student_id)

            .map(student => [

              student!.student_id,

              student!

            ])

        ).values()

      );


      // Avoid an empty Supabase query.

      if (uniqueStudents.length === 0) {

        this.interns = [];

        return;

      }


      // ======================================
      // GET STUDENT SCHOOL IDS
      // ======================================

      const schoolIds = uniqueStudents.map(

        student => student.student_id

      );


      // ======================================
      // GET ATTENDANCE RECORDS
      // ======================================

      const hoursByStudent =
        new Map<string, AttendanceHours>();

      const batchSize = 50;

      const attendancePageSize = 500;


      // Load attendance in batches to avoid
      // oversized requests and row-limit issues.

      for (
        let index = 0;
        index < schoolIds.length;
        index += batchSize
      ) {

        const batch = schoolIds.slice(

          index,

          index + batchSize

        );

        let offset = 0;

        while (true) {

          const {
            data: attendance,
            error: attendanceError,
            count
          } = await this.supabase

            .from('attendance')

            .select(`
              id,
              student_id,
              time_in,
              time_out,
              total_hours_rendered,
              verification_status,
              sync_status
            `, { count: 'exact' })

            .in('student_id', batch)

            .in(
              'verification_status',
              ['verified', 'provisional']
            )

            .eq('sync_status', 'synced')

            .not('time_in', 'is', null)

            .not('time_out', 'is', null)

            .order('id', { ascending: true })

            .range(
              offset,
              offset + attendancePageSize - 1
            );


          if (attendanceError) {

            throw attendanceError;

          }


          if (!this.isCurrentRequest(requestVersion, userId)) {

            return;

          }


          const records = attendance || [];


          // ==================================
          // CALCULATE ATTENDANCE HOURS
          // ==================================

          for (const record of records) {

            const hours = this.calculateAttendanceHours(

              record.time_in,

              record.time_out,

              record.total_hours_rendered

            );


            const totals = hoursByStudent.get(
              record.student_id
            ) || {

              verified: 0,

              provisional: 0

            };


            if (
              record.verification_status === 'verified'
            ) {

              totals.verified += hours;

            } else if (
              record.verification_status === 'provisional'
            ) {

              totals.provisional += hours;

            }


            hoursByStudent.set(

              record.student_id,

              totals

            );

          }


          offset += records.length;


          if (
            records.length === 0 ||
            (count !== null && offset >= count) ||
            (count === null &&
              records.length < attendancePageSize)
          ) {

            break;

          }

        }

      }


      // ======================================
      // BUILD INTERN VIEW MODELS
      // ======================================

      const results: Intern[] = uniqueStudents.map(

        student => {

          const hours = hoursByStudent.get(
            student.student_id
          ) || {

            verified: 0,

            provisional: 0

          };


          // Retain actual hour totals without
          // rounding them to whole hours.

          const completedHours = hours.verified;

          const provisionalHours = hours.provisional;


          const storedRequiredHours =
            Number(student.required_hours ?? 486);


          const requiredHours =

            Number.isFinite(storedRequiredHours) &&
            storedRequiredHours > 0

              ? storedRequiredHours

              : 486;


          // Calculate progress using verified hours only.

          const progress = Math.min(

            100,

            Math.max(

              0,

              (completedHours / requiredHours) * 100

            )

          );


          // Determine progress-based status.

          const statusClass = this.getInternStatus(

            completedHours,

            requiredHours,

            progress,

            student.ojt_start_date,

            student.ojt_end_date

          );


          const name =

            student.full_name?.trim() || 'Unknown student';


          return {

            id: student.student_id,

            name,

            initials: this.getInitials(name),

            email: student.email || '',

            course: student.course || 'Not provided',

            department:
              student.department || 'Not assigned',

            yearLevel:
              student.year_level || 'Not provided',

            companyName:
              student.company_name ||
              this.companyName ||
              'Not provided',

            completedHours,

            provisionalHours,

            requiredHours,

            progress,

            progressColor: this.getProgressColor(
              progress,
              statusClass
            ),

            status: this.getStatusLabel(statusClass),

            statusClass,

            avatarColor: this.getAvatarColor(
              student.student_id
            ),

            startDate: this.formatDate(
              student.ojt_start_date
            ),

            endDate: this.formatDate(
              student.ojt_end_date
            )

          };

        }

      );


      if (!this.isCurrentRequest(requestVersion, userId)) {

        return;

      }


      // Display interns alphabetically.

      this.interns = results.sort(

        (first, second) =>
          first.name.localeCompare(second.name)

      );


    } catch (error) {

      if (requestVersion !== this.loadVersion) {

        return;

      }

      console.error(
        'Error loading assigned interns:',
        error
      );

      this.interns = [];

      this.loadError =
        'We could not retrieve your assigned interns. Please try again.';


    } finally {

      if (requestVersion === this.loadVersion) {

        this.loading = false;

        this.cdr.markForCheck();

      }

    }

  }


  // ==========================================
  // REQUEST VALIDATION
  // ==========================================

  private isCurrentRequest(

    requestVersion: number,

    userId: string

  ): boolean {

    return (

      requestVersion === this.loadVersion &&

      this.authService.getCurrentUser()?.id === userId

    );

  }


  // ==========================================
  // ATTENDANCE HOURS CALCULATION
  // ==========================================

  private calculateAttendanceHours(

    timeIn: string | null,

    timeOut: string | null,

    storedHours: number | string | null

  ): number {

    if (!timeIn || !timeOut) {

      return 0;

    }


    const start = new Date(timeIn).getTime();

    const end = new Date(timeOut).getTime();


    if (

      !Number.isFinite(start) ||

      !Number.isFinite(end) ||

      end <= start

    ) {

      return 0;

    }


    // Prefer the attendance hours already
    // stored in Supabase.

    if (storedHours !== null && storedHours !== undefined) {

      const hours = Number(storedHours);

      if (Number.isFinite(hours) && hours >= 0) {

        return hours;

      }

    }


    // Fallback to actual time-in/out duration.

    return (end - start) / (1000 * 60 * 60);

  }


  // ==========================================
  // DETERMINE INTERN STATUS
  // ==========================================

  private getInternStatus(

    completedHours: number,

    requiredHours: number,

    progress: number,

    startDate: string | null,

    endDate: string | null

  ): InternStatus {


    // Required verified hours have been reached.

    if (

      requiredHours > 0 &&

      completedHours >= requiredHours

    ) {

      return 'completed';

    }


    // Retain the original schedule-based
    // progress comparison where dates exist.

    if (startDate && endDate) {

      const start = new Date(startDate).getTime();

      const end = new Date(endDate).getTime();

      const today = Date.now();


      if (

        Number.isFinite(start) &&

        Number.isFinite(end) &&

        end > start

      ) {

        const totalDuration = end - start;

        const elapsedDuration = today - start;


        const expectedProgress = Math.min(

          100,

          Math.max(

            0,

            (elapsedDuration / totalDuration) * 100

          )

        );


        const progressDifference =

          progress - expectedProgress;


        if (progressDifference < -10) {

          return 'needs-follow-up';

        }

      }

    }


    // Missing schedule dates should not
    // automatically mark an intern as at risk.

    return 'ongoing';

  }


  // ==========================================
  // STATUS LABELS
  // ==========================================

  private getStatusLabel(

    status: InternStatus

  ): string {

    const labels: Record<InternStatus, string> = {

      ongoing: 'Ongoing',

      'needs-follow-up': 'Needs follow-up',

      completed: 'Completed'

    };

    return labels[status];

  }


  // ==========================================
  // PROGRESS COLOR
  // ==========================================

  private getProgressColor(

    progress: number,

    status: InternStatus

  ): ProgressColor {

    if (status === 'needs-follow-up') {

      return 'orange';

    }

    if (progress >= 90) {

      return 'green';

    }

    return 'blue';

  }


  // ==========================================
  // REMAINING HOURS
  // ==========================================

  getRemainingHours(intern: Intern): number {

    return Math.max(

      0,

      intern.requiredHours - intern.completedHours

    );

  }


  // ==========================================
  // GENERATE INITIALS
  // ==========================================

  private getInitials(name: string): string {

    const parts = name

      .trim()

      .split(/\s+/)

      .filter(Boolean);


    if (parts.length === 0) {

      return '??';

    }


    if (parts.length === 1) {

      return parts[0]

        .substring(0, 2)

        .toUpperCase();

    }


    return (

      parts[0][0] +

      parts[parts.length - 1][0]

    ).toUpperCase();

  }


  // ==========================================
  // CONSISTENT AVATAR COLORS
  // ==========================================

  private getAvatarColor(id: string): AvatarColor {

    const colors: AvatarColor[] = [

      'blue',

      'slate',

      'orange',

      'green',

      'purple'

    ];


    const hash = Array.from(id).reduce(

      (total, character) =>

        total + character.charCodeAt(0),

      0

    );


    return colors[hash % colors.length];

  }


  // ==========================================
  // FORMAT DATE
  // ==========================================

  private formatDate(value: string | null): string {

    if (!value) {

      return 'Not provided';

    }


    const date = new Date(value);


    if (!Number.isFinite(date.getTime())) {

      return 'Not provided';

    }


    return date.toLocaleDateString('en-US', {

      month: 'long',

      day: 'numeric',

      year: 'numeric',

      timeZone: 'Asia/Manila'

    });

  }


  // ==========================================
  // DYNAMIC COURSE OPTIONS
  // ==========================================

  get courses(): string[] {

    return Array.from(

      new Set(

        this.interns

          .map(intern => intern.course)

          .filter(course => course !== 'Not provided')

      )

    ).sort();

  }


  // ==========================================
  // FILTER INTERNS
  // ==========================================

  get filteredInterns(): Intern[] {

    const query = this.searchQuery

      .trim()

      .toLowerCase();


    return this.interns.filter(intern => {

      const searchableText = [

        intern.name,

        intern.id,

        intern.course,

        intern.email,

        intern.department

      ]

        .join(' ')

        .toLowerCase();


      const matchesSearch =

        !query || searchableText.includes(query);


      const matchesCourse =

        this.selectedCourse === 'all' ||

        intern.course === this.selectedCourse;


      const matchesStatus =

        this.selectedStatus === 'all' ||

        intern.statusClass === this.selectedStatus;


      return (

        matchesSearch &&

        matchesCourse &&

        matchesStatus

      );

    });

  }


  // ==========================================
  // SEARCH CHANGE
  // ==========================================

  onSearchChange(value: string): void {

    this.searchQuery = value || '';

    this.currentPage = 1;

  }


  // ==========================================
  // COURSE FILTER CHANGE
  // ==========================================

  onCourseChange(value: string): void {

    this.selectedCourse = value;

    this.currentPage = 1;

  }


  // ==========================================
  // STATUS FILTER CHANGE
  // ==========================================

  onStatusChange(value: StatusFilter): void {

    this.selectedStatus = value;

    this.currentPage = 1;

  }


  // ==========================================
  // CLEAR FILTERS
  // ==========================================

  clearFilters(): void {

    this.searchQuery = '';

    this.selectedCourse = 'all';

    this.selectedStatus = 'all';

    this.currentPage = 1;

  }


  // ==========================================
  // PAGINATION
  // ==========================================

  get totalPages(): number {

    return Math.max(

      1,

      Math.ceil(

        this.filteredInterns.length / this.pageSize

      )

    );

  }


  get pageNumbers(): number[] {

    return Array.from(

      { length: this.totalPages },

      (_, index) => index + 1

    );

  }


  get paginatedInterns(): Intern[] {

    const startIndex =

      (this.currentPage - 1) * this.pageSize;


    return this.filteredInterns.slice(

      startIndex,

      startIndex + this.pageSize

    );

  }


  get firstVisibleRecord(): number {

    if (this.filteredInterns.length === 0) {

      return 0;

    }


    return (

      (this.currentPage - 1) * this.pageSize + 1

    );

  }


  get lastVisibleRecord(): number {

    return Math.min(

      this.currentPage * this.pageSize,

      this.filteredInterns.length

    );

  }


  goToPage(page: number): void {

    if (page >= 1 && page <= this.totalPages) {

      this.currentPage = page;

    }

  }


  // ==========================================
  // OPEN INTERN DETAILS PAGE
  // ==========================================

  openInternDetails(intern: Intern): void {

    void this.router.navigate([

      '/supervisor',

      'interns',

      intern.id

    ]);

  }

}