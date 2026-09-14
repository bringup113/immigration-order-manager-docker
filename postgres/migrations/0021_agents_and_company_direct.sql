-- Customers represented order sources in the original model. Rename the model
-- to agents, remove the misleading customer type, and add one protected source
-- for orders contracted directly by the company.
ALTER TABLE customers RENAME TO agents;
ALTER INDEX customers_name_idx RENAME TO agents_name_idx;

ALTER TABLE agents ADD COLUMN system_managed INTEGER NOT NULL DEFAULT 0 CHECK (system_managed IN (0,1));
ALTER TABLE agents DROP COLUMN customer_type;
CREATE UNIQUE INDEX agents_one_system_managed_uq ON agents(system_managed) WHERE system_managed=1;

ALTER TABLE orders RENAME COLUMN customer_id TO agent_id;
ALTER INDEX orders_customer_idx RENAME TO orders_agent_idx;
ALTER TABLE order_search_index RENAME COLUMN customer_name TO agent_name;

ALTER TABLE search_jobs DROP CONSTRAINT search_jobs_entity_type_check;
UPDATE search_jobs SET entity_type='agent' WHERE entity_type='customer';
ALTER TABLE search_jobs ADD CONSTRAINT search_jobs_entity_type_check CHECK(entity_type IN ('order','agent','project'));

ALTER TABLE entity_search_index DROP CONSTRAINT entity_search_index_entity_type_check;
UPDATE entity_search_index SET entity_type='agent' WHERE entity_type='customer';
ALTER TABLE entity_search_index ADD CONSTRAINT entity_search_index_entity_type_check CHECK(entity_type IN ('agent','project'));

DROP TRIGGER customers_search_dirty ON agents;
CREATE OR REPLACE FUNCTION queue_entity_search() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entity TEXT; kind TEXT;
BEGIN
 IF TG_OP='DELETE' THEN entity=OLD.id; ELSE entity=NEW.id; END IF;
 kind=CASE TG_TABLE_NAME WHEN 'agents' THEN 'agent' ELSE 'project' END;
 PERFORM enqueue_search(kind,entity);
 IF TG_TABLE_NAME='agents' THEN
   INSERT INTO search_jobs(entity_type,entity_id) SELECT 'order',id FROM orders WHERE agent_id=entity ORDER BY id
   ON CONFLICT(entity_type,entity_id) DO UPDATE SET requested_at=clock_timestamp(),available_at=clock_timestamp(),attempts=0;
 END IF;
 RETURN NULL;
END;
$$;
CREATE TRIGGER agents_search_dirty AFTER INSERT OR UPDATE OR DELETE ON agents FOR EACH ROW EXECUTE FUNCTION queue_entity_search();

UPDATE role_permissions SET permission='agents.read' WHERE permission='customers.read';
UPDATE role_permissions SET permission='agents.write' WHERE permission='customers.write';

INSERT INTO agents
  (id,code,name,contact_name,phone,email,country_region,notes,active,version,created_at,updated_at,system_managed)
VALUES
  ('agt_company_direct','DIRECT','公司直营',NULL,NULL,NULL,NULL,'系统内置的直营订单来源',1,1,now(),now(),1)
ON CONFLICT(id) DO UPDATE SET name='公司直营',active=1,system_managed=1,updated_at=now();

INSERT INTO search_jobs(entity_type,entity_id) VALUES ('agent','agt_company_direct')
ON CONFLICT(entity_type,entity_id) DO UPDATE SET requested_at=clock_timestamp(),available_at=clock_timestamp(),attempts=0;
