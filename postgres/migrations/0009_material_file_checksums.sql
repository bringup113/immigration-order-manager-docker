ALTER TABLE material_files ADD COLUMN IF NOT EXISTS sha256 TEXT;

CREATE INDEX IF NOT EXISTS idx_material_files_sha256 ON material_files(sha256);
