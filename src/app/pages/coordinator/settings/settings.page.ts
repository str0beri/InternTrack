
import {
  Component,
  OnInit,
  inject,
  ChangeDetectorRef,
  NgZone
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';

import { addIcons } from 'ionicons';

import {
  personOutline,
  shieldCheckmarkOutline,
  informationCircleOutline,
  createOutline,
  lockClosedOutline,
  eyeOutline,
  eyeOffOutline,
  checkmarkCircleOutline,
  alertCircleOutline,
  refreshOutline,
  closeOutline,
  mailOutline,
  callOutline
} from 'ionicons/icons';

import { SupabaseService } from '../../../services/supabase.service';

type SettingsTab = 'profile' | 'security' | 'about';

interface CoordinatorProfile {
  id: string;
  user_id: string;
  admin_id: string;
  full_name: string;
  email: string;
  contact_number: string | null;
  account_status: string;
  date_created: string | null;
  updated_at: string | null;
}

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonIcon
  ]
})
export class SettingsPage implements OnInit {

  private supabaseService = inject(SupabaseService);
  private supabase = this.supabaseService.getClient();
  private cdr = inject(ChangeDetectorRef);
  private ngZone = inject(NgZone);

  activeTab: SettingsTab = 'profile';

  profile: CoordinatorProfile | null = null;

  isLoading = true;
  isSavingProfile = false;
  isChangingPassword = false;
  isEditingProfile = false;

  errorMessage = '';
  successMessage = '';
  profileError = '';
  passwordError = '';
  passwordSuccess = '';

  editForm = {
    fullName: '',
    contactNumber: ''
  };

  passwordForm = {
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  };

  showCurrentPassword = false;
  showNewPassword = false;
  showConfirmPassword = false;

  constructor() {
    addIcons({
      personOutline,
      shieldCheckmarkOutline,
      informationCircleOutline,
      createOutline,
      lockClosedOutline,
      eyeOutline,
      eyeOffOutline,
      checkmarkCircleOutline,
      alertCircleOutline,
      refreshOutline,
      closeOutline,
      mailOutline,
      callOutline
    });
  }

  ngOnInit(): void {
    void this.loadProfile();
  }

  private refreshView(): void {
    this.ngZone.run(() => {
      this.cdr.detectChanges();
    });
  }

  // =========================================
  // LOAD COORDINATOR PROFILE
  // =========================================

  async loadProfile(): Promise<void> {

    this.isLoading = true;
    this.errorMessage = '';

    try {

      const {
        data: authData,
        error: authError
      } = await this.supabase.auth.getUser();

      if (authError || !authData.user) {
        throw new Error(
          'Your session could not be verified. Please log in again.'
        );
      }

      const { data: user, error: userError } =
        await this.supabase
          .from('users')
          .select('id, role, account_status')
          .eq('id', authData.user.id)
          .single();

      if (
        userError ||
        !user ||
        user.role !== 'ojt_coordinator' ||
        user.account_status !== 'active'
      ) {
        throw new Error(
          'An active coordinator account is required.'
        );
      }

      const { data, error } = await this.supabase
        .from('ojt_coordinators')
        .select(`
          id,
          user_id,
          admin_id,
          full_name,
          email,
          contact_number,
          account_status,
          date_created,
          updated_at
        `)
        .eq('user_id', authData.user.id)
        .eq('account_status', 'active')
        .single();

      if (error || !data) {
        throw new Error(
          'Unable to load your coordinator profile.'
        );
      }

      this.profile = data as CoordinatorProfile;

      this.resetEditForm();

    } catch (error: unknown) {

      this.profile = null;

      this.errorMessage =
        error instanceof Error
          ? error.message
          : 'Unable to load your settings.';

    } finally {

      this.isLoading = false;
      this.refreshView();

    }
  }

  // =========================================
  // NAVIGATION
  // =========================================

  setActiveTab(tab: SettingsTab): void {

    if (
      this.isSavingProfile ||
      this.isChangingPassword
    ) {
      return;
    }

    if (
      this.isEditingProfile &&
      tab !== 'profile'
    ) {
      const confirmed = window.confirm(
        'Discard your unsaved profile changes?'
      );

      if (!confirmed) {
        return;
      }

      this.cancelEditProfile();
    }

    if (tab !== this.activeTab) {
      this.clearPasswordForm();
    }

    this.activeTab = tab;

    this.successMessage = '';
    this.profileError = '';
    this.passwordError = '';
    this.passwordSuccess = '';
  }

  // =========================================
  // PROFILE DISPLAY
  // =========================================

  get fullName(): string {
    return this.profile?.full_name || 'OJT Coordinator';
  }

  get initials(): string {

    const names = this.fullName
      .replace(/^(Dr|Mr|Mrs|Ms|Prof|Engr)\.?\s+/i, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (!names.length) {
      return 'OC';
    }

    if (names.length === 1) {
      return names[0].substring(0, 2).toUpperCase();
    }

    return (
      names[0][0] +
      names[names.length - 1][0]
    ).toUpperCase();
  }

  get coordinatorId(): string {
    return this.profile?.admin_id || 'Not available';
  }

  get emailAddress(): string {
    return this.profile?.email || 'Not available';
  }

  get contactNumber(): string {
    return this.profile?.contact_number || 'Not provided';
  }

  get accountStatus(): string {

    const status = this.profile?.account_status;

    if (!status) {
      return 'Unknown';
    }

    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  formatDate(value: string | null | undefined): string {

    if (!value) {
      return 'Not available';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return 'Not available';
    }

    return date.toLocaleDateString('en-PH', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'Asia/Manila'
    });
  }

  // =========================================
  // EDIT PROFILE
  // =========================================

  private resetEditForm(): void {

    this.editForm = {
      fullName: this.profile?.full_name || '',
      contactNumber: this.profile?.contact_number || ''
    };
  }

  startEditProfile(): void {

    if (!this.profile || this.isSavingProfile) {
      return;
    }

    this.resetEditForm();

    this.profileError = '';
    this.successMessage = '';
    this.isEditingProfile = true;
  }

  cancelEditProfile(): void {

    if (this.isSavingProfile) {
      return;
    }

    this.resetEditForm();

    this.profileError = '';
    this.isEditingProfile = false;
  }

  get isFullNameValid(): boolean {

    const name = this.editForm.fullName.trim();

    return name.length >= 2 && name.length <= 150;
  }

  get isContactNumberValid(): boolean {

    const number = this.editForm.contactNumber.trim();

    if (!number) {
      return true;
    }

    return (
      number.length <= 30 &&
      /^[0-9+() -]+$/.test(number) &&
      number.replace(/\D/g, '').length >= 7
    );
  }

  get hasProfileChanges(): boolean {

    if (!this.profile) {
      return false;
    }

    return (
      this.editForm.fullName.trim() !==
        this.profile.full_name.trim() ||

      this.editForm.contactNumber.trim() !==
        (this.profile.contact_number || '').trim()
    );
  }

  get canSaveProfile(): boolean {

    return (
      !!this.profile &&
      this.isEditingProfile &&
      !this.isSavingProfile &&
      this.isFullNameValid &&
      this.isContactNumberValid &&
      this.hasProfileChanges
    );
  }

  async saveProfile(): Promise<void> {

    if (!this.canSaveProfile) {
      return;
    }

    this.isSavingProfile = true;
    this.profileError = '';
    this.successMessage = '';

    try {

      const { data, error } = await this.supabase.rpc(
        'update_coordinator_profile',
        {
          p_full_name: this.editForm.fullName.trim(),
          p_contact_number:
            this.editForm.contactNumber.trim() || null
        }
      );

      if (error) {
        throw new Error(error.message);
      }

      if (!data?.success || !data?.profile) {
        throw new Error(
          'The profile update could not be confirmed.'
        );
      }

      if (this.profile) {
        this.profile = {
          ...this.profile,
          ...data.profile
        };
      }

      this.resetEditForm();

      this.isEditingProfile = false;

      this.successMessage =
        'Your personal information has been updated successfully.';

      // Notify the coordinator layout.
      window.dispatchEvent(
        new CustomEvent(
          'interntrack:coordinator-profile-updated',
          {
            detail: {
              fullName: this.profile?.full_name
            }
          }
        )
      );

    } catch (error: unknown) {

      this.profileError =
        error instanceof Error
          ? error.message
          : 'Unable to update your profile.';

    } finally {

      this.isSavingProfile = false;
      this.refreshView();

    }
  }

  // =========================================
  // PASSWORD MANAGEMENT
  // =========================================

  get isNewPasswordValid(): boolean {

    const password = this.passwordForm.newPassword;

    return (
      password.length >= 8 &&
      password.trim().length > 0 &&
      new TextEncoder().encode(password).length <= 72
    );
  }

  get passwordsMatch(): boolean {

    return (
      this.passwordForm.newPassword ===
      this.passwordForm.confirmPassword
    );
  }

  get canChangePassword(): boolean {

    return (
      !!this.profile &&
      !this.isChangingPassword &&
      this.passwordForm.currentPassword.length > 0 &&
      this.isNewPasswordValid &&
      this.passwordsMatch &&
      this.passwordForm.currentPassword !==
        this.passwordForm.newPassword
    );
  }

  togglePasswordVisibility(
    field: 'current' | 'new' | 'confirm'
  ): void {

    switch (field) {

      case 'current':
        this.showCurrentPassword =
          !this.showCurrentPassword;
        break;

      case 'new':
        this.showNewPassword =
          !this.showNewPassword;
        break;

      case 'confirm':
        this.showConfirmPassword =
          !this.showConfirmPassword;
        break;
    }
  }

  clearPasswordForm(): void {

    if (this.isChangingPassword) {
      return;
    }

    this.passwordForm = {
      currentPassword: '',
      newPassword: '',
      confirmPassword: ''
    };

    this.showCurrentPassword = false;
    this.showNewPassword = false;
    this.showConfirmPassword = false;

    this.passwordError = '';
    this.passwordSuccess = '';
  }

  async changePassword(): Promise<void> {

    if (!this.canChangePassword) {
      return;
    }

    this.isChangingPassword = true;
    this.passwordError = '';
    this.passwordSuccess = '';

    try {

      const {
        data: authData,
        error: authError
      } = await this.supabase.auth.getUser();

      if (
        authError ||
        !authData.user?.email ||
        authData.user.id !== this.profile?.user_id
      ) {
        throw new Error(
          'Your session could not be verified. Please log in again.'
        );
      }

      // Verify the current password.
      const {
        data: verificationData,
        error: verificationError
      } = await this.supabase.auth.signInWithPassword({
        email: authData.user.email,
        password: this.passwordForm.currentPassword
      });

      if (verificationError) {

        if (
          verificationError.code === 'invalid_credentials'
        ) {
          throw new Error(
            'Your current password is incorrect.'
          );
        }

        throw new Error(
          'Unable to verify your current password. Please try again.'
        );
      }

      if (
        verificationData.user?.id !== authData.user.id
      ) {
        throw new Error(
          'Account verification failed.'
        );
      }

      // Update the authenticated user's password.
      const { error: updateError } =
        await this.supabase.auth.updateUser({
          password: this.passwordForm.newPassword
        });

      if (updateError) {
        throw new Error(updateError.message);
      }

      this.passwordForm = {
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      };

      this.showCurrentPassword = false;
      this.showNewPassword = false;
      this.showConfirmPassword = false;

      this.passwordSuccess =
        'Your password has been changed successfully.';

    } catch (error: unknown) {

      this.passwordError =
        error instanceof Error
          ? error.message
          : 'Unable to change your password.';

    } finally {

      this.isChangingPassword = false;
      this.refreshView();

    }
  }

  // =========================================
  // MESSAGES
  // =========================================

  dismissSuccessMessage(): void {
    this.successMessage = '';
  }

  dismissProfileError(): void {
    this.profileError = '';
  }

  dismissPasswordError(): void {
    this.passwordError = '';
  }

  dismissPasswordSuccess(): void {
    this.passwordSuccess = '';
  }

  retryLoad(): void {
    void this.loadProfile();
  }

}
