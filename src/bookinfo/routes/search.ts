import type { Author, Edition, Work } from '../../types'
import type { BookSearch, BookSearchAuthor } from '../../bookinfo/types'
import config from '../../config'
import db from '../../database'
import * as ids from '../../ids'
import * as model from '../../model'
import * as formatters from '../formatters'
import ISBN from 'isbn3'
import { franc } from 'franc'
import leven from 'leven'
import tsquery from 'pg-tsquery'

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

  const split = splitAuthorAndTitle(query)

  // Fuzzy matching case insensitive
  const authorsQuery = searchAuthorsByName(split ? split.author : query)
  const worksQuery = searchWorksByTitle(query, split)

  // Run both queries in parallel
  const [authors, works] = await Promise.all([authorsQuery, worksQuery])

  // For authors we get up to maxTitles works
  await Promise.all(
    authors.map(async (author) => {
      const authorWorks = await model.getAuthorWorks(author.key, config.search.maxTitles)

      works.unshift(
        ...authorWorks
          .map((work) => ({ ...work, author: author }))
          .filter((work) => !works.some((existing) => existing.key === work.key)),
      )
    }),
  )

  await Promise.all(works.map(async (work) => searchResult(work.author ?? null, work, null, qid, ++rank))).then((res) =>
    searchResults.push(...res.filter((result) => result !== null)),
  )

  // Sort the results by how similar title and/or author are
  searchResults.sort((a, b) => {
    const aAuthorName = normalizeAuthorName(a.author.name)
    const bAuthorName = normalizeAuthorName(b.author.name)

    // We should have both and so we use the total levenshtein distance
    if (split?.author && split?.title) {
      const aTotalDistance = leven(aAuthorName, split.author) + leven(a.title, split.title)
      const bTotalDistance = leven(bAuthorName, split.author) + leven(b.title, split.title)
      return aTotalDistance - bTotalDistance
    }

    const queryAuthorName = normalizeAuthorName(query)
    const aAuthorSimilarity = similarity(aAuthorName, queryAuthorName)
    const bAuthorSimilarity = similarity(bAuthorName, queryAuthorName)

    // Prioritize author similarity >= 0.8
    if (aAuthorSimilarity >= 0.8 && bAuthorSimilarity < 0.9) return -1
    if (bAuthorSimilarity >= 0.8 && aAuthorSimilarity < 0.9) return 1

    // Otherwise use the title
    const aTitleDistance = leven(a.title, query)
    const bTitleDistance = leven(b.title, query)

    return aTitleDistance - bTitleDistance
  })

  // Update results with the new ranking
  searchResults.forEach((result, index) => {
    result.rank = index + 1
  })

  return searchResults
}

/** Finds authors by name */
async function searchAuthorsByName(query: string): Promise<Author[]> {
  const useTrigram = isTrigramQuery(query)
  const pattern = useTrigram ? query : generateNameSearchPattern(query)

  // Sort criteria are: revision count, name similarity, and number of works
  const weights = {
    similarityWeight: 0.7,
    revisionWeight: 0.05,
    worksWeight: 0.25,
  }

  const sql = `
    WITH filtered_authors AS (
      SELECT *
      FROM authors
      ${
        useTrigram
          ? `WHERE authors.data->>'name' ILIKE $1`
          : `WHERE to_tsvector('simple', authors.data->>'name') @@ to_tsquery('simple', $1)`
      }
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
        COALESCE(similarity(filtered_authors.data->>'name', $2), 0) * ${weights.similarityWeight} +
        candidate_matches.work_count * ${weights.worksWeight} +
        filtered_authors.revision * ${weights.revisionWeight}
      ) AS weighted_score
    FROM candidate_matches
    JOIN filtered_authors ON candidate_matches.key = filtered_authors.key
    ORDER BY weighted_score DESC
    LIMIT $3
  `

  const bindParams = [pattern, query, config.search.maxAuthors]

  return db.query(sql, bindParams).then((res) => Promise.all(res.rows.map((author) => model.processModel(author))))
}

async function searchWorksByTitle(query: string, split: { title: string; author: string } | null): Promise<Work[]> {
  const title = split && split.title ? split.title : query
  const useTrigram = isTrigramQuery(query)
  const pattern = useTrigram ? title : generateTitleSearchPattern(title)

  // Sort criteria are: revision count, name similarity, and number of works
  const weights = {
    similarityWeight: 0.8,
    revisionWeight: 0.1,
    editionsWeight: 0.1,
    authorSimilarityWeight: 0.5,
  }

  const sql = `
    WITH filtered_works AS (
      SELECT *
      FROM works
      ${
        useTrigram
          ? `WHERE works.data->>'title' ILIKE $1`
          : `WHERE to_tsvector('simple', works.data->>'title') @@ to_tsquery('simple', $1)`
      }
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
        COALESCE(similarity(works.data->>'title', $2), 0) * ${weights.similarityWeight} +
        candidate_matches.edition_count * ${weights.editionsWeight} +
        works.revision * ${weights.revisionWeight}
        ${
          split
            ? `
          + COALESCE(similarity(authors.data->>'name', $4), 0) * ${weights.authorSimilarityWeight}
        `
            : ''
        }
      ) AS weighted_score
    FROM candidate_matches
    JOIN works ON candidate_matches.key = works.key
    ${
      split
        ? `
      LEFT JOIN author_works ON author_works.work_key = works.key
      LEFT JOIN authors ON authors.key = author_works.author_key
    `
        : ''
    }
    ORDER BY weighted_score DESC
    LIMIT $3
  `

  const bindParams = split
    ? [pattern, split.title, config.search.maxTitles, split.author]
    : [pattern, query, config.search.maxTitles]

  return db.query(sql, bindParams).then((res) => Promise.all(res.rows.map((work) => model.processModel(work))))
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

  // Get ratings for the work itself (so not for the editions)
  const rating = (await model.getWorkRatings([work.key], true))[0] ?? null

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
  const words = query
    .trim()
    .toLowerCase()
    .replace(/\./g, ' ')
    .split(/\s+/)
    // Replace hyphens with spaces
    .flatMap((word) => word.split('-'))
    // Remove any non-alphanumeric characters (unicode aware)
    .map((word) => word.replace(/[^\p{L}\p{N}]+/gu, ''))

  if (words.length === 0) return ''

  // Check if first word is likely 2 or 3 letter initials
  const firstWord = words[0]
  if (
    (words.length <= 3 && firstWord.length === 2) ||
    (firstWord.length === 3 && firstWord === firstWord.toUpperCase())
  ) {
    words[0] = firstWord.split('').join(' & ')
  }

  return words.length > 0 ? (new tsquery.Tsquery().parse(words.join(' '))?.toString() ?? '') : ''
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
    // Replace hyphens with spaces
    .flatMap((word) => word.split('-'))
    // Remove any non-alphanumeric characters (unicode aware)
    .map((word) => word.replace(/[^\p{L}\p{N}]+/gu, ''))

  return words.length > 0 ? (new tsquery.Tsquery().parse(words.join(' '))?.toString() ?? '') : ''
}

// Simple short hash from the query
// From https://gist.github.com/hyamamoto/fd435505d29ebfa3d9716fd2be8d42f0
function getQid(query: string): string {
  const hash = [...query].reduce((hash, c) => (Math.imul(31, hash) + c.charCodeAt(0)) | 0, 0)
  return Math.abs(hash).toString(36)
}

function normalizeAuthorName(authorName: string | null): string {
  return authorName ? authorName.toLowerCase().replace(/[^\w\s]/g, '') : ''
}

// Similarity score between 0 and 1
function similarity(str1: string, str2: string): number {
  const maxLength = Math.max(str1.length, str2.length)
  const distance = leven(str1, str2)

  return 1 - distance / maxLength
  1
}

// Attempts to extract author and title fro ma string
function splitAuthorAndTitle(query: string): { title: string; author: string } | null {
  const keywords = [
    'by', // English
    'par', // French
    'von', // German
    'per', // Italian
    'por', // Portuguese and Spanish
    'от', // Russian
  ]

  for (const keyword of keywords) {
    const delimiter = ` ${keyword} `
    const index = query.lastIndexOf(delimiter)

    if (index !== -1) {
      const title = query.substring(0, index).trim()
      const author = query.substring(index + delimiter.length).trim()

      return { title, author }
    }
  }

  return null
}

// Determine which query type to use
function isTrigramQuery(query: string): boolean {
  return false
}
