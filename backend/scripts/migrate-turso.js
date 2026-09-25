import { ensureSchema } from '../src/schema.js'
import { rows } from '../src/turso.js'

await ensureSchema()

const tables = await rows("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
console.log(`Turso schema ready: ${tables.map(table => table.name).join(', ')}`)
