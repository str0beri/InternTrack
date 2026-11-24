
import {
  Component,
  type OnDestroy,
  inject,
  ChangeDetectorRef
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
  mailOutline,
  logOutOutline
} from 'ionicons/icons';

import type { Subscription } from 'rxjs';

import { AuthService } from '../../services/auth.service';
import { SupabaseService } from '../../services/supabase.service';
import { NetworkService } from '../../services/network.service';

// =========================================
// INTERFACES
// =========================================

interface ContactPerson {
  id: number;
  name: string;
  initials: string;
  role: string;
  email?: string;
}

interface PlacementDetail {
  label: string;
  value: string;
}

interface StudentProfile {
  name: string;
  initials: string;
  studentId: string;
  program: string;
  university: string;
}

interface SupervisorContact {
  full_name: string;
  email: string | null;
}

interface CachedProfile {
  version: number;
  userId: string;
  studentId: string;
  student: StudentProfile;
  placementDetails: PlacementDetail[];
  contacts: ContactPerson[];
  cachedAt: number;
}

// =========================================
// PROFILE PAGE
// =========================================

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    IonContent,
    IonIcon
  ],
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss']
})
export class ProfilePage
  implements ViewWillEnter, ViewWillLeave, OnDestroy {

  // =========================================
  // SERVICES
  // =========================================

  private readonly alertController =
    inject(AlertController);

  private readonly cdr =
    inject(ChangeDetectorRef);

  private readonly supabaseService =
    inject(SupabaseService);

  private readonly authService =
    inject(AuthService);

  private readonly networkService =
    inject(NetworkService);

  private readonly supabase =
    this.supabaseService.getClient();

  // =========================================
  // CACHE CONFIGURATION
  // =========================================

  private readonly cachePrefix =
    'interntrack_profile_v1_';

  private readonly cacheVersion = 1;

  // =========================================
  // COMPONENT STATE
  // =========================================

  private destroyed = false;
  private viewActive = false;

  private currentStudentId = '';
  private currentUserId = '';

  private loadVersion = 0;

  private networkSub?: Subscription;

  private serverRequest?: AbortController;

  private reconnectTimer?:
    ReturnType<typeof setTimeout>;

  // =========================================
  // PAGE STATE
  // =========================================

  isLoggingOut = false;
  isLoading = true;
  isOnline = false;
  isCachedProfile = false;

  profileLoadError = false;
  contactsLoadError = false;

  hasProfile = false;

  lastUpdated: number | null = null;

  profileMessage = '';

  // =========================================
  // STUDENT INFORMATION
  // =========================================

  student: StudentProfile = {
    name: '',
    initials: '',
    studentId: '',
    program: '',
    university: ''
  };

  // =========================================
  // OJT PLACEMENT
  // =========================================

  placementDetails: PlacementDetail[] = [];

  // =========================================
  // CONTACTS
  // =========================================

  contacts: ContactPerson[] = [];

  // =========================================
  // CONSTRUCTOR
  // =========================================

  constructor() {
    addIcons({
      mailOutline,
      logOutOutline
    });
  }

  // =========================================
  // PAGE INITIALIZATION
  // =========================================

  async ionViewWillEnter(): Promise<void> {

    this.viewActive = true;
    this.isLoading = true;

    this.profileLoadError = false;
    this.contactsLoadError = false;

    this.profileMessage = '';

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

      this.isOnline =
        this.networkService.isOnline();

      const studentId =
        this.authService.getStudentId();

      const userId =
        this.authService.getCurrentUser()?.id;

      // Require a valid student identity.

      if (
        !studentId ||
        !userId ||
        !this.authService.isAuthenticated() ||
        !this.authService.isStudent()
      ) {

        this.currentStudentId = '';
        this.currentUserId = '';

        this.resetState();

        this.profileLoadError = true;

        this.profileMessage =
          'Unable to identify your student account.';

        return;
      }

      // Prevent displaying another student's data.

      if (
        this.currentStudentId !== studentId ||
        this.currentUserId !== userId
      ) {
        this.resetState();
      }

      this.currentStudentId = studentId;
      this.currentUserId = userId;

      // Restore locally saved profile first.

      this.restoreCachedProfile(
        userId,
        studentId
      );

      // Monitor connectivity.

      this.initializeNetworkSubscription();

      // Avoid server requests while offline.

      if (!this.isOnline) {

        this.updateOfflineMessage();

        return;
      }

      // Refresh the profile when online.

      await this.loadProfileData();

    } catch (error) {

      if (
        this.destroyed ||
        !this.viewActive
      ) {
        return;
      }

      console.warn(
        'Profile initialization failed:',
        error
      );

      this.profileLoadError = true;

      this.profileMessage = this.hasProfile
        ? 'Showing previously saved profile information.'
        : 'Unable to load your profile information.';

    } finally {

      this.isLoading = false;

      this.refresh();
    }
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
            this.destroyed ||
            !this.viewActive ||
            !changed
          ) {
            return;
          }

          if (!connected) {

            this.loadVersion++;

            this.serverRequest?.abort();

            this.clearReconnectTimer();

            this.isLoading = false;
            this.profileLoadError = false;
            this.contactsLoadError = false;

            this.updateOfflineMessage();

          } else {

            void this.loadProfileData();
          }

          this.refresh();
        });
  }

  private updateOfflineMessage(): void {

    if (this.hasProfile) {

      this.isCachedProfile = true;

      this.profileMessage =
        'Offline mode. Showing saved profile information.';

    } else {

      this.profileMessage =
        'No saved profile is available. Connect to the internet to load your profile.';
    }
  }

  // =========================================
  // PAGE EXIT
  // =========================================

  ionViewWillLeave(): void {

    this.viewActive = false;

    this.loadVersion++;

    this.serverRequest?.abort();

    this.clearReconnectTimer();

    this.networkSub?.unsubscribe();

    this.networkSub = undefined;

    const activeElement =
      document.activeElement;

    if (
      activeElement instanceof HTMLElement &&
      activeElement.closest('app-profile')
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

    this.networkSub?.unsubscribe();
  }

  private refresh(): void {

    if (!this.destroyed) {
      this.cdr.detectChanges();
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
      this.destroyed ||
      !this.viewActive ||
      !this.networkService.isOnline()
    ) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {

      if (
        !this.destroyed &&
        this.viewActive &&
        this.networkService.isOnline()
      ) {
        void this.loadProfileData();
      }

    }, 3000);
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
      this.currentStudentId === studentId &&
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
  // RESET PROFILE STATE
  // =========================================

  private resetState(): void {

    this.student = {
      name: '',
      initials: '',
      studentId: '',
      program: '',
      university: ''
    };

    this.placementDetails = [];
    this.contacts = [];

    this.hasProfile = false;
    this.isCachedProfile = false;

    this.lastUpdated = null;

    this.profileLoadError = false;
    this.contactsLoadError = false;

    this.profileMessage = '';
  }

  // =========================================
  // PROFILE CACHE KEY
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
  // SAVE PROFILE CACHE
  // =========================================

  private saveProfileCache(
    userId: string,
    studentId: string
  ): void {

    if (
      !this.hasProfile ||
      !this.isCurrentIdentity(
        userId,
        studentId
      )
    ) {
      return;
    }

    try {

      const cache: CachedProfile = {

        version: this.cacheVersion,

        userId,
        studentId,

        student: {
          ...this.student
        },

        placementDetails:
          this.placementDetails.map(detail => ({
            ...detail
          })),

        contacts:
          this.contacts.map(contact => ({
            ...contact
          })),

        cachedAt: Date.now()
      };

      localStorage.setItem(
        this.getCacheKey(
          userId,
          studentId
        ),
        JSON.stringify(cache)
      );

      this.lastUpdated = cache.cachedAt;

    } catch (error) {

      console.warn(
        'Unable to save profile cache:',
        error
      );
    }
  }

  // =========================================
  // RESTORE PROFILE CACHE
  // =========================================

  private restoreCachedProfile(
    userId: string,
    studentId: string
  ): boolean {

    if (
      !this.isCurrentIdentity(
        userId,
        studentId
      )
    ) {
      return false;
    }

    try {

      const raw = localStorage.getItem(
        this.getCacheKey(
          userId,
          studentId
        )
      );

      if (!raw) {
        return false;
      }

      const cache =
        JSON.parse(raw) as CachedProfile;

      // Validate the cached identity and structure.

      if (
        !cache ||
        cache.version !== this.cacheVersion ||
        cache.userId !== userId ||
        cache.studentId !== studentId ||
        !cache.student ||
        cache.student.studentId !== studentId ||
        typeof cache.student.name !== 'string' ||
        typeof cache.student.initials !== 'string' ||
        typeof cache.student.program !== 'string' ||
        typeof cache.student.university !== 'string' ||
        !Array.isArray(cache.placementDetails) ||
        !Array.isArray(cache.contacts) ||
        typeof cache.cachedAt !== 'number' ||
        !Number.isFinite(cache.cachedAt)
      ) {
        return false;
      }

      const validPlacement =
        cache.placementDetails.every(detail =>
          detail &&
          typeof detail.label === 'string' &&
          typeof detail.value === 'string'
        );

      const validContacts =
        cache.contacts.every(contact =>
          contact &&
          typeof contact.id === 'number' &&
          typeof contact.name === 'string' &&
          typeof contact.initials === 'string' &&
          typeof contact.role === 'string' &&
          (
            contact.email === undefined ||
            typeof contact.email === 'string'
          )
        );

      if (!validPlacement || !validContacts) {
        return false;
      }

      this.student = {
        ...cache.student
      };

      this.placementDetails =
        cache.placementDetails.map(detail => ({
          ...detail
        }));

      this.contacts =
        cache.contacts.map(contact => ({
          ...contact
        }));

      this.lastUpdated = cache.cachedAt;

      this.hasProfile = true;
      this.isCachedProfile = true;

      return true;

    } catch (error) {

      console.warn(
        'Unable to restore profile cache:',
        error
      );

      return false;
    }
  }

  // =========================================
  // REMOVE PROFILE CACHE
  // =========================================

  private removeProfileCache(
    userId: string,
    studentId: string
  ): void {

    try {

      localStorage.removeItem(
        this.getCacheKey(
          userId,
          studentId
        )
      );

    } catch (error) {

      console.warn(
        'Unable to remove profile cache:',
        error
      );
    }
  }

  // =========================================
  // LOAD PROFILE DATA
  // =========================================

  async loadProfileData(): Promise<void> {

    const studentId =
      this.authService.getStudentId();

    const userId =
      this.authService.getCurrentUser()?.id;

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

    this.isOnline =
      this.networkService.isOnline();

    // =======================================
    // OFFLINE MODE
    // =======================================

    if (!this.isOnline) {

      this.restoreCachedProfile(
        userId,
        studentId
      );

      this.updateOfflineMessage();

      this.isLoading = false;

      this.refresh();

      return;
    }

    // =======================================
    // SESSION REVALIDATION
    // =======================================

    if (this.authService.isOfflineSession()) {

      this.profileMessage =
        'Reconnecting. Showing saved profile information if available.';

      this.isLoading = false;

      this.scheduleReconnectRefresh();

      this.refresh();

      return;
    }

    // =======================================
    // ONLINE MODE
    // =======================================

    const version = ++this.loadVersion;

    this.serverRequest?.abort();

    this.clearReconnectTimer();

    const controller = new AbortController();

    this.serverRequest = controller;

    this.isLoading = true;
    this.profileLoadError = false;
    this.contactsLoadError = false;

    try {

      // Only request confirmed students columns.

      const {
        data: studentData,
        error
      } = await this.supabase

        .from('students')

        .select(`
          id,
          full_name,
          student_id,
          course,
          school_name,
          company_name,
          company_location,
          department,
          ojt_start_date,
          required_hours
        `)

        .eq('student_id', studentId)

        .abortSignal(controller.signal)

        .maybeSingle();

      // Ignore outdated requests.

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

      // No accessible student record.

      if (!studentData) {

        this.removeProfileCache(
          userId,
          studentId
        );

        this.resetState();

        this.profileLoadError = true;

        this.profileMessage =
          'Your student profile could not be found. Please contact your OJT Coordinator.';

        return;
      }

      // =====================================
      // STUDENT INFORMATION
      // =====================================

      const fullName =
        studentData.full_name || 'Unknown';

      this.student = {

        name: fullName,

        initials:
          this.generateInitials(fullName),

        studentId,

        program:
          studentData.course || 'N/A',

        university:
          studentData.school_name ||
          'Pamantasan ng Lungsod ng Valenzuela'
      };

      // =====================================
      // OJT PLACEMENT
      // =====================================

      this.placementDetails = [

        {
          label: 'Company',

          value:
            studentData.company_name ||
            'Not assigned'
        },

        {
          label: 'Department',

          value:
            studentData.department ||
            'Not specified'
        },

        {
          label: 'Start Date',

          value:
            this.formatStartDate(
              studentData.ojt_start_date
            )
        },

        {
          label: 'Required Hours',

          value:
            studentData.required_hours == null
              ? 'Not set'
              : `${studentData.required_hours} hrs`
        }
      ];

      // =====================================
      // SAVE BASIC PROFILE INFORMATION
      // =====================================

      this.hasProfile = true;
      this.isCachedProfile = false;

      this.profileLoadError = false;

      this.profileMessage = '';

      this.lastUpdated = Date.now();

      // Do not retain potentially outdated contacts
      // after refreshing the student profile.

      this.contacts = [];

      this.saveProfileCache(
        userId,
        studentId
      );

      this.refresh();

      // =====================================
      // LOAD ASSIGNED SUPERVISOR CONTACTS
      // =====================================

      await this.loadSupervisorContacts(
        userId,
        studentId,
        version,
        controller.signal
      );

      if (
        !this.isCurrentLoad(
          userId,
          studentId,
          version
        )
      ) {
        return;
      }

      // Persist the completed profile.

      this.saveProfileCache(
        userId,
        studentId
      );

    } catch (error: unknown) {

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
        'Unable to refresh profile information:',
        error
      );

      this.isOnline =
        this.networkService.isOnline();

      // Restore previously saved information.

      if (!this.hasProfile) {

        this.restoreCachedProfile(
          userId,
          studentId
        );
      }

      if (!this.isOnline) {

        this.profileLoadError = false;

        this.updateOfflineMessage();

      } else {

        this.profileLoadError = true;

        if (this.hasProfile) {

          this.isCachedProfile = true;

          this.profileMessage =
            'Unable to refresh profile. Showing previously saved information.';

        } else {

          this.profileMessage =
            'Unable to load your profile. Please try again.';
        }
      }

    } finally {

      if (this.serverRequest === controller) {
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
  // LOAD SUPERVISOR CONTACTS
  // =========================================

  private async loadSupervisorContacts(
    userId: string,
    studentId: string,
    version: number,
    signal: AbortSignal
  ): Promise<void> {

    if (
      !this.isCurrentLoad(
        userId,
        studentId,
        version
      ) ||
      !this.networkService.isOnline()
    ) {
      return;
    }

    try {

      // Retrieve only assigned supervisor contacts
      // through the restricted database function.

      const {
        data,
        error
      } = await this.supabase

        .rpc('get_my_supervisor_contacts')

        .abortSignal(signal);

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

      const supervisors =
        (data ?? []) as SupervisorContact[];

      this.contacts = supervisors

        .filter(supervisor =>
          typeof supervisor.full_name === 'string' &&
          supervisor.full_name.trim().length > 0
        )

        .map((supervisor, index) => ({

          id: index + 1,

          name:
            supervisor.full_name,

          initials:
            this.generateInitials(
              supervisor.full_name
            ),

          role: 'Company Supervisor',

          email:
            supervisor.email || undefined
        }));

      this.contactsLoadError = false;

      // No coordinator contact is added until
      // a valid assignment relationship exists.

    } catch (error: unknown) {

      if (
        !this.isCurrentLoad(
          userId,
          studentId,
          version
        )
      ) {
        return;
      }

      // Contact errors must not prevent the
      // basic student profile from displaying.

      this.contacts = [];

      if (this.networkService.isOnline()) {

        this.contactsLoadError = true;

        this.profileMessage =
          'Profile loaded, but supervisor contacts could not be refreshed.';

        console.warn(
          'Unable to load supervisor contacts:',
          error
        );

      } else {

        this.updateOfflineMessage();
      }
    }
  }

  // =========================================
  // MANUAL PROFILE REFRESH
  // =========================================

  async retryProfile(): Promise<void> {

    const status =
      await this.networkService.refreshStatus();

    this.isOnline = status.connected;

    await this.loadProfileData();
  }

  // =========================================
  // FORMAT START DATE
  // =========================================

  private formatStartDate(
    value: string | null | undefined
  ): string {

    if (!value) {
      return 'Not set';
    }

    const date = new Date(
      /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? `${value}T00:00:00+08:00`
        : value
    );

    if (Number.isNaN(date.getTime())) {
      return 'Not set';
    }

    return date.toLocaleDateString(
      'en-US',
      {
        timeZone: 'Asia/Manila',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      }
    );
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

  // =========================================
  // GENERATE INITIALS
  // =========================================

  private generateInitials(
    name: string
  ): string {

    const parts = name
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (parts.length === 0) {
      return '??';
    }

    if (parts.length >= 2) {

      return (
        parts[0][0] +
        parts[parts.length - 1][0]
      ).toUpperCase();
    }

    return parts[0]
      .substring(0, 2)
      .toUpperCase();
  }

  // =========================================
  // EMAIL CONTACT
  // =========================================

  async emailContact(
    contact: ContactPerson
  ): Promise<void> {

    if (
      !this.isCurrentIdentity(
        this.currentUserId,
        this.currentStudentId
      )
    ) {
      return;
    }

    const currentContact =
      this.contacts.find(item =>
        item.id === contact.id &&
        item.email === contact.email &&
        item.name === contact.name
      );

    if (!currentContact) {
      return;
    }

    const email =
      currentContact.email?.trim();

    if (
      email &&
      /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(email)
    ) {

      window.location.href =
        `mailto:${encodeURIComponent(email)}`;

      return;
    }

    const alert =
      await this.alertController.create({

        header: 'Contact Information',

        message:
          'A valid email address is not available for this contact.',

        buttons: ['OK']
      });

    await alert.present();
  }

  // =========================================
  // LOGOUT
  // =========================================

  async logout(): Promise<void> {

    if (this.isLoggingOut) {
      return;
    }

    this.isLoggingOut = true;

    this.refresh();

    try {

      await this.networkService
        .waitForInitialization();

      // Require connectivity before logout.

      if (!this.networkService.isOnline()) {

        const offlineAlert =
          await this.alertController.create({

            header: 'You’re Offline',

            message:
              'Please connect to the internet before logging out. Your locally saved attendance records will be retained.',

            buttons: ['OK']
          });

        await offlineAlert.present();

        await offlineAlert.onDidDismiss();

        return;
      }

      // Confirm logout.

      const confirmationAlert =
        await this.alertController.create({

          header: 'Log Out',

          message:
            'Are you sure you want to log out?',

          buttons: [

            {
              text: 'Cancel',
              role: 'cancel'
            },

            {
              text: 'Log Out',
              role: 'confirm'
            }
          ]
        });

      await confirmationAlert.present();

      const { role } =
        await confirmationAlert.onDidDismiss();

      if (role !== 'confirm') {
        return;
      }

      // Capture identity before authentication
      // information is cleared.

      const studentId =
        this.currentStudentId;

      const userId =
        this.currentUserId;

      // Prevent outdated profile requests.

      this.loadVersion++;

      this.serverRequest?.abort();

      this.clearReconnectTimer();

      // Sign out through AuthService.

      await this.authService.signOut();

      // Remove the current student's profile cache.

      if (studentId && userId) {

        this.removeProfileCache(
          userId,
          studentId
        );
      }

      // Attendance IndexedDB remains untouched.

      this.currentStudentId = '';
      this.currentUserId = '';

      this.resetState();

    } catch (error: unknown) {

      const errorAlert =
        await this.alertController.create({

          header: 'Unable to Log Out',

          message:
            error instanceof Error
              ? error.message
              : 'Something went wrong. Please try again.',

          buttons: ['OK']
        });

      await errorAlert.present();

      await errorAlert.onDidDismiss();

    } finally {

      this.isLoggingOut = false;

      this.refresh();
    }
  }
}
