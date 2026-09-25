-- 个人资料由用户主动维护；服务端仍按当前会话校验只能修改本人资料。
INSERT OR IGNORE INTO permission_catalog (code, name, group_name)
VALUES ('profile.write', '编辑个人资料', '小程序');

INSERT OR IGNORE INTO role_permissions (role_code, permission_code)
SELECT roles.code, 'profile.write'
FROM (SELECT 'PARENT' AS code UNION ALL SELECT 'TEACHER' UNION ALL SELECT 'STUDENT' UNION ALL SELECT 'OPERATOR' UNION ALL SELECT 'ADMIN') AS roles
WHERE EXISTS (SELECT 1 FROM permission_catalog WHERE code = 'profile.write');
