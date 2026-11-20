-- Create a test student for the second supervisor
INSERT INTO students (
  id,
  student_id,
  full_name,
  email,
  course,
  company_name,
  required_hours,
  ojt_start_date,
  ojt_end_date,
  created_at,
  updated_at
)
VALUES (
  gen_random_uuid(),
  '24-3336',
  'Jane Marie Cruz',
  'jane.cruz@student.edu.ph',
  'BSIT',
  'Google Philippines',
  486,
  '2024-01-15',
  '2024-06-15',
  now(),
  now()
)
ON CONFLICT (student_id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  email = EXCLUDED.email,
  updated_at = now();

-- Get the student UUID and supervisor UUID for assignment
-- First, get the student UUID
DO $$
DECLARE
  v_student_uuid UUID;
  v_supervisor_uuid UUID;
BEGIN
  SELECT id INTO v_student_uuid FROM students WHERE student_id = '24-3336';
  SELECT id INTO v_supervisor_uuid FROM company_supervisors WHERE supervisor_id = 'SUP-002';
  
  -- Create assignment
  INSERT INTO intern_supervisor_assignments (
    student_id,
    supervisor_id,
    company_name,
    assignment_status,
    created_at,
    updated_at
  )
  VALUES (
    v_student_uuid,
    v_supervisor_uuid,
    'Google Philippines',
    'active',
    now(),
    now()
  )
  ON CONFLICT DO NOTHING;
  
  RAISE NOTICE 'Student UUID: %', v_student_uuid;
  RAISE NOTICE 'Supervisor UUID: %', v_supervisor_uuid;
END $$;

-- Verify the assignment
SELECT 
  s.student_id,
  s.full_name as student_name,
  cs.supervisor_id,
  cs.full_name as supervisor_name,
  isa.assignment_status
FROM intern_supervisor_assignments isa
JOIN students s ON s.id = isa.student_id
JOIN company_supervisors cs ON cs.id = isa.supervisor_id
WHERE s.student_id IN ('24-3335', '24-3336');
