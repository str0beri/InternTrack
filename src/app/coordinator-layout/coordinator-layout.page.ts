
import {
  Component,
  inject,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  ElementRef,
  ViewChild,
  HostListener
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
  gridOutline,
  peopleOutline,
  personOutline,
  businessOutline,
  calendarOutline,
  documentTextOutline,
  folderOpenOutline,
  settingsOutline,
  logOutOutline,
  chevronDownOutline,
  closeOutline
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

interface CoordinatorNavItem {
  label: string;
  route: string;
  icon: string;
}


// ==========================================
// COMPONENT
// ==========================================

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

export class CoordinatorLayoutPage
  implements OnInit, OnDestroy {


  // =========================================
  // SERVICES
  // =========================================

  private readonly router =
    inject(Router);

  private readonly authService =
    inject(AuthService);

  private readonly supabaseService =
    inject(SupabaseService);

  private readonly cdr =
    inject(ChangeDetectorRef);

  private readonly supabase =
    this.supabaseService.getClient();


  // =========================================
  // VIEW REFERENCES
  // =========================================

  @ViewChild('logoutDialog')
  private logoutDialog?: ElementRef<HTMLDialogElement>;

  @ViewChild('profileDropdown')
  private profileDropdown?: ElementRef<HTMLElement>;

  @ViewChild('profileTrigger')
  private profileTrigger?: ElementRef<HTMLButtonElement>;


  // =========================================
  // LAYOUT STATE
  // =========================================

  isSidebarCollapsed = false;

  isLoggingOut = false;

  isProfileMenuOpen = false;

  logoutError = '';

  profileError = '';

  currentPageTitle = 'Dashboard';

  private destroyed = false;

  private profileLoadVersion = 0;


  // =========================================
  // COORDINATOR INFORMATION
  // =========================================

  coordinatorName = 'Loading...';

  coordinatorInitials = '...';

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
      gridOutline,
      peopleOutline,
      personOutline,
      businessOutline,
      calendarOutline,
      documentTextOutline,
      folderOpenOutline,
      settingsOutline,
      logOutOutline,
      chevronDownOutline,
      closeOutline
    });

    this.updatePageTitle(
      this.router.url
    );

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

        this.refreshView();

      });

  }


  // =========================================
  // INITIALIZATION
  // =========================================

  ngOnInit(): void {

    this.restoreSidebarState();

    void this.loadCoordinatorInfo();

  }

  ngOnDestroy(): void {

    this.destroyed = true;

    this.profileLoadVersion++;

    this.logoutDialog?.nativeElement.close();

  }


  // =========================================
  // PROFILE REQUEST VALIDATION
  // =========================================

  private isCurrentProfileRequest(
    version: number
  ): boolean {

    return (
      !this.destroyed &&
      version === this.profileLoadVersion
    );

  }


  // =========================================
  // LOAD COORDINATOR PROFILE
  // =========================================

  async loadCoordinatorInfo(): Promise<void> {

    const version = ++this.profileLoadVersion;

    this.profileError = '';

    this.coordinatorName = 'Loading...';

    this.coordinatorInitials = '...';

    this.refreshView();

    try {

      await this.authService.waitForInitialization();

      if (!this.isCurrentProfileRequest(version)) {
        return;
      }

      const userId =
        this.authService.getCurrentUser()?.id;

      if (
        !userId ||
        !this.authService.isAuthenticated() ||
        this.authService.getUserRole() !== 'ojt_coordinator'
      ) {

        throw new Error(
          'Coordinator session unavailable.'
        );

      }

      const {
        data: coordinator,
        error
      } = await this.supabase

        .from('ojt_coordinators')

        .select(`
          full_name,
          account_status
        `)

        .eq('user_id', userId)

        .single();

      if (!this.isCurrentProfileRequest(version)) {
        return;
      }

      if (
        this.authService.getCurrentUser()?.id !== userId
      ) {

        return;

      }

      if (error) {
        throw error;
      }

      if (
        !coordinator ||
        coordinator.account_status !== 'active'
      ) {

        throw new Error(
          'Coordinator profile is unavailable.'
        );

      }

      this.coordinatorName =

        coordinator.full_name?.trim() ||

        'OJT Coordinator';

      this.coordinatorInitials =

        this.getInitials(
          this.coordinatorName
        );

    } catch (error) {

      if (!this.isCurrentProfileRequest(version)) {
        return;
      }

      console.error(
        'Unable to load coordinator profile:',
        error
      );

      this.coordinatorName =
        'OJT Coordinator';

      this.coordinatorInitials =
        'OC';

      this.profileError =
        'Unable to load your profile information.';

    } finally {

      if (this.isCurrentProfileRequest(version)) {

        this.refreshView();

      }

    }

  }


  // =========================================
  // GENERATE INITIALS
  // =========================================

  private getInitials(
    name: string
  ): string {

    const parts = name

      .trim()

      .replace(
        /^(Dr|Prof|Mr|Mrs|Ms|Engr|Atty|Arch)\.?\s+/i,
        ''
      )

      .split(/\s+/)

      .filter(Boolean);

    const suffixes = [
      'jr',
      'sr',
      'ii',
      'iii',
      'iv'
    ];

    if (
      parts.length > 1 &&
      suffixes.includes(
        parts[parts.length - 1]
          .replace(/\./g, '')
          .toLowerCase()
      )
    ) {

      parts.pop();

    }

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

  private updatePageTitle(
    url: string
  ): void {

    const path = url

      .split(/[?#]/)[0]

      .replace(/\/+$/, '');

    const activePage =

      this.workspaceNavigation.find(item =>

        path === item.route ||

        path.startsWith(item.route + '/')

      );

    if (activePage) {

      this.currentPageTitle =
        activePage.label;

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

    this.currentPageTitle =
      'Coordinator Workspace';

  }


  // =========================================
  // TOGGLE SIDEBAR
  // =========================================

  toggleSidebar(): void {

    this.isSidebarCollapsed =
      !this.isSidebarCollapsed;

    this.closeProfileMenu();

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

    this.refreshView();

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

      // Start with a collapsed sidebar
      // on narrow screens.

      if (window.innerWidth <= 768) {

        this.isSidebarCollapsed = true;

      }

    } catch {

      this.isSidebarCollapsed =
        window.innerWidth <= 900;

    }

  }


  // =========================================
  // PROFILE DROPDOWN
  // =========================================

  toggleProfileMenu(): void {

    if (this.isLoggingOut) {
      return;
    }

    this.isProfileMenuOpen =
      !this.isProfileMenuOpen;

    this.refreshView();

  }


  closeProfileMenu(): void {

    this.isProfileMenuOpen = false;

    this.refreshView();

  }


  openProfileLogout(): void {

    this.closeProfileMenu();

    this.profileTrigger?.nativeElement.focus();

    this.openLogoutModal();

  }


  // =========================================
  // CLOSE DROPDOWN ON OUTSIDE CLICK
  // =========================================

  @HostListener('document:click', ['$event'])

  onDocumentClick(
    event: MouseEvent
  ): void {

    if (!this.isProfileMenuOpen) {
      return;
    }

    const target = event.target;

    if (
      target instanceof Node &&

      !this.profileDropdown
        ?.nativeElement
        .contains(target)
    ) {

      this.closeProfileMenu();

    }

  }


  // =========================================
  // CLOSE DROPDOWN WITH ESCAPE
  // =========================================

  @HostListener('document:keydown.escape')

  onProfileEscape(): void {

    if (this.isProfileMenuOpen) {

      this.closeProfileMenu();

      this.profileTrigger
        ?.nativeElement
        .focus();

    }

  }


  // =========================================
  // OPEN LOGOUT MODAL
  // =========================================

  openLogoutModal(): void {

    if (this.isLoggingOut) {
      return;
    }

    this.closeProfileMenu();

    this.logoutError = '';

    const dialog =
      this.logoutDialog?.nativeElement;

    if (dialog && !dialog.open) {

      dialog.showModal();

    }

    this.refreshView();

  }


  // =========================================
  // CLOSE LOGOUT MODAL
  // =========================================

  closeLogoutModal(): void {

    if (this.isLoggingOut) {
      return;
    }

    this.logoutDialog
      ?.nativeElement
      .close();

    this.logoutError = '';

    this.refreshView();

  }


  // =========================================
  // LOGOUT ESCAPE KEY
  // =========================================

  onLogoutCancel(
    event: Event
  ): void {

    event.preventDefault();

    if (!this.isLoggingOut) {

      this.closeLogoutModal();

    }

  }


  // =========================================
  // LOGOUT BACKDROP CLICK
  // =========================================

  onLogoutBackdropClick(
    event: MouseEvent
  ): void {

    if (
      event.target ===
      this.logoutDialog?.nativeElement
    ) {

      this.closeLogoutModal();

    }

  }


  // =========================================
  // CONFIRM LOGOUT
  // =========================================

  async logout(): Promise<void> {

    if (
      this.isLoggingOut ||

      !this.logoutDialog?.nativeElement.open
    ) {

      return;

    }

    this.isLoggingOut = true;

    this.logoutError = '';

    this.refreshView();

    try {

      await this.authService.signOut();

      if (!this.authService.isAuthenticated()) {

        const navigated =

          await this.router.navigateByUrl(

            '/login',

            {
              replaceUrl: true
            }

          );

        if (!navigated) {

          throw new Error(
            'Login navigation failed.'
          );

        }

        this.logoutDialog
          ?.nativeElement
          .close();

      } else {

        this.logoutError =
          'Unable to log out. Please try again.';

      }

    } catch (error) {

      console.error(
        'Logout failed:',
        error
      );

      this.logoutError =
        'Unable to finish logging out. Please try again.';

    } finally {

      this.isLoggingOut = false;

      this.refreshView();

    }

  }


  // =========================================
  // REFRESH VIEW
  // =========================================

  private refreshView(): void {

    if (!this.destroyed) {

      this.cdr.markForCheck();

    }

  }

}
