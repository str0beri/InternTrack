-- ============================================================================
-- LINK SUPERVISOR TO SUPABASE AUTH
-- ============================================================================
-- This script links the existing supervisor to a Supabase Auth user
-- so they can log in with email/password.
--
-- RUN THIS IN SUPABASE SQL EDITOR
-- ============================================================================

-- ============================================================================
-- CONFIGURATION - UPDATE THESE VALUES
-- ============================================================================

-- Supervisor's login email (change this to your email)
-- Using the same email as student account for testing
-- Change this when transferring to real supervisors

DO $$
DECLARE
  supervisor_email TEXT := 'guelplayah8@gmail.com';  -- CHANGE THIS TO YOUR EMAIL
  supervisor_password TEXT := 'password123';        -- CHANGE THIS PASSWORD
  supervisor_uuid UUID := '58dc9279-df3c-4465-b5dd-9e1a71aea2a3';  -- Existing supervisor UUID
  supervisor_user_id TEXT := 'SUP-001';             -- Supervisor ID
BEGIN
  -- ============================================================================
  -- STEP 1: Check if Auth User Already Exists
  -- ============================================================================
  
  DECLARE
    existing_user_id UUID;
    auth_user_id UUID;
  BEGIN
    SELECT id INTO existing_user_id
    FROM auth.users
    WHERE email = supervisor_email;
    
    IF existing_user_id IS NOT NULL THEN
      RAISE NOTICE 'Auth user already exists with ID: %', existing_user_id;
      auth_user_id := existing_user_id;
    ELSE
      RAISE NOTICE 'Auth user does not exist, will create new one';
      
      -- ============================================================================
      -- STEP 2: Create Auth User
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
        supervisor_email,
        crypt(supervisor_password, gen_salt('bf')),
        now(),
        now(),
        now()
      )
      RETURNING id INTO auth_user_id;
      
      RAISE NOTICE 'Created new auth user with ID: %', auth_user_id;
    END IF;
    
    -- ============================================================================
    -- STEP 3: Update company_supervisors Table
    -- ============================================================================
    
    UPDATE company_supervisors
    SET user_id = auth_user_id,
        updated_at = now()
    WHERE id = supervisor_uuid;
    
    RAISE NOTICE 'Updated company_supervisors.user_id to %', auth_user_id;
    
    -- ============================================================================
    -- STEP 4: Create or Update users Table Entry
    -- ============================================================================
    
    IF EXISTS (SELECT 1 FROM users WHERE id = auth_user_id) THEN
      -- Update existing entry
      UPDATE users
      SET role = 'company_supervisor',
          account_status = 'active',
          updated_at = now()
      WHERE id = auth_user_id;
      
      RAISE NOTICE 'Updated existing users table entry';
    ELSE
      -- Create new entry
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
        auth_user_id,
        supervisor_email,
        supervisor_user_id,
        'company_supervisor',
        'active',
        true,
        now(),
        now()
      );
      
      RAISE NOTICE 'Created new users table entry';
    END IF;
  END;
END $$;

-- ============================================================================
-- STEP 5: Verify the Linking
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
WHERE u.email = 'guelplayah8@gmail.com';

-- ============================================================================
-- COMPLETE
-- ============================================================================
