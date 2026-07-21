export async function up(knex) {
  await knex.schema.createTable('leave_requests', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('child_id').unsigned().notNullable().references('id').inTable('children')
    table.bigInteger('session_id').unsigned().notNullable().references('id').inTable('class_sessions')
    table.bigInteger('requested_by_user_id').unsigned().notNullable().references('id').inTable('users')
    table.text('reason').notNullable()
    table.enu('status', ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).notNullable().defaultTo('PENDING')
    table.bigInteger('reviewed_by_user_id').unsigned().nullable().references('id').inTable('users')
    table.text('review_note').nullable()
    table.dateTime('reviewed_at').nullable()
    table.timestamps(true, true)
    table.index(['child_id', 'status'])
    table.unique(['child_id', 'session_id'])
  })
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('leave_requests')
}
