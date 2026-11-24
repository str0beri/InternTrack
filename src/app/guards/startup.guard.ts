import { inject } from '@angular/core';

import {
  type CanActivateFn,
  Router
} from '@angular/router';

import { AuthService } from '../services/auth.service';

export const startupGuard: CanActivateFn = async () => {

  const authService = inject(AuthService);
  const router = inject(Router);

  // Wait until authentication initialization is complete.
  await authService.waitForInitialization();

  // Restore an existing authenticated session.
  if (authService.isAuthenticated()) {

    // Existing authenticated users have passed onboarding.
    localStorage.setItem(
      'interntrack.onboarded',
      'true'
    );

    if (authService.isStudent()) {
      return router.createUrlTree(['/tabs/home']);
    }

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

  // Check whether onboarding has already been completed.
  const hasCompletedOnboarding =
    localStorage.getItem('interntrack.onboarded') === 'true';

  if (hasCompletedOnboarding) {
    return router.createUrlTree(['/login']);
  }

  // First-time users.
  return router.createUrlTree([
    '/onboarding/welcome'
  ]);
};