import { Injectable, inject } from '@angular/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BehaviorSubject, Subject } from 'rxjs';

import { SupabaseService } from './supabase.service';
import { NetworkService } from './network.service';
import { AuthService } from './auth.service';

// ======================================================
// INTERFACES
// ======================================================

export interface PendingAttendance {
  id: string;
  student_id: string;
  attendance_date: string;
  client_transaction_id: string;

  time_in?: string;
  time_out?: string;

  time_in_photo?: Blob;
  time_out_photo?: Blob;

  time_in_photo_path?: string;
  time_out_photo_path?: string;

  time_in_location_lat?: number;
  time_in_location_long?: number;

  time_out_location_lat?: number;
  time_out_location_long?: number;

  total_hours_rendered?: number | null;

  status: string;
  created_at: string;

  sync_status: 'pending' | 'synced' | 'failed';

  retry_count: number;
  last_retry_at?: string;
  last_error?: string;
}

export interface SyncState {
  pending: number;
  failed: number;
  syncing: boolean;
}

interface PhotoRecord {
  id: string;
  blob: Blob;
  type: 'time_in' | 'time_out';
  attendance_id: string;
}

export interface CachedAttendance {
  id?: string;
  student_id: string;
  attendance_date: string;
  client_transaction_id: string;

  time_in: string;
  time_out: string | null;

  total_hours_rendered: number | null;

  sync_status: 'pending_upload' | 'synced';
  verification_status: 'provisional' | 'verified';
}

// ======================================================
// CONSTANTS
// ======================================================

const DB_NAME = 'InternTrackOffline';
const DB_VERSION = 2;

const ATTENDANCE_STORE = 'pending_attendance';
const PHOTO_STORE = 'photos';
const CACHE_STORE = 'attendance_cache';

const PHOTO_BUCKET = 'attendance-photos';

const MAX_RETRIES = 6;
const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 15 * 60_000;

// ======================================================
// PHILIPPINE DATE HELPER
// ======================================================

export function getPhilippineDate(
  timestamp: string | Date = new Date()
): string {

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid attendance timestamp.');
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;

  return `${year}-${month}-${day}`;
}

// ======================================================
// OFFLINE SYNC SERVICE
// ======================================================

@Injectable({
  providedIn: 'root'
})
export class OfflineSyncService {

  private readonly supabase = inject(SupabaseService);
  private readonly networkService = inject(NetworkService);
  private readonly authService = inject(AuthService);

  private syncStateSubject = new BehaviorSubject<SyncState>({
    pending: 0,
    failed: 0,
    syncing: false
  });

  private syncedSubject = new Subject<void>();

  private pendingAttendance: PendingAttendance[] = [];

  private db: IDBDatabase | null = null;

  private syncInProgress = false;

  private attendanceRevision = 0;

  getAttendanceRevision(): number {
    return this.attendanceRevision;
  }

  private dbReady: Promise<void>;
  private loaded: Promise<void>;

  private activeStudentId: string | null = null;

  private saveQueue: Promise<unknown> = Promise.resolve();

  // ====================================================
  // OBSERVABLES
  // ====================================================

  readonly isOnline$ = this.networkService.online$;

  readonly syncState$ = this.syncStateSubject.asObservable();

  readonly synced$ = this.syncedSubject.asObservable();

  // ====================================================
  // CONSTRUCTOR
  // ====================================================

  constructor() {

    this.dbReady = this.initDB();

    this.loaded = this.dbReady.then(() =>
      this.loadPendingRecords()
    );

    void this.initializeConnectivity();

    setInterval(() => {

      if (this.isOnline) {
        void this.autoSync();
      }

    }, 30_000);

  }

  private async initializeConnectivity(): Promise<void> {

    try {

      await this.networkService.waitForInitialization();

      await this.authService.waitForInitialization();

      await this.loaded;

      this.networkService.online$.subscribe(connected => {

        if (connected) {
          void this.autoSync();
        }

      });

    } catch (error) {

      console.error(
        'Offline synchronization initialization failed:',
        error
      );

    }

  }

  get isOnline(): boolean {
    return this.networkService.isOnline();
  }

  get isSyncing(): boolean {
    return this.syncInProgress;
  }

  async ready(): Promise<void> {

    await this.loaded;

    await this.networkService.waitForInitialization();

    await this.authService.waitForInitialization();

  }

  // ====================================================
  // ACTIVE STUDENT
  // ====================================================

  setActiveStudent(studentId: string | null): void {

    this.activeStudentId = studentId?.trim() || null;

    this.emitState();

    if (this.activeStudentId) {
      void this.autoSync();
    }

  }

  private belongsToActiveStudent(
    record: PendingAttendance
  ): boolean {

    return (
      this.activeStudentId !== null &&
      record.student_id === this.activeStudentId
    );

  }

  // ====================================================
  // AUTHENTICATION VALIDATION
  // ====================================================

  private canSynchronize(): boolean {

    return (
      this.networkService.isInitialized() &&
      this.networkService.isOnline() &&
      this.authService.isInitialized() &&
      this.authService.isAuthenticated() &&
      this.authService.isStudent() &&
      !this.authService.isOfflineSession() &&
      this.activeStudentId !== null &&
      this.authService.getStudentId() ===
        this.activeStudentId
    );

  }

  // ====================================================
  // INDEXEDDB INITIALIZATION
  // ====================================================

  private initDB(): Promise<void> {

    return new Promise((resolve, reject) => {

      if (!('indexedDB' in window)) {

        reject(
          new Error('IndexedDB is unavailable.')
        );

        return;

      }

      const request = indexedDB.open(
        DB_NAME,
        DB_VERSION
      );

      request.onerror = () => {
        reject(request.error);
      };

      request.onblocked = () => {

        reject(new Error(
          'Offline database upgrade is blocked. Close other app tabs.'
        ));

      };

      request.onsuccess = () => {

        this.db = request.result;

        this.db.onversionchange = () => {

          this.db?.close();
          this.db = null;

        };

        resolve();

      };

      request.onupgradeneeded = () => {

        const db = request.result;

        // Pending attendance records

        if (!db.objectStoreNames.contains(ATTENDANCE_STORE)) {

          const store = db.createObjectStore(
            ATTENDANCE_STORE,
            { keyPath: 'id' }
          );

          store.createIndex(
            'sync_status',
            'sync_status',
            { unique: false }
          );

          store.createIndex(
            'student_id',
            'student_id',
            { unique: false }
          );

          store.createIndex(
            'client_transaction_id',
            'client_transaction_id',
            { unique: false }
          );

        } else {

          const store = request.transaction!
            .objectStore(ATTENDANCE_STORE);

          if (
            store.indexNames.contains(
              'client_transaction_id'
            )
          ) {

            store.deleteIndex(
              'client_transaction_id'
            );

          }

          store.createIndex(
            'client_transaction_id',
            'client_transaction_id',
            { unique: false }
          );

        }

        // Photo evidence

        if (!db.objectStoreNames.contains(PHOTO_STORE)) {

          const store = db.createObjectStore(
            PHOTO_STORE,
            { keyPath: 'id' }
          );

          store.createIndex(
            'attendance_id',
            'attendance_id',
            { unique: false }
          );

        }

        // Local attendance cache

        if (!db.objectStoreNames.contains(CACHE_STORE)) {

          const store = db.createObjectStore(
            CACHE_STORE,
            {
              keyPath: [
                'student_id',
                'attendance_date'
              ]
            }
          );

          store.createIndex(
            'student_id',
            'student_id',
            { unique: false }
          );

        }

      };

    });

  }

  // ====================================================
  // INDEXEDDB TRANSACTIONS
  // ====================================================

  private async tx<T = void>(
    stores: string[],
    mode: IDBTransactionMode,
    work: (transaction: IDBTransaction) => IDBRequest | void
  ): Promise<T> {

    await this.dbReady;

    if (!this.db) {

      throw new Error(
        'Offline database is not initialized.'
      );

    }

    const db = this.db;

    return new Promise<T>((resolve, reject) => {

      const transaction = db.transaction(
        stores,
        mode
      );

      let request: IDBRequest | void;

      transaction.oncomplete = () => {

        resolve(
          (request ? request.result : undefined) as T
        );

      };

      transaction.onerror = () => {
        reject(transaction.error);
      };

      transaction.onabort = () => {

        reject(
          transaction.error ??
          new Error('Offline transaction aborted.')
        );

      };

      try {

        request = work(transaction);

      } catch (error) {

        transaction.abort();
        reject(error);

      }

    });

  }

  private saveToIndexedDB(
    record: PendingAttendance
  ): Promise<void> {

    return this.tx(
      [ATTENDANCE_STORE],
      'readwrite',
      transaction => {

        transaction
          .objectStore(ATTENDANCE_STORE)
          .put(record);

      }
    );

  }

  private loadFromIndexedDB(): Promise<PendingAttendance[]> {

    return this.tx<PendingAttendance[]>(
      [ATTENDANCE_STORE],
      'readonly',
      transaction =>
        transaction
          .objectStore(ATTENDANCE_STORE)
          .getAll()
    );

  }

  private async getPhoto(
    id: string
  ): Promise<Blob | null> {

    const record = await this.tx<PhotoRecord | undefined>(
      [PHOTO_STORE],
      'readonly',
      transaction =>
        transaction
          .objectStore(PHOTO_STORE)
          .get(id)
    );

    return record?.blob ?? null;

  }

  // ====================================================
  // LOAD PENDING RECORDS
  // ====================================================

  private async loadPendingRecords(): Promise<void> {

    this.pendingAttendance =
      await this.loadFromIndexedDB();

    this.emitState();

  }

  // ====================================================
  // LOCAL ATTENDANCE CACHE
  // ====================================================

  async getCachedAttendance(
    studentId: string,
    attendanceDate: string = getPhilippineDate()
  ): Promise<CachedAttendance | null> {

    await this.loaded;

    if (studentId !== this.activeStudentId) {
      throw new Error('Invalid active student.');
    }

    const record = await this.tx<
      CachedAttendance | undefined
    >(
      [CACHE_STORE],
      'readonly',
      transaction =>
        transaction
          .objectStore(CACHE_STORE)
          .get([studentId, attendanceDate])
    );

    return record ?? null;

  }

  async getCachedAttendanceRecords(
    studentId: string
  ): Promise<CachedAttendance[]> {

    await this.loaded;

    if (studentId !== this.activeStudentId) {
      throw new Error('Invalid active student.');
    }

    const records = await this.tx<CachedAttendance[]>(
      [CACHE_STORE],
      'readonly',
      transaction =>
        transaction
          .objectStore(CACHE_STORE)
          .index('student_id')
          .getAll(studentId)
    );

    return records.sort((a, b) =>
      b.attendance_date.localeCompare(a.attendance_date)
    );

  }

  async cacheAttendance(
    record: CachedAttendance
  ): Promise<void> {

    await this.loaded;

    if (record.student_id !== this.activeStudentId) {
      throw new Error('Invalid active student.');
    }

    await this.tx(
      [CACHE_STORE],
      'readwrite',
      transaction => {

        const store =
          transaction.objectStore(CACHE_STORE);

        const request = store.get([
          record.student_id,
          record.attendance_date
        ]);

        request.onsuccess = () => {

          const existing =
            request.result as CachedAttendance | undefined;

          // Never overwrite unsynchronized local attendance.

          if (existing?.sync_status === 'pending_upload') {
            return;
          }

          store.put(record);

        };

      }
    );

  }

  // ====================================================
  // RECONCILE ATTENDANCE CACHE
  // ====================================================

  /**
   * Reconciles the local attendance cache against a complete,
   * successful server response for the active student.
   *
   * Never call this method with partial, filtered, failed,
   * or incomplete server results.
   */

async reconcileAttendanceCache(
  studentId: string,
  serverRecords: CachedAttendance[],
  expectedRevision: number
): Promise<void> {

  await this.ready();

  if (
    !this.canSynchronize() ||
    studentId !== this.activeStudentId
  ) {
    throw new Error(
      'A valid online student session is required.'
    );
  }

  if (!Array.isArray(serverRecords)) {
    throw new Error(
      'Invalid server attendance records.'
    );
  }

  const serverDates = new Set<string>();

  for (const record of serverRecords) {
    if (
      record.student_id !== studentId ||
      !record.attendance_date ||
      !record.time_in ||
      serverDates.has(record.attendance_date)
    ) {
      throw new Error(
        'Invalid or duplicate server attendance record.'
      );
    }

    serverDates.add(record.attendance_date);
  }

  const operation = this.saveQueue.then(async () => {

    if (
      !this.canSynchronize() ||
      this.activeStudentId !== studentId ||
      this.syncInProgress ||
      this.attendanceRevision !== expectedRevision
    ) {
      throw new Error(
        'Attendance reconciliation is temporarily unavailable.'
      );
    }

    await this.tx(
      [CACHE_STORE, ATTENDANCE_STORE],
      'readwrite',
      transaction => {

        const cacheStore =
          transaction.objectStore(CACHE_STORE);

        const pendingStore =
          transaction.objectStore(ATTENDANCE_STORE);

        const pendingRequest = pendingStore
          .index('student_id')
          .getAll(studentId);

        pendingRequest.onsuccess = () => {

          const pendingRecords =
            pendingRequest.result as PendingAttendance[];

          const protectedDates = new Set(
            pendingRecords
              .filter(record =>
                record.sync_status !== 'synced'
              )
              .map(record => record.attendance_date)
          );

          const cacheRequest = cacheStore
            .index('student_id')
            .getAll(studentId);

          cacheRequest.onsuccess = () => {

            // Revalidate identity, connectivity,
            // and attendance revision.

            if (
              !this.canSynchronize() ||
              this.activeStudentId !== studentId ||
              this.syncInProgress ||
              this.attendanceRevision !== expectedRevision
            ) {
              transaction.abort();
              return;
            }

            const cachedRecords =
              cacheRequest.result as CachedAttendance[];

            // Protect unsynchronized attendance.

            for (const cached of cachedRecords) {
              if (
                cached.sync_status === 'pending_upload'
              ) {
                protectedDates.add(
                  cached.attendance_date
                );
              }
            }

            // Remove obsolete synchronized records.

            for (const cached of cachedRecords) {
              if (
                cached.sync_status === 'synced' &&
                !serverDates.has(cached.attendance_date) &&
                !protectedDates.has(cached.attendance_date)
              ) {
                cacheStore.delete([
                  studentId,
                  cached.attendance_date
                ]);
              }
            }

            // Insert or update current server records.

            for (const record of serverRecords) {
              if (
                !protectedDates.has(record.attendance_date)
              ) {
                cacheStore.put(record);
              }
            }

          };

        };

      }
    );

  });

  this.saveQueue = operation.catch(() => undefined);

  await operation;

}


  // ====================================================
  // VALIDATION
  // ====================================================

  private validateTimestamp(timestamp: string): void {

    if (Number.isNaN(new Date(timestamp).getTime())) {

      throw new Error(
        'Invalid attendance timestamp.'
      );

    }

  }

  private validateLocation(
    latitude?: number,
    longitude?: number
  ): void {

    if (
      latitude === undefined ||
      longitude === undefined ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {

      throw new Error(
        'A valid GPS location is required.'
      );

    }

  }

  private validatePhoto(photo?: Blob): void {

    if (
      !photo ||
      photo.size === 0 ||
      !photo.type.startsWith('image/')
    ) {

      throw new Error(
        'Valid photo evidence is required.'
      );

    }

  }

  private calculateRenderedHours(
    timeIn: string,
    timeOut: string
  ): number {

    const start = new Date(timeIn).getTime();
    const end = new Date(timeOut).getTime();

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end < start
    ) {

      throw new Error(
        'Time-Out cannot be earlier than Time-In.'
      );

    }

    return (end - start) / 3_600_000;

  }

  // ====================================================
  // SAVE ATTENDANCE LOCALLY
  // ====================================================

  async saveOfflineAttendance(
    record: Omit<
      PendingAttendance,
      'id' | 'sync_status' | 'retry_count'
    >
  ): Promise<string> {

    const operation = this.saveQueue.then(() =>
      this.saveAttendanceInternal(record)
    );

    this.saveQueue = operation.catch(() => undefined);

    return operation;

  }

  private async saveAttendanceInternal(
    record: Omit<
      PendingAttendance,
      'id' | 'sync_status' | 'retry_count'
    >
  ): Promise<string> {

    await this.loaded;

    await this.authService.waitForInitialization();

    if (
      !record.student_id ||
      record.student_id !== this.activeStudentId ||
      !this.authService.isAuthenticated() ||
      !this.authService.isStudent() ||
      this.authService.getStudentId() !== record.student_id
    ) {

      throw new Error('Invalid active student.');

    }

    if (!record.attendance_date) {

      throw new Error(
        'Attendance date is required.'
      );

    }

    if (!record.client_transaction_id) {

      throw new Error(
        'Transaction ID is required.'
      );

    }

    const isTimeIn = !!record.time_in;
    const isTimeOut = !!record.time_out;

    if (isTimeIn === isTimeOut) {

      throw new Error(
        'Save exactly one Time-In or Time-Out event.'
      );

    }

    const id = this.generateId();

    const {
      time_in_photo,
      time_out_photo,
      ...rest
    } = record;

    const pending: PendingAttendance = {
      ...rest,
      id,
      sync_status: 'pending',
      retry_count: 0,
      created_at: new Date().toISOString()
    };

    const photos: PhotoRecord[] = [];

    const cached = await this.getCachedAttendance(
      record.student_id,
      record.attendance_date
    );

    let updatedCache: CachedAttendance;

    // --------------------------------------------------
    // TIME-IN
    // --------------------------------------------------

    if (isTimeIn && record.time_in) {

      this.validateTimestamp(record.time_in);

      this.validatePhoto(time_in_photo);

      this.validateLocation(
        record.time_in_location_lat,
        record.time_in_location_long
      );

      const actualDate =
        getPhilippineDate(record.time_in);

      if (record.attendance_date !== actualDate) {

        throw new Error(
          'Attendance date must match the Philippine Time-In date.'
        );

      }

      if (cached) {

        throw new Error(
          'Attendance has already been recorded for this date.'
        );

      }

      const existingPending =
        this.pendingAttendance.find(item =>
          item.student_id === record.student_id &&
          item.attendance_date === record.attendance_date &&
          !!item.time_in
        );

      if (existingPending) {

        throw new Error(
          'A Time-In record already exists for this date.'
        );

      }

      pending.time_in_photo_path = `${id}-time-in`;

      photos.push({
        id: pending.time_in_photo_path,
        blob: time_in_photo!,
        type: 'time_in',
        attendance_id: id
      });

      updatedCache = {
        student_id: record.student_id,
        attendance_date: record.attendance_date,
        client_transaction_id: record.client_transaction_id,
        time_in: record.time_in,
        time_out: null,
        total_hours_rendered: null,
        sync_status: 'pending_upload',
        verification_status: 'provisional'
      };

    }

    // --------------------------------------------------
    // TIME-OUT
    // --------------------------------------------------

    else if (isTimeOut && record.time_out) {

      this.validateTimestamp(record.time_out);

      this.validatePhoto(time_out_photo);

      this.validateLocation(
        record.time_out_location_lat,
        record.time_out_location_long
      );

      if (!cached) {

        throw new Error(
          'No corresponding Time-In record was found.'
        );

      }

      if (cached.time_out) {

        throw new Error(
          'Time-Out has already been recorded.'
        );

      }

      if (cached.verification_status === 'verified') {

        throw new Error(
          'Verified attendance cannot be modified.'
        );

      }

      if (
        cached.client_transaction_id !==
        record.client_transaction_id
      ) {

        throw new Error(
          'Time-Out does not match the original Time-In session.'
        );

      }

      const renderedHours = this.calculateRenderedHours(
        cached.time_in,
        record.time_out
      );

      pending.total_hours_rendered = renderedHours;

      pending.time_out_photo_path = `${id}-time-out`;

      photos.push({
        id: pending.time_out_photo_path,
        blob: time_out_photo!,
        type: 'time_out',
        attendance_id: id
      });

      updatedCache = {
        ...cached,
        time_out: record.time_out,
        total_hours_rendered: renderedHours,
        sync_status: 'pending_upload',
        verification_status: 'provisional'
      };

    } else {

      throw new Error('Invalid attendance record.');

    }

    // --------------------------------------------------
    // ATOMIC LOCAL SAVE
    // --------------------------------------------------

    await this.tx(
      [
        ATTENDANCE_STORE,
        PHOTO_STORE,
        CACHE_STORE
      ],
      'readwrite',
      transaction => {

        const photoStore =
          transaction.objectStore(PHOTO_STORE);

        photos.forEach(photo => {
          photoStore.put(photo);
        });

        transaction
          .objectStore(ATTENDANCE_STORE)
          .add(pending);

        transaction
          .objectStore(CACHE_STORE)
          .put(updatedCache);

      }
    );

    this.pendingAttendance.push(pending);

    this.emitState();

    // Synchronization starts only after local saving succeeds.

    void this.autoSync();

    return pending.id;

  }

  // ====================================================
  // PUBLIC RECORD GETTERS
  // ====================================================

  getPendingRecords(): PendingAttendance[] {

    return this.pendingAttendance
      .filter(record =>
        this.belongsToActiveStudent(record) &&
        record.sync_status === 'pending'
      )
      .map(record => ({ ...record }));

  }

  getFailedRecords(): PendingAttendance[] {

    return this.pendingAttendance
      .filter(record =>
        this.belongsToActiveStudent(record) &&
        record.sync_status === 'failed'
      )
      .map(record => ({ ...record }));

  }

  getAllRecords(): PendingAttendance[] {

    return this.pendingAttendance
      .filter(record =>
        this.belongsToActiveStudent(record)
      )
      .map(record => ({ ...record }));

  }

  // ====================================================
  // MARK RECORD AS SYNCED
  // ====================================================

  async markAsSynced(id: string): Promise<void> {

    const record = this.pendingAttendance.find(
      item => item.id === id
    );

    if (!record) {
      return;
    }

    await this.tx(
      [
        ATTENDANCE_STORE,
        PHOTO_STORE,
        CACHE_STORE
      ],
      'readwrite',
      transaction => {

        const attendanceStore =
          transaction.objectStore(ATTENDANCE_STORE);

        const photoStore =
          transaction.objectStore(PHOTO_STORE);

        const cacheStore =
          transaction.objectStore(CACHE_STORE);

        attendanceStore.delete(id);

        if (record.time_in_photo_path) {
          photoStore.delete(record.time_in_photo_path);
        }

        if (record.time_out_photo_path) {
          photoStore.delete(record.time_out_photo_path);
        }

        const cacheRequest = cacheStore.get([
          record.student_id,
          record.attendance_date
        ]);

        cacheRequest.onsuccess = () => {

          const cached =
            cacheRequest.result as CachedAttendance | undefined;

          if (!cached) {
            return;
          }

          const queueRequest = attendanceStore
            .index('student_id')
            .getAll(record.student_id);

          queueRequest.onsuccess = () => {

            const remaining =
              queueRequest.result as PendingAttendance[];

            const hasUnsyncedRecord = remaining.some(
              item =>
                item.attendance_date === record.attendance_date &&
                item.sync_status !== 'synced'
            );

            cacheStore.put({
              ...cached,
              sync_status: hasUnsyncedRecord
                ? 'pending_upload'
                : 'synced'
            });

          };

        };

      }
    );

    this.pendingAttendance =
      this.pendingAttendance.filter(
        item => item.id !== id
      );

    this.emitState();

  }

  // ====================================================
  // MARK RECORD AS FAILED
  // ====================================================

  async markAsFailed(
    id: string,
    error?: unknown
  ): Promise<void> {

    const record = this.pendingAttendance.find(
      item => item.id === id
    );

    if (!record) {
      return;
    }

    const updated: PendingAttendance = {
      ...record,
      retry_count: record.retry_count + 1,
      last_retry_at: new Date().toISOString(),
      last_error: this.getErrorMessage(error),
      sync_status:
        record.retry_count + 1 >= MAX_RETRIES
          ? 'failed'
          : 'pending'
    };

    await this.saveToIndexedDB(updated);

    this.pendingAttendance =
      this.pendingAttendance.map(item =>
        item.id === id ? updated : item
      );

    this.emitState();

  }

  // ====================================================
  // REMOVE LOCAL RECORD
  // ====================================================

  async removeRecord(id: string): Promise<void> {

    const record = this.pendingAttendance.find(
      item => item.id === id
    );

    if (!record) {
      return;
    }

    if (record.sync_status !== 'synced') {

      throw new Error(
        'Unsynchronized attendance cannot be removed.'
      );

    }

    await this.markAsSynced(id);

  }

  // ====================================================
  // CLEAR LOCAL TESTING DATA
  // ====================================================

  async clearAllRecords(): Promise<void> {

    await this.loaded;

    if (this.syncInProgress) {

      throw new Error(
        'Cannot clear records while synchronization is running.'
      );

    }

    if (
      this.pendingAttendance.some(
        record => record.sync_status !== 'synced'
      )
    ) {

      throw new Error(
        'Unsynchronized attendance exists. Clearing is not allowed.'
      );

    }

    await this.tx(
      [
        ATTENDANCE_STORE,
        PHOTO_STORE,
        CACHE_STORE
      ],
      'readwrite',
      transaction => {

        transaction
          .objectStore(ATTENDANCE_STORE)
          .clear();

        transaction
          .objectStore(PHOTO_STORE)
          .clear();

        transaction
          .objectStore(CACHE_STORE)
          .clear();

      }
    );

    this.pendingAttendance = [];

    this.emitState();

  }

  // ====================================================
  // RETRY FAILED RECORDS
  // ====================================================

  async retryFailed(): Promise<void> {

    await this.ready();

    if (!this.isOnline) {
      throw new Error('You are offline.');
    }

    if (!this.canSynchronize()) {

      throw new Error(
        'Please wait until your session is revalidated.'
      );

    }

    if (this.syncInProgress) {
      return;
    }

    const failedRecords = this.pendingAttendance.filter(
      record =>
        this.belongsToActiveStudent(record) &&
        record.sync_status === 'failed'
    );

    for (const record of failedRecords) {

      const updated: PendingAttendance = {
        ...record,
        sync_status: 'pending',
        retry_count: 0,
        last_retry_at: undefined,
        last_error: undefined
      };

      await this.saveToIndexedDB(updated);

      this.pendingAttendance =
        this.pendingAttendance.map(item =>
          item.id === record.id ? updated : item
        );

    }

    this.emitState();

    await this.syncPendingRecords();

  }

  // ====================================================
  // MANUAL SYNCHRONIZATION
  // ====================================================

  async syncPendingRecords(
    _supabaseClient?: unknown
  ): Promise<{
    synced: number;
    failed: number;
  }> {

    await this.ready();

    if (!this.isOnline) {
      throw new Error('You are offline.');
    }

    if (!this.canSynchronize()) {

      throw new Error(
        'Please wait until your session is revalidated.'
      );

    }

    return this.runSync(true);

  }

  // ====================================================
  // AUTOMATIC SYNCHRONIZATION
  // ====================================================

  private async autoSync(): Promise<void> {

    try {

      await this.runSync(false);

    } catch (error) {

      console.error(
        'Automatic synchronization failed:',
        error
      );

    }

  }

  private isDue(record: PendingAttendance): boolean {

    if (record.sync_status !== 'pending') {
      return false;
    }

    if (!record.last_retry_at) {
      return true;
    }

    const delay = Math.min(
      BASE_DELAY_MS * 2 ** record.retry_count,
      MAX_DELAY_MS
    );

    return Date.now() >=
      new Date(record.last_retry_at).getTime() + delay;

  }

  // ====================================================
  // SYNCHRONIZATION ENGINE
  // ====================================================

  private async runSync(
    force: boolean
  ): Promise<{
    synced: number;
    failed: number;
  }> {

    await this.loaded;

    await this.networkService.waitForInitialization();

    await this.authService.waitForInitialization();

    if (
      !this.canSynchronize() ||
      this.syncInProgress ||
      !this.activeStudentId
    ) {

      return {
        synced: 0,
        failed: 0
      };

    }

    this.attendanceRevision++;
    this.syncInProgress = true;

    const studentId = this.activeStudentId;

    let synced = 0;
    let failed = 0;

    this.emitState();

    try {

      const client = this.supabase.getClient();

      const records = this.pendingAttendance
        .filter(record =>
          record.student_id === studentId &&
          record.sync_status !== 'synced'
        )
        .sort((a, b) => {

          const dateOrder =
            a.attendance_date.localeCompare(
              b.attendance_date
            );

          if (dateOrder !== 0) {
            return dateOrder;
          }

          // Time-In must synchronize before Time-Out.

          if (!!a.time_in !== !!b.time_in) {
            return a.time_in ? -1 : 1;
          }

          return a.created_at.localeCompare(
            b.created_at
          );

        });

      const blockedSessions = new Set<string>();

      for (const record of records) {

        // Stop when connectivity or identity changes.

        if (
          !this.canSynchronize() ||
          this.activeStudentId !== studentId
        ) {
          break;
        }

        const sessionKey =
          `${record.student_id}:${record.attendance_date}`;

        if (blockedSessions.has(sessionKey)) {
          continue;
        }

        if (record.sync_status === 'failed') {

          blockedSessions.add(sessionKey);
          continue;

        }

        if (!force && !this.isDue(record)) {

          blockedSessions.add(sessionKey);
          continue;

        }

        try {

          await this.syncOne(client, record);

          // Remove local evidence only after confirmation.

          await this.markAsSynced(record.id);

          synced++;

        } catch (error) {

          // Connection loss does not consume a retry.

          if (
            !this.canSynchronize() ||
            this.activeStudentId !== studentId
          ) {

            console.warn(
              'Synchronization paused. Local records retained.'
            );

            break;

          }

          console.error(
            'Attendance synchronization failed:',
            record.id,
            error
          );

          await this.markAsFailed(
            record.id,
            error
          );

          blockedSessions.add(sessionKey);

          failed++;

        }

      }

    } finally {

      this.syncInProgress = false;

      this.emitState();

      if (synced > 0) {
        this.syncedSubject.next();
      }

    }

    return {
      synced,
      failed
    };

  }

  // ====================================================
  // SYNCHRONIZE INDIVIDUAL ATTENDANCE
  // ====================================================

  private async syncOne(
    client: SupabaseClient,
    record: PendingAttendance
  ): Promise<void> {

    if (!record.client_transaction_id) {
      throw new Error('Missing transaction ID.');
    }

    if (!record.attendance_date) {
      throw new Error('Missing attendance date.');
    }

    if (record.time_in) {

      await this.syncTimeIn(client, record);
      return;

    }

    if (record.time_out) {

      await this.syncTimeOut(client, record);
      return;

    }

    throw new Error('Invalid attendance event.');

  }

  // ====================================================
  // SYNCHRONIZE TIME-IN
  // ====================================================

  private async syncTimeIn(
    client: SupabaseClient,
    record: PendingAttendance
  ): Promise<void> {

    const { data: existing, error: findError } =
      await client
        .from('attendance')
        .select(
          'id, student_id, attendance_date, client_transaction_id, time_in'
        )
        .eq('student_id', record.student_id)
        .eq('attendance_date', record.attendance_date)
        .maybeSingle();

    if (findError) {
      throw findError;
    }

    // Idempotent retry: previous upload already succeeded.

    if (existing) {

      if (
        existing.client_transaction_id ===
          record.client_transaction_id &&
        new Date(existing.time_in).getTime() ===
          new Date(record.time_in!).getTime()
      ) {
        return;
      }

      throw new Error(
        'A different attendance record already exists for this date.'
      );

    }

    const photoUrl = await this.uploadStoredPhoto(
      client,
      record.time_in_photo_path,
      `${record.student_id}-${record.client_transaction_id}-time-in`
    );

    if (
      !this.canSynchronize() ||
      this.activeStudentId !== record.student_id
    ) {

      throw new Error(
        'Synchronization interrupted.'
      );

    }

    const { error } = await client
      .from('attendance')
      .upsert(
        {
          student_id: record.student_id,

          attendance_date: record.attendance_date,

          client_transaction_id:
            record.client_transaction_id,

          time_in: record.time_in,

          time_in_photo: photoUrl,

          time_in_location_lat:
            record.time_in_location_lat,

          time_in_location_long:
            record.time_in_location_long,

          status: record.status || 'Present',

          sync_status: 'synced',

          verification_status: 'provisional',

          total_hours_rendered: null
        },
        {
          onConflict: 'client_transaction_id',
          ignoreDuplicates: true
        }
      );

    if (error) {
      throw error;
    }

    // Confirm that the correct record exists.

    const { data: confirmed, error: confirmError } =
      await client
        .from('attendance')
        .select(
          'id, student_id, attendance_date, time_in'
        )
        .eq(
          'client_transaction_id',
          record.client_transaction_id
        )
        .eq('student_id', record.student_id)
        .eq('attendance_date', record.attendance_date)
        .maybeSingle();

    if (confirmError) {
      throw confirmError;
    }

    if (
      !confirmed ||
      new Date(confirmed.time_in).getTime() !==
        new Date(record.time_in!).getTime()
    ) {

      throw new Error(
        'Time-In synchronization could not be confirmed.'
      );

    }

  }

  // ====================================================
  // SYNCHRONIZE TIME-OUT
  // ====================================================

  private async syncTimeOut(
    client: SupabaseClient,
    record: PendingAttendance
  ): Promise<void> {

    const { data: existing, error: findError } =
      await client
        .from('attendance')
        .select(
          'id, time_in, time_out, verification_status'
        )
        .eq('student_id', record.student_id)
        .eq('attendance_date', record.attendance_date)
        .eq(
          'client_transaction_id',
          record.client_transaction_id
        )
        .maybeSingle();

    if (findError) {
      throw findError;
    }

    if (!existing) {

      throw new Error(
        'The corresponding Time-In has not been synchronized.'
      );

    }

    // Confirm whether an earlier retry already succeeded.

    if (existing.time_out) {

      if (
        new Date(existing.time_out).getTime() ===
          new Date(record.time_out!).getTime()
      ) {
        return;
      }

      throw new Error(
        'A different Time-Out has already been recorded.'
      );

    }

    if (existing.verification_status === 'verified') {

      throw new Error(
        'Verified attendance cannot be modified.'
      );

    }

    const renderedHours = this.calculateRenderedHours(
      existing.time_in,
      record.time_out!
    );

    const photoUrl = await this.uploadStoredPhoto(
      client,
      record.time_out_photo_path,
      `${record.student_id}-${record.client_transaction_id}-time-out`
    );

    if (
      !this.canSynchronize() ||
      this.activeStudentId !== record.student_id
    ) {

      throw new Error(
        'Synchronization interrupted.'
      );

    }

    const { data: updated, error: updateError } =
      await client
        .from('attendance')
        .update({
          time_out: record.time_out,

          time_out_photo: photoUrl,

          time_out_location_lat:
            record.time_out_location_lat,

          time_out_location_long:
            record.time_out_location_long,

          total_hours_rendered: renderedHours,

          sync_status: 'synced'
        })
        .eq('id', existing.id)
        .eq('student_id', record.student_id)
        .eq('verification_status', 'provisional')
        .is('time_out', null)
        .select('id, time_out')
        .maybeSingle();

    if (updateError) {
      throw updateError;
    }

    if (
      !updated ||
      new Date(updated.time_out).getTime() !==
        new Date(record.time_out!).getTime()
    ) {

      throw new Error(
        'Time-Out update could not be confirmed.'
      );

    }

  }

  // ====================================================
  // PHOTO UPLOAD
  // ====================================================

  private async uploadStoredPhoto(
    client: SupabaseClient,
    photoId: string | undefined,
    baseName: string
  ): Promise<string> {

    if (!photoId) {
      throw new Error('Missing photo evidence.');
    }

    const blob = await this.getPhoto(photoId);

    if (!blob || blob.size === 0) {

      throw new Error(
        'Locally stored photo evidence could not be found.'
      );

    }

    const extensionMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/heic': 'heic',
      'image/heif': 'heif'
    };

    const extension = extensionMap[blob.type];

    if (!extension) {

      throw new Error(
        'Unsupported photo format.'
      );

    }

    const fileName = `${baseName}.${extension}`;

    return this.uploadPhoto(
      client,
      blob,
      fileName
    );

  }

  private async uploadPhoto(
    client: SupabaseClient,
    blob: Blob,
    fileName: string
  ): Promise<string> {

    if (!this.canSynchronize()) {

      throw new Error(
        'Synchronization interrupted.'
      );

    }

    const { error } = await client
      .storage
      .from(PHOTO_BUCKET)
      .upload(fileName, blob, {
        contentType: blob.type,
        cacheControl: '3600',
        upsert: true
      });

    if (error) {
      throw error;
    }

    // Retain the existing public URL implementation.

    const { data } = client
      .storage
      .from(PHOTO_BUCKET)
      .getPublicUrl(fileName);

    return data.publicUrl;

  }

  // ====================================================
  // SYNC STATE
  // ====================================================

  private emitState(): void {

    const studentRecords =
      this.pendingAttendance.filter(record =>
        this.belongsToActiveStudent(record)
      );

    this.syncStateSubject.next({

      pending: studentRecords.filter(
        record => record.sync_status === 'pending'
      ).length,

      failed: studentRecords.filter(
        record => record.sync_status === 'failed'
      ).length,

      syncing: this.syncInProgress

    });

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
      error ?? 'Unknown synchronization error.'
    );

  }

  // ====================================================
  // ID GENERATION
  // ====================================================

  private generateId(): string {

    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    const bytes = crypto.getRandomValues(
      new Uint8Array(16)
    );

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes)
      .map(byte =>
        byte.toString(16).padStart(2, '0')
      )
      .join('');

    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20)
    ].join('-');

  }

  generateTransactionId(): string {

    return this.generateId();

  }

}