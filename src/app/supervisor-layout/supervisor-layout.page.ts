import {
  Component,
  inject,
  OnInit,
  HostListener,
  ChangeDetectorRef
} from '@angular/core';

import { IonIcon } from '@ionic/angular';

import {
  Router,
  RouterOutlet,
  RouterLink,
  RouterLinkActive,
  NavigationEnd
} from '@angular/router';

import { addIcons } from 'ionicons';

import {
  gridOutline,
  peopleOutline,
  calendarOutline,
  documentTextOutline,
  clipboardOutline,
  settingsOutline,
  logOutOutline,
  chevronDownOutline
} from 'ionicons/icons';

import {
  takeUntilDestroyed
} from '@angular/core/rxjs-interop';

import { filter } from 'rxjs';

import { AuthService } from '../services/auth.service';
import { SupabaseService } from '../services/supabase.service';


// ==========================================
// NAVIGATION INTERFACE
// ==========================================

interface SupervisorNavItem {
  label: string;
  route: string;
  icon: string;
}


// ==========================================
// SUPERVISOR LAYOUT COMPONENT
// ==========================================

@Component({
  selector: 'app-supervisor-layout',

  standalone: true,

  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    IonIcon
  ],

  templateUrl: './supervisor-layout.page.html',

  styleUrls: ['./supervisor-layout.page.scss'],

  host: {
    class: 'ion-page'
  }
})
export class SupervisorLayoutComponent implements OnInit {

  // ==========================================
  // SERVICES
  // ==========================================

  private readonly router = inject(Router);

  private readonly authService = inject(AuthService);

  private readonly supabaseService = inject(SupabaseService);

  private readonly cdr = inject(ChangeDetectorRef);

  private readonly supabase =
    this.supabaseService.getClient();


  // ==========================================
  // LAYOUT STATE
  // ==========================================

  isSidebarCollapsed = false;

  isProfileMenuOpen = false;

  isLoggingOut = false;

  logoutError = '';


  // ==========================================
  // CURRENT PAGE
  // ==========================================

  currentPageTitle = 'Dashboard';


  // ==========================================
  // SUPERVISOR INFORMATION
  // ==========================================

  supervisorName = 'Loading...';

  supervisorInitials = '...';


  // ==========================================
  // ACADEMIC INFORMATION
  // ==========================================

  // These will be connected to the actual
  // academic period data source once confirmed.

  academicYear = '';

  semester = '';


  // ==========================================
  // SIDEBAR PREFERENCE
  // ==========================================

  private readonly sidebarStorageKey =
    'interntrack.supervisor.sidebarCollapsed';


  // ==========================================
  // WORKSPACE NAVIGATION
  // ==========================================

  readonly workspaceNavigation: SupervisorNavItem[] = [

    {
      label: 'Dashboard',
      route: '/supervisor/dashboard',
      icon: 'grid-outline'
    },

    {
      label: 'My Interns',
      route: '/supervisor/interns',
      icon: 'people-outline'
    },

    {
      label: 'Attendance',
      route: '/supervisor/attendance',
      icon: 'calendar-outline'
    },

    {
      label: 'Weekly Reports',
      route: '/supervisor/reports',
      icon: 'document-text-outline'
    }

    // Evaluations will be added here after
    // confirming its existing route.

  ];


  // ==========================================
  // CONSTRUCTOR
  // ==========================================

  constructor() {

    // Register navigation icons.

    addIcons({
      gridOutline,
      peopleOutline,
      calendarOutline,
      documentTextOutline,
      clipboardOutline,
      settingsOutline,
      logOutOutline,
      chevronDownOutline
    });


    // Set the initial breadcrumb.

    this.updatePageTitle(this.router.url);


    // Listen for navigation changes.

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

        this.closeProfileMenu();

        this.cdr.markForCheck();

      });

  }


  // ==========================================
  // INITIALIZATION
  // ==========================================

  ngOnInit(): void {

    this.restoreSidebarState();

    void this.loadSupervisorInfo();

  }


  // ==========================================
  // LOAD ACTUAL SUPERVISOR INFORMATION
  // ==========================================

  async loadSupervisorInfo(): Promise<void> {

    try {

      // Get the currently authenticated user.

      const userId =
        this.authService.getCurrentUser()?.id;

      if (!userId) {

        this.supervisorName = 'Supervisor';

        this.supervisorInitials = 'S';

        return;

      }


      // Retrieve the actual supervisor account
      // using the existing Supabase table.

      const {
        data: supervisor,
        error
      } = await this.supabase

        .from('company_supervisors')

        .select('full_name')

        .eq('user_id', userId)

        .single();


      // Ignore results if the authenticated
      // account changed during the request.

      if (
        this.authService.getCurrentUser()?.id !== userId
      ) {
        return;
      }


      // Handle Supabase errors.

      if (error) {
        throw error;
      }


      // Display the supervisor's actual name.

      if (supervisor) {

        this.supervisorName =
          supervisor.full_name?.trim() || 'Supervisor';

        this.supervisorInitials =
          this.getInitials(this.supervisorName);

      } else {

        this.supervisorName = 'Supervisor';

        this.supervisorInitials = 'S';

      }

    } catch (error) {

      console.error(
        'Error loading supervisor info:',
        error
      );

      this.supervisorName = 'Supervisor';

      this.supervisorInitials = 'S';

    } finally {

      this.cdr.markForCheck();

    }

  }


  // ==========================================
  // GENERATE SUPERVISOR INITIALS
  // ==========================================

  private getInitials(name: string): string {

    const parts = name
      .trim()
      .split(/\s+/)
      .filter(Boolean);


    // Empty name.

    if (parts.length === 0) {

      return 'S';

    }


    // Single name.

    if (parts.length === 1) {

      return parts[0]
        .substring(0, 2)
        .toUpperCase();

    }


    // First name and last name initials.

    return (

      parts[0][0] +

      parts[parts.length - 1][0]

    ).toUpperCase();

  }


  // ==========================================
  // UPDATE BREADCRUMB PAGE TITLE
  // ==========================================

  private updatePageTitle(url: string): void {

    const path = url

      .split(/[?#]/)[0]

      .replace(/\/+$/, '');


    // Find the current workspace page.

    const activePage =
      this.workspaceNavigation.find(item =>

        path === item.route ||

        path.startsWith(item.route + '/')

      );


    // Workspace page title.

    if (activePage) {

      this.currentPageTitle = activePage.label;

      return;

    }


    // Existing profile route displayed as Settings.

    if (

      path === '/supervisor/profile' ||

      path.startsWith('/supervisor/profile/')

    ) {

      this.currentPageTitle = 'Settings';

      return;

    }


    // Evaluations page title.

    if (

      path === '/supervisor/evaluations' ||

      path.startsWith('/supervisor/evaluations/')

    ) {

      this.currentPageTitle = 'Evaluations';

      return;

    }


    // Default supervisor route.

    if (path === '/supervisor') {

      this.currentPageTitle = 'Dashboard';

      return;

    }


    // Fallback page title.

    this.currentPageTitle = 'Supervisor Workspace';

  }


  // ==========================================
  // TOGGLE SIDEBAR
  // ==========================================

  toggleSidebar(): void {

    this.isSidebarCollapsed =
      !this.isSidebarCollapsed;


    // Save the sidebar preference.

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


  // ==========================================
  // RESTORE SIDEBAR STATE
  // ==========================================

  private restoreSidebarState(): void {

    try {

      const savedState = localStorage.getItem(

        this.sidebarStorageKey

      );


      // Restore the last selected sidebar state.

      if (savedState !== null) {

        this.isSidebarCollapsed =
          savedState === 'true';

        return;

      }


      // Initially collapse on smaller screens.

      this.isSidebarCollapsed =
        window.innerWidth <= 700;

    } catch {

      this.isSidebarCollapsed = false;

    }

  }


  // ==========================================
  // TOGGLE PROFILE DROPDOWN
  // ==========================================

  toggleProfileMenu(event: MouseEvent): void {

    event.stopPropagation();

    this.isProfileMenuOpen =
      !this.isProfileMenuOpen;

  }


  // ==========================================
  // CLOSE PROFILE DROPDOWN
  // ==========================================

  closeProfileMenu(): void {

    this.isProfileMenuOpen = false;

  }


  // ==========================================
  // OUTSIDE CLICK
  // ==========================================

  @HostListener('document:click')
  onDocumentClick(): void {

    if (this.isProfileMenuOpen) {

      this.closeProfileMenu();

    }

  }


  // ==========================================
  // ESCAPE KEY
  // ==========================================

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {

    if (this.isProfileMenuOpen) {

      this.closeProfileMenu();

    }

  }


  // ==========================================
  // LOGOUT
  // ==========================================

  async logout(): Promise<void> {

    // Prevent repeated logout requests.

    if (this.isLoggingOut) {
      return;
    }

    this.isLoggingOut = true;

    this.logoutError = '';

    this.closeProfileMenu();

    try {

      // Retain the existing authentication
      // service and logout implementation.

      await this.authService.signOut();

    } catch (error) {

      console.error(
        'Error signing out:',
        error
      );

      this.logoutError =
        'Unable to log out. Please try again.';

    } finally {

      this.isLoggingOut = false;

      this.cdr.markForCheck();

    }

  }

}