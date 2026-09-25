export async function up(knex) {
  await knex.schema.alterTable('artworks', table => {
    table.string('kind', 30).notNullable().defaultTo('ARTWORK')
    table.index(['kind', 'is_public'])
  })
}

export async function down(knex) {
  await knex.schema.alterTable('artworks', table => {
    table.dropIndex(['kind', 'is_public'])
    table.dropColumn('kind')
  })
}
