import { CommonModule } from '@angular/common';

import {

  type OnInit,

  type OnDestroy,

  ChangeDetectorRef,

  Component,

  inject,

  CUSTOM_ELEMENTS_SCHEMA

} from '@angular/core';

import { RouterModule } from '@angular/router';

import {

  type ViewWillEnter,

  type ViewWillLeave

} from '@ionic/angular';

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

  chevronForwardOutline,

  checkmarkOutline,

  alertCircleOutline

} from 'ionicons/icons';

import type { Subscription } from 'rxjs';

import { AuthService } from '../../services/auth.service';

import { SupabaseService } from '../../services/supabase.service';

import { NetworkService } from '../../services/network.service';

import {

  OfflineSyncService,

  getPhilippineDate,

  type CachedAttendance

} from '../../services/offline-sync.service';

// =========================================

// INTERFACES

// =========================================

interface RecentActivity {

  id: string | number;

  icon: string;

  title: string;

  description: string;

  day: string;

  timestamp: number;

}

interface TodoReport {

  id: number;

  week: number;

  period: string;

  status: 'draft' | 'returned';

}

interface DashboardStudent {

  name: string;

  course: string;

  companyLocation: string;

  requiredHours: number;

}

interface DashboardReport {

  id: number;

  week: number;

  period: string | null;

  status: string;

  start_date: string | null;

  end_date: string | null;

  submitted_at: string | null;

  reviewed_at: string | null;

}

interface DashboardCache {

  version: number;

  userId: string;

  studentId: string;

  student: DashboardStudent | null;

  reports: DashboardReport[] | null;

  studentCachedAt: number | null;

  reportsCachedAt: number | null;

}

// =========================================

// COMPONENT

// =========================================

@Component({

  selector: 'app-homepage',

  templateUrl: './homepage.page.html',

  styleUrls: ['./homepage.page.scss'],

  standalone: true,

  imports: [

    CommonModule,

    RouterModule

  ],

  schemas: [CUSTOM_ELEMENTS_SCHEMA]

})

export class HomepagePage

  implements OnInit, OnDestroy, ViewWillEnter, ViewWillLeave {

  // =========================================

  // SERVICES

  // =========================================

  private readonly supabaseService =

    inject(SupabaseService);

  private readonly authService =

    inject(AuthService);

  private readonly networkService =

    inject(NetworkService);

  private readonly offlineSyncService =

    inject(OfflineSyncService);

  private readonly cdr =

    inject(ChangeDetectorRef);

  private readonly supabase =

    this.supabaseService.getClient();

  // =========================================

  // CACHE CONFIGURATION

  // =========================================

  private readonly cachePrefix =

    'interntrack_dashboard_v1_';

  private readonly cacheVersion = 1;

  private cachedStudent:

    DashboardStudent | null = null;

  private cachedReports:

    DashboardReport[] | null = null;

  private studentCachedAt:

    number | null = null;

  private reportsCachedAt:

    number | null = null;

  private attendanceRecords:

    CachedAttendance[] = [];

  // =========================================

  // COMPONENT STATE

  // =========================================

  private destroyed = false;

  private viewActive = false;

  private currentUserId = '';

  private loadVersion = 0;

  private currentAttendanceDate =

    getPhilippineDate();

  private networkSub?: Subscription;

  private syncSub?: Subscription;

  private syncStateSub?: Subscription;

  private serverRequest?: AbortController;

  private reconnectTimer?:

    ReturnType<typeof setTimeout>;

  // =========================================

  // DASHBOARD STATE

  // =========================================

  isOnline = false;

  isLoading = true;

  isCachedDashboard = false;

  dashboardLoadError = false;

  attendanceLoadError = false;

  dashboardMessage = '';

  lastUpdated: number | null = null;

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

  requiredHours = 0;

  verifiedHours = 0;

  provisionalHours = 0;

  remainingHours = 0;

  verifiedPercent = 0;

  provisionalPercent = 0;

  // =========================================

  // TODAY'S ATTENDANCE

  // =========================================

  todayStatusText = 'Not timed in yet';

  isTimedInToday = false;

  currentLiveTime = '';
  greeting = 'Good Morning';

  private clockInterval?:

    ReturnType<typeof setInterval>;

  // =========================================

  // RECENT ACTIVITIES

  // =========================================

  showAllActivities = false;

  activitiesLoadError = false;

  activities: RecentActivity[] = [];

  displayedActivities: RecentActivity[] = [];

  // =========================================

  // WEEKLY REPORTS

  // =========================================

  todoReports: TodoReport[] = [];

  reportsLoadError = false;

  // =========================================

  // CONSTRUCTOR

  // =========================================

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

      personOutline,

      checkmarkOutline,

      alertCircleOutline

    });

  }

  // =========================================

  // COMPONENT INITIALIZATION

  // =========================================

  ngOnInit(): void {

    this.updateLiveTime();

    this.clockInterval = setInterval(() => {

      if (

        this.destroyed ||

        !this.viewActive

      ) {

        return;

      }

      this.updateLiveTime();

      const today = getPhilippineDate();

      // Refresh today's attendance after midnight.

      if (

        today !== this.currentAttendanceDate

      ) {

        this.currentAttendanceDate = today;

        this.calculateAttendance();

        this.buildRecentActivities();

        void this.refreshDashboard();

      }

      this.refresh();

    }, 1000);

  }

  // =========================================

  // PAGE ENTRY

  // =========================================

  async ionViewWillEnter(): Promise<void> {

    this.viewActive = true;

    this.isLoading = true;

    this.dashboardLoadError = false;

    this.dashboardMessage = '';

    this.currentAttendanceDate =

      getPhilippineDate();

    this.updateLiveTime();

    try {

      await this.networkService

        .waitForInitialization();

      await this.authService

        .waitForInitialization();

      if (

        this.destroyed ||

        !this.viewActive

      ) {

        return;

      }

      const studentId =

        this.authService.getStudentId();

      const userId =

        this.authService.getCurrentUser()?.id;

      // Only use authenticated student identity.

      if (

        !studentId ||

        !userId ||

        !this.authService.isAuthenticated() ||

        !this.authService.isStudent()

      ) {

        this.resetDashboard();

        this.dashboardLoadError = true;

        this.dashboardMessage =

          'Unable to identify your student account.';

        return;

      }

      // Prevent displaying another student's data.

      if (

        this.studentIdNumber !== studentId ||

        this.currentUserId !== userId

      ) {

        this.resetDashboard();

      }

      this.studentIdNumber = studentId;

      this.currentUserId = userId;

      this.isOnline =

        this.networkService.isOnline();

      await this.offlineSyncService.ready();

      if (

        !this.viewActive ||

        !this.isCurrentIdentity(

          userId,

          studentId

        )

      ) {

        return;

      }

      // Set the student for local attendance access.

      this.offlineSyncService.setActiveStudent(

        studentId

      );

      // Restore previously saved dashboard information.

      this.restoreDashboardCache(

        userId,

        studentId

      );

      this.applyStudentData();

      this.applyTodoReports();

      // Read attendance from IndexedDB.

      await this.loadLocalAttendance();

      if (

        !this.viewActive ||

        !this.isCurrentIdentity(

          userId,

          studentId

        )

      ) {

        return;

      }

      this.buildRecentActivities();

      this.initializeSubscriptions();

      // Refresh from Supabase only when connected.

      await this.refreshDashboard();

    } catch (error) {

      console.warn(

        'Dashboard initialization failed:',

        error

      );

      this.dashboardLoadError = true;

      this.dashboardMessage =

        'Unable to initialize the dashboard.';

    } finally {

      this.isLoading = false;

      this.refresh();

    }

  }

  // =========================================

  // NETWORK AND SYNC SUBSCRIPTIONS

  // =========================================

  private initializeSubscriptions(): void {

    this.unsubscribeAll();

    // Centralized network monitoring.

    this.networkSub =

      this.networkService.online$

        .subscribe(connected => {

          const changed =

            this.isOnline !== connected;

          this.isOnline = connected;

          if (

            !changed ||

            !this.viewActive ||

            this.destroyed

          ) {

            return;

          }

          if (!connected) {

            this.loadVersion++;

            this.serverRequest?.abort();

            this.clearReconnectTimer();

            this.isLoading = false;

            this.updateOfflineState();

            void this.refreshLocalDashboard();

          } else {

            void this.refreshDashboard();

          }

          this.refresh();

        });

    // Refresh after successful attendance synchronization.

    this.syncSub =

      this.offlineSyncService.synced$

        .subscribe(() => {

          if (

            this.viewActive &&

            !this.destroyed

          ) {

            void this.refreshDashboard();

          }

        });

    // Refresh locally recorded attendance.

    this.syncStateSub =

      this.offlineSyncService.syncState$

        .subscribe(() => {

          if (

            this.viewActive &&

            !this.destroyed

          ) {

            void this.refreshLocalDashboard();

          }

        });

  }

  private unsubscribeAll(): void {

    this.networkSub?.unsubscribe();

    this.syncSub?.unsubscribe();

    this.syncStateSub?.unsubscribe();

    this.networkSub = undefined;

    this.syncSub = undefined;

    this.syncStateSub = undefined;

  }

  // =========================================

  // PAGE EXIT

  // =========================================

  ionViewWillLeave(): void {

    this.viewActive = false;

    this.loadVersion++;

    this.serverRequest?.abort();

    this.clearReconnectTimer();

    this.unsubscribeAll();

    const activeElement =

      document.activeElement;

    if (

      activeElement instanceof HTMLElement &&

      activeElement.closest('app-homepage')

    ) {

      activeElement.blur();

    }

  }

  ngOnDestroy(): void {

    this.destroyed = true;

    this.viewActive = false;

    this.loadVersion++;

    this.serverRequest?.abort();

    this.clearReconnectTimer();

    this.unsubscribeAll();

    if (this.clockInterval) {

      clearInterval(this.clockInterval);

    }

  }

  private refresh(): void {

    if (!this.destroyed) {

      this.cdr.detectChanges();

    }

  }

  // =========================================

  // IDENTITY VALIDATION

  // =========================================

  private isCurrentIdentity(

    userId: string,

    studentId: string

  ): boolean {

    return (

      !this.destroyed &&

      this.authService.isAuthenticated() &&

      this.authService.isStudent() &&

      this.currentUserId === userId &&

      this.studentIdNumber === studentId &&

      this.authService.getCurrentUser()?.id === userId &&

      this.authService.getStudentId() === studentId

    );

  }

  private isCurrentLoad(

    userId: string,

    studentId: string,

    version: number

  ): boolean {

    return (

      this.viewActive &&

      version === this.loadVersion &&

      this.isCurrentIdentity(

        userId,

        studentId

      )

    );

  }

  // =========================================

  // LIVE CLOCK

  // =========================================

  updateLiveTime(): void {
    const now = new Date();

    this.currentLiveTime = now.toLocaleTimeString(
      'en-US',
      {
        timeZone: 'Asia/Manila',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }
    );

    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        hour: 'numeric',
        hourCycle: 'h23'
      }).format(now)
    );

    if (hour < 12) {
      this.greeting = 'Good Morning';
    } else if (hour < 18) {
      this.greeting = 'Good Afternoon';
    } else {
      this.greeting = 'Good Evening';
    }
  }

  // =========================================

  // RESET DASHBOARD

  // =========================================

  private resetDashboard(): void {

    this.studentName = '';

    this.studentCourse = '';

    this.studentIdNumber = '';

    this.currentUserId = '';

    this.companyLocation = '';

    this.requiredHours = 0;

    this.cachedStudent = null;

    this.cachedReports = null;

    this.studentCachedAt = null;

    this.reportsCachedAt = null;

    this.attendanceRecords = [];

    this.lastUpdated = null;

    this.isCachedDashboard = false;

    this.dashboardLoadError = false;

    this.attendanceLoadError = false;

    this.dashboardMessage = '';

    this.resetAttendanceData();

    this.resetReportData();

    this.resetActivitiesData();

  }

  private resetAttendanceData(): void {

    this.totalHours = 0;

    this.verifiedHours = 0;

    this.provisionalHours = 0;

    this.remainingHours =

      this.requiredHours;

    this.verifiedPercent = 0;

    this.provisionalPercent = 0;

    this.todayStatusText =

      'Not timed in yet';

    this.isTimedInToday = false;

  }

  private resetReportData(): void {

    this.todoReports = [];

    this.reportsLoadError = false;

  }

  private resetActivitiesData(): void {

    this.activities = [];

    this.displayedActivities = [];

    this.showAllActivities = false;

    this.activitiesLoadError = false;

  }

  // =========================================

  // CACHE KEY

  // =========================================

  private getCacheKey(

    userId: string,

    studentId: string

  ): string {

    return (

      this.cachePrefix +

      encodeURIComponent(userId) +

      '_' +

      encodeURIComponent(studentId)

    );

  }

  // =========================================

  // SAVE DASHBOARD CACHE

  // =========================================

  private saveDashboardCache(): void {

    const userId =

      this.currentUserId;

    const studentId =

      this.studentIdNumber;

    if (

      !userId ||

      !studentId ||

      !this.isCurrentIdentity(

        userId,

        studentId

      )

    ) {

      return;

    }

    try {

      const cache: DashboardCache = {

        version: this.cacheVersion,

        userId,

        studentId,

        student: this.cachedStudent,

        reports: this.cachedReports,

        studentCachedAt:

          this.studentCachedAt,

        reportsCachedAt:

          this.reportsCachedAt

      };

      localStorage.setItem(

        this.getCacheKey(

          userId,

          studentId

        ),

        JSON.stringify(cache)

      );

      this.updateLastUpdated();

    } catch (error) {

      console.warn(

        'Unable to save dashboard cache:',

        error

      );

    }

  }

  // =========================================

  // RESTORE DASHBOARD CACHE

  // =========================================

  private restoreDashboardCache(

    userId: string,

    studentId: string

  ): void {

    if (

      !this.isCurrentIdentity(

        userId,

        studentId

      )

    ) {

      return;

    }

    try {

      const raw = localStorage.getItem(

        this.getCacheKey(

          userId,

          studentId

        )

      );

      if (!raw) {

        return;

      }

      const cache =

        JSON.parse(raw) as DashboardCache;

      if (

        !cache ||

        cache.version !== this.cacheVersion ||

        cache.userId !== userId ||

        cache.studentId !== studentId

      ) {

        return;

      }

      const student = cache.student;

      if (

        student &&

        typeof student.name === 'string' &&

        typeof student.course === 'string' &&

        typeof student.companyLocation === 'string' &&

        Number.isFinite(student.requiredHours) &&

        student.requiredHours >= 0

      ) {

        this.cachedStudent = {

          ...student

        };

        this.studentCachedAt =

          typeof cache.studentCachedAt === 'number'

            ? cache.studentCachedAt

            : null;

      }

      if (

        Array.isArray(cache.reports) &&

        cache.reports.every(report =>

          report &&

          Number.isFinite(report.id) &&

          Number.isFinite(report.week) &&

          typeof report.status === 'string'

        )

      ) {

        this.cachedReports =

          cache.reports.map(report => ({

            ...report

          }));

        this.reportsCachedAt =

          typeof cache.reportsCachedAt === 'number'

            ? cache.reportsCachedAt

            : null;

      }

      this.isCachedDashboard =

        this.cachedStudent !== null ||

        this.cachedReports !== null;

      this.updateLastUpdated();

    } catch (error) {

      console.warn(

        'Unable to restore dashboard cache:',

        error

      );

    }

  }

  private updateLastUpdated(): void {

    const timestamps = [

      this.studentCachedAt,

      this.reportsCachedAt

    ].filter(

      (value): value is number =>

        typeof value === 'number' &&

        Number.isFinite(value)

    );

    this.lastUpdated =

      timestamps.length > 0

        ? Math.min(...timestamps)

        : null;

  }

  // =========================================

  // APPLY STUDENT INFORMATION

  // =========================================

  private applyStudentData(): void {

    if (!this.cachedStudent) {

      this.studentName = 'Student';

      this.studentCourse = '';

      this.companyLocation = '';

      this.requiredHours = 0;

      this.calculateAttendance();

      return;

    }

    this.studentName =

      this.cachedStudent.name;

    this.studentCourse =

      this.cachedStudent.course;

    this.companyLocation =

      this.cachedStudent.companyLocation;

    this.requiredHours =

      this.cachedStudent.requiredHours;

    this.calculateAttendance();

  }

  // =========================================

  // LOAD LOCAL ATTENDANCE

  // =========================================

  private async loadLocalAttendance(): Promise<void> {

    const studentId =

      this.studentIdNumber;

    const userId =

      this.currentUserId;

    if (

      !studentId ||

      !userId ||

      !this.isCurrentIdentity(

        userId,

        studentId

      )

    ) {

      return;

    }

    try {

      const records =

        await this.offlineSyncService

          .getCachedAttendanceRecords(

            studentId

          );

      if (

        !this.viewActive ||

        !this.isCurrentIdentity(

          userId,

          studentId

        )

      ) {

        return;

      }

      this.attendanceRecords =

        records.filter(record =>

          record.student_id === studentId

        );

      this.attendanceLoadError = false;

      this.calculateAttendance();

    } catch (error) {

      if (

        !this.viewActive ||

        !this.isCurrentIdentity(

          userId,

          studentId

        )

      ) {

        return;

      }

      this.attendanceLoadError = true;

      console.warn(

        'Unable to load local attendance:',

        error

      );

    }

  }

  // =========================================

  // REFRESH LOCAL DASHBOARD

  // =========================================

  private async refreshLocalDashboard(): Promise<void> {

    if (

      this.destroyed ||

      !this.viewActive

    ) {

      return;

    }

    await this.loadLocalAttendance();

    if (

      !this.viewActive ||

      !this.isCurrentIdentity(

        this.currentUserId,

        this.studentIdNumber

      )

    ) {

      return;

    }

    this.buildRecentActivities();

    this.refresh();

  }

  // =========================================

  // OFFLINE DASHBOARD STATE

  // =========================================

  private updateOfflineState(): void {

    this.isCachedDashboard =

      this.cachedStudent !== null ||

      this.cachedReports !== null ||

      this.attendanceRecords.length > 0;

    this.dashboardLoadError = false;

    // A missing cache is different from an empty report list.

    this.reportsLoadError =

      this.cachedReports === null;

    this.activitiesLoadError =

      this.cachedReports === null &&

      this.attendanceRecords.length === 0;

    if (this.isCachedDashboard) {

      this.dashboardMessage =

        'Offline mode. Showing locally saved information.';

    } else {

      this.dashboardMessage =

        'No saved dashboard information is available. Connect to the internet.';

    }

  }

  // =========================================

  // RECONNECTION HANDLING

  // =========================================

  private clearReconnectTimer(): void {

    if (this.reconnectTimer) {

      clearTimeout(this.reconnectTimer);

      this.reconnectTimer = undefined;

    }

  }

  private scheduleReconnectRefresh(): void {

    this.clearReconnectTimer();

    if (

      !this.viewActive ||

      this.destroyed ||

      !this.networkService.isOnline()

    ) {

      return;

    }

    this.reconnectTimer = setTimeout(() => {

      if (

        this.viewActive &&

        !this.destroyed &&

        this.networkService.isOnline()

      ) {

        void this.refreshDashboard();

      }

    }, 3000);

  }

  // =========================================

  // MAIN DASHBOARD REFRESH

  // =========================================

  async refreshDashboard(): Promise<void> {

    const studentId =

      this.studentIdNumber;

    const userId =

      this.currentUserId;

    if (

      !studentId ||

      !userId ||

      !this.viewActive ||

      !this.isCurrentIdentity(

        userId,

        studentId

      )

    ) {

      return;

    }

    const version = ++this.loadVersion;

    this.serverRequest?.abort();

    this.clearReconnectTimer();

    this.isLoading = true;

    this.dashboardLoadError = false;

    let controller:

      AbortController | undefined;

    try {

      // Always load local attendance first.

      await this.loadLocalAttendance();

      if (

        !this.isCurrentLoad(

          userId,

          studentId,

          version

        )

      ) {

        return;

      }

      this.applyStudentData();

      this.applyTodoReports();

      this.buildRecentActivities();

      this.isOnline =

        this.networkService.isOnline();

      // =====================================

      // OFFLINE MODE

      // =====================================

      if (!this.isOnline) {

        this.updateOfflineState();

        return;

      }

      // =====================================

      // SESSION REVALIDATION

      // =====================================

      if (

        this.authService.isOfflineSession()

      ) {

        this.isCachedDashboard = true;

        this.dashboardMessage =

          'Reconnecting. Showing saved information.';

        this.scheduleReconnectRefresh();

        return;

      }

      // =====================================

      // ONLINE MODE

      // =====================================

      controller = new AbortController();

      this.serverRequest = controller;

      const attendanceRevision = this.offlineSyncService.getAttendanceRevision();

      // Retrieve student, attendance and report

      // information without duplicate queries.

      const [

        studentResult,

        attendanceResult,

        reportsResult

      ] = await Promise.allSettled([

        this.supabase

          .from('students')

          .select('*')

          .eq('student_id', studentId)

          .abortSignal(controller.signal)

          .maybeSingle(),

        this.supabase

          .from('attendance')

          .select(`

            id,

            student_id,

            attendance_date,

            client_transaction_id,

            time_in,

            time_out,

            total_hours_rendered,

            sync_status,

            verification_status

          `, { count: 'exact' })

          .eq('student_id', studentId)

          .order(

            'attendance_date',

            { ascending: false }

          )

          .abortSignal(controller.signal),

        this.supabase

          .from('reports')

          .select(`

            id,

            week,

            period,

            status,

            start_date,

            end_date,

            submitted_at,

            reviewed_at

          `)

          .eq('student_id', studentId)

          .order(

            'week',

            { ascending: false }

          )

          .abortSignal(controller.signal)

      ]);

      if (

        !this.isCurrentLoad(

          userId,

          studentId,

          version

        )

      ) {

        return;

      }

      let studentError = false;

      let attendanceError = false;

      let reportsError = false;

      // =====================================

      // STUDENT QUERY RESULT

      // =====================================

      if (

        studentResult.status === 'fulfilled' &&

        !studentResult.value.error

      ) {

        const data =

          studentResult.value.data;

        if (data) {

          const fullName = String(

            data.full_name ||

            data.name ||

            'Student'

          ).trim();

          const requiredHours =

            Number(data.required_hours ?? 0);

          this.cachedStudent = {

            name:

              fullName.split(/\s+/)[0] ||

              'Student',

            course:

              data.course || '',

            companyLocation:

              data.company_location ||

              data.company_name ||

              '',

            requiredHours:

              Number.isFinite(requiredHours) &&

              requiredHours >= 0

                ? requiredHours

                : 0

          };

          this.studentCachedAt = Date.now();

        } else {

          this.cachedStudent = null;

          this.studentCachedAt = null;

          studentError = true;

        }

      } else {

        // Retain existing cached student information.

        studentError = true;

        console.warn(

          'Unable to refresh student information.'

        );

      }

      // =====================================

      // ATTENDANCE QUERY RESULT

      // =====================================

      if (

        attendanceResult.status === 'fulfilled' &&

        !attendanceResult.value.error

      ) {

        try {

          const { data, count } = attendanceResult.value;
          if (!Array.isArray(data) || count !== data.length) {
            throw new Error('Incomplete attendance snapshot.');
          }
          const serverRecords: CachedAttendance[] = [];
          const serverDates = new Set<string>();

          for (const row of data) {

            if (

              !this.isCurrentLoad(

                userId,

                studentId,

                version

              )

            ) {

              return;

            }

            if (

              !row.attendance_date ||

              !row.time_in ||

              row.student_id !== studentId ||
              serverDates.has(row.attendance_date)

            ) {

              throw new Error('Invalid or duplicate attendance record.');

            }

            serverDates.add(row.attendance_date);

            const record: CachedAttendance = {

              id: row.id,

              student_id: row.student_id,

              attendance_date:

                row.attendance_date,

              client_transaction_id:

                row.client_transaction_id || '',

              time_in:

                row.time_in,

              time_out:

                row.time_out || null,

              total_hours_rendered:

                row.total_hours_rendered !== null &&

                row.total_hours_rendered !== undefined

                  ? Number(

                      row.total_hours_rendered

                    )

                  : null,

              sync_status:

                row.sync_status === 'synced'

                  ? 'synced'

                  : 'pending_upload',

              verification_status:

                row.verification_status === 'verified'

                  ? 'verified'

                  : 'provisional'

            };

            serverRecords.push(record);

          }

          if (!this.isCurrentLoad(userId, studentId, version)) return;
          await this.offlineSyncService.reconcileAttendanceCache(
            studentId, serverRecords, attendanceRevision
          );
        } catch (error) {

          attendanceError = true;

          console.warn(

            'Unable to update attendance cache:',

            error

          );

        }

      } else {

        attendanceError = true;

        console.warn(

          'Unable to refresh attendance information.'

        );

      }

      if (

        !this.isCurrentLoad(

          userId,

          studentId,

          version

        )

      ) {

        return;

      }

      // =====================================

      // REPORTS QUERY RESULT

      // =====================================

      if (

        reportsResult.status === 'fulfilled' &&

        !reportsResult.value.error

      ) {

        this.cachedReports =

          (reportsResult.value.data || [])

            .map(row => ({

              id: row.id,

              week: row.week,

              period:

                row.period || null,

              status:

                row.status,

              start_date:

                row.start_date || null,

              end_date:

                row.end_date || null,

              submitted_at:

                row.submitted_at || null,

              reviewed_at:

                row.reviewed_at || null

            }));

        this.reportsCachedAt = Date.now();

      } else {

        // Retain the last successful report snapshot.

        reportsError = true;

        console.warn(

          'Unable to refresh weekly reports.'

        );

      }

      // =====================================

      // UPDATE DASHBOARD

      // =====================================

      this.saveDashboardCache();

      this.applyStudentData();

      await this.loadLocalAttendance();

      if (

        !this.isCurrentLoad(

          userId,

          studentId,

          version

        )

      ) {

        return;

      }

      this.applyTodoReports();

      this.buildRecentActivities();

      this.attendanceLoadError =

        attendanceError ||

        this.attendanceLoadError;

      this.reportsLoadError =

        reportsError &&

        this.cachedReports === null;

      this.activitiesLoadError =

        reportsError &&

        this.cachedReports === null &&

        this.attendanceRecords.length === 0;

      this.dashboardLoadError =

        studentError ||

        this.attendanceLoadError ||

        reportsError;

      this.isCachedDashboard =

        this.dashboardLoadError;

      this.dashboardMessage =

        this.dashboardLoadError

          ? 'Some information could not be refreshed. Showing saved data where available.'

          : '';

      this.isOnline =

        this.networkService.isOnline();

      if (!this.isOnline) {

        this.updateOfflineState();

      }

    } catch (error) {

      if (

        !this.isCurrentLoad(

          userId,

          studentId,

          version

        )

      ) {

        return;

      }

      console.warn(

        'Dashboard refresh failed:',

        error

      );

      this.isOnline =

        this.networkService.isOnline();

      if (!this.isOnline) {

        this.updateOfflineState();

      } else {

        this.dashboardLoadError = true;

        this.isCachedDashboard = true;

        this.dashboardMessage =

          'Unable to refresh dashboard. Showing saved information where available.';

      }

    } finally {

      if (

        this.serverRequest === controller

      ) {

        this.serverRequest = undefined;

      }

      if (

        version === this.loadVersion &&

        !this.destroyed

      ) {

        this.isLoading = false;

        this.refresh();

      }

    }

  }

  // =========================================

  // COMPATIBILITY METHODS

  // =========================================

  async loadStudentData(

    studentId: string

  ): Promise<void> {

    if (

      studentId === this.studentIdNumber

    ) {

      await this.refreshDashboard();

    }

  }

  async loadCurrentReport(

    studentId: string

  ): Promise<void> {

    if (

      studentId === this.studentIdNumber

    ) {

      await this.refreshDashboard();

    }

  }

  async loadRecentActivities(

    studentId: string

  ): Promise<void> {

    if (

      studentId === this.studentIdNumber

    ) {

      await this.refreshDashboard();

    }

  }

  // =========================================

  // CALCULATE ATTENDANCE

  // =========================================

  private calculateAttendance(): void {

    this.resetAttendanceData();

    const today = getPhilippineDate();

    // Ensure one attendance record per date.

    const uniqueRecords = new Map<

      string,

      CachedAttendance

    >();

    for (const record of this.attendanceRecords) {

      if (

        record.student_id !==

          this.studentIdNumber ||

        !record.attendance_date

      ) {

        continue;

      }

      uniqueRecords.set(

        record.attendance_date,

        record

      );

    }

    const records =

      Array.from(uniqueRecords.values());

    // =======================================

    // TODAY'S ATTENDANCE

    // =======================================

    const todayRecord =

      uniqueRecords.get(today);

    if (todayRecord?.time_in) {

      this.isTimedInToday = true;

      this.todayStatusText =

        todayRecord.time_out

          ? 'Timed Out (Done for today)'

          : 'Timed In';

    }

    // =======================================

    // OJT HOURS

    // =======================================

    let verifiedHours = 0;

    let provisionalHours = 0;

    for (const record of records) {

      // Incomplete attendance does not earn hours.

      if (

        !record.time_in ||

        !record.time_out

      ) {

        continue;

      }

      const timeIn =

        new Date(record.time_in).getTime();

      const timeOut =

        new Date(record.time_out).getTime();

      const duration = timeOut - timeIn;

      if (

        !Number.isFinite(duration) ||

        duration < 0

      ) {

        continue;

      }

      const storedHours =

        record.total_hours_rendered;

      // Use recorded hours when available.

      const renderedHours =

        typeof storedHours === 'number' &&

        Number.isFinite(storedHours) &&

        storedHours >= 0

          ? storedHours

          : duration / 3_600_000;

      // Only synchronized and verified attendance

      // contributes to official OJT completion.

      if (

        record.verification_status === 'verified' &&

        record.sync_status === 'synced'

      ) {

        verifiedHours += renderedHours;

      } else {

        provisionalHours += renderedHours;

      }

    }

    this.verifiedHours =

      verifiedHours;

    this.provisionalHours =

      provisionalHours;

    this.totalHours =

      verifiedHours + provisionalHours;

    // Only verified hours reduce remaining hours.

    this.remainingHours = Math.max(

      0,

      this.requiredHours -

        this.verifiedHours

    );

    // =======================================

    // PROGRESS BAR

    // =======================================

    if (this.requiredHours > 0) {

      this.verifiedPercent = Math.min(

        100,

        (

          this.verifiedHours /

          this.requiredHours

        ) * 100

      );

      this.provisionalPercent = Math.min(

        100 - this.verifiedPercent,

        (

          this.provisionalHours /

          this.requiredHours

        ) * 100

      );

    } else {

      this.verifiedPercent = 0;

      this.provisionalPercent = 0;

    }

  }

  // =========================================

  // APPLY ACTIONABLE REPORTS

  // =========================================

  private applyTodoReports(): void {

    if (this.cachedReports === null) {

      this.todoReports = [];

      this.reportsLoadError = true;

      return;

    }

    this.reportsLoadError = false;

    this.todoReports =

      this.cachedReports

        .filter(report =>

          report.status === 'draft' ||

          report.status === 'returned'

        )

        .map((report): TodoReport => ({

          id: report.id,

          week: report.week,

          period:

            this.formatReportPeriod(

              report.start_date,

              report.end_date,

              report.period

            ),

          status:

            report.status as

              'draft' | 'returned'

        }))

        .sort((a, b) => {

          // Returned reports require priority.

          const priorityA =

            a.status === 'returned' ? 0 : 1;

          const priorityB =

            b.status === 'returned' ? 0 : 1;

          return (

            priorityA - priorityB ||

            b.week - a.week

          );

        });

  }

  // =========================================

  // FORMAT REPORT PERIOD

  // =========================================

  private formatReportPeriod(

    startDate: string | null,

    endDate: string | null,

    fallback: string | null

  ): string {

    if (!startDate || !endDate) {

      return (

        fallback ||

        'Reporting period not set'

      );

    }

    const start =

      new Date(`${startDate}T00:00:00+08:00`);

    const end =

      new Date(`${endDate}T00:00:00+08:00`);

    if (

      !Number.isFinite(start.getTime()) ||

      !Number.isFinite(end.getTime()) ||

      end.getTime() < start.getTime()

    ) {

      return (

        fallback ||

        'Reporting period not set'

      );

    }

    const options: Intl.DateTimeFormatOptions = {

      timeZone: 'Asia/Manila',

      month: 'short',

      day: 'numeric'

    };

    return `${

      start.toLocaleDateString(

        'en-US',

        options

      )

    } - ${

      end.toLocaleDateString(

        'en-US',

        {

          ...options,

          year: 'numeric'

        }

      )

    }`;

  }

  // =========================================

  // BUILD RECENT ACTIVITIES

  // =========================================

  private buildRecentActivities(): void {

    const activities: RecentActivity[] = [];

    const activityIds = new Set<string>();

    // =======================================

    // ACTIVITY HELPER

    // =======================================

    const addActivity = (

      id: string,

      icon: string,

      description: string,

      dateValue: string | null

    ): void => {

      if (

        !dateValue ||

        activityIds.has(id)

      ) {

        return;

      }

      const date =

        new Date(dateValue);

      if (

        !Number.isFinite(date.getTime())

      ) {

        return;

      }

      activityIds.add(id);

      activities.push({

        id,

        icon,

        title: description,

        description,

        day:

          this.formatActivityDate(date),

        timestamp:

          date.getTime()

      });

    };

    // =======================================

    // ATTENDANCE ACTIVITIES

    // =======================================

    for (const record of this.attendanceRecords) {

      const recordId =

        record.client_transaction_id ||

        record.id ||

        `${record.student_id}-${record.attendance_date}`;

      const pendingLabel =

        record.sync_status === 'pending_upload'

          ? ' (Pending sync)'

          : '';

      // Time-In activity.

      if (record.time_in) {

        addActivity(

          `attendance-${recordId}-in`,

          'time-outline',

          `Timed in at ${

            this.formatActivityTime(

              record.time_in

            )

          }${pendingLabel}`,

          record.time_in

        );

      }

      // Time-Out activity.

      if (record.time_out) {

        addActivity(

          `attendance-${recordId}-out`,

          'time-outline',

          `Timed out at ${

            this.formatActivityTime(

              record.time_out

            )

          }${pendingLabel}`,

          record.time_out

        );

      }

    }

    // =======================================

    // WEEKLY REPORT ACTIVITIES

    // =======================================

    for (

      const report of

      this.cachedReports || []

    ) {

      // Report submission.

      if (report.submitted_at) {

        addActivity(

          `report-${report.id}-submitted`,

          'document-text-outline',

          `Week ${report.week} Report Submitted`,

          report.submitted_at

        );

      }

      // Report approval.

      if (

        report.status === 'approved' &&

        report.reviewed_at

      ) {

        addActivity(

          `report-${report.id}-approved`,

          'checkmark-outline',

          `Week ${report.week} Report Approved`,

          report.reviewed_at

        );

      }

      // Report returned for revision.

      if (

        report.status === 'returned' &&

        report.reviewed_at

      ) {

        addActivity(

          `report-${report.id}-returned`,

          'alert-circle-outline',

          `Week ${report.week} Report Returned`,

          report.reviewed_at

        );

      }

    }

    // =======================================

    // SORT ACTIVITIES

    // =======================================

    this.activities = activities.sort(

      (a, b) =>

        b.timestamp - a.timestamp

    );

    this.activitiesLoadError =

      this.attendanceLoadError &&

      this.cachedReports === null &&

      this.activities.length === 0;

    this.updateDisplayedActivities();

  }

  // =========================================

  // FORMAT ACTIVITY TIME

  // =========================================

  private formatActivityTime(

    value: string

  ): string {

    const date =

      new Date(value);

    if (

      !Number.isFinite(date.getTime())

    ) {

      return '--';

    }

    return date.toLocaleTimeString(

      'en-US',

      {

        timeZone: 'Asia/Manila',

        hour: 'numeric',

        minute: '2-digit',

        hour12: true

      }

    );

  }

  // =========================================

  // FORMAT ACTIVITY DATE

  // =========================================

  private formatActivityDate(

    date: Date

  ): string {

    const todayKey =

      getPhilippineDate();

    const activityKey =

      getPhilippineDate(date);

    const today =

      new Date(`${todayKey}T00:00:00+08:00`);

    const activityDate =

      new Date(`${activityKey}T00:00:00+08:00`);

    const differenceInDays = Math.round(

      (

        today.getTime() -

        activityDate.getTime()

      ) / 86_400_000

    );

    if (differenceInDays === 0) {

      return 'Today';

    }

    if (differenceInDays === 1) {

      return 'Yesterday';

    }

    // Determine the current Philippine weekday.

    const weekday =

      new Intl.DateTimeFormat(

        'en-US',

        {

          timeZone: 'Asia/Manila',

          weekday: 'short'

        }

      ).format(today);

    const weekdays = [

      'Sun',

      'Mon',

      'Tue',

      'Wed',

      'Thu',

      'Fri',

      'Sat'

    ];

    const weekdayIndex =

      weekdays.indexOf(weekday);

    if (

      differenceInDays >= 0 &&

      differenceInDays <= weekdayIndex

    ) {

      return date.toLocaleDateString(

        'en-US',

        {

          timeZone: 'Asia/Manila',

          weekday: 'short'

        }

      );

    }

    return date.toLocaleDateString(

      'en-US',

      {

        timeZone: 'Asia/Manila',

        month: 'short',

        day: 'numeric',

        ...(

          activityKey.substring(0, 4) !==

          todayKey.substring(0, 4)

            ? {

                year: 'numeric' as const

              }

            : {}

        )

      }

    );

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

  // MANUAL DASHBOARD RETRY

  // =========================================

  async retryDashboard(): Promise<void> {

    const status =

      await this.networkService.refreshStatus();

    this.isOnline =

      status.connected;

    await this.refreshDashboard();

  }

  // =========================================

  // LAST UPDATED LABEL

  // =========================================

  get lastUpdatedLabel(): string {

    if (!this.lastUpdated) {

      return '';

    }

    return new Date(

      this.lastUpdated

    ).toLocaleString(

      'en-US',

      {

        timeZone: 'Asia/Manila',

        month: 'short',

        day: 'numeric',

        year: 'numeric',

        hour: 'numeric',

        minute: '2-digit',

        hour12: true

      }

    );

  }

}
