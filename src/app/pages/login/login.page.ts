import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  AlertController,
  IonContent,
  IonIcon
} from '@ionic/angular';

import { Capacitor } from '@capacitor/core';

import { addIcons } from 'ionicons';

import {
  personCircleOutline,
  lockClosedOutline,
  eyeOutline,
  eyeOffOutline,
  chevronDownOutline
} from 'ionicons/icons';

import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    IonContent,
    IonIcon,
    FormsModule
  ],
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss']
})
export class LoginPage {

  // =========================================
  // PLATFORM
  // =========================================

  readonly isMobile = Capacitor.isNativePlatform();

  // =========================================
  // LOGIN CREDENTIALS
  // =========================================

  studentIdOrEmail = '';
  password = '';

  selectedRole = this.isMobile
    ? 'student_intern'
    : 'company_supervisor';

  // =========================================
  // FORM STATE
  // =========================================

  showPassword = false;
  errorMessage = '';
  isLoading = false;

  // =========================================
  // SERVICES
  // =========================================

  private readonly alertController =
    inject(AlertController);

  private readonly authService =
    inject(AuthService);

  constructor() {

    addIcons({
      personCircleOutline,
      chevronDownOutline,
      lockClosedOutline,
      eyeOutline,
      eyeOffOutline
    });
  }

  // =========================================
  // PASSWORD VISIBILITY
  // =========================================

  togglePassword(): void {

    this.showPassword = !this.showPassword;
  }

  // =========================================
  // FORM CHANGES
  // =========================================

  clearError(): void {

    this.errorMessage = '';
  }

  onRoleChange(): void {

    this.errorMessage = '';
    this.password = '';
    this.showPassword = false;
  }

  // =========================================
  // LOGIN
  // =========================================

  async login(): Promise<void> {

    if (this.isLoading) {
      return;
    }

    this.errorMessage = '';

    const identifier = this.studentIdOrEmail.trim();

    // Validate credentials.

    if (!identifier || !this.password.trim()) {

      this.errorMessage =
        'Please enter your credentials.';

      return;
    }

    // New login attempts require internet access.

    if (!this.authService.isOnline()) {

      this.errorMessage =
        'An internet connection is required to log in.';

      return;
    }

    // Determine the allowed account role.

    const role = this.isMobile
      ? 'student_intern'
      : this.selectedRole;

    const allowedRoles = this.isMobile
      ? ['student_intern']
      : ['company_supervisor', 'ojt_coordinator'];

    if (!allowedRoles.includes(role)) {

      this.errorMessage =
        'This account type is not supported on this platform.';

      return;
    }

    // Validate staff email.

    if (
      !this.isMobile &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)
    ) {

      this.errorMessage =
        'Please enter a valid email address.';

      return;
    }

    this.isLoading = true;

    try {

      await this.authService.waitForInitialization();

      let result: {
        success: boolean;
        error?: string;
      };

      // Student login through the existing Edge Function.

      if (this.isMobile) {

        result = await this.authService.signInWithStudentId(
          identifier,
          this.password
        );

      } else {

        // Staff login through Supabase Authentication.

        result = await this.authService.signIn(
          identifier,
          this.password,
          role
        );
      }

      if (!result.success) {

        this.errorMessage =
          result.error ||
          'Login failed. Please try again.';

        return;
      }

      // Clear sensitive form information.

      this.password = '';
      this.showPassword = false;
      this.errorMessage = '';

      if (this.isMobile) {

        localStorage.setItem(
          'interntrack.onboarded',
          'true'
        );
      }

      // AuthService handles role-based navigation.

    } catch (error: unknown) {

      if (!this.authService.isOnline()) {

        this.errorMessage =
          'Connection lost. Please check your internet connection.';

      } else {

        this.errorMessage =
          'An unexpected error occurred. Please try again.';
      }

    } finally {

      this.isLoading = false;
    }
  }

  // =========================================
  // FORGOT PASSWORD
  // =========================================

  async forgotPassword(): Promise<void> {

    const message =
      this.selectedRole === 'ojt_coordinator'
        ? 'Please contact your system administrator for assistance with your account.'
        : 'Please contact your OJT Coordinator for assistance with your account.';

    const alert = await this.alertController.create({
      header: 'Forgot Password',
      message,
      buttons: ['OK']
    });

    await alert.present();
  }

  // =========================================
  // LEGAL INFORMATION
  // =========================================

  async openLegal(title: string): Promise<void> {

    const privacyPolicy = `
  InternTrack respects the privacy of its users and is designed for academic internship monitoring.

  Information Collected

  The system collects account information, student records, internship assignments, attendance records, attendance photos, GPS coordinates, and weekly accomplishment reports.

  Use of Information

  Collected information is used for attendance verification, internship monitoring, report evaluation, and academic record management.

  Data Access

  Access to personal information is limited according to the user's assigned role. Authorized company supervisors and OJT coordinators may access records necessary for their responsibilities.

  Data Protection

  InternTrack uses authentication and role-based access controls to help protect user information.

  User Rights

  Users may contact their OJT Coordinator to request access to or correction of their personal information.

  Academic Purpose

  InternTrack was developed as an academic final project. Personal information must not be used for unauthorized purposes.
    `.trim();

    const termsAndConditions = `
  By using InternTrack, users agree to the following conditions:

  1. Authorized Use

  InternTrack must only be used for internship monitoring, attendance recording, weekly reporting, and related academic activities.

  2. Account Responsibility

  Users are responsible for protecting their login credentials. Sharing accounts or accessing another user's account without permission is prohibited.

  3. Accuracy of Records

  Student interns must provide accurate attendance records, photos, location information, and weekly reports. Falsification of records is prohibited.

  4. Confidentiality

  Company supervisors and OJT coordinators must handle student information responsibly and maintain its confidentiality.

  5. Internet Connectivity

  Certain student mobile application features may work offline. An internet connection is required for synchronization and online services.

  6. System Availability

  As an academic project, InternTrack may experience technical issues, maintenance, or temporary service interruptions.

  7. Support

  Users should contact their OJT Coordinator or the project developers for system-related concerns.
    `.trim();

    const isPrivacyPolicy =
      title.toLowerCase().includes('privacy');

    const alert = await this.alertController.create({
      header: isPrivacyPolicy
        ? 'Privacy Policy'
        : 'Terms and Conditions',

      subHeader: 'InternTrack',

      message: isPrivacyPolicy
        ? privacyPolicy
        : termsAndConditions,

      cssClass: 'interntrack-legal-alert',

      backdropDismiss: true,

      buttons: [
        {
          text: 'Close',
          role: 'cancel'
        }
      ]
    });

    await alert.present();
  }
}