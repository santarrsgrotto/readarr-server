function getString(key: string, defaultValue: string): string {
  const value = process.env[`OLP_${key}`]
  if (!value) return defaultValue
  return value
}

function getNumber(key: string, defaultValue: number): number {
  const value = process.env[`OLP_${key}`]
  if (!value) return defaultValue
  const parsed = Number(value)
  if (isNaN(parsed)) throw new Error(`Invalid number for ${key}: ${value}`)
  return parsed
}

function getBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[`OLP_${key}`]
  if (!value) return defaultValue
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`Invalid boolean for ${key}: ${value}`)
}

const config = {
  hostname: getString('HOSTNAME', '0.0.0.0'),
  port: getNumber('PORT', 8080),
  workers: getNumber('WORKERS', 10),
  postgres: {
    connectionString: getString('POSTGRES_CONNECTION_STRING', ''),
    // Maximum number of connections in the pool
    maxConnections: getNumber('POSTGRES_MAX_CONNECTIONS', 50),
    // Idle timeout in seconds
    idleTimeout: getNumber('POSTGRES_IDLE_TIMEOUT', 30),
    // Timeout for establishing a new connection
    connectionTimeout: getNumber('POSTGRES_CONNECTION_TIMEOUT', 20),
  },
  // 3 character language code
  defaultLanguage: getString('DEFAULT_LANGUAGE', '') ?? null,
  // Bulk endpoint
  bulk: {
    // Maximum number of edition IDs to process
    limit: getNumber('BULK_LIMIT', 50),
  },
  // Changed endpoint
  changed: {
    // Maximum number of IDs to return
    limit: getNumber('CHANGED_LIMIT', 1000),
    // Maximum number of months to look back
    maxMonths: getNumber('CHANGED_MAX_MONTHS', 6),
  },
  // Search endpoint
  search: {
    // Max authors to return via author part of the search
    maxAuthors: getNumber('MAX_AUTHORS', 1),
    // Max books to return via title part of the search
    maxTitles: getNumber('MAX_TITLES', 3),
  },
  // Update process
  update: {
    // How many keys to process per batch
    batchSize: getNumber('UPDATE_BATCH_SIZE', 10),
    // Cron schedule for updating from OL
    cron: getString('UPDATE_CRON', '30 * * * *'),
    // How many times to retry each page before giving up
    retries: getNumber('UPDATE_RETRIES', 1),
    // Seconds to wait on a request before timing out
    timeout: getNumber('UPDATE_TIMEOUT', 30),
  },
}

export default config
