import 'dotenv/config'

const connection = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3307),
  user: process.env.DB_USER || 'art_studio_app',
  password: process.env.DB_PASSWORD || 'change-me-local-only',
  database: process.env.DB_NAME || 'art_studio',
  charset: 'utf8mb4'
}

export default {
  development: {
    client: 'mysql2',
    connection,
    migrations: { directory: './migrations', tableName: 'knex_migrations' }
  }
}
