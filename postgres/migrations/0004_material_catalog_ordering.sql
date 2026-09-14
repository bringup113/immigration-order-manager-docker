ALTER TABLE material_catalog ADD COLUMN IF NOT EXISTS sequence INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT id,ROW_NUMBER() OVER (
    ORDER BY CASE WHEN category IS NULL OR category='' THEN 1 ELSE 0 END,category,name,created_at
  )-1 AS sequence
  FROM material_catalog
)
UPDATE material_catalog c SET sequence=r.sequence
FROM ranked r WHERE r.id=c.id;

CREATE INDEX IF NOT EXISTS material_catalog_sequence_idx ON material_catalog(sequence);

DROP INDEX IF EXISTS project_material_templates_catalog_idx;
ALTER TABLE project_material_templates DROP COLUMN IF EXISTS catalog_id;
