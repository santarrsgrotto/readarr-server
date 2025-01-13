import { convertAuthor, convertSeries, convertWork } from '../convert'
import * as ids from '../../ids'
import * as model from '../../model'

export default async function work(id: string): Promise<Response> {
  try {
    const work = await model.getWork(id).then((work) => (work ? convertWork(work) : null))

    if (!work) {
      return new Response(null, { status: 404 })
    }

    // Distinct author IDs
    const authorIds: string[] = [
      ...new Set(
        work.Books?.flatMap((book) =>
          book.Contributors.map((contributor) => ids.decodeReadarrId(contributor.ForeignId, 'author')),
        ) || [],
      ),
    ]

    work.Authors = await model.getAuthors(authorIds).then((authors) =>
      Promise.all(
        authors.map(async (author) => {
          const bookInfoAuthor = await convertAuthor(author)

          // Calculate rating for author based on their editions
          const { totalRatingCount, totalSumAverage, totalEditionCount } = (
            work.Books?.filter((edition) =>
              edition.Contributors.some((contributor) => contributor.ForeignId === bookInfoAuthor.ForeignId),
            ) || []
          ).reduce(
            (totals, edition) => {
              totals.totalRatingCount += edition.RatingCount
              totals.totalSumAverage += edition.AverageRating * edition.RatingCount
              totals.totalEditionCount += edition.RatingCount
              return totals
            },
            { totalRatingCount: 0, totalSumAverage: 0, totalEditionCount: 0 },
          )

          return {
            ...bookInfoAuthor,
            RatingCount: totalRatingCount,
            AverageRating: totalEditionCount > 0 ? Number((totalSumAverage / totalEditionCount).toFixed(1)) : 0.0,
          }
        }),
      ),
    )

    work.Series = convertSeries(await model.getWorkSeries([ids.decodeReadarrId(work.ForeignId, 'work')]))

    return new Response(JSON.stringify(work), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const err = error as Error
    throw new Error(`Error processing work: ${err.message}`)
  }
}
