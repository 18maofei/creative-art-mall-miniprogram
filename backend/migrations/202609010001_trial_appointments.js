const TRIAL_PERMISSIONS = [
  ['trial.read', '查看试听预约', '试听预约'],
  ['trial.write', '处理试听预约', '试听预约']
]

export async function up(knex) {
  await knex.schema.createTable('trial_appointments', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL')
    table.string('guardian_name', 80).notNullable()
    table.string('mobile', 20).notNullable()
    table.string('child_name', 80).notNullable()
    table.integer('child_age').nullable()
    table.bigInteger('course_id').unsigned().nullable().references('id').inTable('courses').onDelete('SET NULL')
    table.date('preferred_date').nullable()
    table.enu('preferred_time', ['ANY', 'MORNING', 'AFTERNOON', 'EVENING']).notNullable().defaultTo('ANY')
    table.text('note').nullable()
    table.enu('status', ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED']).notNullable().defaultTo('PENDING')
    table.bigInteger('handled_by_user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL')
    table.text('handled_note').nullable()
    table.dateTime('handled_at').nullable()
    table.string('idempotency_key', 120).nullable().unique()
    table.timestamps(true, true)
    table.index(['status', 'created_at'])
    table.index(['user_id', 'created_at'])
  })

  await knex('permission_catalog').insert(TRIAL_PERMISSIONS.map(([code, name, group_name]) => ({ code, name, group_name }))).onConflict('code').ignore()
  const roles = await knex('role_catalog').whereIn('code', ['OPERATOR', 'ADMIN']).select('code')
  const permissions = await knex('permission_catalog').whereIn('code', TRIAL_PERMISSIONS.map(([code]) => code)).select('code')
  const rows = []
  for (const role of roles) for (const permission of permissions) rows.push({ role_code: role.code, permission_code: permission.code })
  if (rows.length) await knex('role_permissions').insert(rows).onConflict(['role_code', 'permission_code']).ignore()
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('trial_appointments')
  await knex('role_permissions').whereIn('permission_code', TRIAL_PERMISSIONS.map(([code]) => code)).delete()
  await knex('permission_catalog').whereIn('code', TRIAL_PERMISSIONS.map(([code]) => code)).delete()
}
