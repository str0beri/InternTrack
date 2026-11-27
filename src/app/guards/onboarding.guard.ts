import { inject } from '@angular/core';

import {
  type CanActivateFn,
  Router
} from '@angular/router';

import { Capacitor } from '@capacitor/core';

import { AuthService } from '../services/auth.service';

export const onboardingGuard: CanActivateFn = async () => {

  const router = inject(Router);
  const authService = inject(AuthService);

  // Onboarding is exclusive to the native application.

  if (!Capacitor.isNativePlatform()) {

    return router.createUrlTree(['/login']);
  }

  await authService.waitForInitialization();

  // Authenticated students do not need onboarding.

  if (
    authService.isAuthenticated() &&
    authService.isStudent()
  ) {

    return router.createUrlTree(['/tabs/home']);
  }

  // Skip onboarding if already completed.

  const hasCompletedOnboarding =
    localStorage.getItem('interntrack.onboarded') === 'true';

  if (hasCompletedOnboarding) {

    return router.createUrlTree(['/login']);
  }

  return true;
};