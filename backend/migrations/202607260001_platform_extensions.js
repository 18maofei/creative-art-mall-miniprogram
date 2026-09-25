export async function up(knex) {
  await knex.schema.alterTable('users', table => {
    table.enu('status', ['ACTIVE', 'DISABLED']).notNullable().defaultTo('ACTIVE')
    table.string('admin_password_hash', 255).nullable()
  })

  await knex.schema.alterTable('courses', table => {
    table.string('category', 60).nullable()
    table.string('schedule_text', 160).nullable()
    table.string('campus', 120).nullable()
    table.string('room', 120).nullable()
    table.string('teacher_name', 80).nullable()
    table.string('cover_url', 1024).nullable()
  })

  await knex.schema.alterTable('products', table => {
    table.string('category', 60).nullable()
  })

  await knex.schema.alterTable('order_items', table => {
    table.bigInteger('course_id').unsigned().nullable().references('id').inTable('courses')
  })

  await knex.schema.alterTable('artworks', table => {
    table.boolean('is_public').notNullable().defaultTo(true)
  })

  await knex.schema.createTable('analytics_events', table => {
    table.bigIncrements('id').primary()
    table.string('event_name', 100).notNullable()
    table.string('role', 30).nullable()
    table.bigInteger('user_id').unsigned().nullable()
    table.string('page', 160).nullable()
    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now())
    table.index(['created_at'])
  })

  await knex.schema.createTable('resources', table => {
    table.bigIncrements('id').primary()
    table.string('title', 160).notNullable()
    table.string('type', 40).nullable()
    table.string('url', 1024).nullable()
    table.bigInteger('size_bytes').unsigned().nullable()
    table.string('created_by', 80).nullable()
    table.timestamps(true, true)
  })

  await knex.schema.createTable('announcements', table => {
    table.bigIncrements('id').primary()
    table.string('title', 160).notNullable()
    table.text('content').notNullable()
    table.enu('audience', ['ALL', 'PARENT', 'TEACHER']).notNullable().defaultTo('ALL')
    table.enu('status', ['DRAFT', 'PUBLISHED']).notNullable().defaultTo('DRAFT')
    table.dateTime('published_at').nullable()
    table.timestamps(true, true)
  })

  await knex.schema.createTable('session_feedback', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('session_id').unsigned().notNullable().references('id').inTable('class_sessions').onDelete('CASCADE')
    table.bigInteger('child_id').unsigned().nullable().references('id').inTable('children')
    table.bigInteger('teacher_user_id').unsigned().notNullable().references('id').inTable('users')
    table.text('content').notNullable()
    table.text('homework').nullable()
    table.json('images_json').nullable()
    table.enu('status', ['DRAFT', 'PUBLISHED']).notNullable().defaultTo('PUBLISHED')
    table.timestamps(true, true)
    table.index(['child_id', 'created_at'])
  })
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('session_feedback')
  await knex.schema.dropTableIfExists('announcements')
  await knex.schema.dropTableIfExists('resources')
  await knex.schema.dropTableIfExists('analytics_events')
  await knex.schema.alterTable('artworks', table => { table.dropColumn('is_public') })
  await knex.schema.alterTable('order_items', table => {
    table.dropForeign(['course_id'])
    table.dropColumn('course_id')
  })
  await knex.schema.alterTable('products', table => { table.dropColumn('category') })
  await knex.schema.alterTable('courses', table => {
    table.dropColumn('category')
    table.dropColumn('schedule_text')
    table.dropColumn('campus')
    table.dropColumn('room')
    table.dropColumn('teacher_name')
    table.dropColumn('cover_url')
  })
  await knex.schema.alterTable('users', table => {
    table.dropColumn('status')
    table.dropColumn('admin_password_hash')
  })
}
