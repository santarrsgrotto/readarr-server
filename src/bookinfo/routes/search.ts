import type { Author, Edition, Work } from '../../types'
import type { BookSearch, BookSearchAuthor } from '../../bookinfo/types'
import config from '../../config'
import db from '../../database'
import * as ids from '../../ids'
import * as model from '../../model'
import * as formatters from '../formatters'
import ISBN from 'isbn3'
import { franc } from 'franc'

export default async function search(query: string): Promise<Response> {
  const qid = getQid(query)

  let results: BookSearch[] = []
  let author: Author | null = null
  let work: Work | null = null
  let edition: Edition | null = null

  if (query.startsWith('author:')) {
    author = await model.getAuthor(query.substring(7))
  } else if (query.startsWith('edition:')) {
    edition = await model.getEdition(query.substring(8))
  } else if (query.startsWith('isbn:')) {
    edition = await searchByIsbn(query.substring(5))
  } else if (query.startsWith('work:')) {
    work = await model.getWork(query.substring(5))
  }

  if (author || work || edition) {
    const result = await searchResult(author, work, edition, qid, 1)

    if (result) {
      results.push(result)
    }
  } else {
    results = (await searchByName(query)) ?? []
  }

  // If there's only one result Readarr doesn't seem to show it
  // so we just include the same one twice
  if (results.length == 1) {
    results.push(results[0])
  }

  let response: string
  results = results.filter((result): result is BookSearch => result != null)
  response = JSON.stringify(results)

  return new Response(response, {
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Find books based on author name or title */
async function searchByName(query: string): Promise<BookSearch[] | null> {
  const qid: string = getQid(query)
  let rank: number = 0
  let searchResults: BookSearch[] = []

  // Fuzzy matching case insensitive
  const authorsQuery = searchAuthorsByName(query)
  const worksQuery = searchWorksByTitle(query)

  // Run both queries in parallel
  const [authors, works] = await Promise.all([authorsQuery, worksQuery])

  // For authors we get up to maxTitles works
  await Promise.all(
    authors.map(async (author) =>
      works.unshift(
        ...(await model.getAuthorWorks(author.key, config.search.maxTitles))
          .map((work) => ({ ...work, author: author }))
          .filter((work) => !works.some((existing) => existing.key === work.key)),
      ),
    ),
  )

  await Promise.all(works.map(async (work) => searchResult(work.author ?? null, work, null, qid, ++rank))).then((res) =>
    searchResults.push(...res.filter((result) => result !== null)),
  )

  return searchResults
}

/** Finds authors by name */
async function searchAuthorsByName(query: string): Promise<Author[]> {
  const pattern = generateNameSearchPattern(query)

  // Sort criteria are: revision count, name similarity, and number of works
  const weights = {
    revisionWeight: 0.8,
    similarityWeight: 0.1,
    worksWeight: 0.1,
  }

  const sql = `
    WITH filtered_authors AS (
      SELECT *
      FROM authors
      WHERE to_tsvector('simple', authors.data->>'name') @@ to_tsquery('simple', $1)
    ),
    candidate_matches AS (
      SELECT filtered_authors.key,
        filtered_authors.data,
        COUNT(author_works.work_key) AS work_count
      FROM filtered_authors
      LEFT JOIN author_works ON author_works.author_key = filtered_authors.key
      GROUP BY filtered_authors.key, filtered_authors.data
    )
    SELECT filtered_authors.*,
      candidate_matches.work_count,
      filtered_authors.revision,
      (
        similarity(filtered_authors.data->>'name', $1) * ${weights.similarityWeight} +
        candidate_matches.work_count * ${weights.worksWeight} +
        filtered_authors.revision * ${weights.revisionWeight}
      ) AS weighted_score
    FROM candidate_matches
    JOIN filtered_authors ON candidate_matches.key = filtered_authors.key
    ORDER BY weighted_score DESC
    LIMIT $2
  `

  return db
    .query(sql, [pattern, config.search.maxAuthors])
    .then((res) => Promise.all(res.rows.map((author) => model.processModel(author))))
}

async function searchWorksByTitle(query: string): Promise<Work[]> {
  // Search patterns for the name
  const pattern = generateTitleSearchPattern(query)

  // Sort criteria are: revision count, name similarity, and number of works
  const weights = {
    revisionWeight: 0.8,
    similarityWeight: 0.1,
    editionsWeight: 0.1,
  }

  const sql = `
    WITH filtered_works AS (
      SELECT *
      FROM works
      WHERE to_tsvector('simple', works.data->>'title') @@ to_tsquery('simple', $1)
    ),
    candidate_matches AS (
      SELECT filtered_works.key,
        filtered_works.data,
        COUNT(editions.key) AS edition_count
      FROM filtered_works
      LEFT JOIN editions ON editions.work_key = filtered_works.key
      GROUP BY filtered_works.key, filtered_works.data
    )
    SELECT works.*,
      candidate_matches.edition_count,
      works.revision,
      (
        similarity(works.data->>'title', $1) * ${weights.similarityWeight} +
        candidate_matches.edition_count * ${weights.editionsWeight} +
        works.revision * ${weights.revisionWeight}
      ) AS weighted_score
    FROM candidate_matches
    JOIN works ON candidate_matches.key = works.key
    ORDER BY weighted_score DESC
    LIMIT $2
  `

  return db
    .query(sql, [pattern, config.search.maxTitles])
    .then((res) => Promise.all(res.rows.map((work) => model.processModel(work))))
}

/** Find an edition based on ISBN (tries ISBN and ISBN-13) */
async function searchByIsbn(query: string): Promise<Edition | null> {
  const isbns: string[] = []
  const isbn = ISBN.parse(query)

  if (isbn) {
    // We also convert between ISBN-10 and 13 ISBN-13 where possible
    if (isbn.isIsbn10 && isbn.isbn10 && isbn.isValid) {
      isbns.push(isbn.isbn10)

      const isbn13 = ISBN.asIsbn13(isbn.isbn10)
      if (isbn13) isbns.push(isbn13)
    } else if (isbn.isIsbn13 && isbn.isbn13 && isbn.isValid) {
      isbns.push(isbn.isbn13)

      const isbn10 = ISBN.asIsbn10(isbn.isbn13)
      if (isbn10) isbns.push(isbn10)
    }
  }

  if (!isbns.length) {
    return null
  }

  const isbnQuery = `
    SELECT edition_key
    FROM edition_isbns
    WHERE isbn = ANY($1::text[])
    LIMIT 1
  `

  const editionKey = await db.query(isbnQuery, [isbns]).then((res) => res.rows[0]?.edition_key as string | null)

  if (!editionKey) {
    return null
  }

  return await model.getEdition(editionKey)
}

/** Formats a search result */
async function searchResult(
  author: Author | null,
  work: Work | null,
  edition: Edition | null,
  qid: string,
  rank: number,
): Promise<BookSearch | null> {
  // If we having one of the three, we should be able to get the other two using it
  if (!work) {
    if (edition) {
      work = await model.getWork(edition.workKey)
    } else if (author) {
      work = await model.getAuthorWork(author.key)
    }
  }
  if (!edition && work) {
    edition = await model.getWorkEdition(work.key)
  }
  if (!author && (work || edition)) {
    const authorId = work?.authors?.[0] || edition?.authors?.[0]
    author = authorId ? await model.getAuthor(authorId) : null
  }

  if (!author || !work || !edition) {
    return null
  }

  const rating = (await model.getWorkRatings([work.key]))[0] ?? null

  return {
    qid: qid,
    bookId: edition ? ids.encodeReadarrId(edition.key).toString() : '',
    workId: work ? ids.encodeReadarrId(work.key).toString() : '',
    bookUrl: edition ? formatters.formatUrl(edition.key) : '',
    kcrPreviewUrl: null,

    title: edition?.title ?? work?.title ?? '',
    bookTitleBare: edition?.title ?? work?.title ?? '',

    description: {
      html: formatters.formatHtml(work.description),
      truncated: false,
      fullContentUrl: formatters.formatUrl(work.key),
    },

    numPages: edition?.numberOfPages ?? 0,
    avgRating: String(rating?.average ?? 0),
    ratingsCount: rating?.count ?? 0,
    imageUrl: (work?.covers?.[0] && formatters.formatCover(work.covers[0], 'book')) ?? '',

    author: {
      id: author ? ids.encodeReadarrId(author.key) : 0,
      name: author ? author.name : '',
      // This doesn't seem to be used by Readarr, but set to false to be safe
      isGoodreadsAuthor: false,
      profileUrl: author ? formatters.formatUrl(author.key) : '',
      worksListUrl: author ? formatters.formatUrl(author.key) : '',
    } as BookSearchAuthor,

    from_search: true,
    from_srp: true,
    rank: rank,
  }
}

// Convert author name into a search pattern
function generateNameSearchPattern(query: string): string {
  const words = query.trim().toLowerCase().replace(/\./g, ' ').split(/\s+/)

  if (words.length === 0) return ''

  // Check if first word is likely 2 or 3 letter initials
  const firstWord = words[0]
  if (firstWord.length === 2 || (firstWord.length === 3 && firstWord === firstWord.toUpperCase())) {
    words[0] = firstWord.split('').join(' & ')
  }

  return words.map((word) => `${word}${words.length === 1 ? '' : ':*'}`).join(' & ')
}

// Convert book title into a search pattern
function generateTitleSearchPattern(query: string): string {
  const lang = franc(query, { minLength: 3 })
  const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for']

  // Split the query into words and normalize each word
  const words = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((p) => p.length > 0)
    // Filter out common stopwords for English queries
    .filter((p) => lang !== 'eng' || !stopWords.includes(p))

  if (words.length === 0) return ''
  return words.map((word) => `${word}${words.length === 1 ? '' : ':*'}`).join(' & ')
}

// Simple short hash from the query
// From https://gist.github.com/hyamamoto/fd435505d29ebfa3d9716fd2be8d42f0
function getQid(query: string): string {
  const hash = [...query].reduce((hash, c) => (Math.imul(31, hash) + c.charCodeAt(0)) | 0, 0)
  return Math.abs(hash).toString(36)
}
