import {
  Component,
  inject,
  OnInit,
  ChangeDetectorRef
} from '@angular/core';

import {
  Router,
  RouterOutlet,
  RouterLink,
  RouterLinkActive,
  NavigationEnd
} from '@angular/router';

import { IonIcon } from '@ionic/angular';

import { addIcons } from 'ionicons';

import {
  schoolOutline,
  gridOutline,
  peopleOutline,
  personOutline,
  businessOutline,
  calendarOutline,
  documentTextOutline,
  folderOpenOutline,
  settingsOutline,
  logOutOutline,
  chevronForwardOutline,
  chevronBackOutline
} from 'ionicons/icons';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';

import { AuthService } from '../services/auth.service';
import { SupabaseService } from '../services/supabase.service';

interface CoordinatorNavItem {
  label: string;
  route: string;
  icon: string;
}

@Component({
  selector: 'app-coordinator-layout',
  standalone: true,

  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    IonIcon
  ],

  templateUrl: './coordinator-layout.page.html',
  styleUrls: ['./coordinator-layout.page.scss'],

  host: {
    class: 'ion-page'
  }
})

export class CoordinatorLayoutPage implements OnInit {

  // =========================================
  // SERVICES
  // =========================================

  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly supabaseService = inject(SupabaseService);
  private readonly cdr = inject(ChangeDetectorRef);

  private readonly supabase =
    this.supabaseService.getClient();

  // =========================================
  // LAYOUT STATE
  // =========================================

  isSidebarCollapsed = false;
  isLoggingOut = false;

  logoutError = '';
  profileError = '';

  currentPageTitle = 'Dashboard';

  // =========================================
  // COORDINATOR INFORMATION
  // =========================================

  coordinatorName = 'Loading...';
  coordinatorInitials = '...';

  // Academic period will be connected
  // once its actual data source is available.

  academicYear = '';
  semester = '';

  private readonly sidebarStorageKey =
    'interntrack.coordinator.sidebarCollapsed';

  // =========================================
  // WORKSPACE NAVIGATION
  // =========================================

  readonly workspaceNavigation: CoordinatorNavItem[] = [
    {
      label: 'Dashboard',
      route: '/coordinator/dashboard',
      icon: 'grid-outline'
    },
    {
      label: 'Student Interns',
      route: '/coordinator/student-interns',
      icon: 'people-outline'
    },
    {
      label: 'Company Supervisors',
      route: '/coordinator/company-supervisors',
      icon: 'person-outline'
    },
    {
      label: 'Internship Assignments',
      route: '/coordinator/internship-assignments',
      icon: 'business-outline'
    },
    {
      label: 'Attendance',
      route: '/coordinator/attendance',
      icon: 'calendar-outline'
    },
    {
      label: 'Weekly Reports',
      route: '/coordinator/reports',
      icon: 'document-text-outline'
    },
    {
      label: 'Reports & Records',
      route: '/coordinator/reports-records',
      icon: 'folder-open-outline'
    }
  ];

  // =========================================
  // CONSTRUCTOR
  // =========================================

  constructor() {

    addIcons({
      schoolOutline,
      gridOutline,
      peopleOutline,
      personOutline,
      businessOutline,
      calendarOutline,
      documentTextOutline,
      folderOpenOutline,
      settingsOutline,
      logOutOutline,
      chevronForwardOutline,
      chevronBackOutline
    });

    this.updatePageTitle(this.router.url);

    this.router.events
      .pipe(
        filter(
          (event): event is NavigationEnd =>
            event instanceof NavigationEnd
        ),
        takeUntilDestroyed()
      )
      .subscribe(event => {

        this.updatePageTitle(
          event.urlAfterRedirects
        );

        this.cdr.markForCheck();

      });
  }

  // =========================================
  // INITIALIZATION
  // =========================================

  ngOnInit(): void {

    this.restoreSidebarState();

    void this.loadCoordinatorInfo();

  }

  // =========================================
  // LOAD COORDINATOR PROFILE
  // =========================================

  async loadCoordinatorInfo(): Promise<void> {

    this.profileError = '';

    try {

      await this.authService.waitForInitialization();

      const userId =
        this.authService.getCurrentUser()?.id;

      if (
        !userId ||
        this.authService.getUserRole() !== 'ojt_coordinator'
      ) {
        throw new Error('Coordinator session unavailable.');
      }

      const { data: coordinator, error } =
        await this.supabase
          .from('ojt_coordinators')
          .select('full_name')
          .eq('user_id', userId)
          .single();

      if (
        this.authService.getCurrentUser()?.id !== userId
      ) {
        return;
      }

      if (error) {
        throw error;
      }

      this.coordinatorName =
        coordinator?.full_name?.trim() ||
        'OJT Coordinator';

      this.coordinatorInitials =
        this.getInitials(this.coordinatorName);

    } catch (error) {

      console.error(
        'Unable to load coordinator profile:',
        error
      );

      this.coordinatorName = 'OJT Coordinator';
      this.coordinatorInitials = 'OC';

      this.profileError =
        'Unable to load your profile information.';

    } finally {

      this.cdr.markForCheck();

    }
  }

  // =========================================
  // GENERATE INITIALS
  // =========================================

  private getInitials(name: string): string {

    const parts = name
      .trim()
      .replace(/^(Dr|Prof|Mr|Mrs|Ms|Engr)\.?\s+/i, '')
      .split(/\s+/)
      .filter(Boolean);

    if (parts.length === 0) {
      return 'OC';
    }

    if (parts.length === 1) {
      return parts[0]
        .substring(0, 2)
        .toUpperCase();
    }

    return (
      parts[0][0] +
      parts[parts.length - 1][0]
    ).toUpperCase();

  }

  // =========================================
  // DYNAMIC BREADCRUMB
  // =========================================

  private updatePageTitle(url: string): void {

    const path = url
      .split(/[?#]/)[0]
      .replace(/\/+$/, '');

    const activePage =
      this.workspaceNavigation.find(item =>
        path === item.route ||
        path.startsWith(item.route + '/')
      );

    if (activePage) {

      this.currentPageTitle = activePage.label;

      return;
    }

    if (
      path === '/coordinator/settings' ||
      path.startsWith('/coordinator/settings/')
    ) {

      this.currentPageTitle = 'Settings';

      return;
    }

    if (path === '/coordinator') {

      this.currentPageTitle = 'Dashboard';

      return;
    }

    this.currentPageTitle = 'Coordinator Workspace';

  }

  // =========================================
  // TOGGLE SIDEBAR
  // =========================================

  toggleSidebar(): void {

    this.isSidebarCollapsed =
      !this.isSidebarCollapsed;

    try {

      localStorage.setItem(
        this.sidebarStorageKey,
        String(this.isSidebarCollapsed)
      );

    } catch (error) {

      console.warn(
        'Unable to save sidebar preference:',
        error
      );

    }
  }

  // =========================================
  // RESTORE SIDEBAR PREFERENCE
  // =========================================

  private restoreSidebarState(): void {

    try {

      const savedState =
        localStorage.getItem(
          this.sidebarStorageKey
        );

      this.isSidebarCollapsed =
        savedState !== null
          ? savedState === 'true'
          : window.innerWidth <= 900;

    } catch {

      this.isSidebarCollapsed = false;

    }
  }

  // =========================================
  // LOGOUT
  // =========================================

  async logout(): Promise<void> {

    if (this.isLoggingOut) {
      return;
    }

    const confirmed = window.confirm(
      'Are you sure you want to log out?'
    );

    if (!confirmed) {
      return;
    }

    this.isLoggingOut = true;
    this.logoutError = '';

    try {

      await this.authService.signOut();

      if (!this.authService.isAuthenticated()) {

        await this.router.navigateByUrl(
          '/login',
          { replaceUrl: true }
        );

      } else {

        this.logoutError =
          'Unable to log out. Please try again.';

      }

    } catch (error) {

      console.error('Logout failed:', error);

      this.logoutError =
        'Unable to log out. Please try again.';

    } finally {

      this.isLoggingOut = false;

      this.cdr.markForCheck();

    }
  }
}