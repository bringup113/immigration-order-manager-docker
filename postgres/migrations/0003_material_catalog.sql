CREATE TABLE IF NOT EXISTS material_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL UNIQUE,
  category TEXT,
  default_scope TEXT NOT NULL DEFAULT 'ALL' CHECK (default_scope IN ('COMMON','MAIN','ALL','DEPENDENT')),
  default_required INTEGER NOT NULL DEFAULT 1 CHECK (default_required IN (0,1)),
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS material_catalog_active_idx ON material_catalog(active,category,name);

ALTER TABLE project_material_templates ADD COLUMN IF NOT EXISTS catalog_id TEXT;
CREATE INDEX IF NOT EXISTS project_material_templates_catalog_idx ON project_material_templates(catalog_id);

INSERT INTO material_catalog
  (id,name,name_normalized,category,default_scope,default_required,description,active,version,created_at,updated_at)
SELECT
  'mcat_' || md5(lower(regexp_replace(trim(name), '[[:space:]]+', ' ', 'g'))),
  MIN(name),
  lower(regexp_replace(trim(name), '[[:space:]]+', ' ', 'g')),
  '现有材料',
  CASE WHEN COUNT(DISTINCT scope)=1 THEN MIN(scope) ELSE 'ALL' END,
  CASE WHEN MIN(required)=MAX(required) THEN MIN(required) ELSE 1 END,
  NULL,
  1,
  1,
  CURRENT_TIMESTAMP::text,
  CURRENT_TIMESTAMP::text
FROM project_material_templates
WHERE trim(name)<>''
GROUP BY lower(regexp_replace(trim(name), '[[:space:]]+', ' ', 'g'))
ON CONFLICT (name_normalized) DO NOTHING;

UPDATE project_material_templates p
SET catalog_id=c.id
FROM material_catalog c
WHERE p.catalog_id IS NULL
  AND lower(regexp_replace(trim(p.name), '[[:space:]]+', ' ', 'g'))=c.name_normalized;

INSERT INTO role_permissions (role_id,permission) VALUES
  ('role_admin','material_catalog.read'),
  ('role_admin','material_catalog.write'),
  ('role_readonly','material_catalog.read')
ON CONFLICT DO NOTHING;
