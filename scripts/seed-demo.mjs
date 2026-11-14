// Creates (or resets) the public demo account: a Manager, username "younus ali nahid", password "12345".
// Usage: node scripts/seed-demo.mjs        (reads DATABASE_URL from the environment or .env.local)
// Keep the values in sync with DEMO_USERNAME / DEMO_PASSWORD in src/server/services/auth.ts.
import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import postgres from 'postgres'

const NAME = 'Younus Ali Nahid'
const USERNAME = 'younus ali nahid' // spaces are fine here: login lowercases and trims what is typed
const LEGACY_USERNAME = 'demo' // the first demo account; renamed in place
const PASSWORD = '12345'

if (!process.env.DATABASE_URL && existsSync('.env.local')) {
  const m = readFileSync('.env.local', 'utf8').match(/^DATABASE_URL="?([^"\r\n]+)"?/m)
  if (m) process.env.DATABASE_URL = m[1]
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')

// Same scheme as hashPin(): PBKDF2-SHA256, 150000 iterations, 32-byte key, 16-byte salt, hex.
const salt = randomBytes(16)
const hash = pbkdf2Sync(PASSWORD, salt, 150_000, 32, 'sha256').toString('hex')
const now = Date.now()

const sql = postgres(process.env.DATABASE_URL, { max: 1 })
try {
  const [existing] = await sql`select id from users where username in (${USERNAME}, ${LEGACY_USERNAME}) order by (username = ${USERNAME}) desc limit 1`
  if (existing) {
    await sql`update users set name = ${NAME}, username = ${USERNAME}, role = 'manager', status = 'active', pin_hash = ${hash}, pin_salt = ${salt.toString('hex')}, updated_at = ${now} where id = ${existing.id}`
    console.log('Demo account reset.')
  } else {
    await sql`insert into users (name, username, role, pin_hash, pin_salt, status, created_at, updated_at)
              values (${NAME}, ${USERNAME}, 'manager', ${hash}, ${salt.toString('hex')}, 'active', ${now}, ${now})`
    console.log('Demo account created.')
  }
} finally {
  await sql.end()
}
