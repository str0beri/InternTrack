--
-- PostgreSQL database dump
--

\restrict gyVlRAMy4KL7Hi73l3QlsPeHfFkXO9uZzEiRQLdlsN8GaxRry48MHMF5P0saKCM

-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.12

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: warehouse; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA warehouse;


--
-- Name: calculate_attendance_hours(timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_attendance_hours(p_time_in timestamp with time zone, p_time_out timestamp with time zone) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
    v_attendance_date date;
    v_lunch_start timestamptz;
    v_lunch_end timestamptz;
    v_elapsed_seconds numeric;
    v_lunch_seconds numeric;
BEGIN
    IF p_time_in IS NULL OR p_time_out IS NULL THEN
        RETURN NULL;
    END IF;

    IF NOT isfinite(p_time_in)
       OR NOT isfinite(p_time_out)
       OR p_time_out <= p_time_in THEN
        RAISE EXCEPTION 'Invalid attendance time sequence.'
            USING ERRCODE = '22023';
    END IF;

    v_attendance_date :=
        (p_time_in AT TIME ZONE 'Asia/Manila')::date;

    v_lunch_start :=
        (v_attendance_date + TIME '12:00')
        AT TIME ZONE 'Asia/Manila';

    v_lunch_end :=
        (v_attendance_date + TIME '13:00')
        AT TIME ZONE 'Asia/Manila';

    v_elapsed_seconds :=
        EXTRACT(EPOCH FROM (p_time_out - p_time_in));

    v_lunch_seconds :=
        GREATEST(
            0,
            EXTRACT(EPOCH FROM (
                LEAST(p_time_out, v_lunch_end)
                -
                GREATEST(p_time_in, v_lunch_start)
            ))
        );

    RETURN ROUND(
        GREATEST(
            0,
            (v_elapsed_seconds - v_lunch_seconds) / 3600.0
        ),
        6
    );
END;
$$;


--
-- Name: generate_supervisor_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_supervisor_id() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
    v_next_id bigint;
    v_formatted_id text;
BEGIN
    v_next_id := nextval(
        'public.company_supervisor_id_seq'::regclass
    );

    v_formatted_id := 'SUP-' || LPAD(
        v_next_id::text,
        GREATEST(3, LENGTH(v_next_id::text)),
        '0'
    );

    RETURN v_formatted_id;
END;
$$;


--
-- Name: get_assigned_student_uuids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_assigned_student_uuids() RETURNS uuid[]
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
    SELECT COALESCE(
        ARRAY_AGG(isa.student_id),
        '{}'::uuid[]
    )
    FROM public.intern_supervisor_assignments isa
    JOIN public.company_supervisors cs
        ON cs.id = isa.supervisor_id
    JOIN public.users u
        ON u.id = cs.user_id
    WHERE u.id = auth.uid()
      AND u.role = 'company_supervisor'
      AND u.account_status = 'active'
      AND cs.account_status = 'active'
      AND isa.assignment_status = 'active';
$$;


--
-- Name: get_current_user_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_current_user_role() RETURNS text
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
    SELECT u.role
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.account_status = 'active';
$$;


--
-- Name: get_internship_analytics(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_internship_analytics() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
    v_result jsonb;
BEGIN

    -- Coordinator-only authorization
    IF auth.uid() IS NULL
       OR public.is_coordinator() IS NOT TRUE
    THEN
        RAISE EXCEPTION 'Unauthorized analytics access.'
            USING ERRCODE = '42501';
    END IF;

    WITH attendance_summary AS (
        SELECT
            COUNT(*) AS total_records,

            COUNT(*) FILTER (
                WHERE verification_status = 'verified'
            ) AS verified_records,

            COUNT(*) FILTER (
                WHERE verification_status = 'provisional'
            ) AS provisional_records,

            COUNT(*) FILTER (
                WHERE verification_status = 'rejected'
            ) AS rejected_records,

            COUNT(*) FILTER (
                WHERE verification_status IS NULL
                   OR verification_status NOT IN (
                       'verified',
                       'provisional',
                       'rejected'
                   )
            ) AS other_records,

            COALESCE(SUM(verified_hours), 0)
                AS total_verified_hours,

            MIN(date_key) AS period_start,
            MAX(date_key) AS period_end,
            MAX(loaded_at) AS last_refreshed_at

        FROM warehouse.fact_attendance
    ),

    weekly_summary AS (
        SELECT
            DATE_TRUNC(
                'week',
                date_key::timestamp
            )::date AS week_start,

            SUM(verified_hours) AS verified_hours

        FROM warehouse.fact_attendance

        GROUP BY 1
    ),

    student_hours AS (
        SELECT
            s.student_key,
            s.student_id,
            s.full_name,
            s.account_status,
            s.required_hours,

            COALESCE(
                SUM(f.verified_hours),
                0
            ) AS verified_hours

        FROM warehouse.dim_student s

        LEFT JOIN warehouse.fact_attendance f
            ON f.student_key = s.student_key

        GROUP BY
            s.student_key,
            s.student_id,
            s.full_name,
            s.account_status,
            s.required_hours
    ),

    student_progress AS (
        SELECT
            student_id,
            full_name,
            account_status,
            required_hours,
            verified_hours,

            CASE
                WHEN required_hours > 0 THEN
                    GREATEST(
                        required_hours - verified_hours,
                        0
                    )
                ELSE NULL
            END AS remaining_hours,

            CASE
                WHEN required_hours > 0 THEN
                    ROUND(
                        verified_hours * 100.0
                        / required_hours,
                        2
                    )
                ELSE NULL
            END AS completion_percentage

        FROM student_hours
    )

    SELECT jsonb_build_object(

        'summary',
        (
            SELECT jsonb_build_object(
                'total_records',
                total_records,

                'verified_records',
                verified_records,

                'provisional_records',
                provisional_records,

                'rejected_records',
                rejected_records,

                'other_records',
                other_records,

                'total_verified_hours',
                total_verified_hours,

                'verification_rate',
                CASE
                    WHEN total_records > 0 THEN
                        ROUND(
                            verified_records * 100.0
                            / total_records,
                            2
                        )
                    ELSE 0
                END,

                'period_start',
                period_start,

                'period_end',
                period_end,

                'last_refreshed_at',
                last_refreshed_at
            )
            FROM attendance_summary
        ),

        'weekly_hours',
        COALESCE(
            (
                SELECT jsonb_agg(
                    to_jsonb(w)
                    ORDER BY w.week_start
                )
                FROM weekly_summary w
            ),
            '[]'::jsonb
        ),

        'student_progress',
        COALESCE(
            (
                SELECT jsonb_agg(
                    to_jsonb(s)
                    ORDER BY
                        s.completion_percentage
                            ASC NULLS LAST,
                        s.student_id
                )
                FROM student_progress s
            ),
            '[]'::jsonb
        )

    )
    INTO v_result;

    RETURN v_result;

END;
$$;


--
-- Name: get_my_coordinator_contact(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_coordinator_contact() RETURNS TABLE(full_name text, email text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$

    SELECT
        oc.full_name,
        oc.email
    FROM public.ojt_coordinators oc
    WHERE auth.uid() IS NOT NULL

      AND EXISTS (
          SELECT 1
          FROM public.students s
          WHERE s.student_id = public.get_student_id()
      )

      AND lower(trim(oc.account_status)) = 'active'

      AND (
          SELECT COUNT(*)
          FROM public.ojt_coordinators c
          WHERE lower(trim(c.account_status)) = 'active'
      ) = 1;

$$;


--
-- Name: get_my_internship_details(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_internship_details() RETURNS TABLE(company_name text, company_location text, department text, start_date date, end_date date, required_hours integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$

    SELECT
        isa.company_name,
        CASE WHEN isa.id IS NOT NULL
            THEN s.company_location
        END,
        CASE WHEN isa.id IS NOT NULL
            THEN s.department
        END,
        isa.start_date,
        isa.end_date,
        s.required_hours

    FROM public.students s

    LEFT JOIN public.intern_supervisor_assignments isa
        ON isa.student_id = s.id
        AND LOWER(TRIM(isa.assignment_status)) = 'active'

    WHERE s.student_id = public.get_student_id()
        AND auth.uid() IS NOT NULL;

$$;


--
-- Name: get_my_supervisor_contacts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_supervisor_contacts() RETURNS TABLE(full_name text, email text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$

    SELECT DISTINCT
        cs.full_name,
        cs.email
    FROM public.intern_supervisor_assignments isa
    JOIN public.students s
        ON s.id = isa.student_id
    JOIN public.company_supervisors cs
        ON cs.id = isa.supervisor_id
    WHERE s.student_id = public.get_student_id()
      AND auth.uid() IS NOT NULL
      AND lower(trim(isa.assignment_status)) = 'active';

$$;


--
-- Name: get_student_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_student_id() RETURNS text
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
    SELECT u.user_id
    FROM public.users u
    JOIN public.students s
        ON s.student_id = u.user_id
    WHERE u.id = auth.uid()
      AND u.role = 'student_intern'
      AND u.account_status = 'active'
      AND s.account_status = 'active';
$$;


--
-- Name: get_student_uuid(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_student_uuid() RETURNS uuid
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
    SELECT s.id
    FROM public.students s
    JOIN public.users u
        ON s.student_id = u.user_id
    WHERE u.id = auth.uid()
      AND u.role = 'student_intern'
      AND u.account_status = 'active'
      AND s.account_status = 'active';
$$;


--
-- Name: is_coordinator(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_coordinator() RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users u
        JOIN public.ojt_coordinators oc
            ON oc.user_id = u.id
        WHERE u.id = auth.uid()
          AND u.role = 'ojt_coordinator'
          AND u.account_status = 'active'
          AND oc.account_status = 'active'
    );
$$;


--
-- Name: is_student(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_student() RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users u
        JOIN public.students s
            ON s.student_id = u.user_id
        WHERE u.id = auth.uid()
          AND u.role = 'student_intern'
          AND u.account_status = 'active'
          AND s.account_status = 'active'
    );
$$;


--
-- Name: is_supervisor(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_supervisor() RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users u
        JOIN public.company_supervisors cs
            ON cs.user_id = u.id
        WHERE u.id = auth.uid()
          AND u.role = 'company_supervisor'
          AND u.account_status = 'active'
          AND cs.account_status = 'active'
    );
$$;


--
-- Name: protect_attendance_fields(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_attendance_fields() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
    v_supervisor_id uuid;
    v_computed_hours numeric;
BEGIN

    -- Trusted database and backend operations
    IF current_user NOT IN ('authenticated', 'anon') THEN
        RETURN NEW;
    END IF;

    -- Prevent anonymous attendance operations
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required.'
            USING ERRCODE = '42501';
    END IF;

    -- Coordinators have read-only attendance access
    IF public.is_coordinator() THEN
        RAISE EXCEPTION 'Coordinator attendance access is read-only.'
            USING ERRCODE = '42501';
    END IF;

    -- ==========================================
    -- STUDENT ATTENDANCE CREATION
    -- ==========================================

    IF TG_OP = 'INSERT' THEN

        IF NOT public.is_student()
           OR NEW.student_id IS DISTINCT FROM
              public.get_student_id() THEN
            RAISE EXCEPTION 'Unauthorized attendance creation.'
                USING ERRCODE = '42501';
        END IF;

        -- Require transaction identity
        IF NEW.client_transaction_id IS NULL
           OR BTRIM(NEW.client_transaction_id) = '' THEN
            RAISE EXCEPTION 'Attendance transaction ID is required.'
                USING ERRCODE = '22023';
        END IF;

        -- Validate Time-In
        IF NEW.time_in IS NULL
           OR NOT isfinite(NEW.time_in)
           OR NEW.time_in > now() THEN
            RAISE EXCEPTION 'Invalid Time-In timestamp.'
                USING ERRCODE = '22023';
        END IF;

        -- Validate Philippine attendance date
        IF NEW.attendance_date IS DISTINCT FROM
           (NEW.time_in AT TIME ZONE 'Asia/Manila')::date THEN
            RAISE EXCEPTION 'Invalid attendance date.'
                USING ERRCODE = '22023';
        END IF;

        -- Require Time-In photo
        IF NEW.time_in_photo IS NULL
           OR BTRIM(NEW.time_in_photo) = '' THEN
            RAISE EXCEPTION 'Time-In photo is required.'
                USING ERRCODE = '22023';
        END IF;

        -- Require valid Time-In GPS coordinates
        IF NEW.time_in_location_lat IS NULL
           OR NEW.time_in_location_long IS NULL
           OR NEW.time_in_location_lat NOT BETWEEN -90 AND 90
           OR NEW.time_in_location_long NOT BETWEEN -180 AND 180 THEN
            RAISE EXCEPTION 'Invalid Time-In GPS coordinates.'
                USING ERRCODE = '22023';
        END IF;

        -- Students cannot submit review information
        IF NEW.verification_status IS DISTINCT FROM 'provisional'
           OR NEW.verified_by IS NOT NULL
           OR NEW.verified_at IS NOT NULL
           OR NEW.remarks IS NOT NULL THEN
            RAISE EXCEPTION 'Unauthorized attendance review information.'
                USING ERRCODE = '42501';
        END IF;

        -- Initial attendance must contain Time-In only
        IF NEW.time_out IS NOT NULL
           OR NEW.time_out_photo IS NOT NULL
           OR NEW.time_out_location_lat IS NOT NULL
           OR NEW.time_out_location_long IS NOT NULL
           OR NEW.total_hours_rendered IS NOT NULL THEN
            RAISE EXCEPTION 'Initial attendance must contain Time-In only.'
                USING ERRCODE = '22023';
        END IF;

        -- Server-controlled values
        NEW.id := gen_random_uuid();
        NEW.created_at := now();
        NEW.submitted_at := NULL;
        NEW.status := 'Present';
        NEW.sync_status := 'synced';
        NEW.verification_status := 'provisional';
        NEW.total_hours_rendered := NULL;

        RETURN NEW;

    END IF;

    -- ==========================================
    -- COMMON UPDATE PROTECTION
    -- ==========================================

    IF TG_OP = 'UPDATE' THEN

        -- Verified and rejected records are locked
        IF OLD.verification_status IS DISTINCT FROM 'provisional' THEN
            RAISE EXCEPTION 'Reviewed attendance records are locked.'
                USING ERRCODE = '42501';
        END IF;

        -- Protect attendance identity
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.student_id IS DISTINCT FROM OLD.student_id
           OR NEW.attendance_date IS DISTINCT FROM OLD.attendance_date
           OR NEW.client_transaction_id IS DISTINCT FROM
              OLD.client_transaction_id
           OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'Unauthorized modification of attendance identity.'
                USING ERRCODE = '42501';
        END IF;

        -- Protect existing Time-In evidence
        IF NEW.time_in IS DISTINCT FROM OLD.time_in
           OR NEW.time_in_photo IS DISTINCT FROM OLD.time_in_photo
           OR NEW.time_in_location_lat IS DISTINCT FROM
              OLD.time_in_location_lat
           OR NEW.time_in_location_long IS DISTINCT FROM
              OLD.time_in_location_long THEN
            RAISE EXCEPTION 'Recorded Time-In information cannot be modified.'
                USING ERRCODE = '42501';
        END IF;

        -- ======================================
        -- STUDENT TIME-OUT
        -- ======================================

        IF public.is_student() THEN

            IF OLD.student_id IS DISTINCT FROM
               public.get_student_id() THEN
                RAISE EXCEPTION 'Unauthorized attendance update.'
                    USING ERRCODE = '42501';
            END IF;

            -- Restrict students to Time-Out fields
            IF (
                to_jsonb(NEW) - ARRAY[
                    'time_out',
                    'time_out_photo',
                    'time_out_location_lat',
                    'time_out_location_long',
                    'total_hours_rendered',
                    'sync_status'
                ]
            ) IS DISTINCT FROM (
                to_jsonb(OLD) - ARRAY[
                    'time_out',
                    'time_out_photo',
                    'time_out_location_lat',
                    'time_out_location_long',
                    'total_hours_rendered',
                    'sync_status'
                ]
            ) THEN
                RAISE EXCEPTION 'Unauthorized student attendance modification.'
                    USING ERRCODE = '42501';
            END IF;

            -- Existing Time-Out cannot be overwritten
            IF OLD.time_out IS NOT NULL THEN
                RAISE EXCEPTION 'Time-Out has already been recorded.'
                    USING ERRCODE = '42501';
            END IF;

            -- Validate Time-Out
            IF NEW.time_out IS NULL
               OR NOT isfinite(NEW.time_out)
               OR NEW.time_out <= OLD.time_in
               OR NEW.time_out > now() THEN
                RAISE EXCEPTION 'Invalid Time-Out timestamp.'
                    USING ERRCODE = '22023';
            END IF;

            -- Require Time-Out photo
            IF NEW.time_out_photo IS NULL
               OR BTRIM(NEW.time_out_photo) = '' THEN
                RAISE EXCEPTION 'Time-Out photo is required.'
                    USING ERRCODE = '22023';
            END IF;

            -- Require valid Time-Out GPS coordinates
            IF NEW.time_out_location_lat IS NULL
               OR NEW.time_out_location_long IS NULL
               OR NEW.time_out_location_lat NOT BETWEEN -90 AND 90
               OR NEW.time_out_location_long NOT BETWEEN -180 AND 180 THEN
                RAISE EXCEPTION 'Invalid Time-Out GPS coordinates.'
                    USING ERRCODE = '22023';
            END IF;

            -- Database-controlled hours
            NEW.total_hours_rendered :=
                public.calculate_attendance_hours(
                    OLD.time_in,
                    NEW.time_out
                );

            NEW.sync_status := 'synced';
            NEW.submitted_at := now();

            RETURN NEW;

        END IF;

        -- ======================================
        -- COMPANY SUPERVISOR REVIEW
        -- ======================================

        IF public.is_supervisor() THEN

            SELECT cs.id
            INTO v_supervisor_id
            FROM public.company_supervisors cs
            WHERE cs.user_id = auth.uid()
              AND cs.account_status = 'active';

            IF v_supervisor_id IS NULL THEN
                RAISE EXCEPTION 'Invalid supervisor identity.'
                    USING ERRCODE = '42501';
            END IF;

            -- Confirm active student assignment
            IF NOT EXISTS (
                SELECT 1
                FROM public.students s
                JOIN public.intern_supervisor_assignments isa
                    ON isa.student_id = s.id
                WHERE s.student_id = OLD.student_id
                  AND isa.supervisor_id = v_supervisor_id
                  AND isa.assignment_status = 'active'
            ) THEN
                RAISE EXCEPTION 'Unauthorized attendance review.'
                    USING ERRCODE = '42501';
            END IF;

            -- Supervisors may modify review fields only
            IF (
                to_jsonb(NEW) - ARRAY[
                    'verification_status',
                    'verified_by',
                    'verified_at',
                    'remarks',
                    'total_hours_rendered'
                ]
            ) IS DISTINCT FROM (
                to_jsonb(OLD) - ARRAY[
                    'verification_status',
                    'verified_by',
                    'verified_at',
                    'remarks',
                    'total_hours_rendered'
                ]
            ) THEN
                RAISE EXCEPTION 'Unauthorized supervisor attendance modification.'
                    USING ERRCODE = '42501';
            END IF;

            IF OLD.sync_status IS DISTINCT FROM 'synced' THEN
                RAISE EXCEPTION 'Attendance must be synchronized before review.'
                    USING ERRCODE = '22023';
            END IF;

            -- Only verification or rejection is permitted
            IF NEW.verification_status IS NULL
               OR NEW.verification_status NOT IN (
                   'verified',
                   'rejected'
               ) THEN
                RAISE EXCEPTION 'Invalid attendance review transition.'
                    USING ERRCODE = '42501';
            END IF;

            -- ==================================
            -- VERIFICATION
            -- ==================================

            IF NEW.verification_status = 'verified' THEN

                IF OLD.time_in IS NULL
                   OR OLD.time_out IS NULL THEN
                    RAISE EXCEPTION 'Incomplete attendance cannot be verified.'
                        USING ERRCODE = '22023';
                END IF;

                -- Require both attendance photos
                IF OLD.time_in_photo IS NULL
                   OR BTRIM(OLD.time_in_photo) = ''
                   OR OLD.time_out_photo IS NULL
                   OR BTRIM(OLD.time_out_photo) = '' THEN
                    RAISE EXCEPTION 'Complete photo evidence is required.'
                        USING ERRCODE = '22023';
                END IF;

                -- Require complete GPS evidence
                IF OLD.time_in_location_lat IS NULL
                   OR OLD.time_in_location_long IS NULL
                   OR OLD.time_out_location_lat IS NULL
                   OR OLD.time_out_location_long IS NULL
                   OR OLD.time_in_location_lat NOT BETWEEN -90 AND 90
                   OR OLD.time_in_location_long NOT BETWEEN -180 AND 180
                   OR OLD.time_out_location_lat NOT BETWEEN -90 AND 90
                   OR OLD.time_out_location_long NOT BETWEEN -180 AND 180 THEN
                    RAISE EXCEPTION 'Complete valid GPS evidence is required.'
                        USING ERRCODE = '22023';
                END IF;

                v_computed_hours :=
                    public.calculate_attendance_hours(
                        OLD.time_in,
                        OLD.time_out
                    );

                IF v_computed_hours IS NULL
                   OR v_computed_hours <= 0 THEN
                    RAISE EXCEPTION 'Attendance must have positive rendered hours.'
                        USING ERRCODE = '22023';
                END IF;

                NEW.total_hours_rendered := v_computed_hours;
                NEW.remarks := NULL;

            -- ==================================
            -- REJECTION
            -- ==================================

            ELSIF NEW.verification_status = 'rejected' THEN

                IF NEW.remarks IS NULL
                   OR BTRIM(NEW.remarks) = ''
                   OR CHAR_LENGTH(NEW.remarks) > 1200 THEN
                    RAISE EXCEPTION 'Valid rejection remarks are required.'
                        USING ERRCODE = '22023';
                END IF;

                -- Retain original hours for historical reference
                NEW.total_hours_rendered :=
                    OLD.total_hours_rendered;

            END IF;

            -- Server-controlled reviewer metadata
            NEW.verified_by := v_supervisor_id;
            NEW.verified_at := now();

            RETURN NEW;

        END IF;

        RAISE EXCEPTION 'Unauthorized attendance operation.'
            USING ERRCODE = '42501';

    END IF;

    RETURN NEW;

END;
$$;


--
-- Name: protect_student_information(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_student_information() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
    IF current_user IN ('authenticated', 'anon') THEN

        -- Protect permanent student identity fields
        IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.student_id IS DISTINCT FROM OLD.student_id
        OR NEW.email IS DISTINCT FROM OLD.email
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        THEN
            RAISE EXCEPTION
                'Unauthorized modification of protected student identity fields.'
                USING ERRCODE = '42501';
        END IF;

        -- Allow authorized coordinator updates
        IF public.is_coordinator() THEN
            RETURN NEW;
        END IF;

        -- Allow students to update only first-login status
        IF public.is_student()
        AND OLD.id = public.get_student_uuid()
        THEN
            IF (
                to_jsonb(NEW)
                - 'first_login'
                - 'updated_at'
            ) IS DISTINCT FROM (
                to_jsonb(OLD)
                - 'first_login'
                - 'updated_at'
            )
            THEN
                RAISE EXCEPTION
                    'Unauthorized modification of student information.'
                    USING ERRCODE = '42501';
            END IF;

            NEW.updated_at = now();

            RETURN NEW;
        END IF;

        RAISE EXCEPTION
            'Unauthorized student record update.'
            USING ERRCODE = '42501';

    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: protect_student_report_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_student_report_changes() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$

DECLARE
    authenticated_student_id text;
    internship_start_date date;
    expected_start_date date;
    expected_end_date date;
    today_manila date;

BEGIN

    -- Trusted database administration is
    -- outside this student-specific trigger.

    IF current_user NOT IN (
        'authenticated',
        'anon'
    ) THEN
        RETURN NEW;
    END IF;

    authenticated_student_id :=
        public.get_student_id();

    -- Existing supervisor and coordinator
    -- policies continue to govern their access.

    IF authenticated_student_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- =====================================
    -- VERIFY REPORT OWNERSHIP
    -- =====================================

    IF NEW.student_id IS DISTINCT FROM
        authenticated_student_id
    THEN

        RAISE EXCEPTION
            'You can only manage your own reports.';

    END IF;


    -- =====================================
    -- PROTECT NEW REPORTS
    -- =====================================

    IF TG_OP = 'INSERT' THEN

        IF NEW.status NOT IN (
            'draft',
            'pending_review'
        ) THEN

            RAISE EXCEPTION
                'Invalid initial report status.';

        END IF;

        IF NEW.feedback IS NOT NULL
           OR NEW.reviewed_at IS NOT NULL
           OR NEW.reviewing_supervisor_id IS NOT NULL
           OR NEW.supervisor_name IS NOT NULL
           OR COALESCE(NEW.comment_count, 0) <> 0
        THEN

            RAISE EXCEPTION
                'Students cannot assign supervisor review information.';

        END IF;

        NEW.created_at := now();


    -- =====================================
    -- PROTECT EXISTING REPORTS
    -- =====================================

    ELSIF TG_OP = 'UPDATE' THEN

        IF OLD.student_id IS DISTINCT FROM
            authenticated_student_id
        THEN

            RAISE EXCEPTION
                'You cannot modify another student report.';

        END IF;

        IF OLD.status NOT IN (
            'draft',
            'returned'
        ) THEN

            RAISE EXCEPTION
                'This report is locked for review.';

        END IF;

        -- Only these fields may be changed
        -- by the student.

        IF (
            to_jsonb(NEW) -
            ARRAY[
                'accomplishments',
                'student_reflection',
                'status',
                'submitted_at',
                'updated_at'
            ]
        ) IS DISTINCT FROM (
            to_jsonb(OLD) -
            ARRAY[
                'accomplishments',
                'student_reflection',
                'status',
                'submitted_at',
                'updated_at'
            ]
        ) THEN

            RAISE EXCEPTION
                'You cannot modify protected report information.';

        END IF;

        -- Valid transitions:
        -- draft -> draft
        -- draft -> pending_review
        -- returned -> returned
        -- returned -> pending_review

        IF OLD.status = 'draft'
           AND NEW.status NOT IN (
               'draft',
               'pending_review'
           )
        THEN

            RAISE EXCEPTION
                'Invalid draft status transition.';

        END IF;

        IF OLD.status = 'returned'
           AND NEW.status NOT IN (
               'returned',
               'pending_review'
           )
        THEN

            RAISE EXCEPTION
                'Invalid returned report status transition.';

        END IF;

    END IF;


    -- =====================================
    -- VALIDATE REPORTING PERIOD
    -- =====================================

    -- Validate new reports and submissions.
    -- Existing legacy drafts can still be
    -- saved without changing their dates.

    IF TG_OP = 'INSERT'
       OR NEW.status = 'pending_review'
    THEN

        SELECT s.ojt_start_date::date
        INTO internship_start_date
        FROM public.students s
        WHERE s.student_id =
            authenticated_student_id;

        IF internship_start_date IS NULL THEN

            RAISE EXCEPTION
                'An OJT start date must be assigned first.';

        END IF;

        IF NEW.week IS NULL
           OR NEW.week < 1
           OR NEW.week > 5200
        THEN

            RAISE EXCEPTION
                'Invalid internship week.';

        END IF;

        today_manila :=
            (now() AT TIME ZONE 'Asia/Manila')::date;

        expected_start_date :=
            internship_start_date +
            ((NEW.week - 1) * 7);

        expected_end_date :=
            expected_start_date + 6;

        IF expected_start_date > today_manila THEN

            RAISE EXCEPTION
                'Future weekly reports are not allowed.';

        END IF;

        IF NEW.start_date IS DISTINCT FROM
            expected_start_date
           OR NEW.end_date IS DISTINCT FROM
            expected_end_date
        THEN

            RAISE EXCEPTION
                'The reporting period does not match your internship schedule.';

        END IF;

    END IF;


    -- =====================================
    -- VALIDATE REPORT SUBMISSION
    -- =====================================

    IF NEW.status = 'pending_review' THEN

        IF COALESCE(
            btrim(NEW.accomplishments),
            ''
        ) = '' THEN

            RAISE EXCEPTION
                'Weekly accomplishments are required.';

        END IF;

        IF COALESCE(
            btrim(NEW.student_reflection),
            ''
        ) = '' THEN

            RAISE EXCEPTION
                'Student reflection is required.';

        END IF;

        -- Use the database server timestamp.

        NEW.submitted_at := now();

    ELSIF TG_OP = 'INSERT' THEN

        NEW.submitted_at := NULL;

    ELSIF TG_OP = 'UPDATE' THEN

        NEW.submitted_at := OLD.submitted_at;

    END IF;


    -- =====================================
    -- SERVER-GENERATED UPDATE TIMESTAMP
    -- =====================================

    NEW.updated_at := now();

    RETURN NEW;

END;

$$;


--
-- Name: protect_supervisor_profile_fields(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_supervisor_profile_fields() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
BEGIN

    -- Preserve trusted administrative operations
    -- and existing SECURITY DEFINER functions.

    IF current_user NOT IN (
        'authenticated',
        'anon'
    ) THEN
        RETURN NEW;
    END IF;

    -- Require authentication.

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    -- Protect permanent identity fields.

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.supervisor_id IS DISTINCT FROM OLD.supervisor_id
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.date_registered IS DISTINCT FROM OLD.date_registered
    THEN
        RAISE EXCEPTION
            'Protected supervisor identity cannot be modified.';
    END IF;

    -- Account status changes must use the
    -- existing authorized account-status function.

    IF NEW.account_status IS DISTINCT FROM OLD.account_status THEN
        RAISE EXCEPTION
            'Use the authorized supervisor account status function.';
    END IF;

    -- Allow active coordinators to manage
    -- permitted supervisor information.

    IF public.is_coordinator() THEN
        NEW.updated_at := now();
        RETURN NEW;
    END IF;

    -- Supervisors may only update their own profile.

    IF NOT public.is_supervisor()
       OR OLD.user_id IS DISTINCT FROM auth.uid()
       OR OLD.account_status IS DISTINCT FROM 'active'
    THEN
        RAISE EXCEPTION
            'Unauthorized supervisor profile update.';
    END IF;

    -- Restrict supervisor-editable fields.

    IF (
        to_jsonb(NEW) -
        ARRAY[
            'full_name',
            'contact_number',
            'updated_at'
        ]
    ) IS DISTINCT FROM (
        to_jsonb(OLD) -
        ARRAY[
            'full_name',
            'contact_number',
            'updated_at'
        ]
    ) THEN
        RAISE EXCEPTION
            'You cannot modify protected supervisor information.';
    END IF;

    -- Validate full name.

    IF NEW.full_name IS NULL
       OR char_length(btrim(NEW.full_name)) < 2
       OR char_length(btrim(NEW.full_name)) > 150
    THEN
        RAISE EXCEPTION 'Enter a valid full name.';
    END IF;

    -- Validate contact number.

    IF char_length(
        COALESCE(btrim(NEW.contact_number), '')
    ) > 30 THEN
        RAISE EXCEPTION 'Contact number is too long.';
    END IF;

    IF COALESCE(btrim(NEW.contact_number), '') <> ''
       AND btrim(NEW.contact_number)
           !~ '^[0-9+() .-]+$'
    THEN
        RAISE EXCEPTION 'Enter a valid contact number.';
    END IF;

    NEW.full_name := btrim(NEW.full_name);

    NEW.contact_number :=
        NULLIF(btrim(NEW.contact_number), '');

    NEW.updated_at := now();

    RETURN NEW;

END;
$_$;


--
-- Name: protect_supervisor_report_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_supervisor_report_changes() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$

DECLARE
    v_supervisor_id uuid;
    v_supervisor_name text;

BEGIN

    -- Preserve trusted administrative operations.

    IF current_user NOT IN (
        'authenticated',
        'anon'
    ) THEN
        RETURN NEW;
    END IF;

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    -- Existing student trigger handles student updates.

    IF public.get_student_id() IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Preserve existing coordinator permissions.

    IF public.is_coordinator() THEN
        RETURN NEW;
    END IF;

    -- Verify active supervisor authorization.

    IF NOT public.is_supervisor() THEN
        RAISE EXCEPTION
            'Unauthorized report update.';
    END IF;

    SELECT
        cs.id,
        cs.full_name
    INTO STRICT
        v_supervisor_id,
        v_supervisor_name
    FROM public.company_supervisors cs
    WHERE cs.user_id = auth.uid()
      AND cs.account_status = 'active';

    -- Verify active student assignment.

    IF NOT EXISTS (
        SELECT 1
        FROM public.intern_supervisor_assignments isa
        JOIN public.students s
            ON s.id = isa.student_id
        WHERE s.student_id = OLD.student_id
          AND isa.supervisor_id = v_supervisor_id
          AND isa.assignment_status = 'active'
    ) THEN
        RAISE EXCEPTION
            'This student is not assigned to you.';
    END IF;

    -- Only pending reports may be reviewed.

    IF OLD.status IS DISTINCT FROM 'pending_review' THEN
        RAISE EXCEPTION
            'Only pending reports may be reviewed.';
    END IF;

    -- Validate review status transition.

    IF NEW.status IS NULL
       OR NEW.status NOT IN (
           'approved',
           'returned'
       )
    THEN
        RAISE EXCEPTION
            'Invalid report review status.';
    END IF;

    -- Protect student report information.

    IF (
        to_jsonb(NEW) -
        ARRAY[
            'status',
            'feedback',
            'comment_count',
            'reviewed_at',
            'reviewing_supervisor_id',
            'supervisor_name',
            'updated_at'
        ]
    ) IS DISTINCT FROM (
        to_jsonb(OLD) -
        ARRAY[
            'status',
            'feedback',
            'comment_count',
            'reviewed_at',
            'reviewing_supervisor_id',
            'supervisor_name',
            'updated_at'
        ]
    ) THEN
        RAISE EXCEPTION
            'Protected report information cannot be modified.';
    END IF;

    -- Require feedback when returning a report.

    IF NEW.status = 'returned' THEN

        NEW.feedback :=
            btrim(COALESCE(NEW.feedback, ''));

        IF char_length(NEW.feedback) < 20 THEN
            RAISE EXCEPTION
                'Please provide at least 20 characters of feedback.';
        END IF;

        NEW.comment_count :=
            COALESCE(OLD.comment_count, 0) + 1;

    ELSE

        -- Preserve existing feedback when approving.

        NEW.feedback := OLD.feedback;
        NEW.comment_count := OLD.comment_count;

    END IF;

    -- Generate authoritative review information.

    NEW.reviewing_supervisor_id := v_supervisor_id;
    NEW.supervisor_name := v_supervisor_name;
    NEW.reviewed_at := now();
    NEW.updated_at := now();

    RETURN NEW;

END;

$$;


--
-- Name: protect_user_account_fields(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_user_account_fields() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
    -- Restrict direct updates by application roles
    IF current_user IN ('authenticated', 'anon') THEN

        IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.role IS DISTINCT FROM OLD.role
        OR NEW.email IS DISTINCT FROM OLD.email
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        THEN
            RAISE EXCEPTION
                'Unauthorized modification of protected account fields.'
                USING ERRCODE = '42501';
        END IF;

        -- Restrict account status changes
        IF NEW.account_status
            IS DISTINCT FROM OLD.account_status
        THEN
            IF NOT public.is_coordinator()
            OR OLD.id = auth.uid()
            THEN
                RAISE EXCEPTION
                    'Unauthorized account status modification.'
                    USING ERRCODE = '42501';
            END IF;
        END IF;

    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: protect_verified_attendance(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_verified_attendance() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Only allow verification_status changes from verified to verified (no change)
  -- Prevent changing verified back to provisional
  IF OLD.verification_status = 'verified' AND NEW.verification_status = 'provisional' THEN
    -- Keep the original verified status
    NEW.verification_status := OLD.verification_status;
    NEW.verified_at := OLD.verified_at;
    NEW.verified_by := OLD.verified_by;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: reassign_student_intern(uuid, uuid, date, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reassign_student_intern(p_student_id uuid, p_supervisor_id uuid, p_start_date date, p_end_date date, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$

DECLARE
    v_supervisor public.company_supervisors%ROWTYPE;
    v_student public.students%ROWTYPE;
    v_old_assignment public.intern_supervisor_assignments%ROWTYPE;
    v_new_assignment_id uuid;
    v_history jsonb := '[]'::jsonb;
    v_reason text;

BEGIN

    -- 1. Verify coordinator authorization
    IF NOT EXISTS (
        SELECT 1
        FROM public.users u
        JOIN public.ojt_coordinators c
            ON c.user_id = u.id
        WHERE u.id = auth.uid()
        AND u.role = 'ojt_coordinator'
        AND u.account_status = 'active'
        AND c.account_status = 'active'
    ) THEN
        RAISE EXCEPTION 'Unauthorized coordinator account.';
    END IF;

    -- 2. Validate internship period
    IF p_start_date IS NULL THEN
        RAISE EXCEPTION 'Internship start date is required.';
    END IF;

    IF p_end_date IS NOT NULL
       AND p_end_date < p_start_date THEN
        RAISE EXCEPTION
            'End date cannot be earlier than start date.';
    END IF;

    -- 3. Retrieve and lock student record
    SELECT *
    INTO v_student
    FROM public.students
    WHERE id = p_student_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Student record not found.';
    END IF;

    IF v_student.account_status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'Student account is not active.';
    END IF;

    -- 4. Validate selected supervisor
    SELECT *
    INTO v_supervisor
    FROM public.company_supervisors
    WHERE id = p_supervisor_id
    AND account_status = 'active'
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Selected supervisor is unavailable or inactive.';
    END IF;

    -- 5. Retrieve current active assignment
    SELECT *
    INTO v_old_assignment
    FROM public.intern_supervisor_assignments
    WHERE student_id = p_student_id
    AND assignment_status = 'active'
    FOR UPDATE;

    IF FOUND THEN

        -- Require a reason for reassignment
        IF p_reason IS NULL OR trim(p_reason) = '' THEN
            RAISE EXCEPTION
                'Reason for assignment change is required.';
        END IF;

        v_reason := trim(p_reason);

        -- Prevent duplicate placement
        IF v_old_assignment.supervisor_id = p_supervisor_id
           AND v_old_assignment.company_name =
               v_supervisor.company_name THEN

            RAISE EXCEPTION
                'Student is already assigned to this supervisor.';

        END IF;

        -- Preserve previous assignment information
        v_history := jsonb_build_array(
            jsonb_build_object(
                'action', 'reassignment',
                'previous_assignment_id', v_old_assignment.id,
                'previous_company', v_old_assignment.company_name,
                'previous_supervisor_id',
                    v_old_assignment.supervisor_id,
                'previous_start_date',
                    v_old_assignment.start_date,
                'previous_end_date',
                    v_old_assignment.end_date,
                'new_company', v_supervisor.company_name,
                'new_supervisor_id', p_supervisor_id,
                'new_start_date', p_start_date,
                'new_end_date', p_end_date,
                'reason', v_reason,
                'changed_at', now(),
                'changed_by', auth.uid()
            )
        );

        -- Retain previous assignment as inactive
        UPDATE public.intern_supervisor_assignments
        SET
            assignment_status = 'inactive',
            assignment_history =
                COALESCE(assignment_history, '[]'::jsonb)
                || v_history,
            updated_at = now()
        WHERE id = v_old_assignment.id;

    ELSE

        -- Initial placement does not require a written reason
        v_reason := COALESCE(
            NULLIF(trim(p_reason), ''),
            'Initial internship assignment'
        );

        v_history := jsonb_build_array(
            jsonb_build_object(
                'action', 'initial_assignment',
                'new_company', v_supervisor.company_name,
                'new_supervisor_id', p_supervisor_id,
                'new_start_date', p_start_date,
                'new_end_date', p_end_date,
                'reason', v_reason,
                'changed_at', now(),
                'changed_by', auth.uid()
            )
        );

    END IF;

    -- 6. Create new active assignment
    INSERT INTO public.intern_supervisor_assignments (
        student_id,
        supervisor_id,
        company_name,
        assigned_date,
        start_date,
        end_date,
        assignment_status,
        assignment_history,
        created_at,
        updated_at
    )
    VALUES (
        p_student_id,
        p_supervisor_id,
        v_supervisor.company_name,
        now(),
        p_start_date,
        p_end_date,
        'active',
        v_history,
        now(),
        now()
    )
    RETURNING id INTO v_new_assignment_id;

    -- 7. Update student's current placement
    UPDATE public.students
    SET
        company_name = v_supervisor.company_name,
        department = v_supervisor.department,
        company_location = NULL,
        ojt_start_date = p_start_date,
        ojt_end_date = p_end_date,
        updated_at = now()
    WHERE id = p_student_id;

    -- 8. Return successful response
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Internship assignment saved successfully.',
        'assignment_id', v_new_assignment_id,
        'student_id', p_student_id,
        'company_name', v_supervisor.company_name,
        'supervisor_name', v_supervisor.full_name,
        'start_date', p_start_date,
        'end_date', p_end_date
    );

END;

$$;


--
-- Name: record_audit_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_audit_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$

DECLARE
    v_old jsonb;
    v_new jsonb;
    v_record_id text;
    v_actor_id uuid;
    v_actor_role text;
    v_changed_fields text[];

BEGIN

    -- Retrieve affected record information.

    IF TG_OP = 'INSERT' THEN
        v_old := '{}'::jsonb;
        v_new := to_jsonb(NEW);

    ELSIF TG_OP = 'UPDATE' THEN
        v_old := to_jsonb(OLD);
        v_new := to_jsonb(NEW);

    ELSE
        v_old := to_jsonb(OLD);
        v_new := '{}'::jsonb;
    END IF;

    -- Identify the affected record.

    v_record_id := COALESCE(
        v_new ->> 'id',
        v_old ->> 'id'
    );

    -- Identify the authenticated actor.

    v_actor_id := auth.uid();

    IF v_actor_id IS NOT NULL THEN

        SELECT u.role
        INTO v_actor_role
        FROM public.users u
        WHERE u.id = v_actor_id;

        v_actor_role := COALESCE(
            v_actor_role,
            'authenticated_unknown'
        );

    ELSE

        v_actor_role := COALESCE(
            auth.role(),
            'database_administration'
        );

    END IF;

    -- Identify changed columns without storing
    -- their sensitive contents.

    SELECT COALESCE(
        array_agg(k ORDER BY k),
        ARRAY[]::text[]
    )
    INTO v_changed_fields
    FROM jsonb_object_keys(
        v_old || v_new
    ) AS fields(k)
    WHERE (v_old -> k)
        IS DISTINCT FROM
        (v_new -> k)
      AND k <> 'updated_at';

    -- Ignore updates with no meaningful changes.

    IF TG_OP = 'UPDATE'
       AND cardinality(v_changed_fields) = 0
    THEN
        RETURN NEW;
    END IF;

    -- Record the audit event.

    INSERT INTO public.audit_logs (
        table_name,
        record_id,
        operation,
        actor_user_id,
        actor_role,
        changed_fields,
        old_status,
        new_status,
        performed_at
    )
    VALUES (
        TG_TABLE_NAME,
        v_record_id,
        TG_OP,
        v_actor_id,
        v_actor_role,
        v_changed_fields,
        COALESCE(
            v_old ->> 'verification_status',
            v_old ->> 'assignment_status',
            v_old ->> 'account_status',
            v_old ->> 'status'
        ),
        COALESCE(
            v_new ->> 'verification_status',
            v_new ->> 'assignment_status',
            v_new ->> 'account_status',
            v_new ->> 'status'
        ),
        clock_timestamp()
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    RETURN NEW;

END;

$$;


--
-- Name: refresh_internship_analytics(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_internship_analytics() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
    v_refresh_result jsonb;
BEGIN

    -- Coordinator-only authorization
    IF auth.uid() IS NULL
       OR public.is_coordinator() IS NOT TRUE
    THEN
        RAISE EXCEPTION 'Unauthorized warehouse refresh.'
            USING ERRCODE = '42501';
    END IF;

    -- Execute existing ETL pipeline
    v_refresh_result :=
        warehouse.refresh_attendance_warehouse();

    -- Revalidate authorization
    IF public.is_coordinator() IS NOT TRUE THEN
        RAISE EXCEPTION 'Coordinator authorization changed.'
            USING ERRCODE = '42501';
    END IF;

    RETURN v_refresh_result;

END;
$$;


--
-- Name: register_student_intern(uuid, text, text, text, text, text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.register_student_intern(p_auth_user_id uuid, p_student_id text, p_full_name text, p_email text, p_course text, p_year_level text, p_school_name text, p_required_hours integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
    v_student_uuid uuid;
    v_student_id text;
    v_email text;
BEGIN
    v_student_id := TRIM(p_student_id);
    v_email := LOWER(TRIM(p_email));

    -- Validate required information
    IF p_auth_user_id IS NULL
        OR NULLIF(v_student_id, '') IS NULL
        OR NULLIF(TRIM(p_full_name), '') IS NULL
        OR NULLIF(v_email, '') IS NULL
        OR NULLIF(TRIM(p_course), '') IS NULL
        OR NULLIF(TRIM(p_year_level), '') IS NULL
        OR NULLIF(TRIM(p_school_name), '') IS NULL
        OR p_required_hours IS NULL
        OR p_required_hours <= 0
    THEN
        RAISE EXCEPTION 'Invalid student registration information'
            USING ERRCODE = '22023';
    END IF;

    -- Verify authentication account
    IF NOT EXISTS (
        SELECT 1
        FROM auth.users
        WHERE id = p_auth_user_id
        AND LOWER(email) = v_email
    ) THEN
        RAISE EXCEPTION 'Authentication account not found';
    END IF;

    -- Check duplicate Student ID
    IF EXISTS (
        SELECT 1
        FROM public.students
        WHERE student_id = v_student_id
    ) OR EXISTS (
        SELECT 1
        FROM public.users
        WHERE user_id = v_student_id
    ) THEN
        RAISE EXCEPTION 'Student ID already exists'
            USING ERRCODE = '23505';
    END IF;

    -- Check duplicate email
    IF EXISTS (
        SELECT 1
        FROM public.users
        WHERE LOWER(email) = v_email
    ) OR EXISTS (
        SELECT 1
        FROM public.students
        WHERE LOWER(email) = v_email
    ) THEN
        RAISE EXCEPTION 'Email address already exists'
            USING ERRCODE = '23505';
    END IF;

    -- Create public user account
    INSERT INTO public.users (
        id,
        email,
        user_id,
        role,
        account_status,
        first_login
    )
    VALUES (
        p_auth_user_id,
        v_email,
        v_student_id,
        'student_intern',
        'active',
        true
    );

    -- Create student profile
    INSERT INTO public.students (
        student_id,
        full_name,
        email,
        course,
        year_level,
        school_name,
        required_hours,
        account_status,
        first_login
    )
    VALUES (
        v_student_id,
        TRIM(p_full_name),
        v_email,
        TRIM(p_course),
        TRIM(p_year_level),
        TRIM(p_school_name),
        p_required_hours,
        'active',
        true
    )
    RETURNING id INTO v_student_uuid;

    -- Return registration result
    RETURN jsonb_build_object(
        'success', true,
        'student', jsonb_build_object(
            'id', v_student_uuid,
            'student_id', v_student_id,
            'full_name', TRIM(p_full_name),
            'email', v_email,
            'account_status', 'active'
        )
    );
END;
$$;


--
-- Name: update_coordinator_profile(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_coordinator_profile(p_full_name text, p_contact_number text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
    v_user_id uuid;
    v_coordinator public.ojt_coordinators%ROWTYPE;
    v_full_name text;
    v_contact_number text;
BEGIN

    v_user_id := auth.uid();

    -- Validate authenticated user
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    -- Validate coordinator role and account status
    IF NOT EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.id = v_user_id
          AND u.role = 'ojt_coordinator'
          AND u.account_status = 'active'
    ) THEN
        RAISE EXCEPTION 'Unauthorized coordinator account.';
    END IF;

    -- Clean input values
    v_full_name := btrim(COALESCE(p_full_name, ''));

    v_contact_number := NULLIF(
        btrim(COALESCE(p_contact_number, '')),
        ''
    );

    -- Validate full name
    IF char_length(v_full_name) < 2 THEN
        RAISE EXCEPTION 'Please enter a valid full name.';
    END IF;

    IF char_length(v_full_name) > 150 THEN
        RAISE EXCEPTION 'Full name is too long.';
    END IF;

    -- Validate contact number
    IF v_contact_number IS NOT NULL THEN

        IF char_length(v_contact_number) > 30 THEN
            RAISE EXCEPTION 'Contact number is too long.';
        END IF;

        IF v_contact_number !~ '^[0-9+() -]+$'
           OR char_length(
               regexp_replace(v_contact_number, '[^0-9]', '', 'g')
           ) < 7 THEN
            RAISE EXCEPTION 'Please enter a valid contact number.';
        END IF;

    END IF;

    -- Update only the authenticated coordinator's profile
    UPDATE public.ojt_coordinators
    SET
        full_name = v_full_name,
        contact_number = v_contact_number,
        updated_at = now()
    WHERE user_id = v_user_id
      AND account_status = 'active'
    RETURNING *
    INTO v_coordinator;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active coordinator profile not found.';
    END IF;

    -- Return updated profile
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Profile updated successfully.',
        'profile', jsonb_build_object(
            'id', v_coordinator.id,
            'admin_id', v_coordinator.admin_id,
            'full_name', v_coordinator.full_name,
            'email', v_coordinator.email,
            'contact_number', v_coordinator.contact_number,
            'account_status', v_coordinator.account_status,
            'updated_at', v_coordinator.updated_at
        )
    );

END;
$_$;


--
-- Name: update_own_supervisor_profile(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_own_supervisor_profile(p_full_name text, p_contact_number text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
    v_user_id uuid := auth.uid();
    v_profile public.company_supervisors%ROWTYPE;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.users
        WHERE id = v_user_id
          AND role = 'company_supervisor'
          AND account_status = 'active'
    ) THEN
        RAISE EXCEPTION 'Unauthorized account.';
    END IF;

    IF p_full_name IS NULL
       OR char_length(btrim(p_full_name)) < 2
       OR char_length(btrim(p_full_name)) > 150 THEN
        RAISE EXCEPTION 'Enter a valid full name.';
    END IF;

    IF char_length(
        COALESCE(btrim(p_contact_number), '')
    ) > 30 THEN
        RAISE EXCEPTION 'Contact number is too long.';
    END IF;

    IF COALESCE(btrim(p_contact_number), '') <> ''
       AND btrim(p_contact_number) !~ '^[0-9+() .-]+$' THEN
        RAISE EXCEPTION 'Enter a valid contact number.';
    END IF;

    UPDATE public.company_supervisors
    SET
        full_name = btrim(p_full_name),
        contact_number = NULLIF(btrim(p_contact_number), ''),
        updated_at = now()
    WHERE user_id = v_user_id
      AND account_status = 'active'
    RETURNING * INTO v_profile;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active supervisor profile not found.';
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Profile updated successfully.',
        'full_name', v_profile.full_name,
        'contact_number', v_profile.contact_number
    );
END;
$_$;


--
-- Name: update_student_academic_info(uuid, text, text, integer, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_student_academic_info(p_student_id uuid, p_course text, p_year_level text, p_required_hours integer, p_start_date date, p_end_date date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN

    -- Verify coordinator authorization
    IF NOT EXISTS (
        SELECT 1
        FROM public.users u
        JOIN public.ojt_coordinators c
            ON c.user_id = u.id
        WHERE u.id = auth.uid()
        AND u.role = 'ojt_coordinator'
        AND u.account_status = 'active'
        AND c.account_status = 'active'
    ) THEN
        RAISE EXCEPTION 'Unauthorized coordinator account.';
    END IF;

    -- Validate academic information
    IF p_course IS NULL OR trim(p_course) = '' THEN
        RAISE EXCEPTION 'Course is required.';
    END IF;

    IF p_year_level IS NULL OR trim(p_year_level) = '' THEN
        RAISE EXCEPTION 'Year level is required.';
    END IF;

    IF p_required_hours IS NULL OR p_required_hours <= 0 THEN
        RAISE EXCEPTION 'Required hours must be greater than zero.';
    END IF;

    IF p_start_date IS NULL THEN
        RAISE EXCEPTION 'Internship start date is required.';
    END IF;

    IF p_end_date IS NOT NULL
       AND p_end_date < p_start_date THEN
        RAISE EXCEPTION 'End date cannot be earlier than start date.';
    END IF;

    -- Update student information
    UPDATE public.students
    SET
        course = trim(p_course),
        year_level = trim(p_year_level),
        required_hours = p_required_hours,
        ojt_start_date = p_start_date,
        ojt_end_date = p_end_date,
        updated_at = now()
    WHERE id = p_student_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Student record not found.';
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Academic information updated successfully.',
        'student_id', p_student_id
    );

END;
$$;


--
-- Name: update_supervisor_account_status(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_supervisor_account_status(p_supervisor_id uuid, p_account_status text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE

    v_supervisor public.company_supervisors%ROWTYPE;

    v_user public.users%ROWTYPE;

    v_active_assignments integer;

    v_new_status text;

BEGIN

    -- =====================================
    -- 1. VERIFY COORDINATOR AUTHORIZATION
    -- =====================================

    IF NOT EXISTS (
        SELECT 1
        FROM public.users u
        INNER JOIN public.ojt_coordinators c
            ON c.user_id = u.id
        WHERE u.id = auth.uid()
          AND u.role = 'ojt_coordinator'
          AND u.account_status = 'active'
          AND c.account_status = 'active'
    ) THEN

        RAISE EXCEPTION
            'Unauthorized coordinator account.';

    END IF;


    -- =====================================
    -- 2. VALIDATE SUPERVISOR ID
    -- =====================================

    IF p_supervisor_id IS NULL THEN

        RAISE EXCEPTION
            'Supervisor ID is required.';

    END IF;


    -- =====================================
    -- 3. VALIDATE REQUESTED ACCOUNT STATUS
    -- =====================================

    v_new_status :=
        LOWER(TRIM(p_account_status));

    IF v_new_status IS NULL
       OR v_new_status NOT IN (
           'active',
           'inactive'
       ) THEN

        RAISE EXCEPTION
            'Invalid account status.';

    END IF;


    -- =====================================
    -- 4. RETRIEVE AND LOCK SUPERVISOR RECORD
    -- =====================================

    SELECT *
    INTO v_supervisor
    FROM public.company_supervisors
    WHERE id = p_supervisor_id
    FOR UPDATE;

    IF NOT FOUND THEN

        RAISE EXCEPTION
            'Company supervisor could not be found.';

    END IF;


    -- =====================================
    -- 5. VERIFY LINKED USER ACCOUNT
    -- =====================================

    IF v_supervisor.user_id IS NULL THEN

        RAISE EXCEPTION
            'This supervisor has no linked user account.';

    END IF;

    SELECT *
    INTO v_user
    FROM public.users
    WHERE id = v_supervisor.user_id
    FOR UPDATE;

    IF NOT FOUND THEN

        RAISE EXCEPTION
            'The linked user account could not be found.';

    END IF;


    -- =====================================
    -- 6. VERIFY LINKED ACCOUNT ROLE
    -- =====================================

    IF v_user.role IS DISTINCT FROM
       'company_supervisor' THEN

        RAISE EXCEPTION
            'The linked account is not a company supervisor account.';

    END IF;


    -- =====================================
    -- 7. PROTECT ADMINISTRATIVELY DISABLED
    -- ACCOUNTS
    -- =====================================

    IF v_user.account_status = 'disabled'
       OR v_supervisor.account_status = 'disabled' THEN

        RAISE EXCEPTION
            'This account is administratively disabled and requires separate authorization.';

    END IF;


    -- =====================================
    -- 8. CHECK CURRENT ACCOUNT STATUS
    -- =====================================

    IF v_supervisor.account_status = v_new_status
       AND v_user.account_status = v_new_status THEN

        RAISE EXCEPTION
            'The supervisor account is already %.',
            v_new_status;

    END IF;


    -- =====================================
    -- 9. CHECK ACTIVE INTERNSHIP ASSIGNMENTS
    -- =====================================

    SELECT COUNT(*)::integer
    INTO v_active_assignments
    FROM public.intern_supervisor_assignments
    WHERE supervisor_id = p_supervisor_id
      AND assignment_status = 'active';


    -- =====================================
    -- 10. BLOCK DEACTIVATION IF SUPERVISOR
    -- STILL HAS ACTIVE ASSIGNMENTS
    -- =====================================

    IF v_new_status = 'inactive'
       AND v_active_assignments > 0 THEN

        RAISE EXCEPTION
            'Cannot deactivate this supervisor. There are % active internship assignments. Reassign the affected student interns first.',
            v_active_assignments;

    END IF;


    -- =====================================
    -- 11. UPDATE SUPERVISOR PROFILE STATUS
    -- =====================================

    UPDATE public.company_supervisors
    SET
        account_status = v_new_status,
        updated_at = NOW()
    WHERE id = p_supervisor_id;


    -- =====================================
    -- 12. UPDATE LINKED USER ACCOUNT STATUS
    -- =====================================

    UPDATE public.users
    SET
        account_status = v_new_status,
        updated_at = NOW()
    WHERE id = v_supervisor.user_id;


    -- =====================================
    -- 13. RETURN SUCCESS RESPONSE
    -- =====================================

    RETURN jsonb_build_object(

        'success',
        true,

        'message',
        CASE
            WHEN v_new_status = 'inactive'
            THEN 'Supervisor account deactivated successfully.'
            ELSE 'Supervisor account reactivated successfully.'
        END,

        'supervisor_id',
        v_supervisor.id,

        'user_id',
        v_supervisor.user_id,

        'full_name',
        v_supervisor.full_name,

        'previous_status',
        v_supervisor.account_status,

        'account_status',
        v_new_status,

        'active_assignments',
        v_active_assignments

    );

END;
$$;


--
-- Name: update_supervisor_information(uuid, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_supervisor_information(p_supervisor_id uuid, p_full_name text, p_contact_number text, p_position text, p_department text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
    v_supervisor public.company_supervisors%ROWTYPE;

BEGIN

    -- =====================================
    -- 1. VERIFY COORDINATOR AUTHORIZATION
    -- =====================================

    IF NOT EXISTS (
        SELECT 1
        FROM public.users u
        INNER JOIN public.ojt_coordinators c
            ON c.user_id = u.id
        WHERE u.id = auth.uid()
          AND u.role = 'ojt_coordinator'
          AND u.account_status = 'active'
          AND c.account_status = 'active'
    ) THEN

        RAISE EXCEPTION
            'Unauthorized coordinator account.';

    END IF;


    -- =====================================
    -- 2. VALIDATE REQUIRED INFORMATION
    -- =====================================

    IF p_supervisor_id IS NULL THEN

        RAISE EXCEPTION
            'Supervisor ID is required.';

    END IF;

    IF p_full_name IS NULL
       OR TRIM(p_full_name) = '' THEN

        RAISE EXCEPTION
            'Full name is required.';

    END IF;

    IF p_position IS NULL
       OR TRIM(p_position) = '' THEN

        RAISE EXCEPTION
            'Position is required.';

    END IF;

    IF p_department IS NULL
       OR TRIM(p_department) = '' THEN

        RAISE EXCEPTION
            'Department is required.';

    END IF;


    -- =====================================
    -- 3. VALIDATE INPUT LENGTH
    -- =====================================

    IF CHAR_LENGTH(TRIM(p_full_name)) > 150 THEN

        RAISE EXCEPTION
            'Full name must not exceed 150 characters.';

    END IF;

    IF CHAR_LENGTH(TRIM(p_position)) > 100 THEN

        RAISE EXCEPTION
            'Position must not exceed 100 characters.';

    END IF;

    IF CHAR_LENGTH(TRIM(p_department)) > 100 THEN

        RAISE EXCEPTION
            'Department must not exceed 100 characters.';

    END IF;

    IF CHAR_LENGTH(
        COALESCE(TRIM(p_contact_number), '')
    ) > 30 THEN

        RAISE EXCEPTION
            'Contact number must not exceed 30 characters.';

    END IF;


    -- =====================================
    -- 4. VERIFY SUPERVISOR EXISTS
    -- =====================================

    SELECT *
    INTO v_supervisor
    FROM public.company_supervisors
    WHERE id = p_supervisor_id
    FOR UPDATE;

    IF NOT FOUND THEN

        RAISE EXCEPTION
            'Company supervisor could not be found.';

    END IF;


    -- =====================================
    -- 5. UPDATE SUPERVISOR INFORMATION
    -- =====================================

    UPDATE public.company_supervisors
    SET
        full_name = TRIM(p_full_name),

        contact_number = NULLIF(
            TRIM(p_contact_number),
            ''
        ),

        position = TRIM(p_position),

        department = TRIM(p_department),

        updated_at = NOW()

    WHERE id = p_supervisor_id

    RETURNING *
    INTO v_supervisor;


    -- =====================================
    -- 6. RETURN SUCCESS RESPONSE
    -- =====================================

    RETURN jsonb_build_object(
        'success', true,

        'message',
        'Supervisor information updated successfully.',

        'supervisor_id',
        v_supervisor.id,

        'full_name',
        v_supervisor.full_name,

        'contact_number',
        v_supervisor.contact_number,

        'position',
        v_supervisor.position,

        'department',
        v_supervisor.department,

        'updated_at',
        v_supervisor.updated_at
    );

END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


--
-- Name: refresh_attendance_warehouse(); Type: FUNCTION; Schema: warehouse; Owner: -
--

CREATE FUNCTION warehouse.refresh_attendance_warehouse() RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    SET lock_timeout TO '5s'
    AS $$
DECLARE
    v_started_at TIMESTAMPTZ := clock_timestamp();
BEGIN

    -- Prevent concurrent warehouse refreshes
    IF NOT pg_try_advisory_xact_lock(20261127, 20) THEN
        RAISE EXCEPTION
            'A warehouse refresh is already in progress. Please try again later.'
            USING ERRCODE = '55P03';
    END IF;

    -- Keep source tables consistent during extraction
    LOCK TABLE
        public.students,
        public.company_supervisors,
        public.intern_supervisor_assignments,
        public.attendance
    IN SHARE MODE;

    -- Clear previous warehouse records
    DELETE FROM warehouse.fact_attendance
    WHERE attendance_key IS NOT NULL;

    DELETE FROM warehouse.dim_date
    WHERE date_key IS NOT NULL;

    DELETE FROM warehouse.dim_student
    WHERE student_key IS NOT NULL;

    DELETE FROM warehouse.dim_company
    WHERE company_key IS NOT NULL;

    DELETE FROM warehouse.dim_supervisor
    WHERE supervisor_key IS NOT NULL;

    -- LOAD DATE DIMENSION
    INSERT INTO warehouse.dim_date (
        date_key,
        day_of_month,
        day_name,
        week_number,
        iso_year,
        month_number,
        month_name,
        quarter_number,
        year_number,
        is_weekend
    )
    SELECT DISTINCT
        attendance_date,
        EXTRACT(DAY FROM attendance_date)::SMALLINT,
        TO_CHAR(attendance_date, 'FMDay'),
        EXTRACT(WEEK FROM attendance_date)::SMALLINT,
        EXTRACT(ISOYEAR FROM attendance_date)::SMALLINT,
        EXTRACT(MONTH FROM attendance_date)::SMALLINT,
        TO_CHAR(attendance_date, 'FMMonth'),
        EXTRACT(QUARTER FROM attendance_date)::SMALLINT,
        EXTRACT(YEAR FROM attendance_date)::SMALLINT,
        EXTRACT(ISODOW FROM attendance_date) IN (6, 7)
    FROM public.attendance;

    -- LOAD STUDENT DIMENSION
    INSERT INTO warehouse.dim_student (
        student_key,
        student_id,
        full_name,
        course,
        year_level,
        school_name,
        required_hours,
        ojt_start_date,
        ojt_end_date,
        account_status
    )
    SELECT
        id,
        student_id,
        full_name,
        course,
        year_level,
        school_name,
        required_hours,
        ojt_start_date,
        ojt_end_date,
        account_status
    FROM public.students;

    -- LOAD COMPANY DIMENSION
    INSERT INTO warehouse.dim_company (
        company_name
    )
    SELECT DISTINCT BTRIM(company_name)
    FROM (
        SELECT company_name
        FROM public.students

        UNION

        SELECT company_name
        FROM public.company_supervisors

        UNION

        SELECT company_name
        FROM public.intern_supervisor_assignments
    ) companies
    WHERE company_name IS NOT NULL
    AND BTRIM(company_name) <> '';

    -- LOAD SUPERVISOR DIMENSION
    INSERT INTO warehouse.dim_supervisor (
        supervisor_key,
        supervisor_id,
        full_name,
        company_name,
        department,
        account_status
    )
    SELECT
        id,
        supervisor_id,
        full_name,
        company_name,
        department,
        account_status
    FROM public.company_supervisors;

    -- LOAD ATTENDANCE FACT TABLE
    INSERT INTO warehouse.fact_attendance (
        attendance_key,
        date_key,
        student_key,
        company_key,
        supervisor_key,
        rendered_hours,
        verified_hours,
        attendance_status,
        verification_status,
        sync_status,
        is_complete,
        attendance_count,
        loaded_at
    )
    SELECT
        a.id,
        a.attendance_date,
        s.id,
        dc.company_key,
        ds.supervisor_key,

        COALESCE(a.total_hours_rendered, 0),

        CASE
            WHEN a.verification_status = 'verified'
            AND a.sync_status = 'synced'
            THEN COALESCE(a.total_hours_rendered, 0)
            ELSE 0
        END,

        a.status,
        a.verification_status,
        a.sync_status,

        (
            a.time_in IS NOT NULL
            AND a.time_out IS NOT NULL
            AND a.time_out > a.time_in
        ),

        1,
        v_started_at

    FROM public.attendance a

    JOIN public.students s
        ON a.student_id = s.student_id

    LEFT JOIN LATERAL (
        SELECT
            CASE WHEN COUNT(*) = 1
                THEN (ARRAY_AGG(isa.supervisor_id))[1]
            END AS supervisor_id,

            CASE WHEN COUNT(*) = 1
                THEN MIN(isa.company_name)
            END AS company_name

        FROM public.intern_supervisor_assignments isa
        WHERE isa.student_id = s.id
        AND isa.start_date <= a.attendance_date
        AND (
            isa.end_date IS NULL
            OR isa.end_date >= a.attendance_date
        )
    ) assignment ON TRUE

    LEFT JOIN warehouse.dim_company dc
        ON dc.company_name = BTRIM(assignment.company_name)

    LEFT JOIN warehouse.dim_supervisor ds
        ON ds.supervisor_key = assignment.supervisor_id;

    -- Prevent silent loss of attendance records
    IF (
        SELECT COUNT(*) FROM warehouse.fact_attendance
    ) <> (
        SELECT COUNT(*) FROM public.attendance
    ) THEN
        RAISE EXCEPTION 'ETL attendance count mismatch.';
    END IF;

    -- Return ETL execution summary
    RETURN jsonb_build_object(
        'status', 'success',
        'date_records',
            (SELECT COUNT(*) FROM warehouse.dim_date),
        'student_records',
            (SELECT COUNT(*) FROM warehouse.dim_student),
        'company_records',
            (SELECT COUNT(*) FROM warehouse.dim_company),
        'supervisor_records',
            (SELECT COUNT(*) FROM warehouse.dim_supervisor),
        'attendance_records',
            (SELECT COUNT(*) FROM warehouse.fact_attendance),
        'verified_hours',
            (SELECT COALESCE(SUM(verified_hours), 0)
             FROM warehouse.fact_attendance),
        'unmapped_companies',
            (SELECT COUNT(*)
             FROM warehouse.fact_attendance
             WHERE company_key IS NULL),
        'unmapped_supervisors',
            (SELECT COUNT(*)
             FROM warehouse.fact_attendance
             WHERE supervisor_key IS NULL),
        'execution_time_ms',
            ROUND(
                EXTRACT(
                    EPOCH FROM clock_timestamp() - v_started_at
                ) * 1000,
                2
            ),
        'refreshed_at', v_started_at
    );

END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id text NOT NULL,
    time_in timestamp with time zone NOT NULL,
    time_out timestamp with time zone,
    status text DEFAULT 'Present'::text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    attendance_date date NOT NULL,
    time_in_photo text,
    time_in_location_lat numeric,
    time_in_location_long numeric,
    time_out_photo text,
    time_out_location_lat numeric,
    time_out_location_long numeric,
    total_hours_rendered numeric,
    sync_status text DEFAULT 'synced'::text,
    verification_status text DEFAULT 'provisional'::text,
    submitted_at timestamp with time zone,
    verified_by uuid,
    verified_at timestamp with time zone,
    remarks text,
    client_transaction_id text,
    CONSTRAINT attendance_sync_status_check CHECK ((sync_status = ANY (ARRAY['pending_upload'::text, 'synced'::text]))),
    CONSTRAINT attendance_valid_date_check CHECK ((attendance_date = ((time_in AT TIME ZONE 'Asia/Manila'::text))::date)),
    CONSTRAINT attendance_valid_hours_check CHECK (((total_hours_rendered IS NULL) OR (total_hours_rendered >= (0)::numeric))),
    CONSTRAINT attendance_valid_time_check CHECK (((time_out IS NULL) OR (time_out >= time_in))),
    CONSTRAINT attendance_verification_status_check CHECK ((verification_status = ANY (ARRAY['provisional'::text, 'verified'::text, 'rejected'::text])))
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id bigint NOT NULL,
    table_name text NOT NULL,
    record_id text NOT NULL,
    operation text NOT NULL,
    actor_user_id uuid,
    actor_role text NOT NULL,
    changed_fields text[] DEFAULT '{}'::text[] NOT NULL,
    old_status text,
    new_status text,
    performed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT audit_logs_operation_check CHECK ((operation = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text])))
);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: company_supervisor_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.company_supervisor_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: company_supervisors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_supervisors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    supervisor_id text NOT NULL,
    full_name text NOT NULL,
    email text NOT NULL,
    company_name text NOT NULL,
    department text,
    "position" text,
    contact_number text,
    account_status text DEFAULT 'active'::text,
    date_registered timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT company_supervisors_account_status_check CHECK ((account_status = ANY (ARRAY['active'::text, 'inactive'::text, 'disabled'::text])))
);


--
-- Name: intern_supervisor_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intern_supervisor_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid,
    supervisor_id uuid,
    company_name text NOT NULL,
    assigned_date timestamp with time zone DEFAULT now(),
    assignment_status text DEFAULT 'active'::text,
    assignment_history jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    start_date date,
    end_date date,
    CONSTRAINT intern_supervisor_assignments_assignment_status_check CHECK ((assignment_status = ANY (ARRAY['active'::text, 'inactive'::text, 'ended'::text]))),
    CONSTRAINT valid_assignment_period CHECK (((end_date IS NULL) OR ((start_date IS NOT NULL) AND (end_date >= start_date))))
);


--
-- Name: ojt_coordinators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ojt_coordinators (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    admin_id text NOT NULL,
    full_name text NOT NULL,
    email text NOT NULL,
    contact_number text,
    account_status text DEFAULT 'active'::text,
    date_created timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ojt_coordinators_account_status_check CHECK ((account_status = ANY (ARRAY['active'::text, 'inactive'::text, 'disabled'::text])))
);


--
-- Name: reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reports (
    id bigint NOT NULL,
    student_id text NOT NULL,
    week integer NOT NULL,
    period text NOT NULL,
    status text NOT NULL,
    accomplishments text,
    feedback text,
    comment_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    start_date date,
    end_date date,
    student_reflection text,
    submitted_at timestamp with time zone,
    reviewed_at timestamp with time zone,
    reviewing_supervisor_id uuid,
    supervisor_name text,
    CONSTRAINT reports_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending_review'::text, 'approved'::text, 'returned'::text])))
);


--
-- Name: reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.reports ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.reports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: students; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.students (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id text NOT NULL,
    full_name text NOT NULL,
    email text,
    course text DEFAULT 'BSIT'::text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    year_level text,
    school_name text DEFAULT 'Pamantasan ng Lungsod ng Valenzuela'::text,
    company_name text,
    company_location text,
    department text,
    required_hours integer DEFAULT 486,
    ojt_start_date date,
    ojt_end_date date,
    account_status text DEFAULT 'active'::text,
    first_login boolean DEFAULT true,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT students_account_status_check CHECK ((account_status = ANY (ARRAY['active'::text, 'inactive'::text, 'disabled'::text])))
);


--
-- Name: student_assignments; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.student_assignments WITH (security_invoker='true') AS
 SELECT s.id,
    s.student_id,
    s.full_name,
    s.email,
    s.course,
    s.year_level,
    s.school_name,
    s.company_name,
    s.department,
    s.required_hours,
    s.ojt_start_date,
    s.ojt_end_date,
    s.account_status,
    cs.id AS supervisor_id,
    cs.supervisor_id AS supervisor_ref_id,
    cs.full_name AS supervisor_name,
    cs.email AS supervisor_email,
    cs.company_name AS supervisor_company,
    isa.assignment_status,
    isa.assigned_date
   FROM ((public.students s
     LEFT JOIN public.intern_supervisor_assignments isa ON (((s.id = isa.student_id) AND (isa.assignment_status = 'active'::text))))
     LEFT JOIN public.company_supervisors cs ON ((isa.supervisor_id = cs.id)));


--
-- Name: supervisor_interns; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.supervisor_interns WITH (security_invoker='true') AS
 SELECT cs.id,
    cs.supervisor_id,
    cs.full_name AS supervisor_name,
    cs.email AS supervisor_email,
    cs.company_name,
    cs.department,
    cs."position",
    s.id AS student_id,
    s.student_id AS student_ref_id,
    s.full_name AS student_name,
    s.email AS student_email,
    s.course,
    s.year_level,
    s.required_hours,
    s.ojt_start_date,
    s.ojt_end_date,
    isa.assignment_status,
    isa.assigned_date
   FROM ((public.company_supervisors cs
     LEFT JOIN public.intern_supervisor_assignments isa ON (((cs.id = isa.supervisor_id) AND (isa.assignment_status = 'active'::text))))
     LEFT JOIN public.students s ON ((isa.student_id = s.id)));


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    user_id text,
    role text NOT NULL,
    account_status text DEFAULT 'active'::text,
    first_login boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT users_account_status_check CHECK ((account_status = ANY (ARRAY['active'::text, 'inactive'::text, 'disabled'::text]))),
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['ojt_coordinator'::text, 'student_intern'::text, 'company_supervisor'::text])))
);


--
-- Name: dim_company; Type: TABLE; Schema: warehouse; Owner: -
--

CREATE TABLE warehouse.dim_company (
    company_key bigint NOT NULL,
    company_name text NOT NULL
);


--
-- Name: dim_company_company_key_seq; Type: SEQUENCE; Schema: warehouse; Owner: -
--

ALTER TABLE warehouse.dim_company ALTER COLUMN company_key ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME warehouse.dim_company_company_key_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: dim_date; Type: TABLE; Schema: warehouse; Owner: -
--

CREATE TABLE warehouse.dim_date (
    date_key date NOT NULL,
    day_of_month smallint NOT NULL,
    day_name text NOT NULL,
    week_number smallint NOT NULL,
    iso_year smallint NOT NULL,
    month_number smallint NOT NULL,
    month_name text NOT NULL,
    quarter_number smallint NOT NULL,
    year_number smallint NOT NULL,
    is_weekend boolean NOT NULL
);


--
-- Name: dim_student; Type: TABLE; Schema: warehouse; Owner: -
--

CREATE TABLE warehouse.dim_student (
    student_key uuid NOT NULL,
    student_id text NOT NULL,
    full_name text NOT NULL,
    course text,
    year_level text,
    school_name text,
    required_hours integer,
    ojt_start_date date,
    ojt_end_date date,
    account_status text,
    CONSTRAINT dim_student_required_hours_check CHECK ((required_hours >= 0))
);


--
-- Name: dim_supervisor; Type: TABLE; Schema: warehouse; Owner: -
--

CREATE TABLE warehouse.dim_supervisor (
    supervisor_key uuid NOT NULL,
    supervisor_id text NOT NULL,
    full_name text NOT NULL,
    company_name text NOT NULL,
    department text,
    account_status text
);


--
-- Name: fact_attendance; Type: TABLE; Schema: warehouse; Owner: -
--

CREATE TABLE warehouse.fact_attendance (
    attendance_key uuid NOT NULL,
    date_key date NOT NULL,
    student_key uuid NOT NULL,
    company_key bigint,
    supervisor_key uuid,
    rendered_hours numeric DEFAULT 0 NOT NULL,
    verified_hours numeric DEFAULT 0 NOT NULL,
    attendance_status text,
    verification_status text,
    sync_status text,
    is_complete boolean NOT NULL,
    attendance_count integer DEFAULT 1 NOT NULL,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fact_attendance_attendance_count_check CHECK ((attendance_count = 1)),
    CONSTRAINT fact_attendance_rendered_hours_check CHECK ((rendered_hours >= (0)::numeric)),
    CONSTRAINT fact_attendance_verified_hours_check CHECK ((verified_hours >= (0)::numeric)),
    CONSTRAINT valid_verified_hours CHECK (((verified_hours <= rendered_hours) AND (verified_hours =
CASE
    WHEN ((verification_status = 'verified'::text) AND (sync_status = 'synced'::text)) THEN rendered_hours
    ELSE (0)::numeric
END)))
);


--
-- Name: attendance attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pkey PRIMARY KEY (id);


--
-- Name: attendance attendance_student_date_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_student_date_unique UNIQUE (student_id, attendance_date);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: company_supervisors company_supervisors_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_supervisors
    ADD CONSTRAINT company_supervisors_email_key UNIQUE (email);


--
-- Name: company_supervisors company_supervisors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_supervisors
    ADD CONSTRAINT company_supervisors_pkey PRIMARY KEY (id);


--
-- Name: company_supervisors company_supervisors_supervisor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_supervisors
    ADD CONSTRAINT company_supervisors_supervisor_id_key UNIQUE (supervisor_id);


--
-- Name: intern_supervisor_assignments intern_supervisor_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intern_supervisor_assignments
    ADD CONSTRAINT intern_supervisor_assignments_pkey PRIMARY KEY (id);


--
-- Name: ojt_coordinators ojt_coordinators_admin_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ojt_coordinators
    ADD CONSTRAINT ojt_coordinators_admin_id_key UNIQUE (admin_id);


--
-- Name: ojt_coordinators ojt_coordinators_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ojt_coordinators
    ADD CONSTRAINT ojt_coordinators_email_key UNIQUE (email);


--
-- Name: ojt_coordinators ojt_coordinators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ojt_coordinators
    ADD CONSTRAINT ojt_coordinators_pkey PRIMARY KEY (id);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: reports reports_student_id_week_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_student_id_week_key UNIQUE (student_id, week);


--
-- Name: students students_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (id);


--
-- Name: students students_student_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_student_id_key UNIQUE (student_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: dim_company dim_company_company_name_key; Type: CONSTRAINT; Schema: warehouse; Owner: -
--

ALTER TABLE ONLY warehouse.dim_company
    ADD CONSTRAINT dim_company_company_name_key UNIQUE (company_name);


--
-- Name: dim_company dim_company_pkey; Type: CONSTRAINT; Schema: warehouse; Owner: -
--

ALTER TABLE ONLY warehouse.dim_company
    ADD CONSTRAINT dim_company_pkey PRIMARY KEY (company_key);


--
-- Name: dim_date dim_date_pkey; Type: CONSTRAINT; Schema: warehouse; Owner: -
--

ALTER TABLE ONLY warehouse.dim_date
    ADD CONSTRAINT dim_date_pkey PRIMARY KEY (date_key);


--
-- Name: dim_student dim_student_pkey; Type: CONSTRAINT; Schema: warehouse; Owner: -
--

ALTER TABLE ONLY warehouse.dim_student
    ADD CONSTRAINT dim_student_pkey PRIMARY KEY (student_key);


--
-- Name: dim_student dim_student_student_id_key; Type: CONSTRAINT; Schema: warehouse; Owner: -
--

ALTER TABLE ONLY warehouse.dim_student
    ADD CONSTRAINT dim_student_student_id_key UNIQUE (student_id);


--
-- Name: dim_supervisor dim_supervisor_pkey; Type: CONSTRAINT; Schema: warehouse; Owner: -
--

ALTER TABLE ONLY warehouse.dim_supervisor
    ADD CONSTRAINT dim_supervisor_pkey PRIMARY KEY (supervisor_key);


--
-- Name: dim_supervisor dim_supervisor_supervisor_id_key; Type: CONSTRAINT; Schema: warehouse; Owner: -
--

ALTER TABLE ONLY warehouse.dim_supervisor
    ADD CONSTRAINT dim_supervisor_supervisor_id_key UNIQUE (supervisor_id);


--
-- Name: fact_attendance fact_attendance_pkey; Type: CONSTRAINT; Schema: warehouse; Owner: -
--

ALTER TABLE ONLY warehouse.fact_attendance
    ADD CONSTRAINT fact_attendance_pkey PRIMARY KEY (attendance_key);


--
-- Name: attendance_client_tx_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX attendance_client_tx_uidx ON public.attendance USING btree (client_transaction_id);


--
-- Name: idx_assignments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignments_status ON public.intern_supervisor_assignments USING btree (assignment_status);


--
-- Name: idx_assignments_student_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignments_student_id ON public.intern_supervisor_assignments USING btree (student_id);


--
-- Name: idx_assignments_supervisor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignments_supervisor_id ON public.intern_supervisor_assignments USING btree (supervisor_id);


--
-- Name: idx_attendance_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_date ON public.attendance USING btree (attendance_date);


--
-- Name: idx_attendance_student_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_student_id ON public.attendance USING btree (student_id);


--
-- Name: idx_attendance_sync_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_sync_status ON public.attendance USING btree (sync_status);


--
-- Name: idx_attendance_verification_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_verification_status ON public.attendance USING btree (verification_status);


--
-- Name: idx_audit_logs_performed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_performed_at ON public.audit_logs USING btree (performed_at DESC);


--
-- Name: idx_audit_logs_record; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_record ON public.audit_logs USING btree (table_name, record_id);


--
-- Name: idx_reports_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_status ON public.reports USING btree (status);


--
-- Name: idx_reports_student_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_student_id ON public.reports USING btree (student_id);


--
-- Name: idx_reports_week; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_week ON public.reports USING btree (week);


--
-- Name: idx_students_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_email ON public.students USING btree (email);


--
-- Name: idx_students_student_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_student_id ON public.students USING btree (student_id);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: unique_active_assignment; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX unique_active_assignment ON public.intern_supervisor_assignments USING btree (student_id) WHERE (assignment_status = 'active'::text);


--
-- Name: users_user_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_user_id_key ON public.users USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: idx_fact_attendance_company; Type: INDEX; Schema: warehouse; Owner: -
--

CREATE INDEX idx_fact_attendance_company ON warehouse.fact_attendance USING btree (company_key);


--
-- Name: idx_fact_attendance_date; Type: INDEX; Schema: warehouse; Owner: -
--

CREATE INDEX idx_fact_attendance_date ON warehouse.fact_attendance USING btree (date_key);


--
-- Name: idx_fact_attendance_student; Type: INDEX; Schema: warehouse; Owner: -
--

CREATE INDEX idx_fact_attendance_student ON warehouse.fact_attendance USING btree (student_key);


--
-- Name: idx_fact_attendance_supervisor; Type: INDEX; Schema: warehouse; Owner: -
--

CREATE INDEX idx_fact_attendance_supervisor ON warehouse.fact_attendance USING btree (supervisor_key);


--
-- Name: attendance trg_audit_event; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_event AFTER INSERT OR DELETE OR UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION public.record_audit_event();


--
-- Name: company_supervisors trg_audit_event; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_event AFTER INSERT OR DELETE OR UPDATE ON public.company_supervisors FOR EACH ROW EXECUTE FUNCTION public.record_audit_event();


--
-- Name: intern_supervisor_assignments trg_audit_event; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_event AFTER INSERT OR DELETE OR UPDATE ON public.intern_supervisor_assignments FOR EACH ROW EXECUTE FUNCTION public.record_audit_event();


--
-- Name: ojt_coordinators trg_audit_event; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_event AFTER INSERT OR DELETE OR UPDATE ON public.ojt_coordinators FOR EACH ROW EXECUTE FUNCTION public.record_audit_event();


--
-- Name: reports trg_audit_event; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_event AFTER INSERT OR DELETE OR UPDATE ON public.reports FOR EACH ROW EXECUTE FUNCTION public.record_audit_event();


--
-- Name: students trg_audit_event; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_event AFTER INSERT OR DELETE OR UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public.record_audit_event();


--
-- Name: users trg_audit_event; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_event AFTER INSERT OR DELETE OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.record_audit_event();


--
-- Name: attendance trg_protect_attendance_fields; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_attendance_fields BEFORE INSERT OR UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION public.protect_attendance_fields();


--
-- Name: students trg_protect_student_information; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_student_information BEFORE UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public.protect_student_information();


--
-- Name: reports trg_protect_student_report_changes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_student_report_changes BEFORE INSERT OR UPDATE ON public.reports FOR EACH ROW EXECUTE FUNCTION public.protect_student_report_changes();


--
-- Name: company_supervisors trg_protect_supervisor_profile_fields; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_supervisor_profile_fields BEFORE UPDATE ON public.company_supervisors FOR EACH ROW EXECUTE FUNCTION public.protect_supervisor_profile_fields();


--
-- Name: reports trg_protect_supervisor_report_changes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_supervisor_report_changes BEFORE UPDATE ON public.reports FOR EACH ROW EXECUTE FUNCTION public.protect_supervisor_report_changes();


--
-- Name: users trg_protect_user_account_fields; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_user_account_fields BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.protect_user_account_fields();


--
-- Name: company_supervisors update_company_supervisors_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_company_supervisors_updated_at BEFORE UPDATE ON public.company_supervisors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: intern_supervisor_assignments update_intern_supervisor_assignments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_intern_supervisor_assignments_updated_at BEFORE UPDATE ON public.intern_supervisor_assignments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: ojt_coordinators update_ojt_coordinators_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_ojt_coordinators_updated_at BEFORE UPDATE ON public.ojt_coordinators FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: students update_students_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_students_updated_at BEFORE UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: attendance attendance_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id) ON DELETE CASCADE;


--
-- Name: company_supervisors company_supervisors_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_supervisors
    ADD CONSTRAINT company_supervisors_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: attendance fk_attendance_verified_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT fk_attendance_verified_by FOREIGN KEY (verified_by) REFERENCES public.company_supervisors(id) ON DELETE SET NULL;


--
-- Name: reports fk_reports_reviewing_supervisor; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT fk_reports_reviewing_supervisor FOREIGN KEY (reviewing_supervisor_id) REFERENCES public.company_supervisors(id) ON DELETE SET NULL;


--
-- Name: intern_supervisor_assignments intern_supervisor_assignments_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intern_supervisor_assignments
    ADD CONSTRAINT intern_supervisor_assignments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: intern_supervisor_assignments intern_supervisor_assignments_supervisor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intern_supervisor_assignments
    ADD CONSTRAINT intern_supervisor_assignments_supervisor_id_fkey FOREIGN KEY (supervisor_id) REFERENCES public.company_supervisors(id) ON DELETE CASCADE;


--
-- Name: ojt_coordinators ojt_coordinators_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ojt_coordinators
    ADD CONSTRAINT ojt_coordinators_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: reports reports_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id);


--
-- Name: fact_attendance fact_attendance_company_key_fkey; Type: FK CONSTRAINT; Schema: warehouse; Owner: -
--

ALTER TABLE ONLY warehouse.fact_attendance
    ADD CONSTRAINT fact_attendance_company_key_fkey FOREIGN KEY (company_key) REFERENCES warehouse.dim_company(company_key);


--
-- Name: fact_attendance fact_attendance_date_key_fkey; Type: FK CONSTRAINT; Schema: warehouse; Owner: -
--

ALTER TABLE ONLY warehouse.fact_attendance
    ADD CONSTRAINT fact_attendance_date_key_fkey FOREIGN KEY (date_key) REFERENCES warehouse.dim_date(date_key);


--
-- Name: fact_attendance fact_attendance_student_key_fkey; Type: FK CONSTRAINT; Schema: warehouse; Owner: -
--

ALTER TABLE ONLY warehouse.fact_attendance
    ADD CONSTRAINT fact_attendance_student_key_fkey FOREIGN KEY (student_key) REFERENCES warehouse.dim_student(student_key);


--
-- Name: fact_attendance fact_attendance_supervisor_key_fkey; Type: FK CONSTRAINT; Schema: warehouse; Owner: -
--

ALTER TABLE ONLY warehouse.fact_attendance
    ADD CONSTRAINT fact_attendance_supervisor_key_fkey FOREIGN KEY (supervisor_key) REFERENCES warehouse.dim_supervisor(supervisor_key);


--
-- Name: ojt_coordinators Coordinators can insert coordinators; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators can insert coordinators" ON public.ojt_coordinators FOR INSERT WITH CHECK (public.is_coordinator());


--
-- Name: students Coordinators can insert students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators can insert students" ON public.students FOR INSERT WITH CHECK (public.is_coordinator());


--
-- Name: company_supervisors Coordinators can insert supervisors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators can insert supervisors" ON public.company_supervisors FOR INSERT WITH CHECK (public.is_coordinator());


--
-- Name: users Coordinators can insert users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators can insert users" ON public.users FOR INSERT WITH CHECK (public.is_coordinator());


--
-- Name: intern_supervisor_assignments Coordinators can manage assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators can manage assignments" ON public.intern_supervisor_assignments TO authenticated USING (public.is_coordinator()) WITH CHECK (public.is_coordinator());


--
-- Name: attendance Coordinators can read all attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators can read all attendance" ON public.attendance FOR SELECT USING (public.is_coordinator());


--
-- Name: ojt_coordinators Coordinators can read all coordinators; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators can read all coordinators" ON public.ojt_coordinators FOR SELECT USING (public.is_coordinator());


--
-- Name: reports Coordinators can read all reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators can read all reports" ON public.reports FOR SELECT USING (public.is_coordinator());


--
-- Name: students Coordinators can read all students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators can read all students" ON public.students FOR SELECT USING (public.is_coordinator());


--
-- Name: company_supervisors Coordinators can read all supervisors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators can read all supervisors" ON public.company_supervisors FOR SELECT USING (public.is_coordinator());


--
-- Name: users Coordinators can read all users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators can read all users" ON public.users FOR SELECT USING (public.is_coordinator());


--
-- Name: audit_logs Coordinators can read audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators can read audit logs" ON public.audit_logs FOR SELECT TO authenticated USING (public.is_coordinator());


--
-- Name: ojt_coordinators Coordinators can update all coordinators; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators can update all coordinators" ON public.ojt_coordinators FOR UPDATE USING (public.is_coordinator()) WITH CHECK (public.is_coordinator());


--
-- Name: reports Coordinators can update all reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators can update all reports" ON public.reports FOR UPDATE USING (public.is_coordinator()) WITH CHECK (public.is_coordinator());


--
-- Name: students Coordinators can update all students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators can update all students" ON public.students FOR UPDATE USING (public.is_coordinator()) WITH CHECK (public.is_coordinator());


--
-- Name: company_supervisors Coordinators can update all supervisors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators can update all supervisors" ON public.company_supervisors FOR UPDATE USING (public.is_coordinator()) WITH CHECK (public.is_coordinator());


--
-- Name: users Coordinators can update all users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators can update all users" ON public.users FOR UPDATE USING (public.is_coordinator()) WITH CHECK (public.is_coordinator());


--
-- Name: intern_supervisor_assignments Service role full access to assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access to assignments" ON public.intern_supervisor_assignments USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: company_supervisors Service role full access to company_supervisors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access to company_supervisors" ON public.company_supervisors USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: ojt_coordinators Service role full access to ojt_coordinators; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access to ojt_coordinators" ON public.ojt_coordinators USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: attendance Students can create own attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Students can create own attendance" ON public.attendance FOR INSERT WITH CHECK ((student_id = public.get_student_id()));


--
-- Name: reports Students can create own reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Students can create own reports" ON public.reports FOR INSERT TO authenticated WITH CHECK (((student_id = public.get_student_id()) AND (status = ANY (ARRAY['draft'::text, 'pending_review'::text]))));


--
-- Name: attendance Students can read own attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Students can read own attendance" ON public.attendance FOR SELECT USING ((student_id = public.get_student_id()));


--
-- Name: students Students can read own record; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Students can read own record" ON public.students FOR SELECT USING ((id = public.get_student_uuid()));


--
-- Name: reports Students can read own reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Students can read own reports" ON public.reports FOR SELECT USING ((student_id = public.get_student_id()));


--
-- Name: attendance Students can update own attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Students can update own attendance" ON public.attendance FOR UPDATE USING ((student_id = public.get_student_id())) WITH CHECK ((student_id = public.get_student_id()));


--
-- Name: students Students can update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Students can update own profile" ON public.students FOR UPDATE USING ((id = public.get_student_uuid())) WITH CHECK ((id = public.get_student_uuid()));


--
-- Name: reports Students can update own reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Students can update own reports" ON public.reports FOR UPDATE TO authenticated USING (((student_id = public.get_student_id()) AND (status = ANY (ARRAY['draft'::text, 'returned'::text])))) WITH CHECK (((student_id = public.get_student_id()) AND (status = ANY (ARRAY['draft'::text, 'returned'::text, 'pending_review'::text]))));


--
-- Name: intern_supervisor_assignments Students can view own assignment; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Students can view own assignment" ON public.intern_supervisor_assignments FOR SELECT TO authenticated USING ((student_id = public.get_student_uuid()));


--
-- Name: attendance Supervisors can read assigned attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Supervisors can read assigned attendance" ON public.attendance FOR SELECT USING ((public.is_supervisor() AND (student_id IN ( SELECT s.student_id
   FROM public.students s
  WHERE (s.id = ANY (public.get_assigned_student_uuids()))))));


--
-- Name: reports Supervisors can read assigned reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Supervisors can read assigned reports" ON public.reports FOR SELECT USING ((public.is_supervisor() AND (student_id IN ( SELECT s.student_id
   FROM public.students s
  WHERE (s.id = ANY (public.get_assigned_student_uuids()))))));


--
-- Name: students Supervisors can read assigned students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Supervisors can read assigned students" ON public.students FOR SELECT USING ((public.is_supervisor() AND (id = ANY (public.get_assigned_student_uuids()))));


--
-- Name: intern_supervisor_assignments Supervisors can read own assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Supervisors can read own assignments" ON public.intern_supervisor_assignments FOR SELECT TO authenticated USING ((public.is_supervisor() AND (EXISTS ( SELECT 1
   FROM public.company_supervisors cs
  WHERE ((cs.id = intern_supervisor_assignments.supervisor_id) AND (cs.user_id = auth.uid()) AND (cs.account_status = 'active'::text))))));


--
-- Name: attendance Supervisors can update assigned attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Supervisors can update assigned attendance" ON public.attendance FOR UPDATE USING ((public.is_supervisor() AND (student_id IN ( SELECT s.student_id
   FROM public.students s
  WHERE (s.id = ANY (public.get_assigned_student_uuids())))))) WITH CHECK ((public.is_supervisor() AND (student_id IN ( SELECT s.student_id
   FROM public.students s
  WHERE (s.id = ANY (public.get_assigned_student_uuids()))))));


--
-- Name: reports Supervisors can update assigned reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Supervisors can update assigned reports" ON public.reports FOR UPDATE USING ((public.is_supervisor() AND (student_id IN ( SELECT s.student_id
   FROM public.students s
  WHERE (s.id = ANY (public.get_assigned_student_uuids())))))) WITH CHECK ((public.is_supervisor() AND (student_id IN ( SELECT s.student_id
   FROM public.students s
  WHERE (s.id = ANY (public.get_assigned_student_uuids()))))));


--
-- Name: company_supervisors Supervisors can update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Supervisors can update own profile" ON public.company_supervisors FOR UPDATE TO authenticated USING ((public.is_supervisor() AND (user_id = auth.uid()) AND (account_status = 'active'::text))) WITH CHECK ((public.is_supervisor() AND (user_id = auth.uid()) AND (account_status = 'active'::text)));


--
-- Name: company_supervisors Supervisors can view own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Supervisors can view own profile" ON public.company_supervisors FOR SELECT TO authenticated USING ((public.is_supervisor() AND (user_id = auth.uid()) AND (account_status = 'active'::text)));


--
-- Name: users Users can read own record; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own record" ON public.users FOR SELECT USING ((auth.uid() = id));


--
-- Name: users Users can update own record; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own record" ON public.users FOR UPDATE USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));


--
-- Name: attendance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: company_supervisors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.company_supervisors ENABLE ROW LEVEL SECURITY;

--
-- Name: intern_supervisor_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.intern_supervisor_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: ojt_coordinators; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ojt_coordinators ENABLE ROW LEVEL SECURITY;

--
-- Name: reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

--
-- Name: students; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: dim_company; Type: ROW SECURITY; Schema: warehouse; Owner: -
--

ALTER TABLE warehouse.dim_company ENABLE ROW LEVEL SECURITY;

--
-- Name: dim_date; Type: ROW SECURITY; Schema: warehouse; Owner: -
--

ALTER TABLE warehouse.dim_date ENABLE ROW LEVEL SECURITY;

--
-- Name: dim_student; Type: ROW SECURITY; Schema: warehouse; Owner: -
--

ALTER TABLE warehouse.dim_student ENABLE ROW LEVEL SECURITY;

--
-- Name: dim_supervisor; Type: ROW SECURITY; Schema: warehouse; Owner: -
--

ALTER TABLE warehouse.dim_supervisor ENABLE ROW LEVEL SECURITY;

--
-- Name: fact_attendance; Type: ROW SECURITY; Schema: warehouse; Owner: -
--

ALTER TABLE warehouse.fact_attendance ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict gyVlRAMy4KL7Hi73l3QlsPeHfFkXO9uZzEiRQLdlsN8GaxRry48MHMF5P0saKCM