-- Seed once, rather than opening an initialization transaction on every GET.
INSERT INTO exchange_rates(currency,name,rate_per_usd_scaled,updated_at,active) VALUES
('USD','美元',100000000,now(),1),('MYR','马来西亚林吉特',404000000,now(),1),
('HKD','港币',784000000,now(),1),('SGD','新加坡元',135200000,now(),1),('EUR','欧元',85700000,now(),1)
ON CONFLICT(currency) DO NOTHING;
INSERT INTO system_settings(key,value,updated_at) VALUES ('base_currency','USD',now()),('schema_version','1.0',now()) ON CONFLICT(key) DO NOTHING;

CREATE TABLE search_jobs (
  entity_type TEXT NOT NULL CHECK(entity_type IN ('order','customer','project')),
  entity_id TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  available_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(entity_type,entity_id)
);
CREATE INDEX search_jobs_available_idx ON search_jobs(available_at,requested_at);
CREATE TABLE entity_search_index (
  entity_type TEXT NOT NULL CHECK(entity_type IN ('customer','project')),
  entity_id TEXT NOT NULL,
  search_blob TEXT NOT NULL,
  PRIMARY KEY(entity_type,entity_id)
);
CREATE INDEX entity_search_blob_trgm_idx ON entity_search_index USING gin(search_blob gin_trgm_ops);
CREATE INDEX order_search_task_blob_trgm_idx ON order_search_index USING gin(search_task_blob gin_trgm_ops);
CREATE INDEX orders_created_page_idx ON orders(created_at DESC,id DESC);
CREATE INDEX orders_owner_created_page_idx ON orders(owner_user_id,created_at DESC,id DESC);
CREATE INDEX order_progress_latest_idx ON order_progress(order_id,progress_date DESC,created_at DESC);
CREATE INDEX order_progress_pending_idx ON order_progress(order_id,follow_up_date,created_at DESC) WHERE follow_up_done=0 AND follow_up_date IS NOT NULL;

CREATE FUNCTION enqueue_search(kind TEXT, entity TEXT) RETURNS void LANGUAGE sql AS $$
 INSERT INTO search_jobs(entity_type,entity_id) SELECT kind,entity WHERE entity IS NOT NULL
 ON CONFLICT(entity_type,entity_id) DO UPDATE SET requested_at=clock_timestamp(),available_at=clock_timestamp(),attempts=0;
$$;
CREATE FUNCTION queue_order_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'INSERT' THEN
   PERFORM enqueue_search('order',OLD.order_id);
 END IF;
 IF TG_OP <> 'DELETE' THEN
   PERFORM enqueue_search('order',NEW.order_id);
 END IF;
 RETURN NULL;
END;
$$;
-- Separate order trigger avoids looking up a nonexistent order_id in its record.
CREATE FUNCTION queue_order_header_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN PERFORM enqueue_search('order',OLD.id);
 ELSE PERFORM enqueue_search('order',NEW.id); END IF;
 RETURN NULL;
END;
$$;
CREATE TRIGGER orders_search_dirty AFTER INSERT OR UPDATE OR DELETE ON orders FOR EACH ROW EXECUTE FUNCTION queue_order_header_search();
DO $$ DECLARE table_name TEXT; BEGIN
 FOREACH table_name IN ARRAY ARRAY['order_applicants','order_steps','order_plans','order_cash_entries','order_materials','material_files','order_progress','order_tasks'] LOOP
 EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION queue_order_search()',table_name||'_search_dirty',table_name);
 END LOOP;
END $$;
CREATE FUNCTION queue_entity_search() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entity TEXT; kind TEXT;
BEGIN
 IF TG_OP='DELETE' THEN entity=OLD.id; ELSE entity=NEW.id; END IF;
 kind=CASE TG_TABLE_NAME WHEN 'customers' THEN 'customer' ELSE 'project' END;
 PERFORM enqueue_search(kind,entity);
 IF TG_TABLE_NAME='customers' THEN
   INSERT INTO search_jobs(entity_type,entity_id) SELECT 'order',id FROM orders WHERE customer_id=entity ORDER BY id
   ON CONFLICT(entity_type,entity_id) DO UPDATE SET requested_at=clock_timestamp(),available_at=clock_timestamp(),attempts=0;
 END IF;
 RETURN NULL;
END;
$$;
CREATE TRIGGER customers_search_dirty AFTER INSERT OR UPDATE OR DELETE ON customers FOR EACH ROW EXECUTE FUNCTION queue_entity_search();
CREATE TRIGGER projects_search_dirty AFTER INSERT OR UPDATE OR DELETE ON projects FOR EACH ROW EXECUTE FUNCTION queue_entity_search();
CREATE FUNCTION queue_related_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='users' THEN
   INSERT INTO search_jobs(entity_type,entity_id)
   SELECT 'order',id FROM orders WHERE owner_user_id=NEW.id OR id IN (SELECT order_id FROM order_tasks WHERE owner_user_id=NEW.id) ORDER BY id
   ON CONFLICT(entity_type,entity_id) DO UPDATE SET requested_at=clock_timestamp(),available_at=clock_timestamp(),attempts=0;
 ELSE
   INSERT INTO search_jobs(entity_type,entity_id) SELECT DISTINCT 'order',order_id FROM order_plans WHERE channel_id=NEW.id ORDER BY order_id
   ON CONFLICT(entity_type,entity_id) DO UPDATE SET requested_at=clock_timestamp(),available_at=clock_timestamp(),attempts=0;
 END IF;
 RETURN NULL;
END;
$$;
CREATE TRIGGER users_search_dirty AFTER UPDATE OF display_name,username ON users FOR EACH ROW
 WHEN (OLD.display_name IS DISTINCT FROM NEW.display_name OR OLD.username IS DISTINCT FROM NEW.username) EXECUTE FUNCTION queue_related_search();
CREATE TRIGGER channels_search_dirty AFTER UPDATE OF name ON channels FOR EACH ROW
 WHEN (OLD.name IS DISTINCT FROM NEW.name) EXECUTE FUNCTION queue_related_search();
INSERT INTO search_jobs(entity_type,entity_id) SELECT 'order',id FROM orders;
INSERT INTO search_jobs(entity_type,entity_id) SELECT 'customer',id FROM customers;
INSERT INTO search_jobs(entity_type,entity_id) SELECT 'project',id FROM projects;
