-- ============================================================
-- INTERNTRACK
-- FINAL ATTENDANCE PHOTO STORAGE CONFIGURATION
-- November 27, 2026
-- ============================================================

BEGIN;

-- ============================================================
-- 1. PRIVATE STORAGE BUCKET
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('attendance-photos', 'attendance-photos', false)
ON CONFLICT (id) DO UPDATE
SET public = false;

-- ============================================================
-- 2. REMOVE OUTDATED DEVELOPMENT POLICIES
-- ============================================================

DROP POLICY IF EXISTS
    "Allow public upload to attendance photos"
    ON storage.objects;

DROP POLICY IF EXISTS
    "Allow public read access to attendance photos"
    ON storage.objects;

DROP POLICY IF EXISTS
    "Allow authenticated users to upload attendance photos"
    ON storage.objects;

-- ============================================================
-- 3. COORDINATOR READ ACCESS
-- ============================================================

DROP POLICY IF EXISTS
    "Coordinators can read attendance photos"
    ON storage.objects;

CREATE POLICY "Coordinators can read attendance photos"
ON storage.objects
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (
    bucket_id = 'attendance-photos'
    AND public.is_coordinator()
);

-- ============================================================
-- 4. STUDENT READ ACCESS
-- ============================================================

DROP POLICY IF EXISTS
    "Students can read own attendance photos"
    ON storage.objects;

CREATE POLICY "Students can read own attendance photos"
ON storage.objects
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (
    bucket_id = 'attendance-photos'
    AND public.get_student_id() IS NOT NULL
    AND owner_id = auth.uid()::text
    AND starts_with(
        name,
        public.get_student_id() || '-'
    )
);

-- ============================================================
-- 5. STUDENT UPLOAD ACCESS
-- ============================================================

DROP POLICY IF EXISTS
    "Students can upload own attendance photos"
    ON storage.objects;

CREATE POLICY "Students can upload own attendance photos"
ON storage.objects
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'attendance-photos'
    AND public.get_student_id() IS NOT NULL
    AND owner_id = auth.uid()::text
    AND starts_with(
        name,
        public.get_student_id() || '-'
    )
);

-- ============================================================
-- 6. SUPERVISOR READ ACCESS
-- ============================================================

DROP POLICY IF EXISTS
    "Supervisors can read assigned attendance photos"
    ON storage.objects;

CREATE POLICY "Supervisors can read assigned attendance photos"
ON storage.objects
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (
    bucket_id = 'attendance-photos'
    AND public.is_supervisor()
    AND EXISTS (
        SELECT 1
        FROM public.attendance a
        JOIN public.students s
            ON s.student_id = a.student_id
        WHERE s.id = ANY(
            public.get_assigned_student_uuids()
        )
        AND starts_with(
            objects.name,
            s.student_id || '-'
        )
        AND (
            a.time_in_photo = objects.name
            OR a.time_out_photo = objects.name
            OR right(
                a.time_in_photo,
                length(objects.name) + 1
            ) = '/' || objects.name
            OR right(
                a.time_out_photo,
                length(objects.name) + 1
            ) = '/' || objects.name
        )
    )
);

COMMIT;

-- ============================================================
-- 7. CONFIGURATION VERIFICATION
-- ============================================================

SELECT id, name, public
FROM storage.buckets
WHERE id = 'attendance-photos';

SELECT
    policyname,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'storage'
AND tablename = 'objects'
ORDER BY policyname;

-- ============================================================
-- END OF FILE
-- ============================================================