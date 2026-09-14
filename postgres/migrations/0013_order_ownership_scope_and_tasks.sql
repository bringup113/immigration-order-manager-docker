-- Lightweight ownership and order-scoped work queue for small-team use.
ALTER TABLE roles ADD COLUMN order_scope TEXT NOT NULL DEFAULT 'ALL'
  CHECK (order_scope IN ('ALL', 'OWN'));

ALTER TABLE orders ADD COLUMN owner_user_id TEXT;
UPDATE orders
SET owner_user_id = COALESCE(
  (SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'OWNER' AND u.active = 1 ORDER BY u.created_at LIMIT 1),
  (SELECT u.id FROM users u WHERE u.active = 1 ORDER BY u.created_at LIMIT 1)
)
WHERE owner_user_id IS NULL;
ALTER TABLE orders ALTER COLUMN owner_user_id SET NOT NULL;
ALTER TABLE orders ADD CONSTRAINT orders_owner_user_fk
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT;
CREATE INDEX orders_owner_status_idx ON orders(owner_user_id, status, updated_at DESC);

CREATE TABLE order_tasks (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  due_date DATE NOT NULL,
  priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'COMPLETED')),
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  related_type TEXT CHECK (related_type IS NULL OR related_type IN ('STEP', 'APPLICANT', 'MATERIAL', 'PLAN')),
  related_id TEXT,
  completed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK ((related_type IS NULL) = (related_id IS NULL)),
  CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL))
);
CREATE INDEX order_tasks_order_status_idx ON order_tasks(order_id, status, due_date, priority);
CREATE INDEX order_tasks_owner_status_idx ON order_tasks(owner_user_id, status, due_date);

ALTER TABLE order_search_index ADD COLUMN search_task_blob TEXT NOT NULL DEFAULT '';

INSERT INTO role_permissions (role_id, permission) VALUES
  ('role_admin', 'orders.assign'),
  ('role_admin', 'tasks.read'),
  ('role_admin', 'tasks.write'),
  ('role_readonly', 'tasks.read')
ON CONFLICT DO NOTHING;
