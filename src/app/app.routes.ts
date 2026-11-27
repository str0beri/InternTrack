import { Routes } from '@angular/router';

import { authGuard } from './guards/auth.guard';
import { startupGuard } from './guards/startup.guard';
import { onboardingGuard } from './guards/onboarding.guard';

export const routes: Routes = [

  // =========================================
  // DEFAULT ROUTE
  // =========================================

  {
    path: '',
    pathMatch: 'full',
    canActivate: [startupGuard],
    loadComponent: () =>
      import('./pages/onboarding/welcome/welcome.page')
        .then(m => m.WelcomePage),
  },

  // =========================================
  // MOBILE ONBOARDING
  // =========================================

  {
    path: 'onboarding/welcome',
    canActivate: [onboardingGuard],
    loadComponent: () =>
      import('./pages/onboarding/welcome/welcome.page')
        .then(m => m.WelcomePage),
  },
  {
    path: 'onboarding/hours',
    canActivate: [onboardingGuard],
    loadComponent: () =>
      import('./pages/onboarding/hours/hours.page')
        .then(m => m.HoursPage),
  },
  {
    path: 'onboarding/all-in-one',
    canActivate: [onboardingGuard],
    loadComponent: () =>
      import('./pages/onboarding/all-in-one/all-in-one.page')
        .then(m => m.AllInOnePage),
  },

  // =========================================
  // AUTHENTICATION
  // =========================================

  {
    path: 'login',
    loadComponent: () =>
      import('./pages/login/login.page')
        .then(m => m.LoginPage),
  },

  // =========================================
  // STUDENT INTERN ROUTES
  // =========================================

  {
    path: 'tabs',

    loadComponent: () =>
      import('./tabs/tabs.page')
        .then(m => m.TabsPage),

    canActivate: [authGuard],
    canActivateChild: [authGuard],

    children: [
      {
        path: '',
        redirectTo: 'home',
        pathMatch: 'full',
      },
      {
        path: 'home',
        loadComponent: () =>
          import('./pages/homepage/homepage.page')
            .then(m => m.HomepagePage),
      },
      {
        path: 'attendance',
        loadComponent: () =>
          import('./pages/attendance/attendance.page')
            .then(m => m.AttendancePage),
      },
      {
        path: 'dtr',
        loadComponent: () =>
          import('./pages/dtr/dtr.page')
            .then(m => m.DtrPage),
      },
      {
        path: 'reports',
        loadComponent: () =>
          import('./pages/reports/reports.page')
            .then(m => m.ReportsPage),
      },
      {
        path: 'profile',
        loadComponent: () =>
          import('./pages/profile/profile.page')
            .then(m => m.ProfilePage),
      },
    ],
  },

  // =========================================
  // COMPANY SUPERVISOR ROUTES
  // =========================================

  {
    path: 'supervisor',

    loadComponent: () =>
      import('./supervisor-layout/supervisor-layout.page')
        .then(m => m.SupervisorLayoutComponent),

    canActivate: [authGuard],
    canActivateChild: [authGuard],

    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full',
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./pages/supervisor/dashboard/dashboard.page')
            .then(m => m.DashboardPage),
      },
      {
        path: 'interns/:studentId',
        loadComponent: () =>
          import('./pages/supervisor/intern-details/intern-details.page')
            .then(m => m.InternDetailsPage),
      },
      {
        path: 'interns',
        pathMatch: 'full',
        loadComponent: () =>
          import('./pages/supervisor/interns/interns.page')
            .then(m => m.InternsPage),
      },
      {
        path: 'attendance/:recordId',
        loadComponent: () =>
          import('./pages/supervisor/attendance-details/attendance-details.page')
            .then(m => m.AttendanceDetailsPage),
      },
      {
        path: 'attendance',
        pathMatch: 'full',
        loadComponent: () =>
          import('./pages/supervisor/attendance-review/attendance-review.page')
            .then(m => m.AttendanceReviewPage),
      },
      {
        path: 'reports/:reportId',
        loadComponent: () =>
          import('./pages/supervisor/report-details/report-details.page')
            .then(m => m.ReportDetailsPage),
      },
      {
        path: 'reports',
        pathMatch: 'full',
        loadComponent: () =>
          import('./pages/supervisor/reports-review/reports-review.page')
            .then(m => m.ReportsReviewPage),
      },
      {
        path: 'profile',
        loadComponent: () =>
          import('./pages/supervisor/profile/supervisor-profile.page')
            .then(m => m.ProfilePage),
      },
    ],
  },

  // =========================================
  // OJT COORDINATOR ROUTES
  // =========================================

  {
    path: 'coordinator',

    loadComponent: () =>
      import('./coordinator-layout/coordinator-layout.page')
        .then(m => m.CoordinatorLayoutPage),

    canActivate: [authGuard],
    canActivateChild: [authGuard],

    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full',
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./pages/coordinator/dashboard/dashboard.page')
            .then(m => m.DashboardPage),
      },
      {
        path: 'student-interns/:studentId',
        loadComponent: () =>
          import('./pages/coordinator/student-details/student-details.page')
            .then(m => m.StudentDetailsPage),
      },
      {
        path: 'student-interns',
        pathMatch: 'full',
        loadComponent: () =>
          import('./pages/coordinator/student-interns/student-interns.page')
            .then(m => m.StudentInternsPage),
      },
      {
        path: 'company-supervisors/:supervisorId',
        loadComponent: () =>
          import('./pages/coordinator/supervisor-details/supervisor-details.page')
            .then(m => m.SupervisorDetailsPage),
      },
      {
        path: 'company-supervisors',
        pathMatch: 'full',
        loadComponent: () =>
          import('./pages/coordinator/company-supervisors/company-supervisors.page')
            .then(m => m.CompanySupervisorsPage),
      },
      {
        path: 'internship-assignments',
        loadComponent: () =>
          import('./pages/coordinator/internship-assignments/internship-assignments.page')
            .then(m => m.InternshipAssignmentsPage),
      },
      {
        path: 'attendance/:recordId',
        loadComponent: () =>
          import('./pages/coordinator/attendance-details/attendance-details.page')
            .then(m => m.AttendanceDetailsPage),
      },
      {
        path: 'attendance',
        pathMatch: 'full',
        loadComponent: () =>
          import('./pages/coordinator/attendance-monitoring/attendance-monitoring.page')
            .then(m => m.AttendanceMonitoringPage),
      },
      {
        path: 'reports/:reportId',
        loadComponent: () =>
          import('./pages/coordinator/report-details/report-details.page')
            .then(m => m.ReportDetailsPage),
      },
      {
        path: 'reports',
        pathMatch: 'full',
        loadComponent: () =>
          import('./pages/coordinator/reports-monitoring/reports-monitoring.page')
            .then(m => m.ReportsMonitoringPage),
      },
      {
        path: 'reports-records',
        loadComponent: () =>
          import('./pages/coordinator/reports-records/reports-records.page')
            .then(m => m.ReportsRecordsPage),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./pages/coordinator/settings/settings.page')
            .then(m => m.SettingsPage),
      },
    ],
  },

  // =========================================
  // UNKNOWN ROUTES
  // =========================================

  {
    path: '**',
    redirectTo: '',
  },

];