
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import type { User, Session } from '@supabase/supabase-js';
import { skip } from 'rxjs';

import { SupabaseService } from './supabase.service';
import { NetworkService } from './network.service';

type UserRole =
  | 'student_intern'
  | 'company_supervisor'
  | 'ojt_coordinator';

interface CachedIdentity {
  userId: string;
  role: UserRole;
  studentId: string | null;
  validatedAt: number;
}

interface LoginResult {
  success: boolean;
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  private readonly supabaseService = inject(SupabaseService);
  private readonly supabase = this.supabaseService.getClient();
  private readonly router = inject(Router);
  private readonly networkService = inject(NetworkService);

  private readonly identityCacheKey = 'interntrack_auth_identity';

  // Proposed offline access limit: 24 hours
  private readonly offlineAccessLimit = 24 * 60 * 60 * 1000;

  private currentUser: User | null = null;
  private userRole: UserRole | null = null;
  private studentId: string | null = null;

  private initialized = false;
  private offlineSession = false;
  private loginInProgress = false;

  private initializationPromise: Promise<void>;

  private identityRequest: Promise<boolean> | null = null;
  private identityRequestUserId: string | null = null;

  private sessionGeneration = 0;

  constructor() {

    this.initializationPromise = this.initializeAuth();

    void this.initializeNetworkListener();
  }

  // =========================================
  // CONNECTIVITY
  // =========================================

  isOnline(): boolean {

    return this.networkService.isOnline();
  }

  private async initializeNetworkListener(): Promise<void> {

    await this.networkService.waitForInitialization();

    await this.waitForInitialization();

    this.networkService.online$
      .pipe(skip(1))
      .subscribe(connected => {

        if (connected) {

          this.handleOnline();

        } else {

          this.handleOffline();
        }
      });

    // Reconcile connectivity changes that occurred
    // during authentication initialization.
    if (!this.isOnline()) {

      this.handleOffline();

    } else if (this.offlineSession) {

      this.handleOnline();
    }
  }

  private handleOnline = (): void => {

    void this.restoreOnlineSession();
  };

  private handleOffline = (): void => {

    void this.supabase.auth.stopAutoRefresh();

    this.offlineSession = false;

    if (this.currentUser) {

      this.restoreCachedIdentity(this.currentUser.id);
    }
  };

  // =========================================
  // AUTHENTICATION INITIALIZATION
  // =========================================

  private async initializeAuth(): Promise<void> {

    try {

      // Determine native connectivity before
      // attempting authentication restoration.
      await this.networkService.waitForInitialization();

      // Disable automatic token refresh while offline.
      if (!this.isOnline()) {

        await this.supabase.auth.stopAutoRefresh();
      }

      // Listen for Supabase authentication changes.
      this.supabase.auth.onAuthStateChange(
        (event, session) => {

          if (event === 'SIGNED_OUT') {

            this.clearIdentity();

            return;
          }

          if (!session?.user) {

            return;
          }

          if (
            event === 'SIGNED_IN' ||
            event === 'TOKEN_REFRESHED' ||
            event === 'USER_UPDATED'
          ) {

            // Run outside Supabase's authentication callback.
            setTimeout(() => {

              void this.handleSessionChange(session);

            }, 0);
          }
        }
      );

      // Retrieve the existing Supabase session.
      const { data, error } =
        await this.supabase.auth.getSession();

      if (error || !data.session?.user) {

        if (this.isOnline()) {

          this.clearIdentity();

        } else {

          // Preserve cached identity when session
          // restoration fails while offline.
          this.currentUser = null;
          this.clearRoleAndStudentId(false);
        }

        return;
      }

      this.setCurrentUser(data.session.user);

      if (this.isOnline()) {

        await this.loadUserIdentity(
          data.session.user.id
        );

        if (this.isAuthenticated() && this.isOnline()) {

          await this.supabase.auth.startAutoRefresh();
        }

      } else {

        this.restoreCachedIdentity(
          data.session.user.id
        );
      }

    } catch (error) {

      console.warn(
        'Authentication initialization failed:',
        error
      );

      if (!this.isOnline()) {

        if (this.currentUser) {

          this.restoreCachedIdentity(
            this.currentUser.id
          );

        } else {

          this.clearRoleAndStudentId(false);
        }

      } else {

        this.clearIdentity();
      }

    } finally {

      this.initialized = true;
    }
  }

  async waitForInitialization(): Promise<void> {

    await this.initializationPromise;
  }

  isInitialized(): boolean {

    return this.initialized;
  }

  private setCurrentUser(user: User): void {

    if (this.currentUser?.id !== user.id) {

      this.sessionGeneration++;

      this.userRole = null;
      this.studentId = null;
      this.offlineSession = false;

      localStorage.removeItem('userRole');
      localStorage.removeItem('studentId');
    }

    this.currentUser = user;
  }

  // =========================================
  // AUTHENTICATION STATE CHANGES
  // =========================================

  private async handleSessionChange(
    session: Session
  ): Promise<void> {

    if (this.loginInProgress) {

      return;
    }

    await this.waitForInitialization();

    // Avoid unnecessary session requests while offline.
    if (!this.isOnline()) {

      if (this.currentUser?.id === session.user.id) {

        this.restoreCachedIdentity(session.user.id);
      }

      return;
    }

    const { data } =
      await this.supabase.auth.getSession();

    if (data.session?.user.id !== session.user.id) {

      return;
    }

    this.setCurrentUser(session.user);

    if (!this.isOnline()) {

      this.restoreCachedIdentity(session.user.id);

      return;
    }

    // Avoid repeated identity requests when Supabase
    // emits SIGNED_IN for an existing session.
    if (this.userRole && !this.offlineSession) {

      return;
    }

    await this.loadUserIdentity(session.user.id);
  }

  // =========================================
  // USER IDENTITY
  // =========================================

  private async loadUserIdentity(
    userId: string
  ): Promise<boolean> {

    if (!this.isOnline()) {

      return this.restoreCachedIdentity(userId);
    }

    // Reuse an existing request for the same user.
    if (
      this.identityRequest &&
      this.identityRequestUserId === userId
    ) {

      return this.identityRequest;
    }

    const generation = this.sessionGeneration;

    const request =
      this.fetchUserIdentity(userId, generation);

    this.identityRequest = request;
    this.identityRequestUserId = userId;

    try {

      return await request;

    } finally {

      if (this.identityRequest === request) {

        this.identityRequest = null;
        this.identityRequestUserId = null;
      }
    }
  }

  private async fetchUserIdentity(
    userId: string,
    generation: number
  ): Promise<boolean> {

    try {

      const { data, error } = await this.supabase
        .from('users')
        .select('role, user_id')
        .eq('id', userId)
        .maybeSingle();

      // Ignore stale responses from a previous session.
      if (
        this.currentUser?.id !== userId ||
        this.sessionGeneration !== generation
      ) {

        return false;
      }

      if (error) {

        if (!this.isOnline()) {

          return this.restoreCachedIdentity(userId);
        }

        console.warn(
          'Unable to retrieve user identity:',
          error.message
        );

        this.clearRoleAndStudentId();

        return false;
      }

      if (!data || !this.isValidRole(data.role)) {

        console.warn('No valid user role was found.');

        this.clearRoleAndStudentId();

        return false;
      }

      const role: UserRole = data.role;

      const studentId =
        role === 'student_intern' && data.user_id
          ? String(data.user_id)
          : null;

      if (role === 'student_intern' && !studentId) {

        this.clearRoleAndStudentId();

        return false;
      }

      this.userRole = role;
      this.studentId = studentId;
      this.offlineSession = false;

      this.saveIdentityCache({
        userId,
        role,
        studentId,
        validatedAt: Date.now()
      });

      this.updateLegacyStorage();

      return true;

    } catch (error) {

      if (
        this.currentUser?.id !== userId ||
        this.sessionGeneration !== generation
      ) {

        return false;
      }

      if (!this.isOnline()) {

        return this.restoreCachedIdentity(userId);
      }

      console.warn('User identity request failed:', error);

      this.clearRoleAndStudentId();

      return false;
    }
  }

  private isValidRole(role: unknown): role is UserRole {

    return (
      role === 'student_intern' ||
      role === 'company_supervisor' ||
      role === 'ojt_coordinator'
    );
  }

  // =========================================
  // LOCAL IDENTITY CACHE
  // =========================================

  private saveIdentityCache(
    identity: CachedIdentity
  ): void {

    try {

      localStorage.setItem(
        this.identityCacheKey,
        JSON.stringify(identity)
      );

    } catch (error) {

      console.warn(
        'Unable to cache user identity:',
        error
      );
    }
  }

  private readIdentityCache(): CachedIdentity | null {

    try {

      const raw = localStorage.getItem(
        this.identityCacheKey
      );

      if (!raw) {

        return null;
      }

      const identity = JSON.parse(raw) as CachedIdentity;

      if (
        !identity ||
        typeof identity.userId !== 'string' ||
        !this.isValidRole(identity.role) ||
        typeof identity.validatedAt !== 'number' ||
        !Number.isFinite(identity.validatedAt)
      ) {

        return null;
      }

      return identity;

    } catch {

      return null;
    }
  }

  private restoreCachedIdentity(
    userId: string
  ): boolean {

    const identity = this.readIdentityCache();

    if (
      !identity ||
      !this.currentUser ||
      this.currentUser.id !== userId ||
      identity.userId !== userId
    ) {

      this.clearRoleAndStudentId(false);

      return false;
    }

    const cacheAge =
      Date.now() - identity.validatedAt;

    if (
      cacheAge < 0 ||
      cacheAge > this.offlineAccessLimit
    ) {

      this.clearRoleAndStudentId(false);

      return false;
    }

    // Offline access is limited to student interns.
    if (
      identity.role !== 'student_intern' ||
      typeof identity.studentId !== 'string' ||
      !identity.studentId.trim()
    ) {

      this.clearRoleAndStudentId(false);

      return false;
    }

    this.userRole = 'student_intern';
    this.studentId = identity.studentId;
    this.offlineSession = true;

    this.updateLegacyStorage();

    return true;
  }

  private updateLegacyStorage(): void {

    // Retained for compatibility with existing pages.
    // These values must not independently grant access.

    if (this.userRole) {

      localStorage.setItem(
        'userRole',
        this.userRole
      );

    } else {

      localStorage.removeItem('userRole');
    }

    if (this.studentId) {

      localStorage.setItem(
        'studentId',
        this.studentId
      );

    } else {

      localStorage.removeItem('studentId');
    }
  }

  // =========================================
  // ONLINE SESSION RESTORATION
  // =========================================

  private async restoreOnlineSession(): Promise<void> {

    await this.waitForInitialization();

    if (!this.isOnline() || this.loginInProgress) {

      return;
    }

    try {

      await this.supabase.auth.startAutoRefresh();

      const { data, error } =
        await this.supabase.auth.getSession();

      if (error || !data.session?.user) {

        if (this.isOnline()) {

          this.clearIdentity();

          await this.router.navigate(['/login']);
        }

        return;
      }

      // Validate the session with Supabase Auth.
      const {
        data: userData,
        error: userError
      } = await this.supabase.auth.getUser();

      if (userError || !userData.user) {

        if (!this.isOnline()) {

          this.restoreCachedIdentity(
            data.session.user.id
          );

          return;
        }

        this.clearIdentity();

        await this.router.navigate(['/login']);

        return;
      }

      this.setCurrentUser(userData.user);

      const identityLoaded =
        await this.loadUserIdentity(userData.user.id);

      if (!identityLoaded && this.isOnline()) {

        await this.router.navigate(['/login']);
      }

    } catch (error) {

      console.warn(
        'Session restoration failed:',
        error
      );

      if (!this.isOnline() && this.currentUser) {

        this.restoreCachedIdentity(
          this.currentUser.id
        );
      }
    }
  }

  // =========================================
  // EMAIL AND PASSWORD LOGIN
  // =========================================

  async signIn(
    email: string,
    password: string,
    expectedRole?: string
  ): Promise<LoginResult> {

    await this.waitForInitialization();

    if (!this.isOnline()) {

      return {
        success: false,
        error: 'An internet connection is required to log in.'
      };
    }

    if (this.loginInProgress) {

      return {
        success: false,
        error: 'Login is already in progress.'
      };
    }

    this.loginInProgress = true;

    try {

      const { data, error } =
        await this.supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        });

      if (error || !data.user || !data.session) {

        return {
          success: false,
          error: !this.isOnline()
            ? 'Connection lost. Please try again.'
            : error?.message || 'Login failed.'
        };
      }

      return await this.completeLogin(
        data.user,
        expectedRole
      );

    } catch (error: unknown) {

      return {
        success: false,
        error: this.getLoginError(error)
      };

    } finally {

      this.loginInProgress = false;
    }
  }

  // =========================================
  // STUDENT ID LOGIN
  // =========================================

  async signInWithStudentId(
    studentId: string,
    password: string
  ): Promise<LoginResult> {

    await this.waitForInitialization();

    if (!this.isOnline()) {

      return {
        success: false,
        error: 'An internet connection is required to log in.'
      };
    }

    if (this.loginInProgress) {

      return {
        success: false,
        error: 'Login is already in progress.'
      };
    }

    this.loginInProgress = true;

    try {

      const supabaseUrl =
        this.supabaseService.getUrl();

      const anonKey =
        this.supabaseService.getAnonKey();

      const response = await fetch(
        `${supabaseUrl}/functions/v1/student-login`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${anonKey}`,
            'apikey': anonKey
          },
          body: JSON.stringify({
            student_id: studentId.trim(),
            password
          })
        }
      );

      const data = await response.json();

      if (!response.ok || data.error) {

        return {
          success: false,
          error: typeof data.error === 'string'
            ? data.error
            : 'Unable to log in. Please try again.'
        };
      }

      if (!data.access_token || !data.refresh_token) {

        return {
          success: false,
          error: 'Unable to establish a login session.'
        };
      }

      const {
        data: sessionData,
        error: sessionError
      } = await this.supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token
      });

      if (sessionError || !sessionData.session) {

        return {
          success: false,
          error: 'Failed to establish session.'
        };
      }

      return await this.completeLogin(
        sessionData.session.user,
        'student_intern'
      );

    } catch (error: unknown) {

      return {
        success: false,
        error: this.getLoginError(error)
      };

    } finally {

      this.loginInProgress = false;
    }
  }

  // =========================================
  // COMPLETE LOGIN
  // =========================================

  private async completeLogin(
    user: User,
    expectedRole?: string
  ): Promise<LoginResult> {

    this.setCurrentUser(user);

    const identityLoaded =
      await this.loadUserIdentity(user.id);

    if (
      !identityLoaded ||
      this.offlineSession ||
      !this.isOnline()
    ) {

      await this.rejectLogin();

      return {
        success: false,
        error: 'Unable to verify your account. Please try again.'
      };
    }

    if (
      expectedRole &&
      this.userRole !== expectedRole
    ) {

      await this.rejectLogin();

      return {
        success: false,
        error: 'Your account does not match the selected role.'
      };
    }

    await this.supabase.auth.startAutoRefresh();

    this.redirectBasedOnRole();

    return {
      success: true
    };
  }

  private async rejectLogin(): Promise<void> {

    try {

      const { error } =
        await this.supabase.auth.signOut({
          scope: 'local'
        });

      if (error) {

        console.warn(
          'Session cleanup failed:',
          error.message
        );
      }

    } finally {

      this.clearIdentity();
    }
  }

  private getLoginError(error: unknown): string {

    if (!this.isOnline() || error instanceof TypeError) {

      return 'Unable to connect. Check your internet connection.';
    }

    return 'Login failed. Please try again.';
  }

  // =========================================
  // LOGOUT
  // =========================================

  async signOut(): Promise<void> {

    await this.waitForInitialization();

    // Require connectivity for reliable session revocation.
    // IndexedDB attendance records are not deleted.

    if (!this.isOnline()) {

      throw new Error(
        'Connect to the internet before logging out.'
      );
    }

    const { error } =
      await this.supabase.auth.signOut({
        scope: 'local'
      });

    if (error) {

      throw new Error(
        'Unable to log out. Please try again.'
      );
    }

    this.clearIdentity();

    await this.router.navigate(['/login']);
  }

  private clearRoleAndStudentId(
    removeCache = true
  ): void {

    this.userRole = null;
    this.studentId = null;
    this.offlineSession = false;

    localStorage.removeItem('userRole');
    localStorage.removeItem('studentId');

    if (removeCache) {

      localStorage.removeItem(this.identityCacheKey);
    }
  }

  private clearIdentity(): void {

    this.sessionGeneration++;

    this.currentUser = null;

    this.clearRoleAndStudentId();
  }

  // =========================================
  // PUBLIC AUTHENTICATION METHODS
  // =========================================

  getCurrentUser(): User | null {

    return this.currentUser;
  }

  getStudentId(): string | null {

    return this.isAuthenticated()
      ? this.studentId
      : null;
  }

  getUserRole(): string | null {

    return this.isAuthenticated()
      ? this.userRole
      : null;
  }

  isAuthenticated(): boolean {

    if (!this.currentUser || !this.userRole) {

      return false;
    }

    if (!this.isOnline() || this.offlineSession) {

      const identity = this.readIdentityCache();

      if (
        !identity ||
        identity.userId !== this.currentUser.id ||
        identity.role !== 'student_intern' ||
        this.userRole !== 'student_intern' ||
        identity.studentId !== this.studentId ||
        !this.studentId
      ) {

        return false;
      }

      const age = Date.now() - identity.validatedAt;

      return (
        age >= 0 &&
        age <= this.offlineAccessLimit
      );
    }

    return true;
  }

  isOfflineSession(): boolean {

    return (
      this.offlineSession &&
      this.isAuthenticated()
    );
  }

  isStudent(): boolean {

    return this.getUserRole() === 'student_intern';
  }

  isSupervisor(): boolean {

    return this.getUserRole() === 'company_supervisor';
  }

  isCoordinator(): boolean {

    return this.getUserRole() === 'ojt_coordinator';
  }

  // =========================================
  // ROLE-BASED NAVIGATION
  // =========================================

  redirectBasedOnRole(): void {

    if (!this.isAuthenticated()) {

      void this.router.navigate(['/login']);

      return;
    }

    switch (this.userRole) {

      case 'student_intern':

        void this.router.navigate(['/tabs/home']);

        break;

      case 'company_supervisor':

        void this.router.navigate([
          '/supervisor/dashboard'
        ]);

        break;

      case 'ojt_coordinator':

        void this.router.navigate([
          '/coordinator'
        ]);

        break;

      default:

        void this.router.navigate(['/login']);
    }
  }
}
