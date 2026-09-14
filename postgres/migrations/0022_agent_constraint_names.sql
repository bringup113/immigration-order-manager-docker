-- Keep PostgreSQL's internal names aligned with the renamed business model.
ALTER TABLE agents RENAME CONSTRAINT customers_pkey TO agents_pkey;
ALTER TABLE agents RENAME CONSTRAINT customers_code_key TO agents_code_key;
ALTER TABLE agents RENAME CONSTRAINT customers_active_check TO agents_active_check;
ALTER TABLE orders RENAME CONSTRAINT orders_customer_id_fkey TO orders_agent_id_fkey;
