ALTER TABLE order_search_index ADD COLUMN IF NOT EXISTS search_order_blob TEXT NOT NULL DEFAULT '';
ALTER TABLE order_search_index ADD COLUMN IF NOT EXISTS search_finance_blob TEXT NOT NULL DEFAULT '';
ALTER TABLE order_search_index ADD COLUMN IF NOT EXISTS search_material_blob TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS order_search_index_order_blob_trgm_idx ON order_search_index USING gin (search_order_blob gin_trgm_ops);
CREATE INDEX IF NOT EXISTS order_search_index_finance_blob_trgm_idx ON order_search_index USING gin (search_finance_blob gin_trgm_ops);
CREATE INDEX IF NOT EXISTS order_search_index_material_blob_trgm_idx ON order_search_index USING gin (search_material_blob gin_trgm_ops);

UPDATE order_search_index SET source_version='__REBUILD_REQUIRED__';
