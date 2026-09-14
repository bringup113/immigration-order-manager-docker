ALTER TABLE order_applicants
  ADD COLUMN surname TEXT,
  ADD COLUMN given_names TEXT,
  ADD COLUMN birth_date DATE,
  ADD COLUMN sex TEXT CHECK (sex IS NULL OR sex IN ('M','F','X')),
  ADD COLUMN passport_expiry DATE,
  ADD COLUMN issuing_country TEXT,
  ADD COLUMN document_code TEXT,
  ADD COLUMN personal_number TEXT,
  ADD COLUMN mrz_status TEXT NOT NULL DEFAULT 'NOT_SCANNED'
    CHECK (mrz_status IN ('NOT_SCANNED','VALID','NEEDS_REVIEW','MANUALLY_CONFIRMED')),
  ADD COLUMN mrz_confirmed_at TIMESTAMPTZ,
  ADD COLUMN mrz_confirmed_by TEXT REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE order_materials
  ADD COLUMN system_code TEXT,
  ADD CONSTRAINT order_materials_system_code_ck
    CHECK (system_code IS NULL OR system_code='PASSPORT_BIO_PAGE');

CREATE UNIQUE INDEX order_materials_applicant_system_uq
  ON order_materials(order_id,applicant_id,system_code)
  WHERE system_code IS NOT NULL;

CREATE TABLE applicant_mrz_records (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  applicant_id TEXT NOT NULL REFERENCES order_applicants(id) ON DELETE CASCADE,
  material_file_id TEXT NOT NULL REFERENCES material_files(id) ON DELETE CASCADE,
  raw_mrz TEXT NOT NULL,
  parsed_json JSONB NOT NULL,
  checksums_json JSONB NOT NULL,
  overall_status TEXT NOT NULL CHECK (overall_status IN ('VALID','NEEDS_REVIEW','MANUALLY_CONFIRMED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_by TEXT NOT NULL REFERENCES users(id),
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX applicant_mrz_records_applicant_idx
  ON applicant_mrz_records(applicant_id,created_at DESC);
CREATE UNIQUE INDEX applicant_mrz_records_file_uq
  ON applicant_mrz_records(material_file_id);

INSERT INTO order_materials
  (id,order_id,template_id,applicant_id,name,required,expected_date,sequence,notes,system_code)
SELECT 'mat_passport_' || md5(a.id),a.order_id,NULL,a.id,'护照首页',1,NULL,-100,
       '每位申请人的系统固定身份材料', 'PASSPORT_BIO_PAGE'
FROM order_applicants a
WHERE NOT EXISTS (
  SELECT 1 FROM order_materials m
  WHERE m.order_id=a.order_id AND m.applicant_id=a.id AND m.system_code='PASSPORT_BIO_PAGE'
);

INSERT INTO role_permissions(role_id,permission)
VALUES ('role_admin','applicants.write'),('role_admin','applicants.mrz')
ON CONFLICT DO NOTHING;

INSERT INTO search_jobs(entity_type,entity_id)
SELECT 'order',id FROM orders
ON CONFLICT(entity_type,entity_id) DO UPDATE
SET requested_at=clock_timestamp(),available_at=clock_timestamp(),attempts=0;
