
import {
  Component,
  inject,
  OnInit,
  HostListener,
  ChangeDetectorRef,
  ElementRef,
  ViewChild
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
  // LOGOUT DIALOG
  // ==========================================

  @ViewChild('logoutDialog')
  private logoutDialog?: ElementRef<HTMLDialogElement>;

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

  ];

  // ==========================================
  // CONSTRUCTOR
  // ==========================================

  constructor() {

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
  // LOAD SUPERVISOR INFORMATION
  // ==========================================

  async loadSupervisorInfo(): Promise<void> {

    try {

      const userId =
        this.authService.getCurrentUser()?.id;

      if (!userId) {

        this.supervisorName = 'Supervisor';

        this.supervisorInitials = 'S';

        return;

      }

      const {
        data: supervisor,
        error
      } = await this.supabase
        .from('company_supervisors')
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

    const titles = new Set([
      'engr',
      'engineer',
      'dr',
      'mr',
      'mrs',
      'ms',
      'prof',
      'atty'
    ]);

    // Ignore professional titles.

    while (
      parts.length > 1 &&
      titles.has(
        parts[0].toLowerCase().replace(/\./g, '')
      )
    ) {
      parts.shift();
    }

    if (parts.length === 0) {

      return 'S';

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

  // ==========================================
  // UPDATE BREADCRUMB PAGE TITLE
  // ==========================================

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
      path === '/supervisor/profile' ||
      path.startsWith('/supervisor/profile/')
    ) {

      this.currentPageTitle = 'Settings';

      return;

    }

    if (
      path === '/supervisor/evaluations' ||
      path.startsWith('/supervisor/evaluations/')
    ) {

      this.currentPageTitle = 'Evaluations';

      return;

    }

    if (path === '/supervisor') {

      this.currentPageTitle = 'Dashboard';

      return;

    }

    this.currentPageTitle = 'Supervisor Workspace';

  }

  // ==========================================
  // TOGGLE SIDEBAR
  // ==========================================

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

  // ==========================================
  // RESTORE SIDEBAR STATE
  // ==========================================

  private restoreSidebarState(): void {

    try {

      const savedState = localStorage.getItem(
        this.sidebarStorageKey
      );

      if (savedState !== null) {

        this.isSidebarCollapsed =
          savedState === 'true';

        return;

      }

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

    if (this.isLoggingOut) {
      return;
    }

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
  // OPEN LOGOUT CONFIRMATION
  // ==========================================

  openLogoutDialog(): void {

    if (this.isLoggingOut) {
      return;
    }

    this.logoutError = '';

    const dialog = this.logoutDialog?.nativeElement;

    if (dialog && !dialog.open) {

      dialog.showModal();

    }

    this.closeProfileMenu();

    this.cdr.markForCheck();

  }

  // ==========================================
  // CLOSE LOGOUT CONFIRMATION
  // ==========================================

  closeLogoutDialog(): void {

    if (this.isLoggingOut) {
      return;
    }

    this.logoutDialog?.nativeElement.close();

    this.logoutError = '';

    this.cdr.markForCheck();

  }

  // ==========================================
  // HANDLE DIALOG CANCEL
  // ==========================================

  onLogoutDialogCancel(event: Event): void {

    event.preventDefault();

    if (!this.isLoggingOut) {

      this.closeLogoutDialog();

    }

  }

  // ==========================================
  // CONFIRM LOGOUT
  // ==========================================

  async logout(): Promise<void> {

    if (this.isLoggingOut) {
      return;
    }

    // Logout requires an open confirmation dialog.

    if (!this.logoutDialog?.nativeElement.open) {
      return;
    }

    this.logoutError = '';

    if (!this.authService.isOnline()) {

      this.logoutError =
        'Connect to the internet before logging out.';

      this.cdr.markForCheck();

      return;

    }

    this.isLoggingOut = true;

    this.closeProfileMenu();

    this.cdr.markForCheck();

    try {

      await this.authService.signOut();

      this.logoutDialog?.nativeElement.close();

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
