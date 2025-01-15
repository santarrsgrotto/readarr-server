import type { Author, Edition, Rating, Series, Work } from '../types'
import type { BookInfoAuthor, BookInfoBook, BookInfoSeries, BookInfoWork } from './types'
import * as formatters from './formatters'
import * as ids from '../ids'
import * as model from '../model'

/**
 * Map between OL JSON and Readarr format
 * This leaves settings Ratings, Series, and Works up to the caller
 */
export async function convertAuthor(author: Author): Promise<BookInfoAuthor> {
  return {
    ForeignId: ids.encodeReadarrId(author.key),
    Name: author.name,
    Description: formatters.formatPlaintext(author.bio),
    ImageUrl: (author.photos?.[0] && formatters.formatCover(author.photos[0], 'author')) ?? '',
    Url: formatters.formatUrl(author.key),
    RatingCount: 0,
    AverageRating: 0,
  }
}

/** Map between OL JSON and Readarr format */
export async function convertEdition(
  edition: Edition,
  work: Work,
  rating?: Rating | null,
): Promise<BookInfoBook | null> {
  // We require at least one author
  if (!work.authors || !work.authors.length) {
    return null
  }

  // If average rating is decent bump up to count to ensure Readarr doesn't skip it
  if (rating && (rating.average ?? 0) > 2) {
    rating.count = Math.max(rating.count, 125)
  }

  // OL doesn't have as many ratings as Goodreads
  // So if there's no rating calculate one based on revision count
  // Readarr uses ratings to work out which editions are worth adding, so this is important
  rating = rating ?? {
    workKey: work.key,
    editionKey: edition.key,
    average: Math.min(edition.revision, 5),
    count: edition.revision * 125,
  }

  const format: string = formatters.formatFormat(edition.physicalFormat)

  return {
    ForeignId: ids.encodeReadarrId(edition.key),
    Title: edition.title ?? work.title ?? 'Unknown',
    Description: work.description ?? '',
    Isbn13: edition.isbn_13[0] ?? '',
    CountryCode: edition.publishCountry ?? '',
    Language: formatters.formatLanguage(edition.languages?.[0]),
    Format: format,
    EditionInformation: '',
    Publisher: edition.publishers?.[0] ?? '',
    IsEbook: format === 'ebook',
    NumPages: edition.numberOfPages ?? 0,
    RatingCount: rating.count,
    AverageRating: rating.average,
    ImageUrl: (edition.covers?.[0] && formatters.formatCover(edition.covers[0], 'book')) ?? '',
    Url: formatters.formatUrl(edition.key),
    ReleaseDate: formatters.formatDate(
      edition.publishDate ?? edition.created ?? work.created ?? edition.lastModified ?? work.lastModified,
    ),
    Contributors: (work.authors ?? []).map((authorId) => ({
      ForeignId: ids.encodeReadarrId(authorId),
      // TODO: find other valid types and map from OL
      Role: 'author',
    })),
  }
}

/** Map between OL JSON and Readarr format */
export function convertSeries(series: Series[]): BookInfoSeries[] {
  const seriesMap: Record<number, Series[]> = {}

  // Group series by seriesId
  series.forEach((item) => {
    if (!seriesMap[item.seriesId]) {
      seriesMap[item.seriesId] = []
    }
    seriesMap[item.seriesId].push(item)
  })

  // Convert grouped series into BookInfoSeries
  return Object.values(seriesMap).map((group, i) => {
    const firstItem = group[0]
    return {
      // This is in OL ID Readerr format
      ForeignId: firstItem.seriesId,
      Title: firstItem.title,
      Description: '',
      LinkItems: group.map((item) => ({
        // TODO: work out how to get OL equivalent of secondary series
        Primary: true,
        // Which book of the series
        PositionInSeries: item.position ? item.position.toString() : '',
        // Order of the series relative to other series by the same author
        SeriesPosition: i + 1,
        ForeignSeriesId: item.seriesId,
        ForeignWorkId: item.workId,
        OlId: ids.decodeReadarrId(item.workId, 'work'),
      })),
    } as BookInfoSeries
  })
}

/**
 * Map between OL JSON and Readarr format
 * This leaves setting Authors and Series key up to the caller
 */
export async function convertWork(
  work: Work,
  editions?: Edition[] | null,
  ratings?: Rating[] | null,
): Promise<BookInfoWork | null> {
  editions = editions ?? (await model.getWorkEditions([work.key]))

  ratings = ratings ?? (editions.length > 0 ? await model.getWorkRatings([work.key], true) : [])

  const books: BookInfoBook[] = (
    await Promise.all(
      editions.map(async (edition) => {
        const editionRating = ratings.find((rating) => rating.editionKey === edition.key) || null
        return await convertEdition(edition, work, editionRating)
      }),
    )
  ).filter((book): book is BookInfoBook => book !== null)

  if (!books.length) {
    return null
  }

  const earliestPublishDate = editions
    .map((edition) => edition.publishDate)
    .filter((date): date is Date => date !== undefined) // Type guard to ensure 'date' is 'Date'
    .reduce(
      (earliest: Date | null, current: Date) => (earliest === null || current < earliest ? current : earliest),
      null as Date | null,
    )

  // Get rating for the work, or failing that the edition rating with the highest count
  let workRating: Rating | null =
    ratings.find((rating) => rating.editionKey === null) ??
    (ratings.length > 0
      ? ratings[ratings.map((r) => r.count).indexOf(Math.max(...ratings.map((r) => r.count)))]
      : null) ??
    (books.length > 0
      ? (() => {
          // Use total count and highest average rating
          return {
            workKey: work.key,
            average: Math.max(...books.map((book) => book.AverageRating)),
            count: books.reduce((sum, book) => sum + book.RatingCount, 0),
          }
        })()
      : null)

  return {
    ForeignId: ids.encodeReadarrId(work.key),
    Title: work.title,
    ReleaseDate: formatters.formatDate(
      earliestPublishDate ?? editions[0].created ?? editions[0].lastModified ?? work.lastModified,
    ),
    Url: formatters.formatUrl(work.key),
    Genres: (work.subjects ?? []).filter((genre, i, genres) => genres.indexOf(genre) === i),
    RatingCount: workRating?.count ?? 0,
    AverageRating: workRating?.average ?? 0,
    // TODO: related works
    RelatedWorks: [],
    Books: books,
  }
}
