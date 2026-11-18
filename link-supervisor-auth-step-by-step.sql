-- ============================================================================
-- LINK SUPERVISOR TO SUPABASE AUTH - STEP BY STEP
-- ============================================================================
-- Run each section separately in Supabase SQL Editor
-- ============================================================================

-- ============================================================================
-- STEP 1: Check if Auth User Exists
-- ============================================================================

SELECT id, email FROM auth.users WHERE email = 'supervisor.test@gmail.com';

-- ============================================================================
-- STEP 2: Create Auth User (ONLY IF STEP 1 RETURNED 0 ROWS)
-- ============================================================================

INSERT INTO auth.users (
  id,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at
)
VALUES (
  gen_random_uuid(),
  'supervisor.test@gmail.com',
  crypt('password123', gen_salt('bf')),
  now(),
  now(),
  now()
);

-- ============================================================================
-- STEP 3: Get the Auth User ID
-- ============================================================================

SELECT id FROM auth.users WHERE email = 'supervisor.test@gmail.com';

-- Copy the UUID from the result above for the next steps

-- ============================================================================
-- STEP 4: Update company_supervisors Table
-- ============================================================================
-- Replace <AUTH_USER_ID> with the UUID from STEP 3

UPDATE company_supervisors
SET user_id = '<AUTH_USER_ID>',
    updated_at = now()
WHERE id = '58dc9279-df3c-4465-b5dd-9e1a71aea2a3';

-- ============================================================================
-- STEP 5: Create users Table Entry
-- ============================================================================
-- Replace <AUTH_USER_ID> with the UUID from STEP 3

INSERT INTO users (
  id,
  email,
  user_id,
  role,
  account_status,
  first_login,
  created_at,
  updated_at
)
VALUES (
  '<AUTH_USER_ID>',
  'supervisor.test@gmail.com',
  'SUP-001',
  'company_supervisor',
  'active',
  true,
  now(),
  now()
);

-- ============================================================================
-- STEP 6: Verify the Linking
-- ============================================================================

SELECT 
  u.id as auth_user_id,
  u.email,
  u.user_id,
  u.role,
  cs.id as supervisor_uuid,
  cs.supervisor_id,
  cs.full_name,
  cs.user_id as supervisor_user_id
FROM users u
LEFT JOIN company_supervisors cs ON cs.user_id = u.id
WHERE u.email = 'supervisor.test@gmail.com';

-- ============================================================================
-- COMPLETE
-- ============================================================================
