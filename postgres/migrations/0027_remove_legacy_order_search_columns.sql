DROP INDEX IF EXISTS order_search_index_blob_trgm_idx;
DROP INDEX IF EXISTS order_search_index_version_idx;

ALTER TABLE order_search_index
  DROP COLUMN IF EXISTS source_version,
  DROP COLUMN IF EXISTS search_text,
  DROP COLUMN IF EXISTS search_pinyin,
  DROP COLUMN IF EXISTS search_initials,
  DROP COLUMN IF EXISTS search_blob;
