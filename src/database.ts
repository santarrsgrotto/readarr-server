import config from './config'
import { Pool } from 'pg'

if (!config.postgres.connectionString) {
  throw new Error('Please set OLP_POSTGRES_CONNECTION_STRING first')
}

const db = new Pool({
  connectionString: config.postgres.connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  keepAlive: true,
})

// Graceful shutdown
async function closeDb() {
  try {
    console.log('Closing database connections...')
    await db.end()
    console.log('Database connections closed.')
  } catch (error) {
    console.error('Error closing database connections:', error)
  }
}

// Catch process exit signals (like Ctrl+C) to close connections gracefully
process.on('SIGINT', async () => {
  await closeDb()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  await closeDb()
  process.exit(0)
})

export default db
