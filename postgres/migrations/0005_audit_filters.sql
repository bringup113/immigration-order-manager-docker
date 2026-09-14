CREATE INDEX IF NOT EXISTS audit_logs_username_time_idx ON audit_logs(actor_username_snapshot,occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_type_time_idx ON audit_logs(entity_type,occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_time_idx ON audit_logs(action,occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_result_time_idx ON audit_logs(result,occurred_at DESC);
