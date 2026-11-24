import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnInit,
  OnDestroy,
  ViewChild,
  inject
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { createClient } from '@supabase/supabase-js';

import { AuthService } from '../../../services/auth.service';
import { SupabaseService } from '../../../services/supabase.service';

interface SupervisorProfile {
  id: string;
  user_id: string | null;
  supervisor_id: string;
  full_name: string;
  email: string;
  company_name: string;
  department: string | null;
  position: string | null;
  contact_number: string | null;
  account_status: string | null;
}

@Component({
  selector: 'app-supervisor-profile',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink
  ],
  templateUrl: './supervisor-profile.page.html',
  styleUrls: ['./supervisor-profile.page.scss']
})
export class ProfilePage implements OnInit, OnDestroy {

  private readonly supabaseService = inject(SupabaseService);
  private readonly supabase = this.supabaseService.getClient();

  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);

  @ViewChild('logoutDialog')
  logoutDialog?: ElementRef<HTMLDialogElement>;

  profile: SupervisorProfile | null = null;

  assignedInterns: number | null = null;

  loading = true;
  loadError = '';

  accountEmail = '';
  lastSignIn = 'Not available';

  currentPassword = '';
  newPassword = '';
  confirmPassword = '';

  saving = false;
  passwordError = '';
  passwordSuccess = '';

  loggingOut = false;
  logoutError = '';

  private destroyed = false;
  private loadVersion = 0;
  private activeUserId: string | null = null;

  ngOnInit(): void {
    void this.loadProfile();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.loadVersion++;
    this.clearPasswordFields();
  }

  // =========================================
  // PROFILE LOADING
  // =========================================

  async loadProfile(): Promise<void> {

    if (this.saving || this.loggingOut) {
      return;
    }

    const version = ++this.loadVersion;

    this.loading = true;
    this.loadError = '';
    this.profile = null;
    this.assignedInterns = null;
    this.activeUserId = null;

    this.accountEmail = '';
    this.lastSignIn = 'Not available';

    this.passwordError = '';
    this.passwordSuccess = '';

    this.clearPasswordFields();
    this.refreshView();

    try {

      await this.authService.waitForInitialization();

      if (this.destroyed || version !== this.loadVersion) {
        return;
      }

      if (!this.authService.isOnline()) {
        throw new Error(
          'An internet connection is required to access Settings.'
        );
      }

      if (
        !this.authService.isAuthenticated() ||
        !this.authService.isSupervisor()
      ) {
        this.authService.redirectBasedOnRole();
        return;
      }

      const currentUser = this.authService.getCurrentUser();

      if (!currentUser?.id) {
        throw new Error('Your account session is unavailable.');
      }

      const userId = currentUser.id;

      // Validate the authenticated user with Supabase.

      const {
        data: userData,
        error: userError
      } = await this.supabase.auth.getUser();

      if (!this.isCurrentRequest(version, userId)) {
        return;
      }

      if (
        userError ||
        !userData.user ||
        userData.user.id !== userId
      ) {
        throw new Error(
          'Unable to verify your session. Please sign in again.'
        );
      }

      // Retrieve the actual supervisor profile.

      const {
        data: supervisor,
        error: supervisorError
      } = await this.supabase
        .from('company_supervisors')
        .select(`
          id,
          user_id,
          supervisor_id,
          full_name,
          email,
          company_name,
          department,
          position,
          contact_number,
          account_status
        `)
        .eq('user_id', userId)
        .maybeSingle();

      if (!this.isCurrentRequest(version, userId)) {
        return;
      }

      if (supervisorError) {
        console.error(
          'Supervisor profile error:',
          supervisorError.message
        );

        throw new Error('Unable to load your supervisor profile.');
      }

      if (!supervisor) {
        throw new Error(
          'Your supervisor profile could not be found. ' +
          'Please contact your OJT Coordinator.'
        );
      }

      if (supervisor.account_status !== 'active') {
        throw new Error(
          'Your supervisor account is not active. ' +
          'Please contact your OJT Coordinator.'
        );
      }

      this.profile = supervisor as SupervisorProfile;
      this.activeUserId = userId;

      this.accountEmail =
        userData.user.email || 'Not available';

      this.lastSignIn = this.formatDateTime(
        userData.user.last_sign_in_at
      );

      // Count unique active intern assignments.

      try {

        const studentIds = new Set<string>();
        const pageSize = 500;

        let offset = 0;

        while (true) {

          const {
            data: assignments,
            error: assignmentError
          } = await this.supabase
            .from('intern_supervisor_assignments')
            .select('id, student_id')
            .eq('supervisor_id', supervisor.id)
            .eq('assignment_status', 'active')
            .not('student_id', 'is', null)
            .order('id', { ascending: true })
            .range(offset, offset + pageSize - 1);

          if (!this.isCurrentRequest(version, userId)) {
            return;
          }

          if (assignmentError) {
            throw assignmentError;
          }

          const records = assignments || [];

          for (const assignment of records) {
            if (assignment.student_id) {
              studentIds.add(assignment.student_id);
            }
          }

          if (records.length === 0) {
            break;
          }

          offset += records.length;

        }

        this.assignedInterns = studentIds.size;

      } catch (error) {

        console.warn(
          'Unable to retrieve assigned interns:',
          error
        );

        this.assignedInterns = null;

      }

    } catch (error) {

      if (
        this.destroyed ||
        version !== this.loadVersion
      ) {
        return;
      }

      this.profile = null;
      this.activeUserId = null;

      this.loadError = error instanceof Error
        ? error.message
        : 'Unable to load your settings. Please try again.';

    } finally {

      if (
        !this.destroyed &&
        version === this.loadVersion
      ) {
        this.loading = false;
        this.refreshView();
      }

    }

  }

  // =========================================
  // PROFILE HELPERS
  // =========================================

  get initials(): string {

    const name = this.profile?.full_name?.trim();

    if (!name) {
      return 'CS';
    }

    const parts = name.split(/\s+/);

    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }

    return (
      parts[0].charAt(0) +
      parts[parts.length - 1].charAt(0)
    ).toUpperCase();

  }

  private formatDateTime(
    value?: string | null
  ): string {

    if (!value) {
      return 'Not available';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return 'Not available';
    }

    const formattedDate = date.toLocaleDateString(
      'en-US',
      {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'Asia/Manila'
      }
    );

    const formattedTime = date.toLocaleTimeString(
      'en-US',
      {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Manila'
      }
    );

    return `${formattedDate} · ${formattedTime}`;

  }

  private isCurrentRequest(
    version: number,
    userId: string
  ): boolean {

    return (
      !this.destroyed &&
      version === this.loadVersion &&
      this.authService.getCurrentUser()?.id === userId &&
      this.authService.isSupervisor() &&
      this.authService.isOnline()
    );

  }

  private hasActiveSupervisorSession(
    userId: string
  ): boolean {

    return (
      !this.destroyed &&
      this.activeUserId === userId &&
      this.authService.getCurrentUser()?.id === userId &&
      this.authService.isAuthenticated() &&
      this.authService.isSupervisor() &&
      this.authService.isOnline()
    );

  }

  // =========================================
  // CHANGE PASSWORD
  // =========================================

  async updatePassword(): Promise<void> {

    if (
      this.saving ||
      this.loggingOut ||
      !this.profile
    ) {
      return;
    }

    this.passwordError = '';
    this.passwordSuccess = '';

    if (!this.authService.isOnline()) {
      this.passwordError =
        'Connect to the internet before changing your password.';
      return;
    }

    const userId = this.activeUserId;

    if (
      !userId ||
      !this.hasActiveSupervisorSession(userId)
    ) {
      this.passwordError =
        'Your session is unavailable. Please sign in again.';
      return;
    }

    if (
      !this.currentPassword ||
      !this.newPassword ||
      !this.confirmPassword
    ) {
      this.passwordError =
        'Please complete all password fields.';
      return;
    }

    if (this.newPassword.length < 8) {
      this.passwordError =
        'Your new password must contain at least 8 characters.';
      return;
    }

    if (this.newPassword !== this.confirmPassword) {
      this.passwordError =
        'The new passwords do not match.';
      return;
    }

    if (this.currentPassword === this.newPassword) {
      this.passwordError =
        'Your new password must be different from your current password.';
      return;
    }

    const currentPassword = this.currentPassword;
    const newPassword = this.newPassword;

    this.saving = true;
    this.refreshView();

    let verificationClient:
      ReturnType<typeof createClient> | null = null;

    try {

      // Retrieve the actual authentication email.

      const {
        data: userData,
        error: userError
      } = await this.supabase.auth.getUser();

      if (
        userError ||
        !userData.user?.email ||
        userData.user.id !== userId ||
        !this.hasActiveSupervisorSession(userId)
      ) {
        throw new Error(
          'Unable to verify your account. Please sign in again.'
        );
      }

      // Temporary client prevents password verification
      // from replacing the application's main session.

      verificationClient = createClient(
        this.supabaseService.getUrl(),
        this.supabaseService.getAnonKey(),
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            storageKey: 'interntrack-password-verification'
          }
        }
      );

      const {
        data: verificationData,
        error: verificationError
      } = await verificationClient.auth.signInWithPassword({
        email: userData.user.email,
        password: currentPassword
      });

      if (verificationError) {

        if (verificationError.code === 'invalid_credentials') {
          throw new Error(
            'Your current password is incorrect.'
          );
        }

        throw new Error(
          'Unable to verify your current password. Please try again.'
        );

      }

      if (
        !verificationData.session ||
        verificationData.user?.id !== userId ||
        !this.hasActiveSupervisorSession(userId)
      ) {
        throw new Error(
          'Your account session has changed. Please sign in again.'
        );
      }

      // Update only the verified user's password.

      const {
        error: updateError
      } = await verificationClient.auth.updateUser({
        password: newPassword
      });

      if (updateError) {
        throw new Error(
          updateError.message ||
          'Unable to update your password.'
        );
      }

      if (
        this.destroyed ||
        this.authService.getCurrentUser()?.id !== userId
      ) {
        return;
      }

      this.clearPasswordFields();

      this.passwordSuccess =
        'Your password has been updated successfully. ' +
        'Use your new password the next time you sign in.';

    } catch (error) {

      if (!this.destroyed) {

        this.passwordError = error instanceof Error
          ? error.message
          : 'Unable to update your password. Please try again.';

      }

    } finally {

      // Revoke only the temporary verification session.

      if (verificationClient) {

        try {

          const { error } =
            await verificationClient.auth.signOut({
              scope: 'local'
            });

          if (error) {
            console.warn(
              'Temporary session cleanup failed:',
              error.message
            );
          }

        } catch {
          console.warn(
            'Unable to clean up temporary verification session.'
          );
        }

      }

      this.saving = false;
      this.refreshView();

    }

  }

  private clearPasswordFields(): void {
    this.currentPassword = '';
    this.newPassword = '';
    this.confirmPassword = '';
  }

  // =========================================
  // LOGOUT CONFIRMATION
  // =========================================

  openLogoutDialog(): void {

    if (this.saving || this.loggingOut) {
      return;
    }

    this.logoutError = '';

    const dialog = this.logoutDialog?.nativeElement;

    if (dialog && !dialog.open) {
      dialog.showModal();
    }

  }

  closeLogoutDialog(): void {

    if (this.loggingOut) {
      return;
    }

    this.logoutDialog?.nativeElement.close();
    this.logoutError = '';

  }

  onDialogCancel(event: Event): void {

    if (this.loggingOut) {
      event.preventDefault();
    }

  }

  async logout(): Promise<void> {

    if (this.loggingOut || this.saving) {
      return;
    }

    this.logoutError = '';

    if (!this.authService.isOnline()) {
      this.logoutError =
        'Connect to the internet before logging out.';
      return;
    }

    this.loggingOut = true;
    this.refreshView();

    try {

      this.clearPasswordFields();

      // Existing AuthService handles session revocation,
      // identity cleanup and navigation to Login.

      await this.authService.signOut();

      this.logoutDialog?.nativeElement.close();

      if (!this.destroyed) {
        await this.router.navigate(
          ['/login'],
          { replaceUrl: true }
        );
      }

    } catch (error) {

      this.logoutError = error instanceof Error
        ? error.message
        : 'Unable to log out. Please try again.';

    } finally {

      this.loggingOut = false;
      this.refreshView();

    }

  }

  // =========================================
  // VIEW UPDATE
  // =========================================

  private refreshView(): void {

    if (!this.destroyed) {
      this.cdr.markForCheck();
    }

  }

}