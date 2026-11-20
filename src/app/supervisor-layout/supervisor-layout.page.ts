import { Component, inject, OnInit } from '@angular/core';
import { IonIcon } from '@ionic/angular';
import {
  Router,
  RouterOutlet,
  RouterLink,
  RouterLinkActive,
  NavigationEnd,
} from '@angular/router';

import { addIcons } from 'ionicons';
import { logOutOutline } from 'ionicons/icons';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';

import { AuthService } from '../services/auth.service';
import { SupabaseService } from '../services/supabase.service';

// navigation item interface
interface SupervisorNavItem {
  label: string;
  path: string;
}

// supervisor layout
@Component({
  selector: 'app-supervisor-layout',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    IonIcon,
  ],
  templateUrl: './supervisor-layout.page.html',
  styleUrls: ['./supervisor-layout.page.scss'],
  host: {
    class: 'ion-page',
  },
})
export class SupervisorLayoutComponent implements OnInit {

  // router
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly supabaseService = inject(SupabaseService);
  private readonly supabase = this.supabaseService.getClient();

  // sidebar state
  isSidebarOpen = false;

  // current page
  currentPageTitle = 'Dashboard';

  // supervisor info
  supervisorName = 'Loading...';
  supervisorInitials = '??';

  // navigation items
  readonly navItems: SupervisorNavItem[] = [
    {
      label: 'Dashboard',
      path: '/supervisor/dashboard',
    },
    {
      label: 'DTR & Attendance Verification',
      path: '/supervisor/attendance',
    },
    {
      label: 'Weekly Reports',
      path: '/supervisor/reports',
    },
    {
      label: 'Intern Roster & Progress',
      path: '/supervisor/interns',
    },
    {
      label: 'My Profile',
      path: '/supervisor/profile',
    },
  ];

  // initialize routing and icons
  constructor() {

    addIcons({
      logOutOutline,
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
        this.updatePageTitle(event.urlAfterRedirects);
        this.closeSidebar();
      });
  }

  ngOnInit(): void {
    this.loadSupervisorInfo();
  }

  async loadSupervisorInfo(): Promise<void> {
    try {
      const userId = this.authService.getCurrentUser()?.id;
      if (!userId) return;

      const { data: supervisor } = await this.supabase
        .from('company_supervisors')
        .select('full_name')
        .eq('user_id', userId)
        .single();

      if (supervisor) {
        this.supervisorName = supervisor.full_name || 'Supervisor';
        this.supervisorInitials = this.getInitials(supervisor.full_name);
      }
    } catch (error) {
      console.error('Error loading supervisor info:', error);
    }
  }

  private getInitials(name: string): string {
    if (!name) return '??';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  // update page title
  private updatePageTitle(url: string): void {

    const path = url
      .split(/[?#]/)[0]
      .replace(/\/+$/, '');

    const activePage = this.navItems.find(
      item => item.path === path
    );

    this.currentPageTitle = activePage
      ? activePage.label
      : 'Supervisor Workspace';
  }

  // toggle sidebar
  toggleSidebar(): void {
    this.isSidebarOpen = !this.isSidebarOpen;
  }

  // close sidebar
  closeSidebar(): void {
    this.isSidebarOpen = false;
  }

  // logout
  async logout(): Promise<void> {
    await this.authService.signOut();
  }

}
