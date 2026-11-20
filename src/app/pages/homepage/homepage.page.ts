import { CommonModule } from '@angular/common';
import {
  type OnInit,
  type OnDestroy,
  ChangeDetectorRef,
  Component,
  inject,
  CUSTOM_ELEMENTS_SCHEMA
} from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { type ViewWillEnter } from '@ionic/angular';

import { addIcons } from 'ionicons';
import {
  businessOutline,
  cameraOutline,
  documentTextOutline,
  homeOutline,
  timeOutline,
  calendarClearOutline,
  folderOutline,
  personOutline,
  chevronForwardOutline
} from 'ionicons/icons';

import { AuthService } from '../../services/auth.service';
import { SupabaseService } from '../../services/supabase.service';

interface RecentActivity {
  id: string | number;
  icon: string;
  title: string;
  description: string;
  day: string;
}

@Component({
  selector: 'app-homepage',
  templateUrl: './homepage.page.html',
  styleUrls: ['./homepage.page.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class HomepagePage
  implements OnInit, OnDestroy, ViewWillEnter {

  private readonly route = inject(ActivatedRoute);
  private readonly supabaseService = inject(SupabaseService);
  private readonly authService = inject(AuthService);
  private readonly cdr = inject(ChangeDetectorRef);

  private readonly supabase = this.supabaseService.getClient();

  // =========================================
  // STUDENT PROFILE
  // =========================================

  studentName = '';
  studentCourse = '';
  studentIdNumber = '';
  companyLocation = '';

  // =========================================
  // OJT HOURS
  // =========================================

  totalHours = 0;
  requiredHours = 486;

  verifiedHours = 0;
  provisionalHours = 0;
  remainingHours = 486;

  verifiedPercent = 0;
  provisionalPercent = 0;

  // =========================================
  // TODAY'S ATTENDANCE
  // =========================================

  todayStatusText = 'Not timed in yet';
  isTimedInToday = false;
  currentLiveTime = '';

  private clockInterval?: ReturnType<typeof setInterval>;

  // =========================================
  // RECENT ACTIVITIES
  // =========================================

  showAllActivities = false;

  activities: RecentActivity[] = [];
  displayedActivities: RecentActivity[] = [];

  // =========================================
  // WEEKLY REPORT
  // =========================================

  currentReportWeek = 0;
  currentReportPeriod = '';
  currentReportStatus = '';

  constructor() {
    addIcons({
      businessOutline,
      cameraOutline,
      documentTextOutline,
      chevronForwardOutline,
      homeOutline,
      timeOutline,
      calendarClearOutline,
      folderOutline,
      personOutline
    });
  }

  // =========================================
  // LIFECYCLE
  // =========================================

  ngOnInit(): void {
    this.updateLiveTime();

    this.clockInterval = setInterval(() => {
      this.updateLiveTime();
      this.cdr.detectChanges();
    }, 1000);
  }

  async ionViewWillEnter(): Promise<void> {
    const id =
      this.authService.getStudentId() ||
      this.route.snapshot.queryParamMap.get('studentId');

    if (!id) {
      console.error(
        'Homepage: no student ID found. User not logged in.'
      );

      this.studentName = 'Unknown student';
      this.companyLocation = '';
      this.resetAttendanceData();
      this.resetReportData();
      this.cdr.detectChanges();
      return;
    }

    this.studentIdNumber = id;

    await this.loadStudentData(id);
    await this.loadCurrentReport(id);

    this.cdr.detectChanges();
  }

  ngOnDestroy(): void {
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
    }
  }

  // =========================================
  // LIVE CLOCK
  // =========================================

  updateLiveTime(): void {
    this.currentLiveTime = new Date().toLocaleTimeString(
      'en-US',
      {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }
    );
  }

  // =========================================
  // RESET HELPERS
  // =========================================

  private resetAttendanceData(): void {
    this.totalHours = 0;
    this.verifiedHours = 0;
    this.provisionalHours = 0;
    this.remainingHours = this.requiredHours;

    this.verifiedPercent = 0;
    this.provisionalPercent = 0;

    this.todayStatusText = 'Not timed in yet';
    this.isTimedInToday = false;

    this.activities = [];
    this.displayedActivities = [];
    this.showAllActivities = false;
  }

  private resetReportData(): void {
    this.currentReportWeek = 0;
    this.currentReportPeriod = '';
    this.currentReportStatus = '';
  }

  // =========================================
  // LOAD STUDENT AND ATTENDANCE DATA
  // =========================================

  async loadStudentData(studentId: string): Promise<void> {
    console.log(
      'Homepage: Loading data for student ID:',
      studentId
    );

    try {
      // Load student profile
      const { data, error } = await this.supabase
        .from('students')
        .select('*')
        .eq('student_id', studentId)
        .maybeSingle();

      if (error) {
        console.error(
          'Homepage: student query failed:',
          error
        );
      }

      if (data) {
        const fullName = (
          data.full_name ||
          data.name ||
          'Student'
        ).trim();

        this.studentName = fullName.split(/\s+/)[0];

        this.studentCourse = data.course || '';
        this.companyLocation =
          data.company_location || '';
      } else {
        this.studentName = 'Student not found';
        this.studentCourse = '';
        this.companyLocation = '';
      }

      this.cdr.detectChanges();

      // Load attendance records
      const { data: attData, error: attError } =
        await this.supabase
          .from('attendance')
          .select('*')
          .eq('student_id', studentId)
          .order('created_at', {
            ascending: false
          });

      if (attError) {
        console.error(
          'Homepage: attendance query failed:',
          attError
        );

        // Do not replace existing data with
        // misleading zero values on query failure.
        return;
      }

      // Reset before calculating fresh values
      this.resetAttendanceData();

      if (attData && attData.length > 0) {
        let verifiedMinutes = 0;
        let provisionalMinutes = 0;

        // =====================================
        // TODAY'S ATTENDANCE STATUS
        // =====================================

        const todayStr = new Date().toDateString();

        const todayRecord = attData.find(
          row =>
            row.created_at &&
            new Date(row.created_at).toDateString() ===
              todayStr
        );

        if (todayRecord) {
          if (
            todayRecord.time_in &&
            !todayRecord.time_out
          ) {
            this.todayStatusText = 'Timed In';
            this.isTimedInToday = true;
          } else if (
            todayRecord.time_in &&
            todayRecord.time_out
          ) {
            this.todayStatusText =
              'Timed Out (Done for today)';

            this.isTimedInToday = true;
          }
        }

        // =====================================
        // CALCULATE COMPLETED OJT HOURS
        // =====================================

        attData.forEach(row => {
          if (row.time_in && row.time_out) {
            const timeIn = new Date(
              row.time_in
            ).getTime();

            const timeOut = new Date(
              row.time_out
            ).getTime();

            const diffMs = timeOut - timeIn;

            if (
              Number.isFinite(diffMs) &&
              diffMs > 0
            ) {
              const minutes = Math.floor(
                diffMs / (1000 * 60)
              );

              if (
                row.verification_status === 'verified'
              ) {
                verifiedMinutes += minutes;
              } else {
                // Preserves the original behavior:
                // non-verified completed records
                // are counted as provisional.
                provisionalMinutes += minutes;
              }
            }
          }
        });

        // Calculate using unrounded values
        this.verifiedHours = verifiedMinutes / 60;

        this.provisionalHours =
          provisionalMinutes / 60;

        this.totalHours =
          (verifiedMinutes + provisionalMinutes) / 60;

        this.remainingHours = Math.max(
          0,
          this.requiredHours - this.totalHours
        );

        // =====================================
        // PROGRESS BAR PERCENTAGES
        // =====================================

        if (this.requiredHours > 0) {
          this.verifiedPercent = Math.min(
            100,
            (this.verifiedHours /
              this.requiredHours) * 100
          );

          this.provisionalPercent = Math.min(
            100 - this.verifiedPercent,
            (this.provisionalHours /
              this.requiredHours) * 100
          );
        }

        // =====================================
        // RECENT ACTIVITIES
        // =====================================

        this.activities = attData.map(
          (row, index): RecentActivity => {
            const formattedDate = row.created_at
              ? new Date(
                  row.created_at
                ).toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric'
                })
              : 'Recent';

            const formattedIn = row.time_in
              ? new Date(
                  row.time_in
                ).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true
                })
              : '--';

            const formattedOut = row.time_out
              ? new Date(
                  row.time_out
                ).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true
                })
              : '--';

            return {
              id: row.id ?? index + 1,
              icon: 'time-outline',
              title: `Attendance: ${formattedDate}`,
              description:
                `Time In: ${formattedIn} | ` +
                `Time Out: ${formattedOut}`,
              day: formattedDate
            };
          }
        );
      }

      // Show first three activities by default
      this.updateDisplayedActivities();

    } catch (error) {
      console.error(
        'Homepage: loadStudentData error:',
        error
      );
    }
  }

  // =========================================
  // RECENT ACTIVITIES CONTROLS
  // =========================================

  toggleActivities(): void {
    this.showAllActivities =
      !this.showAllActivities;

    this.updateDisplayedActivities();
  }

  updateDisplayedActivities(): void {
    this.displayedActivities =
      this.showAllActivities
        ? [...this.activities]
        : this.activities.slice(0, 3);
  }

  // =========================================
  // LOAD CURRENT WEEKLY REPORT
  // =========================================

  async loadCurrentReport(
    studentId: string
  ): Promise<void> {
    try {
      const { data, error } = await this.supabase
        .from('reports')
        .select('*')
        .eq('student_id', studentId)
        .eq('status', 'draft')
        .order('week', {
          ascending: false
        })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error(
          'Homepage: report query failed:',
          error
        );
        return;
      }

      if (data) {
        this.currentReportWeek = data.week;
        this.currentReportPeriod =
          data.period || '';
        this.currentReportStatus =
          data.status || '';
      } else {
        this.resetReportData();
      }

    } catch (error) {
      console.error(
        'Homepage: loadCurrentReport error:',
        error
      );
    }
  }
}
