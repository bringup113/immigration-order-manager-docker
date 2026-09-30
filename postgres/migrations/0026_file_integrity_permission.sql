INSERT INTO role_permissions(role_id, permission)
VALUES ('role_admin', 'system.file_integrity')
ON CONFLICT (role_id, permission) DO NOTHING;
