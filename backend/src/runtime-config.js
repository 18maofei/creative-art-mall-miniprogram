import 'dotenv/config'

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

export const config = {
  port: Number(process.env.PORT || 3000),
  tursoUrl: process.env.TURSO_DATABASE_URL || '',
  tursoToken: process.env.TURSO_AUTH_TOKEN || '',
  r2: {
    accountId: process.env.R2_ACCOUNT_ID || '',
    bucket: process.env.R2_BUCKET || 'mini-app-picture',
    publicBaseUrl: (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, ''),
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || ''
  }
}

export function requireTursoConfig() {
  return { url: required('TURSO_DATABASE_URL'), authToken: required('TURSO_AUTH_TOKEN') }
}
