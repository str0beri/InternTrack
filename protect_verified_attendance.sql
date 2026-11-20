-- Trigger function to protect verified attendance records from sync overwrites
CREATE OR REPLACE FUNCTION protect_verified_attendance()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

-- Create trigger on attendance table
DROP TRIGGER IF EXISTS prevent_verified_overwrite ON attendance;

CREATE TRIGGER prevent_verified_overwrite
  BEFORE UPDATE ON attendance
  FOR EACH ROW
  EXECUTE FUNCTION protect_verified_attendance();

-- Comment explaining the trigger
COMMENT ON TRIGGER prevent_verified_overwrite ON attendance IS 
  'Prevents sync from overwriting verified attendance records back to provisional status';

-- Verify the trigger was created
SELECT tgname, tgrelid::regclass, tgtype
FROM pg_trigger
WHERE tgname = 'prevent_verified_overwrite';
