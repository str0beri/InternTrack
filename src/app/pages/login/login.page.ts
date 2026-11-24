import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import {
  AlertController,
  IonContent,
  IonIcon,
  Platform
} from '@ionic/angular';

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
    FormsModule,
    RouterLink
  ],
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss']
})
export class LoginPage {

  // =========================================
  // LOGIN CREDENTIALS
  // =========================================

  studentIdOrEmail = '';
  password = '';
  selectedRole = 'student_intern';

  // =========================================
  // FORM STATE
  // =========================================

  showPassword = false;
  errorMessage = '';
  isLoading = false;
  isMobile = false;

  // =========================================
  // SERVICES
  // =========================================

  private readonly alertController = inject(AlertController);
  private readonly authService = inject(AuthService);
  private readonly platform = inject(Platform);

  constructor() {

    addIcons({
      personCircleOutline,
      chevronDownOutline,
      lockClosedOutline,
      eyeOutline,
      eyeOffOutline
    });

    this.checkMobile();
  }

  // =========================================
  // MOBILE DETECTION
  // =========================================

  checkMobile(): void {

    this.isMobile =
      this.platform.is('mobile') ||
      this.platform.is('mobileweb');

    // Mobile application is intended for student interns.
    if (this.isMobile) {
      this.selectedRole = 'student_intern';
    }
  }

  // =========================================
  // PASSWORD VISIBILITY
  // =========================================

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  // =========================================
  // LOGIN
  // =========================================

  async login(): Promise<void> {

    // Prevent duplicate login requests.
    if (this.isLoading) {
      return;
    }

    this.errorMessage = '';

    const identifier = this.studentIdOrEmail.trim();

    // Validate required credentials.
    if (!identifier || !this.password.trim()) {

      this.errorMessage = 'Please enter your credentials.';

      return;
    }

    // New login attempts require internet access.
    if (!this.authService.isOnline()) {

      this.errorMessage =
        'An internet connection is required to log in.';

      return;
    }

    // Mobile login is restricted to student interns.
    const role = this.isMobile
      ? 'student_intern'
      : this.selectedRole;

    // Validate selected role.
    if (
      role !== 'student_intern' &&
      role !== 'company_supervisor' &&
      role !== 'ojt_coordinator'
    ) {

      this.errorMessage = 'Please select a valid role.';

      return;
    }

    this.isLoading = true;

    try {

      let result: {
        success: boolean;
        error?: string;
      };

      // Wait until authentication initialization finishes.
      await this.authService.waitForInitialization();

      // Student login through the existing Edge Function.
      if (role === 'student_intern') {

        result = await this.authService.signInWithStudentId(
          identifier,
          this.password
        );

      } else {

        // Supervisor and coordinator email login.
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

      // Clear sensitive form data after successful login.
      this.password = '';
      this.showPassword = false;
      this.errorMessage = '';

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

      // Always reset the loading state.
      this.isLoading = false;
    }
  }

  // =========================================
  // FORGOT PASSWORD
  // =========================================

  async forgotPassword(): Promise<void> {

    const alert = await this.alertController.create({
      header: 'Forgot Password',
      message:
        'Please contact your OJT Coordinator for assistance with your account.',
      buttons: ['OK']
    });

    await alert.present();
  }

  // =========================================
  // LEGAL INFORMATION
  // =========================================

  async openLegal(title: string): Promise<void> {

    const alert = await this.alertController.create({
      header: title,
      message:
        'This information will be available when the official application policies are finalized.',
      buttons: ['OK']
    });

    await alert.present();
  }
}