const ROLE_DEFINITIONS = [
  ['PARENT', '家长', 10],
  ['TEACHER', '教师', 20],
  ['STUDENT', '学生', 30],
  ['OPERATOR', '运营人员', 40],
  ['ADMIN', '超级管理员', 50]
]

const ROLE_PERMISSIONS = {
  PARENT: ['profile.read', 'child.read', 'course.read', 'course.enroll', 'leave.create', 'artwork.read', 'order.read', 'address.manage'],
  TEACHER: ['profile.read', 'course.read', 'schedule.read', 'attendance.read', 'attendance.write', 'feedback.write', 'artwork.read', 'artwork.write'],
  STUDENT: ['profile.read', 'course.read', 'schedule.read', 'artwork.read', 'feedback.read'],
  OPERATOR: ['admin.access', 'dashboard.read', 'user.read', 'user.write', 'child.read', 'child.write', 'course.read', 'course.write', 'schedule.read', 'schedule.write', 'leave.read', 'leave.review', 'product.read', 'product.write', 'resource.read', 'resource.write', 'order.read', 'order.write', 'announcement.read', 'announcement.write', 'report.read'],
  ADMIN: []
}

const PERMISSIONS = [
  ['profile.read', '查看个人资料', '小程序'], ['child.read', '查看学员档案', '小程序'], ['course.read', '查看课程', '小程序'],
  ['course.enroll', '报名课程', '小程序'], ['leave.create', '提交请假', '小程序'], ['artwork.read', '查看课堂作品', '小程序'],
  ['artwork.write', '上传课堂作品', '小程序'], ['feedback.read', '查看课程反馈', '小程序'], ['feedback.write', '发布课程反馈', '小程序'],
  ['order.read', '查看订单', '小程序'], ['address.manage', '管理收货地址', '小程序'], ['schedule.read', '查看排课', '小程序'],
  ['attendance.read', '查看考勤', '小程序'], ['attendance.write', '确认考勤', '小程序'], ['admin.access', '进入管理台', '后台'],
  ['dashboard.read', '查看运营仪表盘', '后台'], ['user.read', '查看用户', '后台'], ['user.write', '编辑用户', '后台'],
  ['child.write', '编辑学员', '后台'], ['course.write', '编辑课程', '后台'], ['schedule.write', '编辑排课', '后台'],
  ['leave.read', '查看请假', '后台'], ['leave.review', '审批请假', '后台'], ['product.read', '查看商品', '后台'],
  ['product.write', '编辑商品', '后台'], ['resource.read', '查看资源', '后台'], ['resource.write', '编辑资源', '后台'],
  ['order.write', '处理订单', '后台'], ['announcement.read', '查看公告', '后台'], ['announcement.write', '编辑公告', '后台'],
  ['report.read', '查看报表', '后台'], ['identity.manage', '配置身份与权限', '后台'], ['permission.manage', '维护权限目录', '后台'],
  ['settings.manage', '维护系统设置', '后台']
]

export async function up(knex) {
  await knex.raw("ALTER TABLE user_roles MODIFY role ENUM('ADMIN', 'OPERATOR', 'TEACHER', 'PARENT', 'STUDENT') NOT NULL")

  await knex.schema.createTable('role_catalog', table => {
    table.string('code', 30).primary()
    table.string('name', 60).notNullable()
    table.enu('status', ['ACTIVE', 'DISABLED']).notNullable().defaultTo('ACTIVE')
    table.integer('sort_order').notNullable().defaultTo(0)
    table.timestamps(true, true)
  })
  await knex.schema.createTable('permission_catalog', table => {
    table.string('code', 80).primary()
    table.string('name', 120).notNullable()
    table.string('group_name', 60).notNullable().defaultTo('业务权限')
    table.enu('status', ['ACTIVE', 'DISABLED']).notNullable().defaultTo('ACTIVE')
    table.timestamps(true, true)
  })
  await knex.schema.createTable('role_permissions', table => {
    table.string('role_code', 30).notNullable().references('code').inTable('role_catalog').onDelete('CASCADE')
    table.string('permission_code', 80).notNullable().references('code').inTable('permission_catalog').onDelete('CASCADE')
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now())
    table.primary(['role_code', 'permission_code'])
  })
  await knex.schema.createTable('user_permissions', table => {
    table.bigInteger('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE')
    table.string('permission_code', 80).notNullable().references('code').inTable('permission_catalog').onDelete('CASCADE')
    table.enu('effect', ['ALLOW', 'DENY']).notNullable()
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now())
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now())
    table.primary(['user_id', 'permission_code'])
  })

  await knex('role_catalog').insert(ROLE_DEFINITIONS.map(([code, name, sort_order]) => ({ code, name, sort_order })))
  await knex('permission_catalog').insert(PERMISSIONS.map(([code, name, group_name]) => ({ code, name, group_name })))
  const roleRows = []
  for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    const codes = role === 'ADMIN' ? PERMISSIONS.map(([code]) => code) : permissions
    for (const permission_code of codes) roleRows.push({ role_code: role, permission_code })
  }
  await knex('role_permissions').insert(roleRows)
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('user_permissions')
  await knex.schema.dropTableIfExists('role_permissions')
  await knex.schema.dropTableIfExists('permission_catalog')
  await knex.schema.dropTableIfExists('role_catalog')
  await knex.raw("ALTER TABLE user_roles MODIFY role ENUM('ADMIN', 'TEACHER', 'PARENT') NOT NULL")
}
