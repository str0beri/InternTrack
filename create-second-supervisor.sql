-- Create second supervisor profile in users table
INSERT INTO users (id, email, user_id, role, account_status, first_login, created_at, updated_at)
VALUES (
  '864e7a10-0164-4da6-bc0a-69b5d1ece22e',
  'shanedimaz@gmail.com',
  'SUP-002',
  'company_supervisor',
  'active',
  true,
  now(),
  now()
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  user_id = EXCLUDED.user_id,
  role = EXCLUDED.role,
  account_status = EXCLUDED.account_status,
  updated_at = now();

-- Insert company_supervisors record
INSERT INTO company_supervisors (
  id,
  user_id,
  supervisor_id,
  full_name,
  email,
  company_name,
  department,
  position,
  account_status,
  created_at,
  updated_at
)
VALUES (
  gen_random_uuid(),
  '864e7a10-0164-4da6-bc0a-69b5d1ece22e',
  'SUP-002',
  'Engr. Shane Dimaz',
  'shanedimaz@gmail.com',
  'Google Philippines',
  'Engineering',
  'Senior Engineer',
  'active',
  now(),
  now()
)
ON CONFLICT (supervisor_id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  full_name = EXCLUDED.full_name,
  email = EXCLUDED.email,
  updated_at = now();

-- Verify the records
SELECT 
  u.id as users_id,
  u.email as users_email,
  u.user_id as supervisor_id_in_users,
  u.role,
  cs.id as supervisor_uuid,
  cs.supervisor_id,
  cs.full_name as supervisor_name,
  cs.email as supervisor_email
FROM users u
LEFT JOIN company_supervisors cs ON cs.user_id = u.id
WHERE u.email = 'shanedimaz@gmail.com';
