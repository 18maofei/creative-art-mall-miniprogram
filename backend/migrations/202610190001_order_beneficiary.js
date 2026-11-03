export async function up(knex) {
  await knex.schema.alterTable('orders', table => {
    table.bigInteger('course_child_id').unsigned().nullable().references('id').inTable('children').onDelete('SET NULL')
    table.index(['course_child_id'])
  })
}

export async function down(knex) {
  await knex.schema.alterTable('orders', table => {
    table.dropForeign(['course_child_id'])
    table.dropIndex(['course_child_id'])
    table.dropColumn('course_child_id')
  })
}
