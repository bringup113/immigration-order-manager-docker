ALTER TABLE material_files
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS superseded_by_id TEXT REFERENCES material_files(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status_reason TEXT,
  ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status_changed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE material_files DROP CONSTRAINT IF EXISTS material_files_status_check;
ALTER TABLE material_files ADD CONSTRAINT material_files_status_check CHECK (status IN ('ACTIVE','SUPERSEDED','VOIDED'));
ALTER TABLE material_files DROP CONSTRAINT IF EXISTS material_files_sha256_check;
ALTER TABLE material_files ADD CONSTRAINT material_files_sha256_check CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$');

CREATE INDEX IF NOT EXISTS material_files_status_idx ON material_files(material_id,status,uploaded_at DESC);
CREATE INDEX IF NOT EXISTS material_files_superseded_by_idx ON material_files(superseded_by_id);

INSERT INTO role_permissions (role_id,permission)
VALUES ('role_admin','materials.restore')
ON CONFLICT(role_id,permission) DO NOTHING;
