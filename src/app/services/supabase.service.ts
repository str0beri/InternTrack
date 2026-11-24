import { Injectable } from '@angular/core';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

@Injectable({
  providedIn: 'root'
})
export class SupabaseService {

  private readonly supabaseUrl =
    'https://itteqwekmszlssyordpf.supabase.co';

  private readonly supabaseAnonKey =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0dGVxd2VrbXN6bHNzeW9yZHBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1MjI4MDgsImV4cCI6MjEwOTA5ODgwOH0.0MAGcWgabDQTO3NsOazbCTIDSSku5GHfcdGBYDJ3Ft4';

  private readonly supabase: SupabaseClient;

  constructor() {

    this.supabase = createClient(
      this.supabaseUrl,
      this.supabaseAnonKey,
      {
        auth: {

          // Preserve authentication sessions
          // across application restarts.
          persistSession: true,

          // AuthService manages automatic token
          // refresh based on network connectivity.
          autoRefreshToken: false,

          // Preserve existing authentication
          // callback URL handling.
          detectSessionInUrl: true,

          // Preserve existing local sessions.
          storage: localStorage
        }
      }
    );
  }

  // =========================================
  // SUPABASE CLIENT
  // =========================================

  getClient(): SupabaseClient {

    return this.supabase;
  }

  // =========================================
  // SUPABASE CONFIGURATION
  // =========================================

  getUrl(): string {

    return this.supabaseUrl;
  }

  getAnonKey(): string {

    return this.supabaseAnonKey;
  }
}