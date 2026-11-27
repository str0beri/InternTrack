-- ============================================================
-- INTERNTRACK
-- FINAL DATABASE ACCESS PERMISSIONS
-- November 27, 2026
-- ============================================================
-- Intended for database restoration after the final schema.
-- Assumes Supabase roles and postgres-owned objects.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. SCHEMA-LEVEL PERMISSIONS
-- ============================================================

REVOKE ALL ON SCHEMA public
FROM PUBLIC, anon, authenticated, service_role;

GRANT USAGE ON SCHEMA public
TO PUBLIC, postgres, anon, authenticated, service_role;

GRANT USAGE, CREATE ON SCHEMA public
TO pg_database_owner;

REVOKE ALL ON SCHEMA warehouse
FROM PUBLIC, anon, authenticated, service_role;

GRANT ALL ON SCHEMA warehouse TO postgres;

-- ============================================================
-- 2. RESET TABLE AND VIEW PERMISSIONS
-- ============================================================

REVOKE ALL PRIVILEGES ON TABLE
    public.attendance,
    public.audit_logs,
    public.company_supervisors,
    public.intern_supervisor_assignments,
    public.ojt_coordinators,
    public.reports,
    public.students,
    public.users,
    public.student_assignments,
    public.supervisor_interns
FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- 3. AUTHENTICATED USER PERMISSIONS
-- ============================================================

GRANT SELECT, INSERT, UPDATE ON TABLE
    public.attendance,
    public.company_supervisors,
    public.ojt_coordinators,
    public.reports,
    public.students,
    public.users
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.intern_supervisor_assignments
TO authenticated;

-- Read-only audit logs and views

GRANT SELECT ON TABLE
    public.audit_logs,
    public.student_assignments,
    public.supervisor_interns
TO authenticated;

-- ============================================================
-- 4. ADMINISTRATIVE PERMISSIONS
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE,
    REFERENCES, TRIGGER, TRUNCATE
ON TABLE
    public.attendance,
    public.audit_logs,
    public.company_supervisors,
    public.intern_supervisor_assignments,
    public.ojt_coordinators,
    public.reports,
    public.students,
    public.users,
    public.student_assignments,
    public.supervisor_interns
TO postgres, service_role;

-- ============================================================
-- 5. WAREHOUSE TABLE PERMISSIONS
-- ============================================================

REVOKE ALL PRIVILEGES ON TABLE
    warehouse.dim_company,
    warehouse.dim_date,
    warehouse.dim_student,
    warehouse.dim_supervisor,
    warehouse.fact_attendance
FROM PUBLIC, anon, authenticated, service_role;

GRANT ALL PRIVILEGES ON TABLE
    warehouse.dim_company,
    warehouse.dim_date,
    warehouse.dim_student,
    warehouse.dim_supervisor,
    warehouse.fact_attendance
TO postgres;

-- ============================================================
-- 6. VIEW SECURITY
-- ============================================================

ALTER VIEW public.student_assignments
SET (security_invoker = true);

ALTER VIEW public.supervisor_interns
SET (security_invoker = true);

-- ============================================================
-- 7. RESET FUNCTION PERMISSIONS
-- ============================================================

DO $$
DECLARE
    fn RECORD;
BEGIN
    FOR fn IN
        SELECT
            n.nspname AS schema_name,
            p.proname AS function_name,
            pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'warehouse')
          AND p.prokind = 'f'
    LOOP
        EXECUTE format(
            'REVOKE ALL ON FUNCTION %I.%I(%s)
             FROM PUBLIC, anon, authenticated, service_role',
            fn.schema_name,
            fn.function_name,
            fn.args
        );

        EXECUTE format(
            'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO postgres',
            fn.schema_name,
            fn.function_name,
            fn.args
        );

        IF fn.schema_name = 'public' THEN
            EXECUTE format(
                'GRANT EXECUTE ON FUNCTION %I.%I(%s)
                 TO service_role',
                fn.schema_name,
                fn.function_name,
                fn.args
            );
        END IF;
    END LOOP;
END $$;

-- ============================================================
-- 8. AUTHENTICATED FUNCTION PERMISSIONS
-- ============================================================

GRANT EXECUTE ON FUNCTION
    public.calculate_attendance_hours(
        timestamp with time zone,
        timestamp with time zone
    ),
    public.get_assigned_student_uuids(),
    public.get_current_user_role(),
    public.get_internship_analytics(),
    public.get_my_coordinator_contact(),
    public.get_my_internship_details(),
    public.get_my_supervisor_contacts(),
    public.get_student_id(),
    public.get_student_uuid(),
    public.is_coordinator(),
    public.is_student(),
    public.is_supervisor(),
    public.refresh_internship_analytics()
TO authenticated;

-- Management functions

GRANT EXECUTE ON FUNCTION
    public.reassign_student_intern(
        uuid, uuid, date, date, text
    ),
    public.update_coordinator_profile(
        text, text
    ),
    public.update_own_supervisor_profile(
        text, text
    ),
    public.update_student_academic_info(
        uuid, text, text, integer, date, date
    ),
    public.update_supervisor_account_status(
        uuid, text
    ),
    public.update_supervisor_information(
        uuid, text, text, text, text
    )
TO authenticated;

-- ============================================================
-- 9. EXISTING TRIGGER FUNCTION PERMISSIONS
-- ============================================================
-- Preserved from the live database ACL configuration.

GRANT EXECUTE ON FUNCTION
    public.protect_student_report_changes(),
    public.protect_verified_attendance(),
    public.update_updated_at_column()
TO PUBLIC, anon, authenticated;

-- ============================================================
-- 10. WAREHOUSE ETL FUNCTION
-- ============================================================

GRANT EXECUTE ON FUNCTION
    warehouse.refresh_attendance_warehouse()
TO postgres;

COMMIT;

-- ============================================================
-- 11. VERIFICATION QUERIES
-- ============================================================

-- Table and view privileges

SELECT
    table_schema,
    table_name,
    grantee,
    string_agg(
        privilege_type,
        ', ' ORDER BY privilege_type
    ) AS permissions
FROM information_schema.table_privileges
WHERE table_schema IN ('public', 'warehouse')
GROUP BY table_schema, table_name, grantee
ORDER BY table_schema, table_name, grantee;

-- Function privileges

SELECT
    n.nspname AS schema_name,
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS arguments,
    p.proacl::text AS permissions
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'warehouse')
ORDER BY n.nspname, p.proname;

-- Schema privileges

SELECT
    nspname AS schema_name,
    nspacl::text AS permissions
FROM pg_namespace
WHERE nspname IN ('public', 'warehouse');

-- ============================================================
-- END OF FILE
-- ============================================================