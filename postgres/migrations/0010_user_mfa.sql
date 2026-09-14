ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret_ciphertext TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_pending_secret_ciphertext TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_recovery_hashes TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled_at TEXT;
