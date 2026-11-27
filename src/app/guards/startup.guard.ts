import { inject } from '@angular/core';

import {
  type CanActivateFn,
  Router
} from '@angular/router';

import { Capacitor } from '@capacitor/core';

import { AuthService } from '../services/auth.service';

export const startupGuard: CanActivateFn = async () => {

  const authService = inject(AuthService);
  const router = inject(Router);

  const isNativeApp = Capacitor.isNativePlatform();

  await authService.waitForInitialization();

  // =========================================
  // RESTORE AUTHENTICATED SESSION
  // =========================================

  if (authService.isAuthenticated()) {

    // Student mobile application.

    if (isNativeApp && authService.isStudent()) {

      localStorage.setItem(
        'interntrack.onboarded',
        'true'
      );

      return router.createUrlTree(['/tabs/home']);
    }

    // Staff web application.

    if (!isNativeApp && authService.isOnline()) {

      if (authService.isSupervisor()) {

        return router.createUrlTree([
          '/supervisor/dashboard'
        ]);
      }

      if (authService.isCoordinator()) {

        return router.createUrlTree([
          '/coordinator/dashboard'
        ]);
      }
    }

    // Session does not match the current platform.

    return router.createUrlTree(['/login']);
  }

  // =========================================
  // WEB APPLICATION
  // =========================================

  // Staff users do not need student onboarding.

  if (!isNativeApp) {

    return router.createUrlTree(['/login']);
  }

  // =========================================
  // STUDENT MOBILE APPLICATION
  // =========================================

  const hasCompletedOnboarding =
    localStorage.getItem('interntrack.onboarded') === 'true';

  if (hasCompletedOnboarding) {

    return router.createUrlTree(['/login']);
  }

  // First-time mobile users.

  return router.createUrlTree([
    '/onboarding/welcome'
  ]);
};