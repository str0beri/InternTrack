import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';

import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = async (route, state) => {

  const authService = inject(AuthService);
  const router = inject(Router);

  const isNativeApp = Capacitor.isNativePlatform();

  await authService.waitForInitialization();

  if (!authService.isAuthenticated()) {
    return router.createUrlTree(['/login']);
  }

  const userRole = authService.getUserRole();
  const url = state.url;

  // Validate account role.

  if (
    userRole !== 'student_intern' &&
    userRole !== 'company_supervisor' &&
    userRole !== 'ojt_coordinator'
  ) {
    return router.createUrlTree(['/login']);
  }

  // Native application: Student interns only.

  if (isNativeApp && userRole !== 'student_intern') {
    return router.createUrlTree(['/login']);
  }

  // Web application: Staff accounts only.

  if (!isNativeApp && userRole === 'student_intern') {
    return router.createUrlTree(['/login']);
  }

  // Offline access: Native student application only.

  if (
    !authService.isOnline() ||
    authService.isOfflineSession()
  ) {

    if (!isNativeApp || userRole !== 'student_intern') {
      return router.createUrlTree(['/login']);
    }
  }

  // Student intern routes.

  if (url.startsWith('/tabs')) {

    if (!isNativeApp || userRole !== 'student_intern') {
      return router.createUrlTree(['/login']);
    }
  }

  // Company supervisor routes.

  if (url.startsWith('/supervisor')) {

    if (isNativeApp || userRole !== 'company_supervisor') {
      return router.createUrlTree(['/login']);
    }
  }

  // OJT coordinator routes.

  if (url.startsWith('/coordinator')) {

    if (isNativeApp || userRole !== 'ojt_coordinator') {
      return router.createUrlTree(['/login']);
    }
  }

  return true;
};