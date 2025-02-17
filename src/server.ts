import { CronJob } from 'cron'
import { BadRequest, BaseError as FejlError } from 'fejl'
import { AutoRouter } from 'itty-router'
import cluster from 'node:cluster'
import os from 'os'
import bookInfoAuthor from './bookinfo/routes/author'
import bookInfoBulk from './bookinfo/routes/bulk'
import bookInfoChanged from './bookinfo/routes/changed'
import bookInfoEdition from './bookinfo/routes/edition'
import bookInfoSearch from './bookinfo/routes/search'
import bookInfoWork from './bookinfo/routes/work'
import config from './config'
import db from './database'

const tables = await db
  .query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)
  .then((res) => res.rows.map((row) => row.table_name))

if (!['authors', 'editions', 'edition_isbns', 'works'].every((table) => tables.includes(table))) {
  throw new Error(
    'Missing required tables in database, please install Open Library database first: https://github.com/LibrariesHacked/openlibrary-search',
  )
}
if (
  !['goodreads', 'goodreads_authors', 'goodreads_series', 'goodreads_works', 'ratings', 'store'].every((table) =>
    tables.includes(table),
  )
) {
  throw new Error('Missing mapping tables, please install the mapping first: https://github.com/santarrsgrotto/mapping')
}

const clusterMode = os.platform() === 'linux' && config.workers > 1
const mainProcess = clusterMode ? cluster.isPrimary : true
const workers = new Array(config.workers)

if (clusterMode && mainProcess) {
  console.log(`Primary ${process.pid} is running`)

  for (let i = 0; i < config.workers; i++) {
    workers.push(cluster.fork())
  }

  cluster.on('exit', (worker, code, signal) => {
    if (signal !== 'SIGINT' && signal !== 'SIGTERM') {
      console.log(`Restarting worker...`)
      workers.push(cluster.fork())
    }
  })

  process.on('SIGINT', () => kill())
  process.on('SIGTERM', () => kill())
} else {
  const server = Bun.serve({
    hostname: config.hostname,
    port: config.port,
    reusePort: true,
    idleTimeout: 30,
    async fetch(req) {
      console.log(`[${new Date().toISOString()}] Incoming request:`, req.url)

      const router = AutoRouter({
        catch(err) {
          if (!(err instanceof FejlError)) console.error(err)
          const message = err instanceof FejlError ? err.message : 'Internal Server Error'
          const status = err instanceof FejlError ? err.status : 500

          return new Response(JSON.stringify({ message }), {
            status,
            headers: { 'Content-Type': 'application/json' },
          })
        },
      })

      router.get('/bookinfo/v1/author/changed', async ({ params: { since } }) => bookInfoChanged(since))
      router.get('/bookinfo/v1/author/:id', async ({ params: { id }, query }) =>
        bookInfoAuthor(id, (query.edition as string | null) ?? null),
      )
      router.get('/bookinfo/v1/book/:id', async ({ params: { id } }) => bookInfoEdition(id))
      router.get('/bookinfo/v1/work/:id', async ({ params: { id } }) => bookInfoWork(id))
      router.post('/bookinfo/v1/book/bulk', async (req) => req.json().then(bookInfoBulk))

      router.get('/bookinfo/v1/search', async ({ query }) => {
        BadRequest.assert(
          typeof query.q === 'string' && query.q.length > 0,
          'Query (`q`) must be defined in the query parameters a single time as a non-empty string',
        )
        return bookInfoSearch(query.q)
      })

      // Internal route
      router.get('/tasks/cache', async () => {
        if (['127.0.0.1', '::1'].includes(server.requestIP(req)?.address ?? '')) {
          const response = new Response()
          cache()
          return response
        }
      })

      // Internal route
      router.get('/tasks/update', async () => {
        if (['127.0.0.1', '::1'].includes(server.requestIP(req)?.address ?? '')) {
          const response = new Response()
          update()
          return response
        }
      })

      return router.fetch(req)
    },
  })

  if (!clusterMode) {
    process.on('SIGINT', () => kill(server))
    process.on('SIGTERM', () => kill(server))
  }
}

if (mainProcess) {
  new CronJob(config.update.cron, async () => update(), null, true, 'UTC')

  console.log(`Listening on http://${config.hostname}:${config.port}`)
}

function kill(server?: any) {
  if (clusterMode) {
    workers.forEach((worker) => worker.kill())
  } else if (server) {
    server.stop()
  }
}

function cache() {
  Bun.spawn(['bun', 'run', 'src/tasks/cache.ts'], {
    stdio: clusterMode ? ['ignore', 'ignore', 'ignore'] : ['inherit', 'inherit', 'inherit'],
  })
}

function update() {
  Bun.spawn(['bun', 'run', 'src/tasks/update.ts'], {
    stdio: clusterMode ? ['ignore', 'ignore', 'ignore'] : ['inherit', 'inherit', 'inherit'],
  })
}
