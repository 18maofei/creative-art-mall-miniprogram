export async function up(knex) {
  await knex.schema.createTable('shipping_addresses', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE')
    table.string('recipient_name', 80).notNullable()
    table.string('mobile', 32).notNullable()
    table.string('province', 80).notNullable()
    table.string('city', 80).notNullable()
    table.string('district', 80).notNullable()
    table.string('detail', 255).notNullable()
    table.boolean('is_default').notNullable().defaultTo(false)
    table.timestamps(true, true)
    table.index(['user_id', 'is_default'])
  })

  await knex.schema.alterTable('orders', table => {
    // Keep address snapshots so historic orders remain accurate after an address changes.
    table.bigInteger('shipping_address_id').unsigned().nullable().references('id').inTable('shipping_addresses').onDelete('SET NULL')
    table.string('recipient_name_snapshot', 80).nullable()
    table.string('recipient_mobile_snapshot', 32).nullable()
    table.string('shipping_address_snapshot', 512).nullable()
    table.string('tracking_no', 100).nullable()
    table.dateTime('shipped_at').nullable()
    table.dateTime('completed_at').nullable()
    table.dateTime('cancelled_at').nullable()
  })
}

export async function down(knex) {
  await knex.schema.alterTable('orders', table => {
    table.dropForeign(['shipping_address_id'])
    table.dropColumn('shipping_address_id')
    table.dropColumn('recipient_name_snapshot')
    table.dropColumn('recipient_mobile_snapshot')
    table.dropColumn('shipping_address_snapshot')
    table.dropColumn('tracking_no')
    table.dropColumn('shipped_at')
    table.dropColumn('completed_at')
    table.dropColumn('cancelled_at')
  })
  await knex.schema.dropTableIfExists('shipping_addresses')
}
