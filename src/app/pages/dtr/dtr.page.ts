import {
  Component,
  ChangeDetectorRef,
  ElementRef,
  ViewChild,
  inject,
  type OnDestroy
} from '@angular/core';

import {
  AlertController,
  IonContent,
  IonIcon,
  type ViewWillEnter,
  type ViewWillLeave
} from '@ionic/angular';

import { addIcons } from 'ionicons';

import {
  cafeOutline,
  checkmarkCircleOutline,
  chevronBackOutline,
  chevronForwardOutline,
  downloadOutline,
  timeOutline
} from 'ionicons/icons';

import { Capacitor } from '@capacitor/core';

import {
  Directory,
  Filesystem
} from '@capacitor/filesystem';

import { Share } from '@capacitor/share';

import type { Subscription } from 'rxjs';

import * as pdfjsLib from 'pdfjs-dist';

import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';

import type {
  TDocumentDefinitions
} from 'pdfmake/interfaces';

import {
  createDtrTemplate
} from '../../utils/dtr-template';

import { AuthService } from '../../services/auth.service';
import { SupabaseService } from '../../services/supabase.service';
import { NetworkService } from '../../services/network.service';

import {
  OfflineSyncService,
  getPhilippineDate,
  type CachedAttendance
} from '../../services/offline-sync.service';

// =========================================
// PDF CONFIGURATION
// =========================================

pdfMake.addVirtualFileSystem(
  pdfFonts as unknown as Record<string, string>
);

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'assets/pdf.worker.min.mjs';

// =========================================
// INTERFACES
// =========================================

interface CalendarDay {
  date: Date;
  key: string;
  number: number;
  label: string;
  fullLabel: string;
}

type DtrStatus =
  | 'verified'
  | 'provisional'
  | 'rejected';

interface DtrRecord {
  date: string;
  timeIn: string;
  timeOut: string;
  status: DtrStatus;
  minutes: number;
  syncStatus: 'synced' | 'pending_upload';
}

interface DtrProfileCache {
  version: number;
  userId: string;
  studentId: string;
  fullName: string;
  company: string;
  requiredHours: number;
  cachedAt: number;
}

// =========================================
// DTR PAGE
// =========================================

@Component({
  selector: 'app-dtr',
  standalone: true,
  imports: [
    IonContent,
    IonIcon
  ],
  templateUrl: './dtr.page.html',
  styleUrls: ['./dtr.page.scss']
})
export class DtrPage
  implements ViewWillEnter, ViewWillLeave, OnDestroy {

  // =========================================
  // SERVICES
  // =========================================

  private readonly alertController =
    inject(AlertController);

  private readonly supabaseService =
    inject(SupabaseService);

  private readonly authService =
    inject(AuthService);

  private readonly networkService =
    inject(NetworkService);

  private readonly offlineSyncService =
    inject(OfflineSyncService);

  private readonly cdRef =
    inject(ChangeDetectorRef);

  private readonly supabase =
    this.supabaseService.getClient();

  // =========================================
  // COMPONENT STATE
  // =========================================

  private destroyed = false;

  private viewActive = false;

  private currentUserId = '';

  private loadVersion = 0;

  private localLoadVersion = 0;

  private networkSub?: Subscription;

  private syncSub?: Subscription;

  private syncStateSub?: Subscription;

  private serverRequest?: AbortController;

  private reconnectTimer?:
    ReturnType<typeof setTimeout>;

  private hasCachedProfile = false;

  private hasAttendanceSnapshot = false;

  // =========================================
  // PAGE STATE
  // =========================================

  isOnline = false;

  isLoading = true;

  isCachedData = false;

  attendanceLoadError = false;

  profileLoadError = false;

  dtrMessage = '';

  // =========================================
  // STUDENT INFORMATION
  // =========================================

  studentId = '';

  studentFullName = '';

  studentCompany = '';

  // =========================================
  // CALENDAR SETTINGS
  // =========================================

  calendarMode: 'weekly' | 'monthly' = 'weekly';

  selectedDate: Date = new Date();

  weekdays = [
    'SUN',
    'MON',
    'TUE',
    'WED',
    'THU',
    'FRI',
    'SAT'
  ];

  // =========================================
  // OJT HOURS
  // =========================================

  requiredHours = 0;

  verifiedHours = 0;

  provisionalHours = 0;

  records: DtrRecord[] = [];

  // =========================================
  // PDF PREVIEW
  // =========================================

  isGeneratingPdf = false;

  isPdfPreviewOpen = false;

  // Retained for compatibility with existing HTML.
  pdfPreviewUrl: string | null = null;

  @ViewChild('pdfPagesContainer')
  pdfPagesContainer?: ElementRef<HTMLDivElement>;

  private pdfRenderVersion = 0;

  // =========================================
  // CONSTRUCTOR
  // =========================================

  constructor() {

    addIcons({
      chevronBackOutline,
      chevronForwardOutline,
      cafeOutline,
      checkmarkCircleOutline,
      timeOutline,
      downloadOutline
    });
  }

  // =========================================
  // PAGE INITIALIZATION
  // =========================================

  async ionViewWillEnter(): Promise<void> {

    this.viewActive = true;

    this.isLoading = true;

    this.dtrMessage = '';

    try {

      await this.networkService
        .waitForInitialization();

      await this.authService
        .waitForInitialization();

      if (
        !this.viewActive ||
        this.destroyed
      ) {
        return;
      }

      const studentId =
        this.authService.getStudentId();

      const userId =
        this.authService.getCurrentUser()?.id;

      // Require authenticated student identity.
      if (
        !studentId ||
        !userId ||
        !this.authService.isAuthenticated() ||
        !this.authService.isStudent()
      ) {

        this.resetDtr();

        this.dtrMessage =
          'Unable to identify your student account.';

        return;
      }

      // Prevent displaying another student's records.
      if (
        this.studentId !== studentId ||
        this.currentUserId !== userId
      ) {

        this.resetDtr();
      }

      this.studentId = studentId;

      this.currentUserId = userId;

      this.isOnline =
        this.networkService.isOnline();

      // Open the calendar on today's Philippine date.
      const [year, month, day] =
        getPhilippineDate()
          .split('-')
          .map(Number);

      this.selectedDate =
        new Date(year, month - 1, day);

      // Initialize local attendance storage.
      await this.offlineSyncService.ready();

      if (
        !this.isCurrentIdentity(
          userId,
          studentId
        )
      ) {
        return;
      }

      this.offlineSyncService
        .setActiveStudent(studentId);

      // Restore locally saved student information.
      this.restoreStudentProfile();

      this.restoreAttendanceSnapshot();

      // Retrieve local attendance before server data.
      await this.loadLocalAttendance();

      if (
        !this.isCurrentIdentity(
          userId,
          studentId
        )
      ) {
        return;
      }

      this.initializeSubscriptions();

      // Refresh server information only when online.
      await this.refreshDtr();

    } catch (error) {

      console.warn(
        'DTR initialization failed:',
        error
      );

      this.dtrMessage =
        'Unable to initialize your DTR.';

    } finally {

      this.isLoading = false;

      this.refresh();
    }
  }

  // =========================================
  // PAGE EXIT
  // =========================================

  ionViewWillLeave(): void {

    this.viewActive = false;

    this.loadVersion++;

    this.localLoadVersion++;

    this.serverRequest?.abort();

    this.clearReconnectTimer();

    this.unsubscribeAll();

    this.closePdfPreview();

    const activeElement =
      document.activeElement;

    if (
      activeElement instanceof HTMLElement &&
      activeElement.closest('app-dtr')
    ) {

      activeElement.blur();
    }
  }

  ngOnDestroy(): void {

    this.destroyed = true;

    this.viewActive = false;

    this.loadVersion++;

    this.localLoadVersion++;

    this.serverRequest?.abort();

    this.clearReconnectTimer();

    this.unsubscribeAll();

    this.closePdfPreview();
  }

  private refresh(): void {

    if (!this.destroyed) {

      this.cdRef.detectChanges();
    }
  }

  // =========================================
  // RESET DTR STATE
  // =========================================

  private resetDtr(): void {

    this.loadVersion++;

    this.localLoadVersion++;

    this.serverRequest?.abort();

    this.studentId = '';

    this.currentUserId = '';

    this.studentFullName = '';

    this.studentCompany = '';

    this.requiredHours = 0;

    this.verifiedHours = 0;

    this.provisionalHours = 0;

    this.records = [];

    this.hasCachedProfile = false;

    this.hasAttendanceSnapshot = false;

    this.isCachedData = false;

    this.attendanceLoadError = false;

    this.profileLoadError = false;

    this.dtrMessage = '';

    this.closePdfPreview();
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
      this.viewActive &&
      this.authService.isAuthenticated() &&
      this.authService.isStudent() &&
      this.currentUserId === userId &&
      this.studentId === studentId &&
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
      version === this.loadVersion &&
      this.isCurrentIdentity(
        userId,
        studentId
      )
    );
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

            void this.loadLocalAttendance()
              .then(() => {

                if (
                  this.viewActive &&
                  !this.destroyed &&
                  !this.networkService.isOnline()
                ) {

                  this.updateOfflineState();

                  this.refresh();
                }
              });

          } else {

            // Automatically refresh after reconnection.
            void this.refreshDtr();
          }

          this.refresh();
        });

    // Refresh after successful synchronization.
    this.syncSub =
      this.offlineSyncService.synced$
        .subscribe(() => {

          if (
            this.viewActive &&
            !this.destroyed
          ) {

            void this.refreshDtr();
          }
        });

    // Refresh when local attendance changes.
    this.syncStateSub =
      this.offlineSyncService.syncState$
        .subscribe(() => {

          if (
            this.viewActive &&
            !this.destroyed
          ) {

            void this.loadLocalAttendance()
              .then(() => {

                if (this.viewActive) {

                  this.refresh();
                }
              });
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

        void this.refreshDtr();
      }

    }, 3000);
  }

  // =========================================
  // STUDENT PROFILE CACHE
  // =========================================

  private getProfileCacheKey(): string {

    return (
      'interntrack_dtr_profile_v1_' +
      encodeURIComponent(this.currentUserId) +
      '_' +
      encodeURIComponent(this.studentId)
    );
  }

  private saveStudentProfile(): void {

    if (
      !this.isCurrentIdentity(
        this.currentUserId,
        this.studentId
      )
    ) {
      return;
    }

    try {

      const cache: DtrProfileCache = {

        version: 1,

        userId: this.currentUserId,

        studentId: this.studentId,

        fullName: this.studentFullName,

        company: this.studentCompany,

        requiredHours: this.requiredHours,

        cachedAt: Date.now()
      };

      localStorage.setItem(
        this.getProfileCacheKey(),
        JSON.stringify(cache)
      );

    } catch (error) {

      console.warn(
        'Unable to save DTR profile cache:',
        error
      );
    }
  }

  private restoreStudentProfile(): void {

    if (
      !this.isCurrentIdentity(
        this.currentUserId,
        this.studentId
      )
    ) {
      return;
    }

    try {

      const raw = localStorage.getItem(
        this.getProfileCacheKey()
      );

      if (!raw) {
        return;
      }

      const cache =
        JSON.parse(raw) as DtrProfileCache;

      if (
        !cache ||
        cache.version !== 1 ||
        cache.userId !== this.currentUserId ||
        cache.studentId !== this.studentId ||
        typeof cache.fullName !== 'string' ||
        typeof cache.company !== 'string' ||
        !Number.isFinite(cache.requiredHours) ||
        cache.requiredHours < 0
      ) {
        return;
      }

      this.studentFullName =
        cache.fullName;

      this.studentCompany =
        cache.company;

      this.requiredHours =
        cache.requiredHours;

      this.hasCachedProfile = true;

      this.profileLoadError = false;

    } catch (error) {

      console.warn(
        'Unable to restore DTR profile:',
        error
      );
    }
  }

  // =========================================
  // ATTENDANCE SNAPSHOT
  // =========================================

  private getAttendanceSnapshotKey(): string {

    return (
      'interntrack_dtr_snapshot_v1_' +
      encodeURIComponent(this.currentUserId) +
      '_' +
      encodeURIComponent(this.studentId)
    );
  }

  private saveAttendanceSnapshot(): void {

    if (
      !this.isCurrentIdentity(
        this.currentUserId,
        this.studentId
      )
    ) {
      return;
    }

    this.hasAttendanceSnapshot = true;

    try {

      localStorage.setItem(
        this.getAttendanceSnapshotKey(),
        JSON.stringify({
          version: 1,
          userId: this.currentUserId,
          studentId: this.studentId,
          cachedAt: Date.now()
        })
      );

    } catch (error) {

      console.warn(
        'Unable to save attendance snapshot:',
        error
      );
    }
  }

  private restoreAttendanceSnapshot(): void {

    try {

      const raw = localStorage.getItem(
        this.getAttendanceSnapshotKey()
      );

      if (!raw) {
        return;
      }

      const snapshot = JSON.parse(raw);

      if (
        snapshot &&
        snapshot.version === 1 &&
        snapshot.userId === this.currentUserId &&
        snapshot.studentId === this.studentId &&
        typeof snapshot.cachedAt === 'number' &&
        Number.isFinite(snapshot.cachedAt)
      ) {

        this.hasAttendanceSnapshot = true;
      }

    } catch (error) {

      console.warn(
        'Unable to restore attendance snapshot:',
        error
      );
    }
  }

  // =========================================
  // LOAD STUDENT PROFILE
  // =========================================

  private async loadStudentProfile(
    signal: AbortSignal,
    version: number
  ): Promise<void> {

    const studentId = this.studentId;

    const userId = this.currentUserId;

    if (
      !this.networkService.isOnline() ||
      this.authService.isOfflineSession() ||
      !this.isCurrentLoad(
        userId,
        studentId,
        version
      )
    ) {
      return;
    }

    const { data, error } = await this.supabase

      .from('students')

      .select('*')

      .eq('student_id', studentId)

      .abortSignal(signal)

      .maybeSingle();

    if (
      !this.isCurrentLoad(
        userId,
        studentId,
        version
      )
    ) {
      return;
    }

    if (error) {

      throw error;
    }

    if (!data) {

      this.studentFullName = '';

      this.studentCompany = '';

      this.requiredHours = 0;

      this.hasCachedProfile = false;

      localStorage.removeItem(
        this.getProfileCacheKey()
      );

      throw new Error(
        'Student profile not found.'
      );
    }

    this.studentFullName =
      data.full_name ||
      data.name ||
      '';

    this.studentCompany =
      data.company_name ||
      data.company_location ||
      '';

    const requiredHours =
      Number(data.required_hours ?? 0);

    this.requiredHours =
      Number.isFinite(requiredHours) &&
      requiredHours >= 0
        ? requiredHours
        : 0;

    this.hasCachedProfile = true;

    this.profileLoadError = false;

    this.saveStudentProfile();
  }

  // =========================================
  // DATE HELPERS
  // =========================================

  private dateKey(date: Date): string {

    const year = date.getFullYear();

    const month = String(
      date.getMonth() + 1
    ).padStart(2, '0');

    const day = String(
      date.getDate()
    ).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  private createDay(
    date: Date
  ): CalendarDay {

    const copy = new Date(date);

    return {

      date: copy,

      key: this.dateKey(copy),

      number: copy.getDate(),

      label: copy.toLocaleDateString(
        'en-US',
        {
          weekday: 'short'
        }
      ).toUpperCase(),

      fullLabel: copy.toLocaleDateString(
        'en-US',
        {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        }
      )
    };
  }

  private formatTime(
    value: string | null | undefined
  ): string {

    if (!value) {
      return '';
    }

    const date = new Date(value);

    if (!Number.isFinite(date.getTime())) {
      return '';
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
  // CALENDAR LABELS
  // =========================================

  get monthLabel(): string {

    return this.selectedDate.toLocaleDateString(
      'en-US',
      {
        month: 'short',
        year: 'numeric'
      }
    );
  }

  get selectedDateLabel(): string {

    return this.selectedDate.toLocaleDateString(
      'en-US',
      {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      }
    );
  }

  // =========================================
  // WEEKLY CALENDAR
  // =========================================

  get weeklyDays(): CalendarDay[] {

    const start =
      new Date(this.selectedDate);

    start.setDate(
      start.getDate() - start.getDay()
    );

    const days: CalendarDay[] = [];

    for (let i = 0; i < 7; i++) {

      const date = new Date(start);

      date.setDate(
        start.getDate() + i
      );

      days.push(
        this.createDay(date)
      );
    }

    return days;
  }

  // =========================================
  // MONTHLY CALENDAR
  // =========================================

  get monthlyDays(): (CalendarDay | null)[] {

    const year =
      this.selectedDate.getFullYear();

    const month =
      this.selectedDate.getMonth();

    const firstDay =
      new Date(year, month, 1);

    const daysInMonth =
      new Date(
        year,
        month + 1,
        0
      ).getDate();

    const days: (CalendarDay | null)[] = [];

    for (
      let i = 0;
      i < firstDay.getDay();
      i++
    ) {

      days.push(null);
    }

    for (
      let i = 1;
      i <= daysInMonth;
      i++
    ) {

      days.push(
        this.createDay(
          new Date(year, month, i)
        )
      );
    }

    return days;
  }

  // =========================================
  // CALENDAR ACTIONS
  // =========================================

  setCalendarMode(
    mode: 'weekly' | 'monthly'
  ): void {

    this.calendarMode = mode;
  }

  selectDate(date: Date): void {

    this.selectedDate =
      new Date(date);
  }

  isSelected(key: string): boolean {

    return (
      this.dateKey(this.selectedDate) === key
    );
  }

  changePeriod(direction: number): void {

    const current =
      new Date(this.selectedDate);

    if (this.calendarMode === 'weekly') {

      current.setDate(
        current.getDate() + direction * 7
      );

      this.selectedDate = current;

      return;
    }

    const year =
      current.getFullYear();

    const month =
      current.getMonth() + direction;

    const day =
      current.getDate();

    const targetStart =
      new Date(year, month, 1);

    const lastDay = new Date(
      targetStart.getFullYear(),
      targetStart.getMonth() + 1,
      0
    ).getDate();

    this.selectedDate = new Date(
      targetStart.getFullYear(),
      targetStart.getMonth(),
      Math.min(day, lastDay)
    );
  }

  getMarker(
    date: string
  ): 'verified' | 'provisional' | 'rejected' | 'incomplete' | null {

    const record = this.records.find(
      item => item.date === date
    );

    if (!record) {
      return null;
    }

    if (record.status === 'rejected') {
      return 'rejected';
    }

    if (!record.timeIn || !record.timeOut) {
      return 'incomplete';
    }

    if (record.status === 'verified') {
      return 'verified';
    }

    return 'provisional';
  }

  get selectedRecord(): DtrRecord | undefined {

    const selectedKey =
      this.dateKey(this.selectedDate);

    return this.records.find(
      record => record.date === selectedKey
    );
  }

  // =========================================
  // OJT HOURS
  // =========================================

  get totalHours(): number {

    return (
      this.verifiedHours +
      this.provisionalHours
    );
  }

  get remainingHours(): number {

    // Only verified hours reduce official
    // remaining internship hours.
    return Math.max(
      0,
      this.requiredHours - this.verifiedHours
    );
  }

  // =========================================
  // LOAD LOCAL ATTENDANCE
  // =========================================

  private async loadLocalAttendance(): Promise<void> {

    const studentId = this.studentId;

    const userId = this.currentUserId;

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

    const localVersion =
      ++this.localLoadVersion;

    try {

      const cachedRecords =
        await this.offlineSyncService
          .getCachedAttendanceRecords(studentId);

      if (
        localVersion !== this.localLoadVersion ||
        !this.isCurrentIdentity(
          userId,
          studentId
        )
      ) {
        return;
      }

      this.applyAttendanceRecords(

        cachedRecords.filter(
          record =>
            record.student_id === studentId
        )
      );

      if (cachedRecords.length > 0) {

        this.hasAttendanceSnapshot = true;
      }

      this.attendanceLoadError = false;

    } catch (error) {

      if (
        localVersion !== this.localLoadVersion ||
        !this.isCurrentIdentity(
          userId,
          studentId
        )
      ) {
        return;
      }

      this.attendanceLoadError = true;

      console.warn(
        'Unable to load local DTR records:',
        error
      );
    }
  }

  // =========================================
  // APPLY ATTENDANCE RECORDS
  // =========================================

  private applyAttendanceRecords(
    records: CachedAttendance[]
  ): void {

    // Ensure one attendance record per date.
    const uniqueRecords =
      new Map<string, CachedAttendance>();

    for (const record of records) {

      if (
        record.student_id !== this.studentId ||
        !record.attendance_date
      ) {
        continue;
      }

      uniqueRecords.set(
        record.attendance_date,
        record
      );
    }

    let verifiedMinutes = 0;

    let provisionalMinutes = 0;

    this.records =
      Array.from(uniqueRecords.values())

        .map((row): DtrRecord => {

          let minutes = 0;

          // Incomplete attendance does not earn hours.
          if (
            row.time_in &&
            row.time_out
          ) {

            const start =
              new Date(row.time_in).getTime();

            const end =
              new Date(row.time_out).getTime();

            const difference = end - start;

            if (
              Number.isFinite(difference) &&
              difference >= 0
            ) {

              const storedHours =
                row.total_hours_rendered;

              // Use stored rendered hours when available.
              minutes =
                typeof storedHours === 'number' &&
                Number.isFinite(storedHours) &&
                storedHours >= 0

                  ? storedHours * 60

                  : difference / 60000;
            }
          }

          const syncStatus:
            'synced' | 'pending_upload' =

            row.sync_status === 'synced'
              ? 'synced'
              : 'pending_upload';

          const rawStatus =
            String(
              row.verification_status || ''
            ).toLowerCase();

          let status: DtrStatus =
            'provisional';

          if (rawStatus === 'rejected') {

            status = 'rejected';

          } else if (
            rawStatus === 'verified' &&
            syncStatus === 'synced'
          ) {

            status = 'verified';
          }

          if (status === 'verified') {

            verifiedMinutes += minutes;

          } else if (status === 'provisional') {

            provisionalMinutes += minutes;
          }

          return {

            date: row.attendance_date,

            timeIn:
              this.formatTime(row.time_in),

            timeOut:
              this.formatTime(row.time_out),

            status,

            minutes,

            syncStatus
          };
        })

        .sort(
          (a, b) =>
            b.date.localeCompare(a.date)
        );

    this.verifiedHours =
      verifiedMinutes / 60;

    this.provisionalHours =
      provisionalMinutes / 60;
  }

  // =========================================
  // LOAD ATTENDANCE FROM SUPABASE
  // =========================================

  async loadAttendanceFromSupabase(
    signal?: AbortSignal,
    version: number = this.loadVersion
  ): Promise<void> {

    const studentId = this.studentId;

    const userId = this.currentUserId;

    if (
      !this.networkService.isOnline() ||
      this.authService.isOfflineSession() ||
      !this.isCurrentLoad(
        userId,
        studentId,
        version
      )
    ) {
      return;
    }

    const attendanceRevision =
      this.offlineSyncService.getAttendanceRevision();

    let query = this.supabase

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

      .order('attendance_date', {
        ascending: false
      });

    if (signal) {

      query = query.abortSignal(signal);
    }

    const { data, error, count } = await query;

    if (
      !this.isCurrentLoad(
        userId,
        studentId,
        version
      )
    ) {
      return;
    }

    if (error) {

      throw error;
    }

    if (!Array.isArray(data) || count === null || count !== data.length) {
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
            : row.verification_status === 'rejected'
              ? 'rejected'
              : 'provisional'
      };

      serverRecords.push(record);
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

    await this.offlineSyncService.reconcileAttendanceCache(
      studentId, serverRecords, attendanceRevision
    );

    if (!this.isCurrentLoad(userId, studentId, version)) {
      return;
    }

    await this.loadLocalAttendance();

    if (
      this.isCurrentLoad(
        userId,
        studentId,
        version
      ) &&
      !this.attendanceLoadError
    ) {

      this.saveAttendanceSnapshot();
    }
  }

  // =========================================
  // OFFLINE STATE
  // =========================================

  private updateOfflineState(): void {

    this.isCachedData =
      this.hasCachedProfile ||
      this.hasAttendanceSnapshot ||
      this.records.length > 0;

    this.profileLoadError =
      !this.hasCachedProfile;

    if (this.attendanceLoadError) {

      this.dtrMessage =
        'Unable to read locally saved attendance records.';

    } else if (this.isCachedData) {

      this.dtrMessage =
        'Offline mode. Showing locally saved DTR records.';

    } else {

      this.dtrMessage =
        'No saved DTR information is available. Connect to the internet.';
    }
  }

  // =========================================
  // MAIN DTR REFRESH
  // =========================================

  async refreshDtr(): Promise<void> {

    const studentId = this.studentId;

    const userId = this.currentUserId;

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

    const version =
      ++this.loadVersion;

    this.serverRequest?.abort();

    this.clearReconnectTimer();

    this.isLoading = true;

    let controller:
      AbortController | undefined;

    try {

      // Always retrieve locally saved records first.
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

        this.isCachedData = true;

        this.dtrMessage =
          'Reconnecting. Showing saved DTR records.';

        this.scheduleReconnectRefresh();

        return;
      }

      // =====================================
      // ONLINE MODE
      // =====================================

      controller = new AbortController();

      this.serverRequest = controller;

      const [
        profileResult,
        attendanceResult
      ] = await Promise.allSettled([

        this.loadStudentProfile(
          controller.signal,
          version
        ),

        this.loadAttendanceFromSupabase(
          controller.signal,
          version
        )
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

      this.profileLoadError =
        profileResult.status === 'rejected';

      this.attendanceLoadError =
        attendanceResult.status === 'rejected' ||
        this.attendanceLoadError;

      if (profileResult.status === 'rejected') {

        console.warn(
          'Unable to refresh DTR profile:',
          profileResult.reason
        );
      }

      if (attendanceResult.status === 'rejected') {

        console.warn(
          'Unable to refresh DTR attendance:',
          attendanceResult.reason
        );
      }

      this.isCachedData =
        this.profileLoadError ||
        this.attendanceLoadError;

      this.dtrMessage =
        this.isCachedData

          ? 'Some DTR information could not be refreshed. Showing saved records where available.'

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
        'DTR refresh failed:',
        error
      );

      this.isCachedData = true;

      this.dtrMessage =
        'Unable to refresh DTR. Showing saved information where available.';

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
  // MANUAL RETRY
  // =========================================

  async retryDtr(): Promise<void> {

    const status =
      await this.networkService.refreshStatus();

    this.isOnline = status.connected;

    await this.refreshDtr();
  }

  // =========================================
  // WEEKLY DATE RANGE
  // =========================================

  private getWeekRange(): {
    start: Date;
    end: Date;
  } {

    const start =
      new Date(this.selectedDate);

    start.setHours(0, 0, 0, 0);

    start.setDate(
      start.getDate() - start.getDay()
    );

    const end = new Date(start);

    end.setDate(
      start.getDate() + 6
    );

    return {
      start,
      end
    };
  }

  // =========================================
  // CREATE WEEKLY PDF
  // =========================================

  private createWeeklyPdf(): TDocumentDefinitions {

    const { start, end } = this.getWeekRange();

    return createDtrTemplate({

      studentName: this.studentFullName,

      studentId: this.studentId,

      schoolName:
        'Pamantasan ng Lungsod ng Valenzuela',

      company: this.studentCompany,

      startDate: this.dateKey(start),

      endDate: this.dateKey(end),

      records: this.records,

      isCachedData:
        this.isCachedData || !this.isOnline

    });
  }

  // =========================================
  // GENERATE PDF BLOB
  // =========================================

  private async generatePdfBlob(): Promise<Blob> {

    // Prevent unauthorized PDF generation.
    if (
      !this.isCurrentIdentity(
        this.currentUserId,
        this.studentId
      )
    ) {

      throw new Error(
        'Your student session is unavailable.'
      );
    }

    // Prevent generating a PDF without available data.
    if (
      this.isLoading ||
      !this.hasCachedProfile ||
      !this.hasAttendanceSnapshot ||
      (
        this.attendanceLoadError &&
        this.records.length === 0
      )
    ) {

      throw new Error(
        'DTR information is not ready. Please refresh your records.'
      );
    }

    const userId = this.currentUserId;

    const studentId = this.studentId;

    const definition =
      this.createWeeklyPdf();

    const blob = await pdfMake

      .createPdf(definition)

      .getBlob();

    if (
      !this.isCurrentIdentity(
        userId,
        studentId
      )
    ) {

      throw new Error(
        'Your student session has changed.'
      );
    }

    return blob;
  }

  // =========================================
  // PDF FILE NAME
  // =========================================

  private getPdfFilename(): string {

    const { start, end } =
      this.getWeekRange();

    return (

      `InternTrack-DTR-` +

      `${this.dateKey(start)}-to-` +

      `${this.dateKey(end)}.pdf`
    );
  }

  // =========================================
  // ERROR ALERT
  // =========================================

  private async showError(
    header: string,
    message: string
  ): Promise<void> {

    if (
      this.destroyed ||
      !this.viewActive
    ) {
      return;
    }

    const alert =
      await this.alertController.create({

        header,

        message,

        buttons: ['OK']
      });

    await alert.present();
  }

  // =========================================
  // PLATFORM DETECTION
  // =========================================

  private isNativeAndroid(): boolean {

    return (

      Capacitor.isNativePlatform() &&

      Capacitor.getPlatform() === 'android'
    );
  }

  // =========================================
  // CONVERT BLOB TO BASE64
  // =========================================

  private blobToBase64(
    blob: Blob
  ): Promise<string> {

    return new Promise<string>(

      (resolve, reject) => {

        const reader =
          new FileReader();

        reader.onload = () => {

          const result =
            reader.result;

          if (typeof result !== 'string') {

            reject(
              new Error(
                'Unable to convert PDF to Base64.'
              )
            );

            return;
          }

          const commaIndex =
            result.indexOf(',');

          if (commaIndex === -1) {

            reject(
              new Error(
                'Invalid Base64 PDF data.'
              )
            );

            return;
          }

          resolve(
            result.substring(commaIndex + 1)
          );
        };

        reader.onerror = () => {

          reject(

            reader.error ??

            new Error('Failed to read PDF.')
          );
        };

        reader.readAsDataURL(blob);
      }
    );
  }

  // =========================================
  // SAVE NATIVE PDF
  // =========================================

  private async saveNativePdf(
    blob: Blob,
    filename: string
  ): Promise<string> {

    const base64 =
      await this.blobToBase64(blob);

    const savedFile =
      await Filesystem.writeFile({

        path: filename,

        data: base64,

        directory: Directory.Cache,

        recursive: true
      });

    return savedFile.uri;
  }

  // =========================================
  // RENDER PDF PAGES USING PDF.JS
  // =========================================

  private async renderPdfPages(
    blob: Blob,
    renderVersion: number
  ): Promise<void> {

    const container =
      this.pdfPagesContainer?.nativeElement;

    if (!container) {

      throw new Error(
        'PDF preview container was not found.'
      );
    }

    container.replaceChildren();

    const pdfData = new Uint8Array(
      await blob.arrayBuffer()
    );

    const loadingTask =
      pdfjsLib.getDocument({

        data: pdfData
      });

    try {

      const pdf =
        await loadingTask.promise;

      try {

        for (
          let pageNumber = 1;
          pageNumber <= pdf.numPages;
          pageNumber++
        ) {

          if (
            renderVersion !== this.pdfRenderVersion ||
            !this.isPdfPreviewOpen ||
            this.destroyed ||
            !this.viewActive
          ) {
            return;
          }

          const page =
            await pdf.getPage(pageNumber);

          if (
            renderVersion !== this.pdfRenderVersion ||
            !this.isPdfPreviewOpen ||
            this.destroyed ||
            !this.viewActive
          ) {
            return;
          }

          const baseViewport =
            page.getViewport({

              scale: 1
            });

          const availableWidth =
            Math.max(

              100,

              container.clientWidth - 24
            );

          const displayScale =
            availableWidth / baseViewport.width;

          const pixelRatio =
            Math.min(

              window.devicePixelRatio || 1,

              2
            );

          const viewport =
            page.getViewport({

              scale: displayScale * pixelRatio
            });

          const canvas =
            document.createElement('canvas');

          const context =
            canvas.getContext('2d');

          if (!context) {

            throw new Error(
              'Unable to initialize PDF canvas.'
            );
          }

          canvas.width =
            Math.ceil(viewport.width);

          canvas.height =
            Math.ceil(viewport.height);

          canvas.style.width =
            `${Math.ceil(
              baseViewport.width * displayScale
            )}px`;

          canvas.style.height =
            `${Math.ceil(
              baseViewport.height * displayScale
            )}px`;

          canvas.style.display = 'block';

          canvas.style.maxWidth = '100%';

          canvas.style.margin = '0 auto 12px';

          canvas.style.background = '#ffffff';

          container.appendChild(canvas);

          const renderTask =
            page.render({

              canvas,

              canvasContext: context,

              viewport
            });

          await renderTask.promise;
        }

      } finally {

        await pdf.cleanup();
      }

    } finally {

      await loadingTask.destroy();
    }
  }

  // =========================================
  // PREVIEW WEEKLY DTR
  // =========================================

  async previewDtr(): Promise<void> {

    if (this.isGeneratingPdf) {
      return;
    }

    this.isGeneratingPdf = true;

    this.refresh();

    const userId = this.currentUserId;

    const studentId = this.studentId;

    try {

      const blob =
        await this.generatePdfBlob();

      if (
        !this.isCurrentIdentity(
          userId,
          studentId
        )
      ) {
        return;
      }

      if (!blob.size) {

        throw new Error(
          'The generated PDF is empty.'
        );
      }

      this.closePdfPreview();

      this.isPdfPreviewOpen = true;

      this.refresh();

      // Allow Angular to create the preview container.
      await new Promise<void>(resolve => {

        requestAnimationFrame(
          () => resolve()
        );
      });

      if (
        !this.isPdfPreviewOpen ||
        !this.isCurrentIdentity(
          userId,
          studentId
        )
      ) {
        return;
      }

      const renderVersion =
        ++this.pdfRenderVersion;

      await this.renderPdfPages(
        blob,
        renderVersion
      );

    } catch (error: unknown) {

      console.error(
        'DTR PDF preview failed:',
        error
      );

      const errorMessage =

        error instanceof Error

          ? `${error.name}: ${error.message}`

          : String(error);

      this.closePdfPreview();

      this.refresh();

      await this.showError(

        'PDF Preview Error',

        errorMessage
      );

    } finally {

      this.isGeneratingPdf = false;

      this.refresh();
    }
  }

  // =========================================
  // EXPORT WEEKLY DTR
  // =========================================

  async exportDtr(): Promise<void> {

    if (this.isGeneratingPdf) {
      return;
    }

    this.isGeneratingPdf = true;

    this.refresh();

    const userId = this.currentUserId;

    const studentId = this.studentId;

    try {

      const filename =
        this.getPdfFilename();

      const blob =
        await this.generatePdfBlob();

      if (
        !this.isCurrentIdentity(
          userId,
          studentId
        )
      ) {
        return;
      }

      if (!blob.size) {

        throw new Error(
          'The generated PDF is empty.'
        );
      }

      // =====================================
      // ANDROID PDF EXPORT
      // =====================================

      if (this.isNativeAndroid()) {

        const fileUri =
          await this.saveNativePdf(
            blob,
            filename
          );

        if (
          !this.isCurrentIdentity(
            userId,
            studentId
          )
        ) {
          return;
        }

        await Share.share({

          title: 'InternTrack Weekly DTR',

          text: 'Weekly Daily Time Record',

          url: fileUri,

          dialogTitle:
            'Save or share your DTR PDF'
        });

      } else {

        // ===================================
        // BROWSER PDF DOWNLOAD
        // ===================================

        const url =
          URL.createObjectURL(blob);

        const link =
          document.createElement('a');

        link.href = url;

        link.download = filename;

        document.body.appendChild(link);

        link.click();

        link.remove();

        setTimeout(() => {

          URL.revokeObjectURL(url);

        }, 60000);
      }

    } catch (error: unknown) {

      console.error(
        'DTR: PDF export failed:',
        error
      );

      await this.showError(

        'Export failed',

        error instanceof Error

          ? error.message

          : 'Unable to export the weekly DTR PDF.'
      );

    } finally {

      this.isGeneratingPdf = false;

      this.refresh();
    }
  }

  // =========================================
  // CLOSE PDF PREVIEW
  // =========================================

  closePdfPreview(): void {

    // Invalidate any ongoing PDF rendering.
    this.pdfRenderVersion++;

    this.isPdfPreviewOpen = false;

    this.pdfPreviewUrl = null;

    this.pdfPagesContainer
      ?.nativeElement
      .replaceChildren();
  }
}
