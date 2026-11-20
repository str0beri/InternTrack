import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { mailOutline, personOutline, briefcaseOutline } from 'ionicons/icons';

import { AuthService } from '../../../services/auth.service';
import { SupabaseService } from '../../../services/supabase.service';

interface SupervisorProfile {
  id: string;
  supervisorId: string;
  name: string;
  email: string;
  company: string;
  department: string;
  position: string;
  accountStatus: string;
}

@Component({
  selector: 'app-supervisor-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, IonIcon],
  templateUrl: './supervisor-profile.page.html',
  styleUrls: ['./supervisor-profile.page.scss'],
})
export class SupervisorProfilePage implements OnInit {
  private supabaseService = inject(SupabaseService);
  private supabase = this.supabaseService.getClient();
  private authService = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);

  profile: SupervisorProfile = {
    id: '',
    supervisorId: '',
    name: '',
    email: '',
    company: '',
    department: '',
    position: '',
    accountStatus: ''
  };

  loading = true;
  editing = false;
  editingPassword = false;
  editForm = {
    name: '',
    department: '',
    position: ''
  };
  passwordForm = {
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  };

  ngOnInit(): void {
    addIcons({
      mailOutline,
      personOutline,
      briefcaseOutline
    });
    this.loadProfile();
  }

  async loadProfile(): Promise<void> {
    try {
      this.loading = true;
      const userId = this.authService.getCurrentUser()?.id;

      if (!userId) {
        console.error('No user ID found');
        return;
      }

      const { data: supervisor, error } = await this.supabase
        .from('company_supervisors')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) throw error;

      if (supervisor) {
        this.profile = {
          id: supervisor.id,
          supervisorId: supervisor.supervisor_id || '',
          name: supervisor.full_name || '',
          email: supervisor.email || this.authService.getCurrentUser()?.email || '',
          company: supervisor.company_name || '',
          department: supervisor.department || '',
          position: supervisor.position || '',
          accountStatus: supervisor.account_status || 'active'
        };

        this.editForm = {
          name: this.profile.name,
          department: this.profile.department,
          position: this.profile.position
        };
      }

    } catch (error) {
      console.error('Error loading profile:', error);
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  startEdit(): void {
    this.editing = true;
    this.cdr.detectChanges();
  }

  cancelEdit(): void {
    this.editing = false;
    this.editForm = {
      name: this.profile.name,
      department: this.profile.department,
      position: this.profile.position
    };
    this.cdr.detectChanges();
  }

  startPasswordEdit(): void {
    this.editingPassword = true;
    this.passwordForm = {
      currentPassword: '',
      newPassword: '',
      confirmPassword: ''
    };
    this.cdr.detectChanges();
  }

  cancelPasswordEdit(): void {
    this.editingPassword = false;
    this.passwordForm = {
      currentPassword: '',
      newPassword: '',
      confirmPassword: ''
    };
    this.cdr.detectChanges();
  }

  async changePassword(): Promise<void> {
    if (!this.passwordForm.currentPassword || !this.passwordForm.newPassword || !this.passwordForm.confirmPassword) {
      alert('Please fill in all password fields.');
      return;
    }

    if (this.passwordForm.newPassword !== this.passwordForm.confirmPassword) {
      alert('New password and confirm password do not match.');
      return;
    }

    if (this.passwordForm.newPassword.length < 6) {
      alert('Password must be at least 6 characters long.');
      return;
    }

    try {
      const { error } = await this.supabase.auth.updateUser({
        password: this.passwordForm.newPassword
      });

      if (error) throw error;

      this.editingPassword = false;
      this.passwordForm = {
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      };
      this.cdr.detectChanges();

      alert('Password changed successfully!');
    } catch (error) {
      console.error('Error changing password:', error);
      alert('Failed to change password. Please check your current password and try again.');
    }
  }

  async saveProfile(): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('company_supervisors')
        .update({
          full_name: this.editForm.name,
          department: this.editForm.department,
          position: this.editForm.position,
          updated_at: new Date().toISOString()
        })
        .eq('id', this.profile.id);

      if (error) throw error;

      this.profile.name = this.editForm.name;
      this.profile.department = this.editForm.department;
      this.profile.position = this.editForm.position;
      this.editing = false;
      this.cdr.detectChanges();

      alert('Profile updated successfully!');
    } catch (error) {
      console.error('Error saving profile:', error);
      alert('Failed to update profile. Please try again.');
    }
  }
}
