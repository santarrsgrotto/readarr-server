import { BadRequest, BaseError as FejlError } from 'fejl'
import { AutoRouter } from 'itty-router'
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
  !['goodreads', 'goodreads_authors', 'goodreads_series', 'goodreads_works', 'ratings'].every((table) =>
    tables.includes(table),
  )
) {
  throw new Error('Missing mapping tables, please install the mapping first: https://github.com/santarrsgrotto/mapping')
}

const server = Bun.serve({
  hostname: config.hostname,
  port: config.port,
  async fetch(req) {
    console.log('Incoming request:', req.url)

    const router = AutoRouter({
      base: '/bookinfo/v1',
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

    router.get('/author/changed', ({ params: { since } }) => bookInfoChanged(since))
    router.get('/author/:id', ({ params: { id } }) => bookInfoAuthor(id))
    router.get('/book/:id', ({ params: { id } }) => bookInfoEdition(id))
    router.get('/work/:id', ({ params: { id } }) => bookInfoWork(id))
    router.post('/book/bulk', (req) => req.json().then(bookInfoBulk))

    router.get('/search', ({ query }) => {
      BadRequest.assert(
        typeof query.q === 'string' && query.q.length > 0,
        'Query (`q`) must be defined in the query parameters a single time as a non-empty string',
      )
      return bookInfoSearch(query.q)
    })

    return router.fetch(req)
  },
})

console.log(`Listening on http://${config.hostname}:${config.port}`)

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...')
  server.stop()
})
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...')
  server.stop()
})
