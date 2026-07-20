import mysql from 'mysql2/promise'

let pool

export function getDb() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3307),
      user: process.env.DB_USER || 'art_studio_app',
      password: process.env.DB_PASSWORD || 'change-me-local-only',
      database: process.env.DB_NAME || 'art_studio',
      waitForConnections: true,
      connectionLimit: 5,
      charset: 'utf8mb4'
    })
  }
  return pool
}

export async function checkDatabase() {
  const [rows] = await getDb().query('SELECT 1 AS ok')
  return rows[0].ok === 1
}
