# InternTrack - Remaining Tasks & TODOs

This document outlines all the remaining features and tasks that need to be implemented for the InternTrack OJT Monitoring System.

---

## ✅ COMPLETED FEATURES

### Student Mobile App (Production Ready)
- ✅ Student ID login via Edge Function
- ✅ Real-time profile data
- ✅ Attendance with photo + GPS
- ✅ Offline sync with IndexedDB
- ✅ Photo upload to Supabase Storage
- ✅ Exponential retry backoff
- ✅ DTR with verified/provisional hours
- ✅ Reports with status workflow (draft → pending_review → approved/returned)
- ✅ RLS policies for student data access
- ✅ Custom app icon

### Backend Infrastructure
- ✅ Supabase PostgreSQL database
- ✅ Supabase Auth integration
- ✅ Edge Function for Student ID login
- ✅ Storage bucket for attendance photos
- ✅ RLS policies (row-level security)

---

## 🔴 HIGH PRIORITY - Core Workflows

### 1. Supervisor Features (Currently Mock Data)
**Status:** Web app exists but uses mock data only

**Tasks:**
- [ ] Link supervisors to Supabase Auth users
- [ ] Update `company_supervisors` table `user_id` field
- [ ] Implement supervisor login (email/password)
- [ ] Build supervisor dashboard with real metrics
- [ ] Implement attendance verification (provisional → verified)
- [ ] Implement report review (approve/return with comments)
- [ ] Update supervisor pages to use real Supabase data
- [ ] Enforce RLS for supervisor access (assigned interns only)

**Files to Update:**
- `src/app/pages/supervisor/dashboard/dashboard.page.ts`
- `src/app/pages/supervisor/attendance-review/attendance-review.page.ts`
- `src/app/pages/supervisor/reports-review/reports-review.page.ts`
- `src/app/pages/supervisor/interns/interns.page.ts`
- `src/app/supervisor-layout/supervisor-layout.page.ts`

**Reference:** See `SUPERVISOR_COORDINATOR_AUTH_LINKING.md` for auth linking instructions

---

### 2. Coordinator Features (Basic Shell Only)
**Status:** Web app exists but minimal functionality

**Tasks:**
- [ ] Link coordinators to Supabase Auth users
- [ ] Update `ojt_coordinators` table `user_id` field
- [ ] Implement coordinator login (email/password)
- [ ] Build coordinator dashboard with system-wide metrics
- [ ] Implement intern registration (create student accounts)
- [ ] Implement supervisor registration (create supervisor accounts)
- [ ] Implement intern-supervisor assignment
- [ ] Implement account status management (active/inactive)
- [ ] Update coordinator pages to use real Supabase data
- [ ] Enforce RLS for coordinator access (full access)

**Files to Update:**
- `src/app/pages/coordinator/coordinator.page.ts`
- `src/app/pages/coordinator/coordinator.page.html`
- Create new coordinator sub-pages as needed

**Reference:** See `SUPERVISOR_COORDINATOR_AUTH_LINKING.md` for auth linking instructions

---

### 3. Assignment System
**Status:** Table exists but not used

**Tasks:**
- [ ] Populate `intern_supervisor_assignments` table
- [ ] Create UI for coordinators to assign interns to supervisors
- [ ] Update supervisor dashboard to filter by assigned interns
- [ ] Update RLS policies to enforce assignment-based access
- [ ] Add assignment history/audit trail

**Database Table:**
```sql
intern_supervisor_assignments (
  id UUID PRIMARY KEY,
  student_id UUID REFERENCES students(id),
  supervisor_id UUID REFERENCES company_supervisors(id),
  company_name TEXT NOT NULL,
  status TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
```

---

## 🟡 MEDIUM PRIORITY - Production Features

### 4. Report Workflow Enhancement
**Status:** Student side complete, supervisor side missing

**Tasks:**
- [ ] Implement supervisor report review UI
- [ ] Add approve/return functionality with comments
- [ ] Implement status transitions (pending_review → approved/returned)
- [ ] Add notification system for report status changes
- [ ] Add comment/reply functionality
- [ ] Add report versioning/history

**Database Fields:**
- `reports.status`: draft, pending_review, approved, returned
- `reports.feedback`: supervisor feedback
- `reports.comment_count`: number of comments
- `reports.reviewed_at`: when reviewed
- `reports.reviewing_supervisor_id`: who reviewed

---

### 5. Attendance Verification Workflow
**Status:** Verification status field exists but no UI

**Tasks:**
- [ ] Implement supervisor attendance verification UI
- [ ] Add verify/unverify functionality
- [ ] Track who verified and when (`verified_by`, `verified_at`)
- [ ] Add verification remarks
- [ ] Implement bulk verification for multiple records
- [ ] Add verification status filter in DTR

**Database Fields:**
- `attendance.verification_status`: provisional, verified
- `attendance.verified_by`: supervisor who verified
- `attendance.verified_at`: when verified
- `attendance.remarks`: verification notes

---

### 6. DTR Improvements
**Status:** Basic DTR working, needs enhancements

**Tasks:**
- [ ] Add PDF export functionality
- [ ] Add calendar view (weekly/monthly)
- [ ] Add date range filtering
- [ ] Add summary statistics (total hours, average hours)
- [ ] Add verification status indicators
- [ ] Add export to Excel/CSV
- [ ] Add print-friendly view

---

### 7. Notifications System
**Status:** Not implemented

**Tasks:**
- [ ] Implement email notifications for:
  - Report submitted
  - Report approved/returned
  - Attendance verification
  - Account status changes
- [ ] Implement in-app notifications
- [ ] Add notification preferences
- [ ] Add notification history

---

## 🟢 LOW PRIORITY - Polish & Production Readiness

### 8. Technical Debt
**Status:** Pre-existing issues

**Tasks:**
- [ ] Fix 78 lint errors (mostly in test files and supervisor pages)
- [ ] Fix ARIA accessibility warning in attendance page
- [ ] Add input validation for all forms
- [ ] Add rate limiting for API endpoints
- [ ] Add error monitoring (Sentry, etc.)
- [ ] Add analytics tracking
- [ ] Add unit tests for critical functions
- [ ] Add E2E tests for user workflows

---

### 9. Production Deployment
**Status:** Debug APK only

**Tasks:**
- [ ] Build release APK/AAB
- [ ] Set up app signing
- [ ] Configure ProGuard/R8
- [ ] Add app store assets (screenshots, descriptions)
- [ ] Submit to Google Play Store
- [ ] Submit to Apple App Store (if iOS needed)
- [ ] Set up CI/CD pipeline
- [ ] Configure production environment variables
- [ ] Set up monitoring and alerting

---

### 10. Advanced Features
**Status:** Future enhancements

**Tasks:**
- [ ] Password reset flow
- [ ] Multi-stage verification (supervisor → coordinator)
- [ ] Requirement document uploads
- [ ] Company supervisor dashboard analytics
- [ ] OJT coordinator reporting tools
- [ ] Bulk operations (bulk verify, bulk approve)
- [ ] Integration with school systems
- [ ] Mobile push notifications

---

## 📋 QUICK START GUIDE FOR TEAMMATES

### For Backend Developers:
1. Read `SUPERVISOR_COORDINATOR_AUTH_LINKING.md` for auth linking instructions
2. Review `interntrack_rls_policies.sql` for RLS policy structure
3. Check `supabase/functions/student-login/index.ts` for Edge Function example
4. Update RLS policies after auth linking is complete

### For Frontend Developers:
1. Review student pages as reference implementations:
   - `src/app/pages/homepage/homepage.page.ts`
   - `src/app/pages/attendance/attendance.page.ts`
   - `src/app/pages/dtr/dtr.page.ts`
   - `src/app/pages/reports/reports.page.ts`
2. Follow the same patterns for supervisor/coordinator pages
3. Use `ChangeDetectorRef` and `destroyed` flag for async data loading
4. Use `ionViewWillEnter()` for data loading

### For QA/Testers:
1. Test student workflows thoroughly (already working)
2. Test offline sync scenarios
3. Test RLS enforcement with different roles
4. Prepare test cases for supervisor/coordinator features

---

## 🔗 KEY FILES REFERENCE

### Database Schema
- `interntrack_rls_policies.sql` - RLS policies
- `SUPERVISOR_COORDINATOR_AUTH_LINKING.md` - Auth linking guide
- Various SQL files for schema setup

### Services
- `src/app/services/auth.service.ts` - Authentication
- `src/app/services/supabase.service.ts` - Supabase client
- `src/app/services/offline-sync.service.ts` - Offline sync

### Pages
- Student: `src/app/pages/homepage/`, `attendance/`, `dtr/`, `reports/`, `profile/`
- Supervisor: `src/app/pages/supervisor/`
- Coordinator: `src/app/pages/coordinator/`

### Edge Functions
- `supabase/functions/student-login/index.ts` - Student ID login

---

## 📞 CONTACT & SUPPORT

For questions about:
- **Database schema:** Check SQL files and Supabase dashboard
- **RLS policies:** See `interntrack_rls_policies.sql`
- **Auth linking:** See `SUPERVISOR_COORDINATOR_AUTH_LINKING.md`
- **Offline sync:** See `src/app/services/offline-sync.service.ts`

---

**Last Updated:** November 10, 2026  
**Project Status:** Student app production-ready, supervisor/coordinator features pending
