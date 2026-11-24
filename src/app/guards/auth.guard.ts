import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = async (route, state) => {

  const authService = inject(AuthService);
  const router = inject(Router);

  // Wait for authentication initialization
  await authService.waitForInitialization();

  // Check authenticated session
  if (!authService.isAuthenticated()) {
    return router.createUrlTree(['/login']);
  }

  // Retrieve identity from AuthService
  const userRole = authService.getUserRole();
  const url = state.url;

  // Reject missing or invalid roles
  if (
    userRole !== 'student_intern' &&
    userRole !== 'company_supervisor' &&
    userRole !== 'ojt_coordinator'
  ) {
    return router.createUrlTree(['/login']);
  }

  // Restrict offline access to student interns
  if (!authService.isOnline() || authService.isOfflineSession()) {

    if (userRole !== 'student_intern') {
      return router.createUrlTree(['/login']);
    }
  }

  // Student routes
  if (url.startsWith('/tabs')) {

    if (userRole !== 'student_intern') {
      return router.createUrlTree(['/login']);
    }
  }

  // Supervisor routes
  if (url.startsWith('/supervisor')) {

    if (userRole !== 'company_supervisor') {
      return router.createUrlTree(['/login']);
    }
  }

  // Coordinator routes
  if (url.startsWith('/coordinator')) {

    if (userRole !== 'ojt_coordinator') {
      return router.createUrlTree(['/login']);
    }
  }

  // Allow authorized access
  return true;
};