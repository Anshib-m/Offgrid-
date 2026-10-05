// Dev Postgres without Docker. Any Postgres works: just set DATABASE_URL.
import EmbeddedPostgres from 'embedded-postgres'
import { existsSync } from 'node:fs'

const dir = new URL('../../.pgdata', import.meta.url).pathname
const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port: 5433, persistent: true })
if (!existsSync(`${dir}/PG_VERSION`)) await pg.initialise()
await pg.start()
try { await pg.createDatabase('offgrid') } catch {} // already exists
console.log('postgres ready on :5433')
process.on('SIGINT', async () => { await pg.stop(); process.exit(0) })
