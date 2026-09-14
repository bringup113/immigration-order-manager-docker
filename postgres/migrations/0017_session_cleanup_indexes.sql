CREATE INDEX IF NOT EXISTS user_sessions_expiry_cleanup_idx
  ON user_sessions(expires_at,revoked_at,last_seen_at);
