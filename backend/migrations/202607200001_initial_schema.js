export async function up(knex) {
  await knex.schema.createTable('users', table => {
    table.bigIncrements('id').primary()
    table.string('wechat_openid', 64).unique().nullable()
    table.string('unionid', 64).unique().nullable()
    table.string('mobile', 32).nullable()
    table.string('display_name', 80).notNullable()
    table.string('avatar_url', 1024).nullable()
    table.timestamps(true, true)
  })

  await knex.schema.createTable('user_roles', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE')
    table.enu('role', ['ADMIN', 'TEACHER', 'PARENT']).notNullable()
    table.unique(['user_id', 'role'])
  })

  await knex.schema.createTable('children', table => {
    table.bigIncrements('id').primary()
    table.string('name', 80).notNullable()
    table.date('birthday').nullable()
    table.enu('gender', ['UNKNOWN', 'MALE', 'FEMALE']).notNullable().defaultTo('UNKNOWN')
    table.text('remark').nullable()
    table.timestamps(true, true)
  })

  await knex.schema.createTable('parent_children', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('parent_user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE')
    table.bigInteger('child_id').unsigned().notNullable().references('id').inTable('children').onDelete('CASCADE')
    table.string('relationship', 30).notNullable().defaultTo('监护人')
    table.unique(['parent_user_id', 'child_id'])
  })

  await knex.schema.createTable('courses', table => {
    table.bigIncrements('id').primary()
    table.string('name', 120).notNullable()
    table.string('age_range', 50).nullable()
    table.integer('default_lesson_count').unsigned().notNullable()
    table.decimal('price', 10, 2).unsigned().notNullable()
    table.text('description').nullable()
    table.enu('status', ['DRAFT', 'ON_SALE', 'OFF_SALE']).notNullable().defaultTo('DRAFT')
    table.timestamps(true, true)
  })

  await knex.schema.createTable('classes', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('course_id').unsigned().notNullable().references('id').inTable('courses')
    table.bigInteger('teacher_user_id').unsigned().nullable().references('id').inTable('users')
    table.string('name', 120).notNullable()
    table.string('campus', 120).nullable()
    table.string('room', 120).nullable()
    table.integer('capacity').unsigned().notNullable().defaultTo(20)
    table.enu('status', ['ACTIVE', 'ARCHIVED']).notNullable().defaultTo('ACTIVE')
    table.timestamps(true, true)
  })

  await knex.schema.createTable('class_sessions', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('class_id').unsigned().notNullable().references('id').inTable('classes').onDelete('CASCADE')
    table.integer('sequence_no').unsigned().notNullable()
    table.dateTime('starts_at').notNullable()
    table.dateTime('ends_at').notNullable()
    table.string('campus', 120).nullable()
    table.string('room', 120).nullable()
    table.enu('status', ['SCHEDULED', 'COMPLETED', 'CANCELLED']).notNullable().defaultTo('SCHEDULED')
    table.timestamps(true, true)
    table.unique(['class_id', 'sequence_no'])
  })

  await knex.schema.createTable('enrollments', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('child_id').unsigned().notNullable().references('id').inTable('children')
    table.bigInteger('class_id').unsigned().notNullable().references('id').inTable('classes')
    table.enu('status', ['ACTIVE', 'PAUSED', 'COMPLETED', 'REFUNDED']).notNullable().defaultTo('ACTIVE')
    table.dateTime('enrolled_at').notNullable().defaultTo(knex.fn.now())
    table.timestamps(true, true)
    table.unique(['child_id', 'class_id'])
  })

  await knex.schema.createTable('attendance', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('session_id').unsigned().notNullable().references('id').inTable('class_sessions').onDelete('CASCADE')
    table.bigInteger('child_id').unsigned().notNullable().references('id').inTable('children')
    table.enu('status', ['PRESENT', 'LEAVE', 'ABSENT']).notNullable().defaultTo('PRESENT')
    table.bigInteger('confirmed_by_user_id').unsigned().nullable().references('id').inTable('users')
    table.dateTime('confirmed_at').nullable()
    table.timestamps(true, true)
    table.unique(['session_id', 'child_id'])
  })

  await knex.schema.createTable('lesson_ledger', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('child_id').unsigned().notNullable().references('id').inTable('children')
    table.bigInteger('enrollment_id').unsigned().nullable().references('id').inTable('enrollments')
    table.bigInteger('session_id').unsigned().nullable().references('id').inTable('class_sessions')
    table.enu('type', ['PURCHASE', 'GIFT', 'DEDUCT', 'REFUND', 'ADJUST', 'FREEZE', 'UNFREEZE']).notNullable()
    table.decimal('quantity', 10, 2).notNullable()
    table.decimal('balance_after', 10, 2).notNullable()
    table.string('reason', 255).notNullable()
    table.string('idempotency_key', 100).unique().nullable()
    table.bigInteger('operator_user_id').unsigned().nullable().references('id').inTable('users')
    table.timestamps(true, true)
    table.index(['child_id', 'created_at'])
  })

  await knex.schema.createTable('products', table => {
    table.bigIncrements('id').primary()
    table.string('name', 160).notNullable()
    table.text('description').nullable()
    table.string('cover_url', 1024).nullable()
    table.enu('status', ['DRAFT', 'ON_SALE', 'OFF_SALE']).notNullable().defaultTo('DRAFT')
    table.timestamps(true, true)
  })

  await knex.schema.createTable('product_skus', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('product_id').unsigned().notNullable().references('id').inTable('products').onDelete('CASCADE')
    table.string('name', 160).notNullable()
    table.string('sku_code', 80).unique().notNullable()
    table.decimal('price', 10, 2).unsigned().notNullable()
    table.integer('stock_quantity').notNullable().defaultTo(0)
    table.timestamps(true, true)
  })

  await knex.schema.createTable('orders', table => {
    table.bigIncrements('id').primary()
    table.string('order_no', 48).unique().notNullable()
    table.bigInteger('buyer_user_id').unsigned().notNullable().references('id').inTable('users')
    table.decimal('total_amount', 10, 2).unsigned().notNullable()
    table.enu('status', ['PENDING_PAYMENT', 'PAID', 'SHIPPED', 'COMPLETED', 'CANCELLED', 'REFUNDED']).notNullable().defaultTo('PENDING_PAYMENT')
    table.dateTime('paid_at').nullable()
    table.timestamps(true, true)
  })

  await knex.schema.createTable('order_items', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('order_id').unsigned().notNullable().references('id').inTable('orders').onDelete('CASCADE')
    table.bigInteger('product_sku_id').unsigned().nullable().references('id').inTable('product_skus')
    table.string('name_snapshot', 160).notNullable()
    table.decimal('unit_price', 10, 2).unsigned().notNullable()
    table.integer('quantity').unsigned().notNullable()
    table.decimal('subtotal', 10, 2).unsigned().notNullable()
  })

  await knex.schema.createTable('payment_records', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('order_id').unsigned().notNullable().references('id').inTable('orders').onDelete('CASCADE')
    table.string('transaction_id', 80).unique().nullable()
    table.enu('status', ['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED']).notNullable().defaultTo('PENDING')
    table.decimal('amount', 10, 2).unsigned().notNullable()
    table.json('raw_payload').nullable()
    table.timestamps(true, true)
  })

  await knex.schema.createTable('notification_logs', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('recipient_user_id').unsigned().notNullable().references('id').inTable('users')
    table.string('template_key', 100).notNullable()
    table.string('business_type', 50).notNullable()
    table.string('business_id', 100).nullable()
    table.enu('status', ['PENDING', 'SENT', 'FAILED']).notNullable().defaultTo('PENDING')
    table.text('failure_reason').nullable()
    table.dateTime('sent_at').nullable()
    table.timestamps(true, true)
  })

  await knex.schema.createTable('artworks', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('child_id').unsigned().notNullable().references('id').inTable('children')
    table.bigInteger('session_id').unsigned().nullable().references('id').inTable('class_sessions')
    table.string('image_url', 1024).notNullable()
    table.string('title', 160).nullable()
    table.enu('status', ['UPLOADED', 'REVIEWING', 'REVIEWED']).notNullable().defaultTo('UPLOADED')
    table.timestamps(true, true)
  })

  await knex.schema.createTable('ai_review_tasks', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('artwork_id').unsigned().notNullable().references('id').inTable('artworks').onDelete('CASCADE')
    table.enu('status', ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED']).notNullable().defaultTo('PENDING')
    table.string('model_version', 100).nullable()
    table.integer('retry_count').unsigned().notNullable().defaultTo(0)
    table.text('failure_reason').nullable()
    table.timestamps(true, true)
  })

  await knex.schema.createTable('ai_review_results', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('task_id').unsigned().notNullable().references('id').inTable('ai_review_tasks').onDelete('CASCADE')
    table.json('dimension_scores').nullable()
    table.json('tags').nullable()
    table.text('feedback').notNullable()
    table.decimal('confidence', 5, 4).nullable()
    table.timestamps(true, true)
    table.unique(['task_id'])
  })

  await knex.schema.createTable('review_audits', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('artwork_id').unsigned().notNullable().references('id').inTable('artworks').onDelete('CASCADE')
    table.bigInteger('reviewer_user_id').unsigned().notNullable().references('id').inTable('users')
    table.text('feedback').notNullable()
    table.enu('status', ['DRAFT', 'PUBLISHED']).notNullable().defaultTo('DRAFT')
    table.timestamps(true, true)
  })
}

export async function down(knex) {
  const tables = ['review_audits', 'ai_review_results', 'ai_review_tasks', 'artworks', 'notification_logs', 'payment_records', 'order_items', 'orders', 'product_skus', 'products', 'lesson_ledger', 'attendance', 'enrollments', 'class_sessions', 'classes', 'courses', 'parent_children', 'children', 'user_roles', 'users']
  for (const table of tables) await knex.schema.dropTableIfExists(table)
}
