export async function up(knex) {
  await knex.schema.alterTable('products', table => {
    table.text('detail_images_json').nullable()
  })
}

export async function down(knex) {
  await knex.schema.alterTable('products', table => {
    table.dropColumn('detail_images_json')
  })
}
