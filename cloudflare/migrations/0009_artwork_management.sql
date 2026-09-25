-- 运营人员需要能在管理台维护作品；默认只开放给已拥有后台作品权限的角色。
INSERT OR IGNORE INTO role_permissions (role_code, permission_code)
VALUES ('OPERATOR', 'artwork.read'), ('OPERATOR', 'artwork.write');
