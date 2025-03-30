import type { Author, Edition, Id, Model, Rating, Record, Series, Work } from './types'
import db from './database'
import * as ids from './ids'
import store from './store'
import * as chrono from 'chrono-node'
import ISBN from 'isbn3'

/** Goodreads -> OL author mapping **/
export async function authorToOl(id: string): Promise<string | null> {
  return await db
    .query('SELECT ol FROM goodreads_authors WHERE id = $1', [id])
    .then((res) => res.rows[0]?.ol as string | null)
}

/** Goodreads -> OL edition mapping **/
export async function editionToOl(id: string): Promise<string | null> {
  return await db
    .query('SELECT ol FROM goodreads_editions WHERE id = $1', [id])
    .then((res) => res.rows[0]?.ol as string | null)
}

/** Goodreads -> OL work mapping **/
export async function workToOl(id: string): Promise<string | null> {
  return await db
    .query('SELECT work_ol FROM goodreads_works WHERE edition_id = $1', [id])
    .then((res) => res.rows[0]?.work_ol as string | null)
}

/** Get all editions for a given work ID (can be Goodreads ID or OL) **/
export async function getAuthor(id: string): Promise<Author | null> {
  const key = ids.isGoodreadsId(id) ? await authorToOl(id) : ids.convertOlId(id, 'author')
  if (!key) return null

  return await db
    .query('SELECT * FROM authors WHERE key = $1', [key])
    .then(async (res) => (await processModel(res.rows[0])) as Author | null)
}

/** Bulk fetch authors by OL ID */
export async function getAuthors(ids: Id[]): Promise<Author[]> {
  return await db
    .query<Author>('SELECT * FROM authors WHERE key = ANY($1::text[])', [ids])
    .then((res) => Promise.all(res.rows.map((row) => processModel(row) as unknown as Author)))
    .then((res) => res.filter((author): author is Author => author != null))
}

/** Get the IDs of all authors with new editions since the given date **/
export async function getAuthorsUpdatedSince(date: Date, limit: number): Promise<Id[]> {
  return await db
    .query(
      `
        SELECT key
        FROM works
        WHERE immutable_json_timestamp(data) >= $1::timestamptz
        LIMIT $2
      `,
      [date.toISOString(), limit],
    )
    .then((res) => res.rows.map((row) => row.key as Id))
}

/** Get a work by the given author (can be Goodreads ID or OL) **/
export async function getAuthorWork(id: string): Promise<Work | null> {
  const key = ids.isGoodreadsId(id) ? await authorToOl(id) : ids.convertOlId(id, 'author')
  if (!key) return null

  // Return work with the the most editions
  return await db
    .query(
      `
        SELECT works.*, COUNT(editions.key) AS editions_count
        FROM author_works
        JOIN works ON author_works.work_key = works.key
        JOIN editions ON editions.work_key = works.key
        WHERE author_works.author_key = $1
        GROUP BY works.key
        ORDER BY editions_count DESC
        LIMIT 1
      `,
      [key],
    )
    .then((res) => (res.rows[0] ? (processModel(res.rows[0]) as unknown as Work) : null))
}

/** Get all works by a given author ID **/
export async function getAuthorWorks(id: string, limit?: number | null): Promise<Work[]> {
  const key = ids.isGoodreadsId(id) ? await authorToOl(id) : ids.convertOlId(id, 'author')
  if (!key) return []

  let query: string = `
    SELECT works.*
    FROM author_works
    JOIN works on author_works.work_key = works.key
    WHERE author_key = $1
      AND type = '/type/work'
  `

  // If we're limiting, only return works where the author is the primary author
  if (limit) {
    query += `
      AND (works.data->'authors'->0->'author'->>'key') = author_works.author_key
      ORDER BY works.revision DESC
      LIMIT $2
    `
  } else {
    query += ` ORDER BY works.revision DESC`
  }

  return await db
    .query(query, limit ? [key, limit] : [key])
    .then((res) => Promise.all(res.rows.map(async (row) => (await processModel(row)) as unknown as Work)))
    .then((res) => res.filter((work): work is Work => work != null))
}

/** Retrieves cached response by type and key */
export async function getCache(type: string, key: string): Promise<string | null> {
  const query = `
    SELECT data FROM cache
    WHERE type = $1 AND key = $2
  `

  return await db.query(query, [type, key]).then((res) => (res.rows[0] ? res.rows[0].data : null))
}

/** Get all editions for a given work ID (can be Goodreads ID or OL) **/
export async function getEdition(id: string): Promise<Edition | null> {
  const key = ids.isGoodreadsId(id) ? await editionToOl(id) : ids.convertOlId(id, 'edition')
  if (!key) return null

  return await db
    .query('SELECT * FROM editions WHERE key = $1 AND work_key IS NOT NULL', [key])
    .then((res) => (res.rows[0] ? (processModel(res.rows[0]) as unknown as Edition) : null))
}

/** Get all authors who have over 1000 works **/
export async function getLargeAuthors(): Promise<string[]> {
  const client = await db.connect()

  try {
    await client.query('BEGIN')

    // Ensure the query doesn't time out
    await client.query('SET LOCAL statement_timeout = 0')

    const result = await client.query(
      `
        WITH work_counts AS (
          SELECT author_key, COUNT(DISTINCT work_key) as work_count
          FROM author_works
          GROUP BY author_key
        )
        SELECT author_key
        FROM work_counts
        WHERE work_count > 1000
      `,
    )

    await client.query('COMMIT')

    return Promise.all(result.rows.map((row) => row.author_key))
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** Get data from the key/value store */
export async function getStore(key: string, cache: boolean = true): Promise<any> {
  // Check cache first
  let value = store.get(key)
  if (value !== undefined) {
    return value
  }

  value = await db.query(`SELECT value FROM store WHERE key = $1`, [key]).then((res) => res.rows[0]?.value)

  if (cache) {
    store.set(key, value ?? null)
  }

  return value ?? null
}

/** Saves data to the key/value store */
export async function setStore(key: string, value: any, cache: boolean = true): Promise<void> {
  value = value === null ? null : JSON.stringify(value)

  await db.query(
    `
      INSERT INTO store (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key)
      DO UPDATE SET value = $2
    `,
    [key, value],
  )

  if (cache) {
    store.set(key, value)
  }
}

/**
 * Get the time the records are updated as-of
 * This is defined of days we've gotten the keys for
 * So the records may still be behind until all the keys have been refreshed
 */
export async function getUpdateTime(): Promise<Date> {
  let date: Date
  let updateTime: string = await getStore('update_keys_time')

  if (updateTime) {
    date = new Date(updateTime)
  } else {
    date = await db.query(`SELECT max(last_modified) as date FROM editions`).then((res) => {
      // Set to start of the day UTC
      const date = new Date(res.rows[0].date)
      date.setUTCHours(0, 0, 0, 0)
      return date
    })

    setStore('update_keys_time', date)
  }

  return date
}

/** Saves a datetime to the store */
export async function saveDatetime(key: string, date: Date, dateOnly: boolean = false): Promise<void> {
  let dateString = dateOnly ? date.toISOString().split('T')[0] : date.toISOString()

  await setStore(key, dateString)
}

/** Gets all the keys to process */
export async function getUnprocessedKeys(): Promise<{ authors: string[]; works: string[]; editions: string[] }> {
  return {
    authors: (await getStore('unprocessed_author_keys', false)) ?? [],
    works: (await getStore('unprocessed_work_keys', false)) ?? [],
    editions: (await getStore('unprocessed_edition_keys', false)) ?? [],
  }
}

/** Get all editions for a given work ID (can be Goodreads ID or OL) **/
export async function getWork(id: string): Promise<Work | null> {
  const key = ids.isGoodreadsId(id) ? await workToOl(id) : ids.convertOlId(id, 'work')
  if (!key) return null

  return await db
    .query('SELECT * FROM works WHERE key = $1', [key])
    .then((res) => processModel(res.rows[0]) as unknown as Work | null)
}

/** Get just the main author for a work **/
export async function getWorkAuthor(id: string): Promise<string | null> {
  const key = ids.isGoodreadsId(id) ? await workToOl(id) : ids.convertOlId(id, 'work')
  if (!key) return null

  return await db
    .query(`SELECT data->'authors'->0->'author'->'key' as author_key FROM works WHERE key = $1`, [key])
    .then((res) => res.rows[0]?.author_key as string | null)
}

/** Get a single editions for a given work ID (can be Goodreads ID or OL) **/
export async function getWorkEdition(id: string): Promise<Edition | null> {
  const key = ids.isGoodreadsId(id) ? await workToOl(id) : ids.convertOlId(id, 'work')
  if (!key) return null

  return await db
    .query(
      `
        SELECT * FROM editions
        WHERE work_key = $1
        ORDER BY
          revision DESC,
          (data->'created'->>'value')::timestamp ASC
        LIMIT 1
      `,
      [key],
    )
    .then((res) => processModel(res.rows[0]) as unknown as Edition | null)
}

/** Get all editions for the given OL work keys **/
export async function getWorkEditions(keys: Id[]): Promise<Edition[]> {
  return await db
    .query(
      `
        SELECT * FROM editions
        WHERE work_key = ANY($1::text[])
        ORDER BY
        revision DESC,
        (data->'created'->>'value')::timestamp ASC
      `,
      [keys],
    )
    .then((res) => Promise.all(res.rows.map(async (row) => (await processModel(row)) as unknown as Edition)))
    .then((res) => res.filter((edition): edition is Edition => edition != null))
}

/** Get all ratings for the given OL work keys **/
export async function getWorkRatings(keys: Id[], editions: boolean): Promise<Rating[]> {
  return db
    .query(
      `
        SELECT
          work_key,
          edition_key,
          ROUND(AVG(rating), 1) as average,
          COUNT(*) as count
        FROM ratings
        WHERE work_key = ANY($1::text[])
        ${editions ? '' : 'AND edition_key IS NULL'}
        GROUP BY work_key, edition_key
        ORDER BY edition_key ASC
      `,
      [keys],
    )
    .then(
      (res) =>
        res.rows.map((row) => ({
          // Correctly type the number since pg returns strings for decimals
          workKey: row.work_key,
          editionKey: row.edition_key,
          average: parseFloat(row.average as string),
          count: parseInt(row.count as string, 10),
        })) as Rating[],
    )
}

/** Get the series for the given OL work keys */
export async function getWorkSeries(workKeys: string[]): Promise<Series[]> {
  return db
    .query(
      `
        SELECT DISTINCT series_id
        FROM goodreads_series
        JOIN goodreads_works ON (
            goodreads_series.work_id = goodreads_works.work_id
            AND goodreads_works.work_ol IS NOT NULL
          )
        WHERE work_ol = ANY($1::text[])
      `,
      [workKeys],
    )
    .then((res) => {
      // Get the full series for all the series IDs we found
      return db
        .query(
          `
            SELECT DISTINCT ON (goodreads_series.work_id) goodreads_series.*, goodreads_works.work_ol
            FROM goodreads_series
            JOIN goodreads_works ON (
              goodreads_series.work_id = goodreads_works.work_id
              AND goodreads_works.work_ol IS NOT NULL
            )
            WHERE series_id = ANY($1::integer[])
          `,
          [res.rows.map((row) => row.series_id)],
        )
        .then((res: { rows: any[] }) =>
          // Need to format columns into camel case
          res.rows.map((row) => ({
            // workId is OL ID in Readarr format
            workId: ids.encodeReadarrId(row.work_ol),
            seriesId: row.series_id,
            position: row.position,
            title: row.title,
          })),
        )
    })
}

/** Normalise model values */
export async function processModel(row: any): Promise<Model | null> {
  if (!row) return row

  // If redirect then fetch the correct model
  if (row.data.type.key == '/type/redirect') {
    const redirectKey = row.data.location

    // No redirecting to self
    if (redirectKey === row.key) {
      throw new Error(`Invalid redirect for: ${row.key}`)
    }

    if (redirectKey.startsWith('/authors')) {
      return await getAuthor(redirectKey)
    } else if (redirectKey.startsWith('/books/')) {
      return await getEdition(redirectKey)
    } else if (redirectKey.startsWith('/works/')) {
      return await getWork(redirectKey)
    }
  }

  const model = Object.fromEntries(
    Object.entries(row.data ?? []).map(([key, value]) => [toCamelCase(key), value]),
  ) as typeof row.data

  if (model.type.key == '/type/author') {
    if (model.bio?.value) {
      model.bio = model.bio.value
    }
  } else if (model.type.key == '/type/edition') {
    model.workKey = model.works?.[0]?.key

    if (model.languages) {
      // Languages should be a flat array of language codes
      model.languages = model.languages
        .filter((language: { key?: string }) => language && language.key)
        .map((language: { key: string }) => language.key.replace('/languages/', ''))
    }

    if (model.works) {
      // Works should be flat array of IDs
      model.works = model.works
        .filter((work: { key?: string }) => work && work.key)
        .map((work: { key: string }) => work.key)
    }

    if (model.authors) {
      // Authors should be flat array of IDs
      model.authors = model.authors
        .filter((author: { key?: string }) => author.key)
        .map((author: { key: string }) => author.key)
    } else if (model.workKey) {
      const workAuthor = await getWorkAuthor(model.workKey)

      if (workAuthor) {
        model.authors = [workAuthor]
      }
    }

    // This is a year not a date
    if (model?.publishDate) {
      model.publishDate = toDate(model.publishDate)
    }

    // ISBNs
    model.isbn_10 = Array.isArray(model.isbn_10) ? model.isbn_10 : []
    model.isbn_13 = Array.isArray(model.isbn_13) ? model.isbn_13 : []

    const validIsbn10Set = new Set<string>()
    const validIsbn13Set = new Set<string>()

    model.isbn_10.forEach((isbn: string) => {
      const parsedIsbn = ISBN.parse(isbn)
      if (parsedIsbn && parsedIsbn.isIsbn10 && parsedIsbn.isbn10 && parsedIsbn.isValid) {
        validIsbn10Set.add(parsedIsbn.isbn10)
        const converted = ISBN.asIsbn13(parsedIsbn.isbn10)
        if (converted) validIsbn13Set.add(converted)
      }
    })
    model.isbn_13.forEach((isbn: string) => {
      const parsedIsbn = ISBN.parse(isbn)
      if (parsedIsbn && parsedIsbn.isIsbn13 && parsedIsbn.isbn13 && parsedIsbn.isValid) {
        validIsbn13Set.add(parsedIsbn.isbn13)
        const converted = ISBN.asIsbn10(parsedIsbn.isbn13)
        if (converted) validIsbn10Set.add(converted)
      }
    })
    model.isbn_10 = Array.from(validIsbn10Set)
    model.isbn_13 = Array.from(validIsbn13Set)
  } else if (model.type.key == '/type/work') {
    if (model.authors) {
      model.contributors = []

      // We set authors to just being actual authors
      // Contributors contains authors and anyone else along with their role
      model.authors = model.authors
        .map((author: { author?: { key?: string; type?: string } }) => {
          if (author.author?.key && (!author.author?.type || author.author.type === '/type/author_role')) {
            model.contributors.push({
              type: author.author.type ?? '/type/author_role',
              key: author.author.key,
            })
            return author.author.key
          } else if (author.author?.key && author.author?.type) {
            model.contributors.push({ type: author.author.type, key: author.author.key })
          }
          return null
        })
        .filter((authorId: string | null): authorId is string => authorId !== null)
    }
  }

  if (model?.description && model.description.value) {
    model.description = model.description.value
  }

  if (model?.created) {
    model.created = toDate(model.created.value)
  }
  if (model?.lastModified) {
    model.lastModified = toDate(model.lastModified.value)
  }

  return model
}

/** Update unprocessed keys queue based on a batch */
export async function saveBatchUpdate(type: string, size: number, failedKeys: string[]): Promise<void> {
  // Remove first N (size) elements and then add back failed keys at the end of the queue
  const sql = `
    WITH current_data AS (
      SELECT value AS existing_value FROM store WHERE key = $1
    ),
    chopped_data AS (
      SELECT
        COALESCE(jsonb_agg(element), '[]'::jsonb) AS modified_array
      FROM (
        SELECT element
        FROM jsonb_array_elements((SELECT existing_value FROM current_data)) WITH ORDINALITY AS e(element, ord)
        WHERE ord > $3
      ) elems
    ),
    new_data AS (
      SELECT jsonb_agg(element) AS new_array
      FROM (
        SELECT element FROM jsonb_array_elements((SELECT modified_array FROM chopped_data)) AS element
        UNION ALL
        SELECT element::jsonb FROM jsonb_array_elements(array_to_json($2::text[])::jsonb) AS element
      ) all_elements
    )
    UPDATE store SET value = (SELECT new_array FROM new_data) WHERE key = $1
    RETURNING *;
  `

  // Save in a transaction
  try {
    await db.query('BEGIN')
    await db.query(sql, [`unprocessed_${type}_keys`, failedKeys, size])
    await db.query('COMMIT')
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  }
}

/** Whether or not a key has been cached */
export async function isCached(type: string, key: string): Promise<boolean> {
  const query = `
    SELECT 1 FROM cache
    WHERE type = $1 AND key = $2
  `

  return db.query(query, [type, key]).then((result) => result.rows.length > 0)
}

/** Cache a JSON response for a record **/
export async function saveCache(type: string, key: string, data: string): Promise<void> {
  const query = `
    INSERT INTO cache (type, key, data, last_modified)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (type, key)
    DO UPDATE SET data = $3, last_modified = $4
  `

  await db.query(query, [type, key, data, new Date().toISOString()])
}

/** Save a model to the database */
export async function saveModel(record: Record): Promise<void> {
  const table = (() => {
    if (record.key.startsWith('/authors/')) return 'authors'
    if (record.key.startsWith('/works/')) return 'works'
    if (record.key.startsWith('/books/')) return 'editions'
    throw new Error(`Unknown model key type: ${record.key}`)
  })()

  const columns = ['type', 'key', 'revision', 'last_modified', 'data']
  const values: (string | number | null)[] = [
    record.type.key,
    record.key,
    record.revision,
    record.last_modified.value,
    JSON.stringify(record),
  ]

  let placeholderIndex = 1
  const placeholders = columns.map(() => `$${placeholderIndex++}`)

  // Edition table has an extra column
  if (table === 'editions') {
    columns.push('work_key')
    values.push(record.works?.[0]?.key ?? null)
    placeholders.push(`$${placeholderIndex++}`)
  }

  // Update author_works table
  if (table === 'works' && record.authors?.[0]?.author.key) {
    await db.query(
      `
      INSERT INTO author_works (author_key, work_key)
      VALUES ($1, $2)
      ON CONFLICT (author_key, work_key)
      DO NOTHING
    `,
      [record.authors[0].author.key, record.key],
    )
  }

  const updateSet = columns
    .filter((col) => col !== 'key')
    .map((col) => `${col} = EXCLUDED.${col}`)
    .join(', ')

  const query = `
    INSERT INTO ${table} (${columns.join(', ')})
    VALUES (${placeholders.join(', ')})
    ON CONFLICT (key)
    DO UPDATE SET ${updateSet}
  `

  await db.query(query, values)
}

function toCamelCase(str: string): string {
  return str.replace(/([-_][a-z])/gi, (match) => match.toUpperCase().replace('-', '').replace('_', ''))
}

function toDate(str: string): Date | null {
  // Chrono can parse dates in most formats
  let date = chrono.parseDate(str)
  if (date) return date

  // Often we just get a 4 digit year
  if (/^\d{4}$/.test(str)) {
    date = new Date(parseInt(str), 0, 1)
    if (!isNaN(date.getTime())) return date
  }

  // If it can't parse, check if we have 3 blocks of numbers
  const dateParts = str.match(/\d+/g)
  if (!dateParts || dateParts.length !== 3) {
    return null
  }

  let year, month, day
  let [first, second, third] = dateParts.map(Number)

  const currentYearTwoDigits = new Date().getFullYear() % 100

  // Attempt to work out which part is which
  // Heuristics based on valid values for each part
  if (third > 31) {
    year = third

    if (first <= 12 && second <= 31) {
      day = second
      month = first
    } else if (second <= 12 && first <= 31) {
      day = first
      month = second
    } else {
      return null
    }
  } else if (first > 31) {
    day = third
    month = second
    year = first
  } else if (first > 12) {
    day = first
    month = second
    year = third <= currentYearTwoDigits ? 2000 + third : 1900 + third
  } else {
    day = second
    month = first
    year = third <= currentYearTwoDigits ? 2000 + third : 1900 + third
  }

  // Sometimes dates are readable but invalid e.g. 31/2/2024
  // The Date here looks wrong but it's just JS weirdness
  const daysInMonth = new Date(year, month, 0).getDate()
  if (day > daysInMonth) {
    day = daysInMonth
  }

  // Month parameter is 0-indexed
  date = new Date(year, month - 1, day)
  return date && !isNaN(date.getTime()) ? date : null
}
