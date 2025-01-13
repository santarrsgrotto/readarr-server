import type { Author } from '../../types'
import type { BookInfoWork } from '../types'
import { convertAuthor, convertSeries, convertWork } from '../convert'
import * as ids from '../../ids'
import * as model from '../../model'

export default async function author(id: string): Promise<Response> {
  try {
    const author = await model.getAuthor(id)

    if (!author) {
      return new Response(null, { status: 404 })
    }

    const bookInfoAuthor = await convertAuthor(author)

    bookInfoAuthor.Works = (await getWorks(author)).map((work: BookInfoWork) => {
      // Readarr expects this nested like a Russian doll
      work.Authors = [{ ...bookInfoAuthor, Works: [{ ...work, Books: null, Authors: null }] }]
      return work
    })

    const workKeys: string[] = (bookInfoAuthor.Works ?? []).map((work) => ids.decodeReadarrId(work.ForeignId, 'work'))

    // Get average rating across all works
    const workRatings = await model.getWorkRatings(workKeys)
    const totalAverage = workRatings.reduce((sum, work) => sum + work.average, 0)

    bookInfoAuthor.RatingCount = workRatings.reduce((sum, work) => sum + work.count, 0)
    bookInfoAuthor.AverageRating = workRatings.length > 0 ? Number((totalAverage / workRatings.length).toFixed(1)) : 0.0

    bookInfoAuthor.Series = convertSeries(
      await model.getWorkSeries(bookInfoAuthor.Works.map((work) => ids.decodeReadarrId(work.ForeignId, 'work'))),
    )

    return new Response(JSON.stringify(bookInfoAuthor), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const err = error as Error
    throw new Error(`Error processing author: ${err.message}`)
  }
}

async function getWorks(author: Author): Promise<BookInfoWork[]> {
  const works = await model.getAuthorWorks(author.key)
  const editions = await model.getWorkEditions(works.map((work) => work.key))

  return await Promise.all(
    works
      .filter((work) => work.title !== undefined)
      .map(async (work) => {
        const workEditions = editions.filter((edition) => edition.works?.includes(work.key))

        return editions.length > 0 ? await convertWork(work, workEditions) : null
      }),
  ).then((results) => results.filter((work): work is BookInfoWork => work != null))
}
