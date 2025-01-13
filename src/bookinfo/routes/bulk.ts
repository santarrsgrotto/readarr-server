import type { Edition, Work } from '../../types'
import type { BookInfoAuthor, BookInfoSeries, BookInfoWork } from '../types'
import { convertAuthor, convertSeries, convertWork } from '../convert'
import config from '../../config'
import * as ids from '../../ids'
import * as model from '../../model'

export default async function bulk(editionIds: string[]): Promise<Response> {
  if (editionIds.length > config.bulk.limit) {
    editionIds = editionIds.slice(0, config.bulk.limit)
  }

  const editions: Edition[] = await Promise.all(editionIds.map((key) => model.getEdition(key))).then((results) =>
    results.filter((edition): edition is Edition => edition != null),
  )

  // Get distinct works for all our editions
  const works: Work[] = await Promise.all(
    Array.from(new Set(editions.map((edition) => edition.workKey).filter((key): key is string => key !== null))).map(
      (key) => model.getWork(key),
    ),
  ).then((results) => results.filter((work): work is Work => work !== null))

  // Get distinct author IDs for all editions/works
  const authorIds = Array.from(
    new Set([...editions.flatMap((edition) => edition.authors ?? []), ...works.flatMap((work) => work.authors ?? [])]),
  )

  const bookInfoWorks: BookInfoWork[] = (
    await Promise.all(
      // We pass in the editions to use
      works.flatMap((work) =>
        work
          ? [
              convertWork(
                work,
                editions.filter((edition) => edition.workKey === work.key),
              ),
            ]
          : [],
      ),
    )
  ).filter((result): result is BookInfoWork => result !== null && result !== undefined)

  // Assume bookInfoWorks already contains the works with editions information
  const bookInfoAuthors: BookInfoAuthor[] = authorIds.length
    ? await Promise.all(
        (await model.getAuthors(authorIds)).map(async (author) => {
          const bookInfoAuthor = await convertAuthor(author)

          // Get ratings across all editions for this author
          const { totalRatingCount, totalSumAverage, totalEditionCount } = bookInfoWorks
            .filter((work) =>
              work.Books?.some((edition) =>
                edition.Contributors.some((contributor) => contributor.ForeignId === bookInfoAuthor.ForeignId),
              ),
            )
            .reduce(
              (totals, work) => {
                work.Books?.forEach((edition) => {
                  totals.totalRatingCount += edition.RatingCount
                  totals.totalSumAverage += edition.AverageRating * edition.RatingCount
                  totals.totalEditionCount += edition.RatingCount
                })
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
      )
    : []

  const series: BookInfoSeries[] = convertSeries(
    await model.getWorkSeries(bookInfoWorks.map((work) => ids.decodeReadarrId(work.ForeignId, 'work'))),
  )

  const response = JSON.stringify({
    Works: bookInfoWorks,
    Authors: bookInfoAuthors,
    Series: series,
  })

  return new Response(response, { headers: { 'Content-Type': 'application/json' } })
}
