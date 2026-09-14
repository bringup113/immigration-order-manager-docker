CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE customers (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  customer_type TEXT NOT NULL DEFAULT 'DIRECT' CHECK (customer_type IN ('DIRECT','AGENT')),
  contact_name TEXT, phone TEXT, email TEXT, country_region TEXT, notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)), version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX customers_name_idx ON customers(name);

CREATE TABLE channels (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, country TEXT,
  contact_name TEXT, phone TEXT, email TEXT, settlement_currency TEXT NOT NULL DEFAULT 'USD', notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)), version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX channels_name_idx ON channels(name);

CREATE TABLE projects (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, country TEXT NOT NULL,
  default_receivable_currency TEXT NOT NULL DEFAULT 'USD', provider_currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  revision_no INTEGER NOT NULL DEFAULT 1 CHECK (revision_no > 0), version INTEGER NOT NULL DEFAULT 1,
  description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX projects_name_idx ON projects(name);

CREATE TABLE project_channels (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)), UNIQUE(project_id,channel_id)
);
CREATE INDEX project_channels_project_idx ON project_channels(project_id);
CREATE UNIQUE INDEX project_channels_one_default_uq ON project_channels(project_id) WHERE is_default=1;

CREATE TABLE project_step_templates (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, sequence INTEGER NOT NULL, required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0,1)),
  due_days INTEGER CHECK (due_days IS NULL OR due_days >= 0), notes TEXT
);
CREATE INDEX project_step_templates_project_idx ON project_step_templates(project_id,sequence);

CREATE TABLE project_plan_templates (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('RECEIVABLE','PAYABLE')), sequence INTEGER NOT NULL,
  name TEXT NOT NULL, currency TEXT NOT NULL, amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  due_days INTEGER CHECK (due_days IS NULL OR due_days >= 0), channel_id TEXT REFERENCES channels(id), notes TEXT
);
CREATE INDEX project_plan_templates_project_idx ON project_plan_templates(project_id,plan_type,sequence);

CREATE TABLE project_material_templates (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'ALL' CHECK (scope IN ('COMMON','MAIN','ALL','DEPENDENT')),
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0,1)), sequence INTEGER NOT NULL DEFAULT 0, notes TEXT
);
CREATE INDEX project_material_templates_project_idx ON project_material_templates(project_id,sequence);

CREATE TABLE orders (
  id TEXT PRIMARY KEY, order_no TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL REFERENCES customers(id),
  project_id TEXT NOT NULL REFERENCES projects(id), project_code_snapshot TEXT NOT NULL,
  project_name_snapshot TEXT NOT NULL, country_snapshot TEXT NOT NULL, project_revision INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','PAUSED','COMPLETED','CANCELLED','REFUNDED')),
  signed_at TEXT, notes TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX orders_customer_idx ON orders(customer_id);
CREATE INDEX orders_project_idx ON orders(project_id);
CREATE INDEX orders_status_idx ON orders(status);

CREATE TABLE order_applicants (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  applicant_type TEXT NOT NULL CHECK (applicant_type IN ('MAIN','DEPENDENT')), relationship TEXT,
  name TEXT NOT NULL, nationality TEXT, passport_no TEXT NOT NULL CHECK (btrim(passport_no) <> ''),
  sequence INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX order_applicants_order_idx ON order_applicants(order_id,sequence);
CREATE UNIQUE INDEX order_applicants_one_main_uq ON order_applicants(order_id) WHERE applicant_type='MAIN';
CREATE UNIQUE INDEX order_applicants_order_passport_uq ON order_applicants(order_id,upper(replace(passport_no,' ','')));

CREATE TABLE order_steps (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, template_id TEXT,
  name TEXT NOT NULL, sequence INTEGER NOT NULL, required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0,1)),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETED','SKIPPED')),
  due_date TEXT, started_at TEXT, completed_at TEXT, notes TEXT,
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX order_steps_order_idx ON order_steps(order_id,sequence);
CREATE INDEX order_steps_due_idx ON order_steps(due_date,status);

CREATE TABLE order_plans (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, template_id TEXT,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('RECEIVABLE','PAYABLE')), sequence INTEGER NOT NULL,
  name TEXT NOT NULL, currency TEXT NOT NULL, planned_amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (planned_amount_minor >= 0),
  budget_rate_scaled BIGINT NOT NULL CHECK (budget_rate_scaled > 0),
  planned_base_minor BIGINT NOT NULL DEFAULT 0 CHECK (planned_base_minor >= 0),
  due_date TEXT, channel_id TEXT REFERENCES channels(id), notes TEXT, version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX order_plans_order_idx ON order_plans(order_id,plan_type,sequence);
CREATE INDEX order_plans_due_idx ON order_plans(due_date);

CREATE TABLE order_cash_entries (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_plan_id TEXT REFERENCES order_plans(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('RECEIPT','PAYMENT')), entry_date TEXT NOT NULL,
  description TEXT NOT NULL, currency TEXT NOT NULL, amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  rate_scaled BIGINT NOT NULL CHECK (rate_scaled > 0), base_amount_minor BIGINT NOT NULL CHECK (base_amount_minor > 0),
  plan_currency TEXT, plan_amount_minor BIGINT CHECK (plan_amount_minor IS NULL OR plan_amount_minor > 0),
  notes TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX order_cash_entries_order_idx ON order_cash_entries(order_id,entry_date);
CREATE INDEX order_cash_entries_plan_idx ON order_cash_entries(order_plan_id);

CREATE TABLE order_materials (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, template_id TEXT,
  applicant_id TEXT REFERENCES order_applicants(id) ON DELETE CASCADE, name TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0,1)), expected_date TEXT,
  sequence INTEGER NOT NULL DEFAULT 0, notes TEXT, version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX order_materials_order_idx ON order_materials(order_id,applicant_id,sequence);
CREATE INDEX order_materials_expected_idx ON order_materials(expected_date);

CREATE TABLE material_files (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  material_id TEXT NOT NULL REFERENCES order_materials(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL, stored_name TEXT NOT NULL, relative_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL, size_bytes BIGINT NOT NULL, uploaded_at TEXT NOT NULL
);
CREATE INDEX material_files_order_idx ON material_files(order_id);
CREATE INDEX material_files_material_idx ON material_files(material_id,uploaded_at);

CREATE TABLE order_progress (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  progress_date TEXT NOT NULL, title TEXT NOT NULL, details TEXT, next_action TEXT, follow_up_date TEXT,
  follow_up_done INTEGER NOT NULL DEFAULT 0 CHECK (follow_up_done IN (0,1)),
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)), created_at TEXT NOT NULL
);
CREATE INDEX order_progress_order_date_idx ON order_progress(order_id,progress_date);
CREATE INDEX order_progress_follow_up_idx ON order_progress(follow_up_date,follow_up_done);

CREATE TABLE exchange_rates (
  currency TEXT PRIMARY KEY, name TEXT NOT NULL, rate_per_usd_scaled BIGINT NOT NULL CHECK (rate_per_usd_scaled > 0),
  updated_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);
CREATE TABLE system_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL);

CREATE TABLE order_search_index (
  order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE, order_no TEXT NOT NULL,
  customer_name TEXT NOT NULL, project_name TEXT NOT NULL, main_applicant TEXT, source_version TEXT NOT NULL,
  search_text TEXT NOT NULL, search_pinyin TEXT NOT NULL, search_initials TEXT NOT NULL,
  search_blob TEXT NOT NULL, match_details TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX order_search_index_order_no_idx ON order_search_index(order_no);
CREATE INDEX order_search_index_version_idx ON order_search_index(source_version);
CREATE INDEX order_search_index_blob_trgm_idx ON order_search_index USING gin (search_blob gin_trgm_ops);

CREATE TABLE roles (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL UNIQUE, description TEXT,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)), active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE, permission TEXT NOT NULL,
  PRIMARY KEY(role_id,permission)
);
CREATE TABLE users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL, username_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL, password_hash TEXT NOT NULL, role_id TEXT NOT NULL REFERENCES roles(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)), must_change_password INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0,1)),
  failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT, last_login_at TEXT, password_changed_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX users_role_idx ON users(role_id);
CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL, revoked_at TEXT, ip TEXT, user_agent TEXT
);
CREATE INDEX user_sessions_user_idx ON user_sessions(user_id,revoked_at,expires_at);
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY, occurred_at TEXT NOT NULL, actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_username_snapshot TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL,
  entity_id TEXT, entity_label TEXT, result TEXT NOT NULL CHECK (result IN ('SUCCESS','FAILURE')),
  summary TEXT NOT NULL, changes_json TEXT, request_id TEXT NOT NULL, ip TEXT, user_agent TEXT
);
CREATE INDEX audit_logs_time_idx ON audit_logs(occurred_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs(actor_user_id,occurred_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type,entity_id,occurred_at DESC);

INSERT INTO roles (id,code,name,description,is_system,active,created_at,updated_at) VALUES
('role_owner','OWNER','系统所有者','系统最高权限，仅可保留和移交',1,1,CURRENT_TIMESTAMP::text,CURRENT_TIMESTAMP::text),
('role_admin','ADMIN','管理员','管理全部业务和普通用户',1,1,CURRENT_TIMESTAMP::text,CURRENT_TIMESTAMP::text),
('role_readonly','READ_ONLY','只读用户','只可查看业务和预览文件',1,1,CURRENT_TIMESTAMP::text,CURRENT_TIMESTAMP::text);

INSERT INTO role_permissions (role_id,permission) VALUES
('role_admin','dashboard.read'),('role_admin','orders.read'),('role_admin','orders.write'),
('role_admin','finance.read'),('role_admin','finance.write'),('role_admin','materials.read'),
('role_admin','materials.write'),('role_admin','materials.download'),('role_admin','customers.read'),
('role_admin','customers.write'),('role_admin','projects.read'),('role_admin','projects.write'),
('role_admin','channels.read'),('role_admin','channels.write'),('role_admin','currencies.read'),
('role_admin','currencies.write'),('role_admin','users.read'),('role_admin','users.write'),
('role_admin','roles.read'),('role_admin','audit.read'),
('role_readonly','dashboard.read'),('role_readonly','orders.read'),('role_readonly','finance.read'),
('role_readonly','materials.read'),('role_readonly','customers.read'),('role_readonly','projects.read'),
('role_readonly','channels.read'),('role_readonly','currencies.read');
