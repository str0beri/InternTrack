import type { OnDestroy, OnInit } from '@angular/core';
import {
  ChangeDetectorRef,
  Component,
  inject
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonContent,
  IonIcon,
  type ViewWillEnter,
  type ViewWillLeave
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  cameraOutline,
  checkmarkOutline,
  cloudOfflineOutline,
  logInOutline,
  logOutOutline,
  alertCircleOutline,
  timeOutline
} from 'ionicons/icons';
import type { Subscription } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { NetworkService } from '../../services/network.service';
import { SupabaseService } from '../../services/supabase.service';
import {
  OfflineSyncService,
  getPhilippineDate,
  type CachedAttendance
} from '../../services/offline-sync.service';
// ======================================================
// INTERFACES
// ======================================================
interface AttendanceLog {
  id: string;
  date: string;
  hours: string;
  status: 'pending' | 'synced' | 'failed';
  condition: 'completed' | 'incomplete' | 'timed_in';
  verificationStatus: 'provisional' | 'verified';
}
interface LocationData {
  latitude: number;
  longitude: number;
}
// ======================================================
// COMPONENT
// ======================================================
@Component({
  selector: 'app-attendance',
  standalone: true,
  imports: [
    IonContent,
    IonIcon,
    RouterLink
  ],
  templateUrl: './attendance.page.html',
  styleUrls: ['./attendance.page.scss']
})
export class AttendancePage
  implements OnInit, OnDestroy, ViewWillEnter, ViewWillLeave {
  // ====================================================
  // SERVICES
  // ====================================================
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly supabaseService =
    inject(SupabaseService);
  protected readonly offlineSyncService =
    inject(OfflineSyncService);
  private readonly authService =
    inject(AuthService);
  private readonly networkService =
    inject(NetworkService);
  private readonly supabase =
    this.supabaseService.getClient();
  // ====================================================
  // CLOCK
  // ====================================================
  currentDate = '';
  currentTime = '';
  timePeriod = '';
  private currentAttendanceDate = getPhilippineDate();
  private clockInterval?: ReturnType<typeof setInterval>;
  // ====================================================
  // ATTENDANCE STATE
  // ====================================================
  studentId = '';
  timeIn = '';
  timeOut = '';
  todayAttendance: CachedAttendance | null = null;
  recentLogs: AttendanceLog[] = [];
  incompleteAttendanceCount = 0;
  isLoading = true;
  isProcessing = false;
  isSyncing = false;
  attendanceLoadError = false;
  private attendanceReady = false;
  private destroyed = false;
  private viewActive = false;
  private loadVersion = 0;
  private serverRequest?: AbortController;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  // ====================================================
  // CONNECTION AND SYNC STATE
  // ====================================================
  isOnline = false;
  offlinePreview = false;
  syncMessage = '';
  private onlineSub?: Subscription;
  private syncSub?: Subscription;
  private syncStateSub?: Subscription;
  // ====================================================
  // CONSTRUCTOR
  // ====================================================
  constructor() {
    addIcons({
      cameraOutline,
      checkmarkOutline,
      cloudOfflineOutline,
      logInOutline,
      logOutOutline,
      alertCircleOutline,
      timeOutline
    });
  }
  // ====================================================
  // LIFECYCLE
  // ====================================================
  ngOnInit(): void {
    this.updateClock();
    void this.initializeSubscriptions();
    this.clockInterval = setInterval(() => {
      if (!this.viewActive || this.destroyed) {
        return;
      }
      this.updateClock();
      const today = getPhilippineDate();
      // Refresh attendance when the Philippine date changes.
      if (today !== this.currentAttendanceDate) {
        this.currentAttendanceDate = today;
        this.attendanceReady = false;
        this.todayAttendance = null;
        this.timeIn = '';
        this.timeOut = '';
        if (this.studentId) {
          void this.loadAttendanceFromSupabase();
        }
      }
      this.refresh();
    }, 1000);
  }
  // ====================================================
  // INITIALIZE SUBSCRIPTIONS
  // ====================================================
  private async initializeSubscriptions(): Promise<void> {
    await this.networkService.waitForInitialization();
    if (this.destroyed) {
      return;
    }
    this.isOnline = this.networkService.isOnline();
    this.offlinePreview = !this.isOnline;
    // Centralized native and browser connectivity.
    this.onlineSub =
      this.networkService.online$
        .subscribe(online => {
          const changed = this.isOnline !== online;
          this.isOnline = online;
          this.offlinePreview = !online;
          if (!online) {
            // Cancel any ongoing server request.
            this.serverRequest?.abort();
            this.attendanceLoadError = false;
            this.clearReconnectTimer();
            // Remove outdated server connection errors.
            if (
              this.syncMessage.startsWith(
                'Unable to refresh server attendance'
              ) ||
              this.syncMessage.startsWith(
                'Attendance is up to date'
              )
            ) {
              this.syncMessage = '';
            }
          }
          if (
            changed &&
            this.viewActive &&
            this.studentId
          ) {
            void this.loadAttendanceFromSupabase();
          }
          this.refresh();
        });
    // Refresh attendance after successful synchronization.
    this.syncSub =
      this.offlineSyncService.synced$
        .subscribe(async () => {
          if (
            !this.studentId ||
            !this.viewActive ||
            this.destroyed
          ) {
            return;
          }
          await this.loadAttendanceFromSupabase();
          // Remove outdated synchronization messages.
          if (
            this.pendingCount === 0 &&
            this.failedCount === 0 &&
            !this.attendanceLoadError &&
            this.isOnline
          ) {
            this.syncMessage = '';
          }
          this.refresh();
        });
    this.syncStateSub =
      this.offlineSyncService.syncState$
        .subscribe(state => {
          this.isSyncing = state.syncing;
          this.refresh();
        });
    this.isSyncing = this.offlineSyncService.isSyncing;
    this.refresh();
  }
  // ====================================================
  // PAGE ENTRY
  // ====================================================
  async ionViewWillEnter(): Promise<void> {
    this.viewActive = true;
    this.isLoading = true;
    this.attendanceReady = false;
    this.attendanceLoadError = false;
    this.syncMessage = '';
    this.currentAttendanceDate = getPhilippineDate();
    this.updateClock();
    try {
      await this.networkService.waitForInitialization();
      await this.authService.waitForInitialization();
      if (!this.viewActive || this.destroyed) {
        return;
      }
      this.isOnline = this.networkService.isOnline();
      this.offlinePreview = !this.isOnline;
      const id = this.authService.getStudentId();
      this.studentId = id?.trim() || '';
      // Reset displayed records before loading the
      // currently authenticated student's attendance.
      this.todayAttendance = null;
      this.timeIn = '';
      this.timeOut = '';
      this.recentLogs = [];
      this.incompleteAttendanceCount = 0;
      if (
        !this.studentId ||
        !this.authService.isStudent()
      ) {
        this.offlineSyncService.setActiveStudent(null);
        this.syncMessage =
          'Unable to identify your student account. Please sign in again.';
        this.attendanceLoadError = true;
        return;
      }
      await this.offlineSyncService.ready();
      if (!this.viewActive || this.destroyed) {
        return;
      }
      this.offlineSyncService.setActiveStudent(
        this.studentId
      );
      await this.loadAttendanceFromSupabase();
    } catch (error) {
      console.error(
        'Attendance initialization failed:',
        error
      );
      this.attendanceLoadError = true;
      this.attendanceReady = false;
      this.syncMessage =
        'Unable to initialize attendance storage.';
    } finally {
      this.isLoading = false;
      this.refresh();
    }
  }
  // ====================================================
  // PAGE EXIT
  // ====================================================
  ionViewWillLeave(): void {
    this.viewActive = false;
    this.loadVersion++;
    this.serverRequest?.abort();
    this.clearReconnectTimer();
    const activeElement = document.activeElement;
    // Prevent Ionic aria-hidden focus warnings.
    if (
      activeElement instanceof HTMLElement &&
      activeElement.closest('app-attendance')
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
    this.onlineSub?.unsubscribe();
    this.syncSub?.unsubscribe();
    this.syncStateSub?.unsubscribe();
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
    }
  }
  // ====================================================
  // CHANGE DETECTION
  // ====================================================
  private refresh(): void {
    if (!this.destroyed) {
      this.cdr.detectChanges();
    }
  }
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
  private isCurrentLoad(
    studentId: string,
    version: number
  ): boolean {
    return (
      !this.destroyed &&
      this.viewActive &&
      version === this.loadVersion &&
      studentId === this.studentId &&
      this.authService.getStudentId() === studentId
    );
  }
  private scheduleReconnectRefresh(): void {
    this.clearReconnectTimer();
    if (
      !this.viewActive ||
      !this.networkService.isOnline()
    ) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      if (
        !this.destroyed &&
        this.viewActive &&
        this.networkService.isOnline() &&
        this.studentId
      ) {
        void this.loadAttendanceFromSupabase();
      }
    }, 3000);
  }
  // ====================================================
  // PHILIPPINE LIVE CLOCK
  // ====================================================
  updateClock(): void {
    const now = new Date();
    this.currentDate = now.toLocaleDateString(
      'en-US',
      {
        timeZone: 'Asia/Manila',
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      }
    );
    const parts = new Intl.DateTimeFormat(
      'en-US',
      {
        timeZone: 'Asia/Manila',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }
    ).formatToParts(now);
    const hour =
      parts.find(part => part.type === 'hour')?.value;
    const minute =
      parts.find(part => part.type === 'minute')?.value;
    this.currentTime =
      `${hour || '12'}:${minute || '00'}`;
    this.timePeriod =
      parts.find(
        part => part.type === 'dayPeriod'
      )?.value || '';
  }
  private formatTime(
    timestamp: string | null | undefined
  ): string {
    if (!timestamp) {
      return '--';
    }
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
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
  private formatAttendanceDate(
    attendanceDate: string
  ): string {
    const date = new Date(
      `${attendanceDate}T00:00:00+08:00`
    );
    return date.toLocaleDateString(
      'en-US',
      {
        timeZone: 'Asia/Manila',
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      }
    );
  }
  // ====================================================
  // ATTENDANCE STATUS
  // ====================================================
  get attendanceStatus(): string {
    if (this.isProcessing) {
      return 'Saving attendance...';
    }
    if (this.isLoading) {
      return 'Loading...';
    }
    if (this.todayAttendance?.time_out) {
      return 'Timed Out';
    }
    if (this.todayAttendance?.time_in) {
      return 'Timed In';
    }
    if (!this.attendanceReady) {
      return 'Attendance unavailable';
    }
    return 'Not timed in';
  }
  get canTimeIn(): boolean {
    return (
      !!this.studentId &&
      this.authService.isStudent() &&
      this.authService.getStudentId() === this.studentId &&
      this.attendanceReady &&
      !this.isLoading &&
      !this.isProcessing &&
      !this.todayAttendance &&
      this.currentAttendanceDate === getPhilippineDate()
    );
  }
  get canTimeOut(): boolean {
    return (
      !!this.studentId &&
      this.authService.isStudent() &&
      this.authService.getStudentId() === this.studentId &&
      this.attendanceReady &&
      !this.isLoading &&
      !this.isProcessing &&
      !!this.todayAttendance?.time_in &&
      !this.todayAttendance?.time_out &&
      !!this.todayAttendance?.client_transaction_id &&
      this.todayAttendance?.verification_status !== 'verified' &&
      this.todayAttendance?.attendance_date === getPhilippineDate()
    );
  }
  get pendingCount(): number {
    return this.offlineSyncService
      .getPendingRecords().length;
  }
  get failedCount(): number {
    return this.offlineSyncService
      .getFailedRecords().length;
  }
  get todaySyncStatus():
    'pending' | 'synced' | 'failed' | null {
    if (!this.todayAttendance) {
      return null;
    }
    const failed =
      this.offlineSyncService
        .getFailedRecords()
        .some(record =>
          record.attendance_date ===
          this.todayAttendance?.attendance_date
        );
    if (failed) {
      return 'failed';
    }
    return this.todayAttendance.sync_status === 'synced'
      ? 'synced'
      : 'pending';
  }
  // ====================================================
  // TIME-IN PHOTO CAPTURE
  // ====================================================
  async handlePhotoCapture(
    event: Event
  ): Promise<void> {
    await this.processAttendance(
      event,
      'in'
    );
  }
  // ====================================================
  // TIME-OUT PHOTO CAPTURE
  // ====================================================
  async handleTimeOutPhotoCapture(
    event: Event
  ): Promise<void> {
    await this.processAttendance(
      event,
      'out'
    );
  }
  // ====================================================
  // ATTENDANCE PROCESSING
  // ====================================================
  private async processAttendance(
    event: Event,
    type: 'in' | 'out'
  ): Promise<void> {
    const input =
      event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset input so the same file can be selected again.
    input.value = '';
    if (!file || this.isProcessing) {
      return;
    }
    if (
      type === 'in' &&
      !this.canTimeIn
    ) {
      this.syncMessage =
        'Time-In is not currently available.';
      this.refresh();
      return;
    }
    if (
      type === 'out' &&
      !this.canTimeOut
    ) {
      this.syncMessage =
        'A valid Time-In is required before Time-Out.';
      this.refresh();
      return;
    }
    this.isProcessing = true;
    this.syncMessage = '';
    this.refresh();
    const studentId = this.studentId;
    const attendanceDate = getPhilippineDate();
    try {
      // Validate photo evidence.
      if (
        file.size === 0 ||
        !file.type.startsWith('image/')
      ) {
        throw new Error(
          'Please capture a valid attendance photo.'
        );
      }
      const supportedTypes = [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/heic',
        'image/heif'
      ];
      if (!supportedTypes.includes(file.type)) {
        throw new Error(
          'This photo format is not supported.'
        );
      }
      // GPS evidence must be successfully captured.
      const location =
        await this.captureLocation();
      const timestamp =
        new Date().toISOString();
      // Do not record attendance under another account.
      if (
        this.studentId !== studentId ||
        this.authService.getStudentId() !== studentId ||
        !this.authService.isStudent()
      ) {
        throw new Error(
          'Your student session has changed.'
        );
      }
      // Avoid recording against the wrong date at midnight.
      if (
        getPhilippineDate(timestamp) !== attendanceDate
      ) {
        throw new Error(
          'The attendance date has changed. Please try again.'
        );
      }
      const existing =
        await this.offlineSyncService
          .getCachedAttendance(
            studentId,
            attendanceDate
          );
      // ================================================
      // TIME-IN
      // ================================================
      if (type === 'in') {
        if (existing) {
          throw new Error(
            'You have already timed in today.'
          );
        }
        const transactionId =
          this.offlineSyncService
            .generateTransactionId();
        await this.offlineSyncService
          .saveOfflineAttendance({
            student_id: studentId,
            attendance_date: attendanceDate,
            client_transaction_id: transactionId,
            time_in: timestamp,
            time_in_photo: file,
            time_in_location_lat:
              location.latitude,
            time_in_location_long:
              location.longitude,
            status: 'Present',
            created_at: timestamp
          });
      }
      // ================================================
      // TIME-OUT
      // ================================================
      else {
        if (!existing?.time_in) {
          throw new Error(
            'No corresponding Time-In was found.'
          );
        }
        if (existing.time_out) {
          throw new Error(
            'You have already timed out today.'
          );
        }
        if (
          existing.verification_status === 'verified'
        ) {
          throw new Error(
            'Verified attendance cannot be modified.'
          );
        }
        if (!existing.client_transaction_id) {
          throw new Error(
            'The original attendance transaction is missing.'
          );
        }
        await this.offlineSyncService
          .saveOfflineAttendance({
            student_id: studentId,
            attendance_date:
              existing.attendance_date,
            // Reuse the original Time-In transaction ID.
            client_transaction_id:
              existing.client_transaction_id,
            time_out: timestamp,
            time_out_photo: file,
            time_out_location_lat:
              location.latitude,
            time_out_location_long:
              location.longitude,
            status: 'Present',
            created_at: timestamp
          });
      }
      // Local saving has completed successfully.
      if (
        this.destroyed ||
        this.authService.getStudentId() !== studentId
      ) {
        return;
      }
      this.syncMessage = type === 'in'
        ? 'Time-In saved successfully.'
        : 'Time-Out saved successfully.';
      // Restore saved attendance from IndexedDB.
      await this.loadLocalAttendance();
      if (
        this.todayAttendance?.sync_status ===
        'pending_upload'
      ) {
        this.syncMessage += this.networkService.isOnline()
          ? ' Waiting for synchronization.'
          : ' Saved offline. Will sync when online.';
      }
    } catch (error) {
      console.error(
        'Attendance recording failed:',
        error
      );
      this.syncMessage =
        this.getErrorMessage(error);
    } finally {
      this.isProcessing = false;
      this.refresh();
    }
  }
  // ====================================================
  // GPS LOCATION
  // ====================================================
  private captureLocation(): Promise<LocationData> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(
          new Error(
            'Location services are unavailable on this device.'
          )
        );
        return;
      }
      navigator.geolocation.getCurrentPosition(
        position => {
          const latitude =
            position.coords.latitude;
          const longitude =
            position.coords.longitude;
          if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            latitude < -90 ||
            latitude > 90 ||
            longitude < -180 ||
            longitude > 180
          ) {
            reject(
              new Error(
                'Unable to capture a valid GPS location.'
              )
            );
            return;
          }
          resolve({
            latitude,
            longitude
          });
        },
        error => {
          let message =
            'Unable to capture your location. Please try again.';
          if (error.code === 1) {
            message =
              'Location permission is required to record attendance.';
          } else if (error.code === 2) {
            message =
              'Location is unavailable. Please enable your GPS.';
          } else if (error.code === 3) {
            message =
              'Location capture timed out. Please try again.';
          }
          reject(new Error(message));
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0
        }
      );
    });
  }
  // ====================================================
  // LOAD LOCAL ATTENDANCE
  // ====================================================
  private async loadLocalAttendance(
    version?: number
  ): Promise<void> {
    if (!this.studentId) {
      return;
    }
    const studentId = this.studentId;
    const records =
      await this.offlineSyncService
        .getCachedAttendanceRecords(studentId);
    if (
      this.destroyed ||
      this.studentId !== studentId ||
      this.authService.getStudentId() !== studentId ||
      (
        version !== undefined &&
        version !== this.loadVersion
      )
    ) {
      return;
    }
    this.applyAttendanceRecords(records);
  }
  // ====================================================
  // LOAD ATTENDANCE
  // ====================================================
  async loadAttendanceFromSupabase(): Promise<void> {
    if (
      !this.studentId ||
      this.destroyed ||
      !this.viewActive
    ) {
      return;
    }
    const studentId = this.studentId;
    const version = ++this.loadVersion;
    // Cancel an outdated server request before starting.
    this.serverRequest?.abort();
    this.clearReconnectTimer();
    this.isLoading = true;
    this.attendanceLoadError = false;
    let localRecordsAvailable = false;
    let requestController: AbortController | undefined;
    try {
      await this.offlineSyncService.ready();
      if (!this.isCurrentLoad(studentId, version)) {
        return;
      }
      // Always load locally saved records first.
      await this.loadLocalAttendance(version);
      if (!this.isCurrentLoad(studentId, version)) {
        return;
      }
      localRecordsAvailable = true;
      this.isOnline = this.networkService.isOnline();
      this.offlinePreview = !this.isOnline;
      // ================================================
      // OFFLINE MODE
      // ================================================
      if (!this.isOnline) {
        // No Supabase requests while offline.
        this.attendanceReady = true;
        this.attendanceLoadError = false;
        return;
      }
      // ================================================
      // WAIT FOR SESSION REVALIDATION
      // ================================================
      if (this.authService.isOfflineSession()) {
        // Local attendance remains available while
        // AuthService revalidates the online session.
        this.attendanceReady = true;
        this.scheduleReconnectRefresh();
        return;
      }
      if (
        !this.authService.isAuthenticated() ||
        !this.authService.isStudent()
      ) {
        this.attendanceReady = false;
        return;
      }
      // ================================================
      // ONLINE MODE
      // ================================================
      if (this.offlineSyncService.isSyncing) {
        this.attendanceReady = true;
        this.scheduleReconnectRefresh();
        return;
      }
      const expectedRevision = this.offlineSyncService.getAttendanceRevision();
      requestController = new AbortController();
      this.serverRequest = requestController;
      const { data, error, count } = await this.supabase
        .from('attendance')
        .select('id, student_id, attendance_date, client_transaction_id, time_in, time_out, total_hours_rendered, sync_status, verification_status', { count: 'exact' })
        .eq('student_id', studentId)
        .order('attendance_date', { ascending: false })
        .abortSignal(requestController.signal);
      if (!this.isCurrentLoad(studentId, version) || requestController.signal.aborted) return;
      if (error) throw error;
      if (!Array.isArray(data) || count === null || data.length !== count) {
        throw new Error('Incomplete server attendance response. Local records retained.');
      }
      const serverRecords: CachedAttendance[] = data.map(row => {
        if (row.student_id !== studentId || !row.attendance_date || !row.time_in) {
          throw new Error('Invalid server attendance record. Local records retained.');
        }
        return {
          id: row.id,
          student_id: row.student_id,
          attendance_date:
            row.attendance_date,
          client_transaction_id:
            row.client_transaction_id || '',
          time_in: row.time_in,
          time_out: row.time_out || null,
          total_hours_rendered:
            row.total_hours_rendered !== null &&
            row.total_hours_rendered !== undefined
              ? Number(row.total_hours_rendered)
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
      });
      if (this.offlineSyncService.isSyncing || this.offlineSyncService.getAttendanceRevision() !== expectedRevision) {
        this.attendanceReady = true;
        this.scheduleReconnectRefresh();
        return;
      }
      await this.offlineSyncService.reconcileAttendanceCache(studentId, serverRecords, expectedRevision);

      // Local pending records remain available.
      await this.loadLocalAttendance(version);
      if (
        this.isCurrentLoad(studentId, version)
      ) {
        this.attendanceReady = true;
        this.attendanceLoadError = false;
        // Remove outdated connection errors.
        if (
          this.syncMessage.startsWith(
            'Unable to refresh server attendance'
          )
        ) {
          this.syncMessage = '';
        }
      }
    } catch (error) {
      if (!this.isCurrentLoad(studentId, version)) {
        return;
      }
      this.isOnline = this.networkService.isOnline();
      this.offlinePreview = !this.isOnline;
      // A detected disconnection is not a server error.
      if (!this.isOnline && localRecordsAvailable) {
        this.attendanceLoadError = false;
        this.attendanceReady = true;
        return;
      }
      if (this.offlineSyncService.isSyncing || this.getErrorMessage(error).includes('Attendance reconciliation is temporarily unavailable') || this.getErrorMessage(error).includes('Offline transaction aborted')) {
        this.scheduleReconnectRefresh();
      }
      console.error(
        'Attendance loading failed:',
        error
      );
      this.attendanceLoadError = true;
      if (localRecordsAvailable) {
        this.syncMessage =
          'Unable to refresh server attendance. Showing locally saved records.';
        this.attendanceReady = true;
      } else {
        this.syncMessage =
          'Unable to load locally saved attendance. Please retry.';
        this.attendanceReady = false;
      }
    } finally {
      if (
        this.serverRequest === requestController
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
  // ====================================================
  // APPLY ATTENDANCE RECORDS TO UI
  // ====================================================
  private applyAttendanceRecords(
    records: CachedAttendance[]
  ): void {
    const today = getPhilippineDate();
    const sorted = [...records].sort(
      (a, b) =>
        b.attendance_date.localeCompare(
          a.attendance_date
        )
    );
    // Only today's record controls the attendance buttons.
    this.todayAttendance =
      sorted.find(record =>
        record.attendance_date === today
      ) || null;
    this.timeIn =
      this.todayAttendance?.time_in
        ? this.formatTime(
            this.todayAttendance.time_in
          )
        : '';
    this.timeOut =
      this.todayAttendance?.time_out
        ? this.formatTime(
            this.todayAttendance.time_out
          )
        : '';
    // Identify unfinished attendance from previous days.
    this.incompleteAttendanceCount =
      sorted.filter(record =>
        record.attendance_date < today &&
        !!record.time_in &&
        !record.time_out
      ).length;
    const failedDates = new Set(
      this.offlineSyncService
        .getFailedRecords()
        .map(record => record.attendance_date)
    );
    // Show only the latest five attendance records.
    this.recentLogs = sorted
      .slice(0, 5)
      .map(record => {
        let condition:
          AttendanceLog['condition'];
        if (record.time_out) {
          condition = 'completed';
        } else if (
          record.attendance_date < today
        ) {
          condition = 'incomplete';
        } else {
          condition = 'timed_in';
        }
        let status: AttendanceLog['status'];
        if (
          failedDates.has(record.attendance_date)
        ) {
          status = 'failed';
        } else if (
          record.sync_status === 'synced'
        ) {
          status = 'synced';
        } else {
          status = 'pending';
        }
        return {
          id:
            record.id ||
            record.client_transaction_id ||
            `${record.student_id}-${record.attendance_date}`,
          date: this.formatAttendanceDate(
            record.attendance_date
          ),
          hours:
            `${this.formatTime(record.time_in)} - ` +
            `${this.formatTime(record.time_out)}`,
          status,
          condition,
          verificationStatus:
            record.verification_status
        };
      });
    this.refresh();
  }
  // ====================================================
  // MANUAL SYNCHRONIZATION
  // ====================================================
  async syncPendingRecords(): Promise<void> {
    if (this.isSyncing) {
      return;
    }
    if (!this.networkService.isOnline()) {
      this.syncMessage =
        'You are offline. Records will sync when connected.';
      this.refresh();
      return;
    }
    if (this.authService.isOfflineSession()) {
      this.syncMessage =
        'Please wait while your session is being revalidated.';
      this.refresh();
      return;
    }
    try {
      const result =
        await this.offlineSyncService
          .syncPendingRecords();
      await this.loadAttendanceFromSupabase();
      if (
        result.synced > 0 &&
        result.failed > 0
      ) {
        this.syncMessage =
          `${result.synced} record(s) synced. ` +
          `${result.failed} upload(s) unsuccessful.`;
      } else if (result.synced > 0) {
        this.syncMessage =
          `${result.synced} record(s) synced successfully.`;
      } else if (result.failed > 0) {
        this.syncMessage =
          'Some records could not be uploaded. Please retry.';
      } else if (this.failedCount > 0) {
        this.syncMessage =
          'Failed records require another retry.';
      } else if (this.pendingCount > 0) {
        this.syncMessage =
          'Attendance records are waiting for synchronization.';
      } else if (!this.attendanceLoadError) {
        this.syncMessage =
          'All attendance records are up to date.';
      }
    } catch (error) {
      this.syncMessage =
        `Sync failed: ${this.getErrorMessage(error)}`;
    } finally {
      this.refresh();
    }
  }
  // ====================================================
  // RETRY FAILED SYNCHRONIZATION
  // ====================================================
  async retryFailedSync(): Promise<void> {
    if (this.isSyncing) {
      return;
    }
    if (!this.networkService.isOnline()) {
      this.syncMessage =
        'Connect to the internet before retrying.';
      this.refresh();
      return;
    }
    if (this.authService.isOfflineSession()) {
      this.syncMessage =
        'Please wait while your session is being revalidated.';
      this.refresh();
      return;
    }
    try {
      await this.offlineSyncService.retryFailed();
      await this.loadAttendanceFromSupabase();
      if (
        this.failedCount === 0 &&
        this.pendingCount === 0 &&
        !this.attendanceLoadError
      ) {
        this.syncMessage =
          'All attendance records synced successfully.';
      } else if (
        this.failedCount > 0 ||
        this.pendingCount > 0
      ) {
        this.syncMessage =
          'Some attendance records are still waiting to sync.';
      }
    } catch (error) {
      this.syncMessage =
        `Retry failed: ${this.getErrorMessage(error)}`;
    } finally {
      this.refresh();
    }
  }
  // ====================================================
  // RETRY CONNECTION
  // ====================================================
  async retrySync(): Promise<void> {
    const status =
      await this.networkService.refreshStatus();
    this.isOnline = status.connected;
    this.offlinePreview = !status.connected;
    if (!this.isOnline) {
      this.syncMessage =
        'You are still offline. Please check your connection.';
      this.refresh();
      return;
    }
    if (this.authService.isOfflineSession()) {
      this.syncMessage =
        'Please wait while your session is being revalidated.';
      this.scheduleReconnectRefresh();
      this.refresh();
      return;
    }
    if (this.failedCount > 0) {
      await this.retryFailedSync();
    } else if (this.pendingCount > 0) {
      await this.syncPendingRecords();
    } else {
      await this.loadAttendanceFromSupabase();
      if (
        !this.attendanceLoadError &&
        this.isOnline &&
        !this.authService.isOfflineSession()
      ) {
        this.syncMessage =
          'Attendance is up to date.';
      }
      this.refresh();
    }
  }
  // ====================================================
  // ERROR HANDLING
  // ====================================================
  private getErrorMessage(error: unknown): string {
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
    return String(
      error || 'An unexpected error occurred.'
    );
  }
}
