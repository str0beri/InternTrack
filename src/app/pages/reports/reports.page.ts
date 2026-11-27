import {
  ChangeDetectorRef,
  Component,
  inject,
  type OnDestroy
} from '@angular/core';

import {
  IonContent,
  IonIcon,
  AlertController,
  type ViewWillEnter,
  type ViewWillLeave
} from '@ionic/angular';

import { addIcons } from 'ionicons';

import {
  addOutline,
  createOutline,
  checkmarkOutline,
  arrowUndoOutline,
  chevronForwardOutline,
  timeOutline,
  cloudOfflineOutline,
  refreshOutline,
  documentTextOutline,
  arrowBackOutline
} from 'ionicons/icons';

import type { Subscription } from 'rxjs';

import { SupabaseService } from '../../services/supabase.service';
import { AuthService } from '../../services/auth.service';
import { NetworkService } from '../../services/network.service';

import {
  getPhilippineDate
} from '../../services/offline-sync.service';

// =========================================
// REPORT INTERFACES
// =========================================

type ReportStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'returned';

type ReportFilter =
  | 'all'
  | ReportStatus;

interface WeeklyReport {
  id: number;
  week: number;
  period: string;
  status: ReportStatus;

  startDate?: string;
  endDate?: string;

  accomplishments?: string;
  reflection?: string;

  feedback?: string;
  commentCount?: number;

  createdAt?: string;
  updatedAt?: string;
  submittedAt?: string;
  reviewedAt?: string;

  supervisorName?: string;
  editedLabel?: string;

  localOnly?: boolean;
  hasLocalChanges?: boolean;
}

interface ReportingPeriod {
  week: number;
  startDate: string;
  endDate: string;
  period: string;
}

interface LocalReportDraft {
  week: number;
  startDate: string;
  endDate: string;
  period: string;

  accomplishments: string;
  reflection: string;

  serverId: number | null;
  baseUpdatedAt: string | null;

  savedAt: string;
}

interface ReportsCache {
  version: number;
  userId: string;
  studentId: string;

  ojtStartDate: string;
  reports: WeeklyReport[];

  cachedAt: number;
}

interface DraftCache {
  version: number;
  userId: string;
  studentId: string;
  drafts: LocalReportDraft[];
}

const emptyReport = (): WeeklyReport => ({
  id: 0,
  week: 0,
  period: '',
  status: 'draft',
  accomplishments: '',
  reflection: '',
  editedLabel: '',
  feedback: '',
  commentCount: 0
});

// =========================================
// REPORTS PAGE
// =========================================

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [
    IonContent,
    IonIcon
  ],
  templateUrl: './reports.page.html',
  styleUrls: ['./reports.page.scss']
})
export class ReportsPage
  implements ViewWillEnter, ViewWillLeave, OnDestroy {

  // =========================================
  // SERVICES
  // =========================================

  private readonly cdr =
    inject(ChangeDetectorRef);

  private readonly alertController =
    inject(AlertController);

  private readonly supabaseService =
    inject(SupabaseService);

  private readonly authService =
    inject(AuthService);

  private readonly networkService =
    inject(NetworkService);

  private readonly supabase =
    this.supabaseService.getClient();

  // =========================================
  // COMPONENT STATE
  // =========================================

  private destroyed = false;
  private viewActive = false;

  private currentUserId = '';
  private loadVersion = 0;

  private networkSub?: Subscription;

  private serverRequest?: AbortController;

  private reconnectTimer?:
    ReturnType<typeof setTimeout>;

  private serverReports: WeeklyReport[] = [];

  private localDrafts: LocalReportDraft[] = [];

  private hasCachedReports = false;

  private hasFreshServerData = false;

  private dialogOpen = false;

  private isSyncingDrafts = false;

  // =========================================
  // STUDENT INFORMATION
  // =========================================

  studentId = '';

  ojtStartDate = '';

  currentWeek = 0;

  currentPeriod = '';

  currentStartDate = '';

  currentEndDate = '';

  // =========================================
  // PAGE STATE
  // =========================================

  isOnline = false;

  isLoading = true;

  isSaving = false;

  isSubmitting = false;

  isCachedData = false;

  reportsLoadError = false;

  reportsMessage = '';

  selectedFilter: ReportFilter = 'all';

  // =========================================
  // REPORT EDITOR STATE
  // =========================================

  activeReport: WeeklyReport | null = null;

  editorAccomplishments = '';
  editorReflection = '';

  private editorUserId = '';
  private editorStudentId = '';

  // =========================================
  // REPORT DATA
  // =========================================

  currentReport: WeeklyReport =
    emptyReport();

  previousReports: WeeklyReport[] = [];

  allReports: WeeklyReport[] = [];

  // =========================================
  // CONSTRUCTOR
  // =========================================

  constructor() {
    addIcons({
      addOutline,
      createOutline,
      checkmarkOutline,
      arrowUndoOutline,
      chevronForwardOutline,
      timeOutline,
      cloudOfflineOutline,
      refreshOutline,
      documentTextOutline,
      arrowBackOutline
    });
  }

  // =========================================
  // PAGE INITIALIZATION
  // =========================================

  async ionViewWillEnter(): Promise<void> {

    this.viewActive = true;

    this.isLoading = true;

    this.reportsMessage = '';

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

      if (
        !studentId ||
        !userId ||
        !this.authService.isAuthenticated() ||
        !this.authService.isStudent()
      ) {

        this.resetState();

        this.reportsMessage =
          'Unable to identify your student account.';

        return;
      }

      if (
        this.studentId !== studentId ||
        this.currentUserId !== userId
      ) {

        this.resetState();
      }

      this.studentId = studentId;

      this.currentUserId = userId;

      this.isOnline =
        this.networkService.isOnline();

      // Restore previously downloaded reports.
      this.restoreReportsCache();

      // Restore unsaved local drafts.
      this.restoreLocalDrafts();

      this.updateCurrentPeriod();

      this.rebuildReports();

      this.initializeNetworkSubscription();

      await this.loadReports();

    } catch (error) {

      console.error(
        'Reports initialization failed:',
        error
      );

      this.reportsLoadError = true;

      this.reportsMessage =
        'Unable to initialize weekly reports.';

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

    this.serverRequest?.abort();

    this.networkSub?.unsubscribe();

    this.clearReconnectTimer();

    const activeElement =
      document.activeElement;

    if (
      activeElement instanceof HTMLElement &&
      activeElement.closest('app-reports')
    ) {

      activeElement.blur();
    }
  }

  ngOnDestroy(): void {

    this.destroyed = true;

    this.viewActive = false;

    this.loadVersion++;

    this.serverRequest?.abort();

    this.networkSub?.unsubscribe();

    this.clearReconnectTimer();
  }

  private refresh(): void {

    if (!this.destroyed) {

      this.cdr.detectChanges();
    }
  }

  // =========================================
  // RESET STATE
  // =========================================

  private resetState(): void {

    this.resetReportEditor();

    this.loadVersion++;

    this.serverRequest?.abort();

    this.studentId = '';

    this.currentUserId = '';

    this.ojtStartDate = '';

    this.currentWeek = 0;

    this.currentPeriod = '';

    this.currentStartDate = '';

    this.currentEndDate = '';

    this.currentReport = emptyReport();

    this.previousReports = [];

    this.allReports = [];

    this.serverReports = [];

    this.localDrafts = [];

    this.hasCachedReports = false;

    this.hasFreshServerData = false;

    this.isCachedData = false;

    this.reportsLoadError = false;

    this.reportsMessage = '';

    this.selectedFilter = 'all';
  }

  // =========================================
  // AUTHENTICATED IDENTITY
  // =========================================

  private isCurrentIdentity(
    userId = this.currentUserId,
    studentId = this.studentId
  ): boolean {

    return (

      !this.destroyed &&

      this.viewActive &&

      !!userId &&

      !!studentId &&

      this.authService.isAuthenticated() &&

      this.authService.isStudent() &&

      this.currentUserId === userId &&

      this.studentId === studentId &&

      this.authService.getCurrentUser()?.id === userId &&

      this.authService.getStudentId() === studentId
    );
  }

  private isCurrentLoad(
    version: number,
    userId: string,
    studentId: string
  ): boolean {

    return (

      version === this.loadVersion &&

      this.isCurrentIdentity(
        userId,
        studentId
      )
    );
  }

  private canUseServer(): boolean {

    return (

      this.isCurrentIdentity() &&

      this.networkService.isOnline() &&

      !this.authService.isOfflineSession()
    );
  }

  // =========================================
  // NETWORK MONITORING
  // =========================================

  private initializeNetworkSubscription(): void {

    this.networkSub?.unsubscribe();

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

            this.hasFreshServerData = false;

            this.updateOfflineState();

          } else {

            void this.loadReports();
          }

          this.refresh();
        });
  }

  private clearReconnectTimer(): void {

    if (this.reconnectTimer) {

      clearTimeout(this.reconnectTimer);

      this.reconnectTimer = undefined;
    }
  }

  private scheduleReconnectRefresh(): void {

    this.clearReconnectTimer();

    this.reconnectTimer = setTimeout(() => {

      if (
        this.viewActive &&
        !this.destroyed &&
        this.networkService.isOnline()
      ) {

        void this.loadReports();
      }

    }, 3000);
  }

  // =========================================
  // DATE HELPERS
  // =========================================

  private parseDate(
    value: string
  ): Date | null {

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
      return null;
    }

    const date = new Date(
      `${value}T00:00:00Z`
    );

    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    ) {
      return null;
    }

    return date;
  }

  private dateKey(date: Date): string {

    return date.toISOString().slice(0, 10);
  }

  private addDays(
    date: Date,
    days: number
  ): Date {

    const result = new Date(date);

    result.setUTCDate(
      result.getUTCDate() + days
    );

    return result;
  }

  private formatPeriod(
    start: Date,
    end: Date
  ): string {

    const formatter =
      new Intl.DateTimeFormat(
        'en-US',
        {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC'
        }
      );

    return (
      `${formatter.format(start)} - ` +
      `${formatter.format(end)}`
    );
  }

  // =========================================
  // AUTOMATIC REPORTING PERIOD
  // =========================================

  private getReportingPeriod(
    week: number
  ): ReportingPeriod | null {

    const start =
      this.parseDate(this.ojtStartDate);

    if (
      !start ||
      !Number.isSafeInteger(week) ||
      week < 1 ||
      week > 5200
    ) {
      return null;
    }

    const weekStart =
      this.addDays(
        start,
        (week - 1) * 7
      );

    const weekEnd =
      this.addDays(
        weekStart,
        6
      );

    return {

      week,

      startDate:
        this.dateKey(weekStart),

      endDate:
        this.dateKey(weekEnd),

      period:
        this.formatPeriod(
          weekStart,
          weekEnd
        )
    };
  }

  private updateCurrentPeriod(): void {

    this.currentWeek = 0;

    this.currentPeriod = '';

    this.currentStartDate = '';

    this.currentEndDate = '';

    const start =
      this.parseDate(this.ojtStartDate);

    const today =
      this.parseDate(getPhilippineDate());

    if (
      !start ||
      !today ||
      today.getTime() < start.getTime()
    ) {
      return;
    }

    const elapsedDays =
      Math.floor(

        (
          today.getTime() -
          start.getTime()
        ) / 86400000
      );

    const week =
      Math.floor(elapsedDays / 7) + 1;

    const period =
      this.getReportingPeriod(week);

    if (!period) {
      return;
    }

    this.currentWeek = period.week;

    this.currentPeriod = period.period;

    this.currentStartDate = period.startDate;

    this.currentEndDate = period.endDate;
  }

  // =========================================
  // REPORT STATUS
  // =========================================

  getStatusLabel(
    status: ReportStatus
  ): string {

    switch (status) {

      case 'approved':
        return 'Approved';

      case 'returned':
        return 'Returned';

      case 'pending_review':
        return 'Pending Review';

      case 'draft':
        return 'Draft';

      default:
        return 'Unknown';
    }
  }

  getStatusIcon(
    status: ReportStatus
  ): string {

    switch (status) {

      case 'approved':
        return 'checkmark-outline';

      case 'returned':
        return 'arrow-undo-outline';

      case 'pending_review':
        return 'time-outline';

      case 'draft':
        return 'create-outline';

      default:
        return 'document-text-outline';
    }
  }

  private isValidStatus(
    status: unknown
  ): status is ReportStatus {

    return (

      status === 'draft' ||

      status === 'pending_review' ||

      status === 'approved' ||

      status === 'returned'
    );
  }

  canEditReport(
    report: WeeklyReport
  ): boolean {

    return (

      report.week > 0 &&

      (
        report.status === 'draft' ||

        report.status === 'returned'
      )
    );
  }

  canSubmitReport(
    report: WeeklyReport
  ): boolean {

    return (

      this.canUseServer() &&

      this.hasFreshServerData &&

      !this.isSaving &&

      !this.isSubmitting &&

      this.canEditReport(report) &&

      !!report.accomplishments?.trim() &&

      !!report.reflection?.trim()
    );
  }

  get canCreateReport(): boolean {

    return (

      this.isCurrentIdentity() &&

      this.currentWeek > 0 &&

      !this.isSaving &&

      !this.isSubmitting &&

      !this.allReports.some(
        report =>
          report.week === this.currentWeek
      )
    );
  }

  // =========================================
  // REPORT COUNTS AND FILTERS
  // =========================================

  get draftCount(): number {

    return this.allReports.filter(
      report => report.status === 'draft'
    ).length;
  }

  get pendingCount(): number {

    return this.allReports.filter(
      report =>
        report.status === 'pending_review'
    ).length;
  }

  get approvedCount(): number {

    return this.allReports.filter(
      report => report.status === 'approved'
    ).length;
  }

  get returnedCount(): number {

    return this.allReports.filter(
      report => report.status === 'returned'
    ).length;
  }

  get unsavedDraftCount(): number {

    return this.localDrafts.length;
  }

  get filteredReports(): WeeklyReport[] {

    if (this.selectedFilter === 'all') {

      return this.previousReports;
    }

    return this.previousReports.filter(

      report =>
        report.status === this.selectedFilter
    );
  }

  setFilter(filter: ReportFilter): void {

    this.selectedFilter = filter;
  }

  // =========================================
  // REPORT TIMESTAMP LABEL
  // =========================================

  private getEditedLabel(
    value?: string
  ): string {

    if (!value) {

      return 'No recent changes';
    }

    const date = new Date(value);

    if (!Number.isFinite(date.getTime())) {

      return 'No recent changes';
    }

    const minutes =
      Math.max(
        0,
        Math.floor(
          (Date.now() - date.getTime()) /
          60000
        )
      );

    if (minutes < 1) {

      return 'Just now';
    }

    if (minutes < 60) {

      return `${minutes} min ago`;
    }

    const hours =
      Math.floor(minutes / 60);

    if (hours < 24) {

      return `${hours} hr ago`;
    }

    return date.toLocaleDateString(
      'en-US',
      {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'Asia/Manila'
      }
    );
  }

  // =========================================
  // CACHE KEYS
  // =========================================

  private getReportsCacheKey(): string {

    return (

      'interntrack_reports_cache_v1_' +

      encodeURIComponent(this.currentUserId) +

      '_' +

      encodeURIComponent(this.studentId)
    );
  }

  private getDraftCacheKey(): string {

    return (

      'interntrack_report_drafts_v1_' +

      encodeURIComponent(this.currentUserId) +

      '_' +

      encodeURIComponent(this.studentId)
    );
  }

  // =========================================
  // SAVE REPORT CACHE
  // =========================================

  private saveReportsCache(): void {

    if (!this.isCurrentIdentity()) {
      return;
    }

    try {

      const cache: ReportsCache = {

        version: 1,

        userId: this.currentUserId,

        studentId: this.studentId,

        ojtStartDate: this.ojtStartDate,

        reports: this.serverReports,

        cachedAt: Date.now()
      };

      localStorage.setItem(

        this.getReportsCacheKey(),

        JSON.stringify(cache)
      );

      this.hasCachedReports = true;

    } catch (error) {

      console.warn(
        'Unable to cache weekly reports:',
        error
      );
    }
  }

  // =========================================
  // RESTORE REPORT CACHE
  // =========================================

  private restoreReportsCache(): void {

    if (!this.isCurrentIdentity()) {
      return;
    }

    try {

      const raw =
        localStorage.getItem(
          this.getReportsCacheKey()
        );

      if (!raw) {
        return;
      }

      const cache =
        JSON.parse(raw) as ReportsCache;

      if (
        !cache ||
        cache.version !== 1 ||
        cache.userId !== this.currentUserId ||
        cache.studentId !== this.studentId ||
        !Array.isArray(cache.reports)
      ) {
        return;
      }

      this.ojtStartDate =
        typeof cache.ojtStartDate === 'string'
          ? cache.ojtStartDate
          : '';

      this.serverReports =
        cache.reports.filter(report =>

          !!report &&

          Number.isSafeInteger(report.id) &&

          Number.isSafeInteger(report.week) &&

          report.week > 0 &&

          this.isValidStatus(report.status)
        );

      this.hasCachedReports = true;

    } catch (error) {

      console.warn(
        'Unable to restore weekly reports:',
        error
      );
    }
  }

  // =========================================
  // SAVE LOCAL DRAFTS
  // =========================================

  private persistLocalDrafts(): void {

    if (!this.isCurrentIdentity()) {

      throw new Error(
        'Your student session is unavailable.'
      );
    }

    const cache: DraftCache = {

      version: 1,

      userId: this.currentUserId,

      studentId: this.studentId,

      drafts: this.localDrafts
    };

    localStorage.setItem(

      this.getDraftCacheKey(),

      JSON.stringify(cache)
    );
  }

  // =========================================
  // RESTORE LOCAL DRAFTS
  // =========================================

  private restoreLocalDrafts(): void {

    if (!this.isCurrentIdentity()) {
      return;
    }

    try {

      const raw =
        localStorage.getItem(
          this.getDraftCacheKey()
        );

      if (!raw) {
        return;
      }

      const cache =
        JSON.parse(raw) as DraftCache;

      if (
        !cache ||
        cache.version !== 1 ||
        cache.userId !== this.currentUserId ||
        cache.studentId !== this.studentId ||
        !Array.isArray(cache.drafts)
      ) {
        return;
      }

      this.localDrafts =
        cache.drafts.filter(draft =>

          !!draft &&

          Number.isSafeInteger(draft.week) &&

          draft.week > 0 &&

          typeof draft.accomplishments === 'string' &&

          typeof draft.reflection === 'string' &&

          typeof draft.period === 'string' &&

          typeof draft.savedAt === 'string'
        );

    } catch (error) {

      console.warn(
        'Unable to restore local drafts:',
        error
      );
    }
  }

  // =========================================
  // MERGE SERVER REPORTS AND LOCAL DRAFTS
  // =========================================

  private rebuildReports(): void {

    const reports = new Map<
      number,
      WeeklyReport
    >();

    for (const report of this.serverReports) {

      reports.set(
        report.week,
        { ...report }
      );
    }

    for (const draft of this.localDrafts) {

      const existing =
        reports.get(draft.week);

      // Never overwrite a locked server report.
      if (
        existing &&
        !this.canEditReport(existing)
      ) {
        continue;
      }

      reports.set(draft.week, {

        ...existing,

        id: existing?.id ?? -draft.week,

        week: draft.week,

        period: draft.period,

        startDate: draft.startDate,

        endDate: draft.endDate,

        status: existing?.status ?? 'draft',

        accomplishments:
          draft.accomplishments,

        reflection:
          draft.reflection,

        updatedAt:
          existing?.updatedAt,

        editedLabel:
          'Saved on this device',

        localOnly:
          !existing,

        hasLocalChanges: true
      });
    }

    this.allReports =
      Array.from(reports.values())
        .sort(
          (a, b) => b.week - a.week
        );

    // Current report represents the actual
    // internship week, not an arbitrary draft.
    this.currentReport =

      this.allReports.find(
        report =>
          report.week === this.currentWeek
      ) ??

      emptyReport();

    this.previousReports =
      this.allReports.filter(

        report =>
          report.week !== this.currentWeek
      );
  }

  // =========================================
  // MAP DATABASE ROW
  // =========================================

  private mapReport(
    row: Record<string, any>
  ): WeeklyReport {

    return {

      id: Number(row['id']),

      week: Number(row['week']),

      period: String(row['period'] || ''),

      status: row['status'] as ReportStatus,

      startDate:
        row['start_date'] || undefined,

      endDate:
        row['end_date'] || undefined,

      accomplishments:
        row['accomplishments'] || '',

      reflection:
        row['student_reflection'] || '',

      feedback:
        row['feedback'] || '',

      commentCount:
        Number(row['comment_count'] || 0),

      createdAt:
        row['created_at'] || undefined,

      updatedAt:
        row['updated_at'] || undefined,

      submittedAt:
        row['submitted_at'] || undefined,

      reviewedAt:
        row['reviewed_at'] || undefined,

      supervisorName:
        row['supervisor_name'] || '',

      editedLabel:
        this.getEditedLabel(
          row['updated_at'] ||
          row['created_at']
        ),

      localOnly: false,

      hasLocalChanges: false
    };
  }

  // =========================================
  // LOAD REPORTS
  // =========================================

  // Automatically save queued drafts after a fresh server read.
  // Never submit reports automatically or overwrite a conflicting version.
  private async syncLocalDrafts(
    version: number,
    userId: string,
    studentId: string
  ): Promise<void> {
    if (this.localDrafts.length && this.dialogOpen && this.canUseServer()) {
      this.scheduleReconnectRefresh();
      return;
    }
    if (
      this.isSyncingDrafts || this.isSaving || this.isSubmitting ||
      !this.hasFreshServerData ||
      !this.canUseServer() || !this.localDrafts.length
    ) {
      return;
    }

    this.isSyncingDrafts = true;
    this.isSaving = true;
    this.refresh();

    try {
      for (const draft of [...this.localDrafts]) {
        if (!this.isCurrentLoad(version, userId, studentId) ||
            !this.canUseServer()) {
          break;
        }

        const report = this.allReports.find(item => item.week === draft.week);
        if (!report || !this.canEditReport(report)) {
          continue;
        }

        try {
          await this.saveReportToSupabase(report, false);
        } catch (error) {
          // Keep failed or conflicting drafts on this device.
          console.warn(`Unable to synchronize Week ${draft.week}:`, error);
        }
      }
    } finally {
      this.isSyncingDrafts = false;
      this.isSaving = false;
      if (this.isCurrentIdentity(userId, studentId)) {
        this.rebuildReports();
        this.refresh();
      }
    }
  }

  async loadReports(): Promise<void> {

    if (this.isSyncingDrafts) {
      this.scheduleReconnectRefresh();
      return;
    }

    if (!this.isCurrentIdentity()) {
      return;
    }

    const studentId = this.studentId;

    const userId = this.currentUserId;

    const version = ++this.loadVersion;

    this.serverRequest?.abort();

    this.clearReconnectTimer();

    this.isLoading = true;

    this.hasFreshServerData = false;

    this.reportsLoadError = false;

    this.isOnline =
      this.networkService.isOnline();

    let controller:
      AbortController | undefined;

    try {

      this.updateCurrentPeriod();

      this.rebuildReports();

      // =====================================
      // OFFLINE MODE
      // =====================================

      if (!this.isOnline) {

        this.updateOfflineState();

        return;
      }

      // Wait for online session revalidation.
      if (
        this.authService.isOfflineSession()
      ) {

        this.isCachedData = true;

        this.reportsMessage =
          'Reconnecting. Showing saved reports.';

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
        reportsResult
      ] = await Promise.all([

        this.supabase

          .from('students')

          .select('ojt_start_date')

          .eq('student_id', studentId)

          .abortSignal(controller.signal)

          .maybeSingle(),

        this.supabase

          .from('reports')

          .select('*')

          .eq('student_id', studentId)

          .order('week', {
            ascending: false
          })

          .abortSignal(controller.signal)
      ]);

      if (
        !this.isCurrentLoad(
          version,
          userId,
          studentId
        )
      ) {
        return;
      }

      if (profileResult.error) {

        throw profileResult.error;
      }

      if (reportsResult.error) {

        throw reportsResult.error;
      }

      if (!profileResult.data) {

        throw new Error(
          'Student profile not found.'
        );
      }

      this.ojtStartDate =
        profileResult.data.ojt_start_date || '';

      const rows =
        reportsResult.data || [];

      const reports = rows

        .filter(row =>

          this.isValidStatus(row.status) &&

          Number.isSafeInteger(Number(row.id)) &&

          Number.isSafeInteger(Number(row.week)) &&

          Number(row.week) > 0
        )

        .map(row =>
          this.mapReport(row)
        );

      const uniqueWeeks =
        new Set(
          reports.map(report => report.week)
        );

      if (
        uniqueWeeks.size !== reports.length
      ) {

        throw new Error(
          'Duplicate weekly reports were found. Contact your OJT coordinator.'
        );
      }

      this.serverReports = reports;

      this.hasFreshServerData = true;

      this.isCachedData = false;

      this.reportsLoadError = false;

      this.updateCurrentPeriod();

      this.rebuildReports();

      this.saveReportsCache();

      this.reportsMessage = '';

      await this.syncLocalDrafts(version, userId, studentId);

      if (!this.isCurrentLoad(version, userId, studentId)) {
        return;
      }

      if (!this.ojtStartDate) {

        this.reportsMessage =
          'Your OJT start date has not been assigned. Contact your OJT coordinator.';

      } else if (this.currentWeek === 0) {

        this.reportsMessage =
          'Your internship has not started yet.';

      } else if (this.localDrafts.length > 0) {

        this.reportsMessage =
          'Some local drafts could not be synchronized. Your changes are retained. Retry when online or contact your OJT coordinator if a conflict remains.';
      }

    } catch (error) {

      if (
        !this.isCurrentLoad(
          version,
          userId,
          studentId
        )
      ) {
        return;
      }

      console.warn(
        'Unable to load weekly reports:',
        error
      );

      this.hasFreshServerData = false;

      this.reportsLoadError = true;

      this.isCachedData =
        this.hasCachedReports ||
        this.localDrafts.length > 0;

      this.reportsMessage =
        this.isCachedData

          ? 'Unable to refresh reports. Showing saved information.'

          : 'Unable to load reports. Please try again.';

      this.rebuildReports();

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
  // OFFLINE STATE
  // =========================================

  private updateOfflineState(): void {

    this.isCachedData =
      this.hasCachedReports ||
      this.localDrafts.length > 0;

    this.hasFreshServerData = false;

    this.reportsMessage =
      this.isCachedData

        ? 'Offline mode. You can view saved reports and edit drafts.'

        : 'No saved reports are available. Connect to the internet.';

    this.rebuildReports();
  }

  // =========================================
  // MANUAL RETRY
  // =========================================

  async retryReports(): Promise<void> {

    const status =
      await this.networkService.refreshStatus();

    this.isOnline = status.connected;

    await this.loadReports();
  }

  // =========================================
  // CREATE CURRENT WEEK REPORT
  // =========================================

  async createReport(): Promise<void> {

    if (
      this.isSaving ||
      this.isSubmitting ||
      this.dialogOpen ||
      !this.isCurrentIdentity()
    ) {
      return;
    }

    this.updateCurrentPeriod();

    this.rebuildReports();

    if (!this.ojtStartDate) {

      await this.showAlert(

        'OJT Start Date Required',

        'Your OJT coordinator must assign your internship start date before you can create a report.'
      );

      return;
    }

    if (this.currentWeek < 1) {

      await this.showAlert(

        'Report Unavailable',

        'Your internship has not started yet.'
      );

      return;
    }

    const existing =
      this.allReports.find(

        report =>
          report.week === this.currentWeek
      );

    if (existing) {

      await this.openReport(existing);

      return;
    }

    const period =
      this.getReportingPeriod(
        this.currentWeek
      );

    if (!period) {
      return;
    }

    const report: WeeklyReport = {

      id: -period.week,

      week: period.week,

      period: period.period,

      startDate: period.startDate,

      endDate: period.endDate,

      status: 'draft',

      accomplishments: '',

      reflection: '',

      localOnly: true
    };

    await this.openEditor(report);
  }

  // =========================================
  // EDIT CURRENT REPORT
  // =========================================

  async editCurrentReport(): Promise<void> {

    if (!this.currentReport.week) {

      await this.createReport();

      return;
    }

    await this.openReport(
      this.currentReport
    );
  }

  // =========================================
  // OPEN ANY REPORT
  // =========================================

  async openReport(
    report: WeeklyReport
  ): Promise<void> {

    if (
      !this.isCurrentIdentity() ||
      this.dialogOpen ||
      this.isSaving ||
      this.isSubmitting
    ) {
      return;
    }

    const latest =
      this.allReports.find(

        item => item.week === report.week
      ) ?? report;

    if (this.canEditReport(latest)) {

      await this.openEditor(latest);

    } else {

      await this.openReadOnlyReport(latest);
    }
  }

  // =========================================
  // REPORT EDITOR
  // =========================================

  private async openEditor(
    report: WeeklyReport
  ): Promise<void> {

    if (
      !this.canEditReport(report) ||
      !this.isCurrentIdentity() ||
      this.dialogOpen ||
      this.isSaving ||
      this.isSubmitting
    ) {
      return;
    }

    this.initializeReportEditor(report);
  }

  // =========================================
  // INITIALIZE REPORT EDITOR
  // =========================================

  private initializeReportEditor(
    report: WeeklyReport
  ): void {

    this.activeReport = { ...report };

    this.editorAccomplishments =
      report.accomplishments || '';

    this.editorReflection =
      report.reflection || '';

    this.editorUserId = this.currentUserId;
    this.editorStudentId = this.studentId;

    this.refresh();
    this.scrollReportsToTop();
  }

  // =========================================
  // SCROLL TO TOP
  // =========================================

  private scrollReportsToTop(): void {

    requestAnimationFrame(() => {

      const content =
        document.querySelector<HTMLIonContentElement>(
          'app-reports ion-content'
        );

      if (content) {
        void content.scrollToTop(0);
      }

    });
  }

  // =========================================
  // EDITOR IDENTITY
  // =========================================

  private isCurrentEditorIdentity(): boolean {

    return (
      !!this.activeReport &&
      this.isCurrentIdentity(
        this.editorUserId,
        this.editorStudentId
      )
    );
  }

  // =========================================
  // READ-ONLY STATUS
  // =========================================

  get isReadOnlyReport(): boolean {

    if (!this.activeReport) {
      return true;
    }

    const latest =
      this.allReports.find(
        report => report.week === this.activeReport?.week
      ) ?? this.activeReport;

    return !this.canEditReport(latest);
  }

  // =========================================
  // EDITOR FORM VALUES
  // =========================================

  updateEditorAccomplishments(
    event: Event
  ): void {

    const target =
      event.target as HTMLTextAreaElement;

    this.editorAccomplishments =
      target.value;
  }

  updateEditorReflection(
    event: Event
  ): void {

    const target =
      event.target as HTMLTextAreaElement;

    this.editorReflection =
      target.value;
  }

  // =========================================
  // BUILD EDITOR REPORT
  // =========================================

  private buildEditorReport(): WeeklyReport | null {

    if (
      !this.activeReport ||
      !this.isCurrentEditorIdentity()
    ) {
      return null;
    }

    return {
      ...this.activeReport,

      accomplishments:
        this.editorAccomplishments.trim(),

      reflection:
        this.editorReflection.trim()
    };
  }

  // =========================================
  // EDITOR SUBMISSION AVAILABILITY
  // =========================================

  get canSubmitEditor(): boolean {

    const report =
      this.buildEditorReport();

    if (
      !report ||
      this.isReadOnlyReport ||
      this.dialogOpen
    ) {
      return false;
    }

    return this.canSubmitReport(report);
  }

  // =========================================
  // UNSAVED EDITOR CHANGES
  // =========================================

  get hasUnsavedEditorChanges(): boolean {

    if (!this.activeReport) {
      return false;
    }

    return (
      this.editorAccomplishments !==
        (this.activeReport.accomplishments || '') ||

      this.editorReflection !==
        (this.activeReport.reflection || '')
    );
  }

  // =========================================
  // SAVE EDITOR DRAFT
  // =========================================

  async saveEditorDraft(): Promise<void> {

    if (
      this.isSaving ||
      this.isSubmitting ||
      this.dialogOpen ||
      this.isReadOnlyReport
    ) {
      return;
    }

    const report =
      this.buildEditorReport();

    if (!report) {
      return;
    }

    await this.saveDraft(report);

    if (!this.isCurrentEditorIdentity()) {
      return;
    }

    this.refreshEditorFromRecords(report);
  }

  // =========================================
  // SUBMIT EDITOR REPORT
  // =========================================

  async submitEditorReport(): Promise<void> {

    if (!this.canSubmitEditor) {
      return;
    }

    const report =
      this.buildEditorReport();

    if (!report) {
      return;
    }

    await this.confirmSubmission(report);

    if (!this.isCurrentEditorIdentity()) {
      return;
    }

    this.refreshEditorFromRecords(report);
  }

  // =========================================
  // REFRESH EDITOR AFTER SAVE OR SUBMISSION
  // =========================================

  private refreshEditorFromRecords(
    attemptedReport: WeeklyReport
  ): void {

    const latest =
      this.allReports.find(
        report => report.week === attemptedReport.week
      );

    if (!latest) {
      return;
    }

    if (
      latest.status === 'pending_review' ||
      latest.status === 'approved'
    ) {

      this.initializeReportEditor(latest);
      return;
    }

    const contentMatches =
      (latest.accomplishments || '').trim() ===
        (attemptedReport.accomplishments || '').trim() &&

      (latest.reflection || '').trim() ===
        (attemptedReport.reflection || '').trim();

    if (contentMatches) {

      this.activeReport = { ...latest };

      this.editorAccomplishments =
        latest.accomplishments || '';

      this.editorReflection =
        latest.reflection || '';

    }

    this.refresh();
  }

  // =========================================
  // CLOSE REPORT EDITOR
  // =========================================

  async closeReportEditor(): Promise<void> {

    if (
      this.isSaving ||
      this.isSubmitting ||
      this.dialogOpen
    ) {
      return;
    }

    if (
      this.hasUnsavedEditorChanges &&
      !this.isReadOnlyReport
    ) {

      this.dialogOpen = true;

      try {

        const alert =
          await this.alertController.create({

            header: 'Unsaved Changes',

            message:
              'You have unsaved changes. Leave without saving?',

            backdropDismiss: false,

            buttons: [
              {
                text: 'Keep Editing',
                role: 'cancel'
              },
              {
                text: 'Discard Changes',
                role: 'destructive'
              }
            ]
          });

        await alert.present();

        const result =
          await alert.onDidDismiss();

        if (result.role !== 'destructive') {
          return;
        }

      } finally {

        this.dialogOpen = false;

      }

    }

    this.resetReportEditor();
    this.refresh();
    this.scrollReportsToTop();
  }

  // =========================================
  // RESET REPORT EDITOR
  // =========================================

  private resetReportEditor(): void {

    this.activeReport = null;

    this.editorAccomplishments = '';
    this.editorReflection = '';

    this.editorUserId = '';
    this.editorStudentId = '';
  }

  // =========================================
  // STORE LOCAL DRAFT
  // =========================================

  private storeLocalDraft(
    report: WeeklyReport
  ): void {

    if (
      !this.isCurrentIdentity() ||
      !this.canEditReport(report)
    ) {

      throw new Error(
        'This report cannot be edited.'
      );
    }

    const existingServer =
      this.serverReports.find(

        item => item.week === report.week
      );

    if (
      existingServer &&
      !this.canEditReport(existingServer)
    ) {

      throw new Error(
        'This report is already locked for review.'
      );
    }

    const existingDraft =
      this.localDrafts.find(

        item => item.week === report.week
      );

    const draft: LocalReportDraft = {

      week: report.week,

      period: report.period,

      startDate: report.startDate || '',

      endDate: report.endDate || '',

      accomplishments:
        report.accomplishments?.trim() || '',

      reflection:
        report.reflection?.trim() || '',

      serverId:

        existingDraft

          ? existingDraft.serverId

          : existingServer?.id ?? null,

      baseUpdatedAt:

        existingDraft

          ? existingDraft.baseUpdatedAt

          : existingServer?.updatedAt ?? null,

      savedAt:
        new Date().toISOString()
    };

    const previousDrafts =
      this.localDrafts;

    this.localDrafts = [

      ...this.localDrafts.filter(

        item => item.week !== report.week
      ),

      draft
    ];

    try {

      this.persistLocalDrafts();

    } catch (error) {

      this.localDrafts = previousDrafts;

      throw error;
    }

    this.rebuildReports();

    this.refresh();
  }

  // =========================================
  // REMOVE CONFIRMED LOCAL DRAFT
  // =========================================

  private removeLocalDraft(
    week: number
  ): void {

    const previousDrafts =
      this.localDrafts;

    this.localDrafts =
      this.localDrafts.filter(

        draft => draft.week !== week
      );

    try {

      this.persistLocalDrafts();

    } catch (error) {

      this.localDrafts = previousDrafts;

      console.warn(
        'Unable to remove local draft:',
        error
      );
    }
  }

  // =========================================
  // SAVE DRAFT
  // =========================================

  private async saveDraft(
    report: WeeklyReport
  ): Promise<void> {

    if (
      this.isSaving ||
      this.isSubmitting ||
      !this.isCurrentIdentity()
    ) {
      return;
    }

    this.isSaving = true;

    const userId = this.currentUserId;

    const studentId = this.studentId;

    let localSaved = false;

    try {

      // Save locally first to prevent data loss.
      this.storeLocalDraft(report);

      localSaved = true;

      if (!this.canUseServer()) {

        this.reportsMessage =
          'Draft saved on this device. Connect to the internet to save it online.';

        await this.showAlert(

          'Draft Saved Offline',

          'Your report has been saved on this device.'
        );

        return;
      }

      await this.saveReportToSupabase(
        report,
        false
      );

      if (
        !this.isCurrentIdentity(
          userId,
          studentId
        )
      ) {
        return;
      }

      await this.loadReports();

      await this.showAlert(

        'Draft Saved',

        'Your weekly report has been saved successfully.'
      );

    } catch (error) {

      if (
        !this.isCurrentIdentity(
          userId,
          studentId
        )
      ) {
        return;
      }

      console.warn(
        'Unable to save report online:',
        error
      );

      this.reportsMessage =

        localSaved

          ? 'Online saving failed. Your local draft is retained.'

          : 'Unable to save your draft.';

      await this.showAlert(

        localSaved
          ? 'Draft Saved Locally'
          : 'Unable to Save Draft',

        this.getErrorMessage(error) +

        (
          localSaved

            ? ' Your changes remain saved on this device.'

            : ''
        )
      );

    } finally {

      this.isSaving = false;

      this.refresh();
    }
  }

  // =========================================
  // SUBMIT CURRENT REPORT
  // =========================================

  async submitReport(): Promise<void> {

    if (!this.currentReport.week) {

      await this.showAlert(

        'No Report',

        'Please create your weekly report first.'
      );

      return;
    }

    await this.confirmSubmission(
      this.currentReport
    );
  }

  // =========================================
  // SUBMISSION VALIDATION
  // =========================================

  private validateSubmission(
    report: WeeklyReport
  ): string | null {

    if (!this.canEditReport(report)) {

      return 'This report cannot be submitted again.';
    }

    if (!report.accomplishments?.trim()) {

      return 'Please enter your weekly accomplishments.';
    }

    if (!report.reflection?.trim()) {

      return 'Please enter your student reflection.';
    }

    if (
      !this.parseDate(report.startDate || '') ||
      !this.parseDate(report.endDate || '')
    ) {

      return 'This report has an invalid reporting period. Contact your OJT coordinator.';
    }

    if (!this.canUseServer()) {

      return 'Connect to the internet before submitting your report.';
    }

    return null;
  }

  // =========================================
  // CONFIRM SUBMISSION
  // =========================================

  private async confirmSubmission(
    report: WeeklyReport
  ): Promise<void> {

    if (
      this.isSubmitting ||
      this.isSaving ||
      this.dialogOpen ||
      !this.isCurrentIdentity()
    ) {
      return;
    }

    const validationError =
      this.validateSubmission(report);

    if (validationError) {

      await this.showAlert(

        'Unable to Submit',

        validationError
      );

      return;
    }

    const userId = this.currentUserId;

    const studentId = this.studentId;

    this.dialogOpen = true;

    let confirmed = false;

    try {

      const alert =
        await this.alertController.create({

          header:
            report.status === 'returned'

              ? 'Resubmit Report'

              : 'Submit Report',

          message:
            'Submit this weekly report for supervisor review? You cannot edit it while it is pending review.',

          backdropDismiss: false,

          buttons: [

            {

              text: 'Cancel',

              role: 'cancel'
            },

            {

              text: 'Submit',

              role: 'confirm',

              handler: () => {

                confirmed = true;
              }
            }
          ]
        });

      await alert.present();

      await alert.onDidDismiss();

    } finally {

      this.dialogOpen = false;
    }

    if (
      !confirmed ||
      !this.isCurrentIdentity(
        userId,
        studentId
      )
    ) {
      return;
    }

    await this.performSubmission(report);
  }

  // =========================================
  // PERFORM SUBMISSION
  // =========================================

  private async performSubmission(
    report: WeeklyReport
  ): Promise<void> {

    if (
      this.isSubmitting ||
      this.isSaving ||
      !this.isCurrentIdentity()
    ) {
      return;
    }

    const validationError =
      this.validateSubmission(report);

    if (validationError) {

      await this.showAlert(

        'Unable to Submit',

        validationError
      );

      return;
    }

    this.isSubmitting = true;

    const userId = this.currentUserId;

    const studentId = this.studentId;

    try {

      this.storeLocalDraft(report);

      // Do not mark the report as pending
      // until Supabase confirms the operation.
      await this.saveReportToSupabase(

        report,

        true
      );

      if (
        !this.isCurrentIdentity(
          userId,
          studentId
        )
      ) {
        return;
      }

      await this.loadReports();

      await this.showAlert(

        'Report Submitted',

        'Your weekly report has been submitted for supervisor review.'
      );

    } catch (error) {

      if (
        !this.isCurrentIdentity(
          userId,
          studentId
        )
      ) {
        return;
      }

      console.error(
        'Report submission failed:',
        error
      );

      await this.showAlert(

        'Submission Not Confirmed',

        this.getErrorMessage(error) +

        ' Refresh your reports before trying again. Any locally saved draft will be retained.'
      );

    } finally {

      this.isSubmitting = false;

      this.refresh();
    }
  }

  // =========================================
  // SAVE REPORT TO SUPABASE
  // =========================================

  private async saveReportToSupabase(
    report: WeeklyReport,
    submit: boolean
  ): Promise<void> {

    if (!this.canUseServer()) {

      throw new Error(
        'An online session is required.'
      );
    }

    const userId = this.currentUserId;

    const studentId = this.studentId;

    const draft =
      this.localDrafts.find(

        item => item.week === report.week
      );

    if (!draft) {

      throw new Error(
        'No local draft was found.'
      );
    }

    // Retrieve latest server version.
    const {
      data: existing,
      error: lookupError
    } = await this.supabase

      .from('reports')

      .select('*')

      .eq('student_id', studentId)

      .eq('week', report.week)

      .maybeSingle();

    if (lookupError) {

      throw lookupError;
    }

    if (
      !this.isCurrentIdentity(
        userId,
        studentId
      ) ||
      !this.canUseServer()
    ) {

      throw new Error(
        'Your session or connection has changed.'
      );
    }

    const now =
      new Date().toISOString();

    let savedRow:
      Record<string, any>;

    // =======================================
    // UPDATE EXISTING REPORT
    // =======================================

    if (existing) {

      if (
        existing.status !== 'draft' &&
        existing.status !== 'returned'
      ) {

        throw new Error(
          'This report is already pending review or approved.'
        );
      }

      // Protect against overwriting changes
      // made from another device or by a reviewer.
      if (
        draft.serverId !== Number(existing.id) ||

        draft.baseUpdatedAt !==
          (existing.updated_at ?? null)
      ) {

        throw new Error(
          'This report has changed on the server. Your local draft was retained. Refresh and resolve the conflicting version before saving.'
        );
      }

      const updateData: Record<string, any> = {

        accomplishments:
          draft.accomplishments,

        student_reflection:
          draft.reflection,

        updated_at:
          now
      };

      if (submit) {

        updateData['status'] =
          'pending_review';

        updateData['submitted_at'] =
          now;
      }

      // Do not write feedback, reviewer identity,
      // review timestamps, or comment counts.

      let updateQuery =
        this.supabase

          .from('reports')

          .update(updateData)

          .eq('id', existing.id)

          .eq('student_id', studentId)

          .eq('status', existing.status);

      if (existing.updated_at) {

        updateQuery =
          updateQuery.eq(

            'updated_at',

            existing.updated_at
          );

      } else {

        updateQuery =
          updateQuery.is(

            'updated_at',

            null
          );
      }

      const {
        data,
        error
      } = await updateQuery

        .select('*')

        .maybeSingle();

      if (error) {

        throw error;
      }

      if (!data) {

        throw new Error(
          'The report changed before it could be saved.'
        );
      }

      savedRow = data;

    } else {

      // =====================================
      // INSERT NEW REPORT
      // =====================================

      if (draft.serverId !== null) {

        throw new Error(
          'The original report no longer exists on the server.'
        );
      }

      const expectedPeriod =
        this.getReportingPeriod(report.week);

      this.updateCurrentPeriod();

      if (
        !expectedPeriod ||
        report.week > this.currentWeek ||
        draft.startDate !== expectedPeriod.startDate ||
        draft.endDate !== expectedPeriod.endDate
      ) {

        throw new Error(
          'The reporting period is no longer valid.'
        );
      }

      const insertData: Record<string, any> = {

        student_id:
          studentId,

        week:
          expectedPeriod.week,

        period:
          expectedPeriod.period,

        start_date:
          expectedPeriod.startDate,

        end_date:
          expectedPeriod.endDate,

        accomplishments:
          draft.accomplishments,

        student_reflection:
          draft.reflection,

        status:

          submit

            ? 'pending_review'

            : 'draft',

        created_at:
          now,

        updated_at:
          now
      };

      if (submit) {

        insertData['submitted_at'] =
          now;
      }

      const {
        data,
        error
      } = await this.supabase

        .from('reports')

        .insert(insertData)

        .select('*')

        .single();

      if (error) {

        if (error.code === '23505') {

          throw new Error(
            'A report already exists for this internship week. Refresh your reports.'
          );
        }

        throw error;
      }

      if (!data) {

        throw new Error(
          'The server did not confirm the saved report.'
        );
      }

      savedRow = data;
    }

    // =======================================
    // CONFIRM SUCCESSFUL SERVER WRITE
    // =======================================

    if (
      !this.isCurrentIdentity(
        userId,
        studentId
      )
    ) {
      return;
    }

    const savedReport =
      this.mapReport(savedRow);

    if (
      submit &&
      savedReport.status !== 'pending_review'
    ) {

      throw new Error(
        'The server did not confirm report submission.'
      );
    }

    this.serverReports = [

      ...this.serverReports.filter(

        item => item.week !== savedReport.week
      ),

      savedReport
    ];

    // Remove local copy only after
    // successful server confirmation.
    this.removeLocalDraft(
      savedReport.week
    );

    this.saveReportsCache();

    this.rebuildReports();

    this.refresh();
  }

  // =========================================
  // READ-ONLY REPORT VIEW
  // =========================================

  private async openReadOnlyReport(
    report: WeeklyReport
  ): Promise<void> {

    if (
      this.dialogOpen ||
      this.isSaving ||
      this.isSubmitting ||
      !this.isCurrentIdentity()
    ) {
      return;
    }

    this.initializeReportEditor(report);
  }

  // =========================================
  // TIMESTAMP FORMAT
  // =========================================

  formatTimestamp(
    value: string
  ): string {

    const date = new Date(value);

    if (!Number.isFinite(date.getTime())) {

      return 'Not available';
    }

    return date.toLocaleString(

      'en-US',

      {

        month: 'short',

        day: 'numeric',

        year: 'numeric',

        hour: 'numeric',

        minute: '2-digit',

        hour12: true,

        timeZone: 'Asia/Manila'
      }
    );
  }

  // =========================================
  // ERROR MESSAGE
  // =========================================

  private getErrorMessage(
    error: unknown
  ): string {

    if (error instanceof Error) {

      return error.message;
    }

    if (
      error &&
      typeof error === 'object' &&
      'message' in error
    ) {

      return String(error.message);
    }

    return 'An unexpected error occurred.';
  }

  // =========================================
  // ALERT HELPER
  // =========================================

  private async showAlert(
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

    await alert.onDidDismiss();
  }
}
