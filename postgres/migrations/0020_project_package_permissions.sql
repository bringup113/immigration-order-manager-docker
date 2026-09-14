-- Project package export/import are separate privileges because they move
-- complete reusable templates and can bulk replace existing project settings.
INSERT INTO role_permissions(role_id,permission) VALUES
  ('role_admin','projects.export'),
  ('role_admin','projects.import')
ON CONFLICT DO NOTHING;
