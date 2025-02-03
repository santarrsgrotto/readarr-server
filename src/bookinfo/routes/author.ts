import type { Author } from '../../types'
import type { BookInfoWork } from '../types'
import { convertAuthor, convertSeries, convertWork } from '../convert'
import * as ids from '../../ids'
import * as model from '../../model'

export default async function author(id: string, workLimit: number = 1000): Promise<Response> {
  try {
    const response = await model.getCache('/type/author', id)

    if (response) {
      return new Response(response, {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const author = await model.getAuthor(id)

    if (!author) {
      return new Response(null, { status: 404 })
    }

    const bookInfoAuthor = await convertAuthor(author)

    bookInfoAuthor.Works = (await getWorks(author, workLimit)).map((work: BookInfoWork) => {
      // Readarr expects this nested like a Russian doll
      work.Authors = [{ ...bookInfoAuthor, Works: [] }]
      return work
    })

    // Calculate total rating count and average rating across all works
    const totalRatings = bookInfoAuthor.Works.reduce((sum, work) => sum + work.RatingCount, 0)
    const totalAverage = bookInfoAuthor.Works.reduce((sum, work) => sum + work.AverageRating * work.RatingCount, 0)

    bookInfoAuthor.RatingCount = totalRatings
    bookInfoAuthor.AverageRating = totalRatings > 0 ? Number((totalAverage / totalRatings).toFixed(1)) : 0.0

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

async function getWorks(author: Author, workLimit: number | null): Promise<BookInfoWork[]> {
  const works = await model.getAuthorWorks(author.key, workLimit)
  const workKeys = works.map((work) => work.key)

  const [editions, ratings] = await Promise.all([model.getWorkEditions(workKeys), model.getWorkRatings(workKeys, true)])

  return await Promise.all(
    works
      .filter((work) => work.title !== undefined)
      .map(async (work) => {
        const workEditions = editions.filter((edition) => edition.works?.includes(work.key))
        const workRatings = ratings.filter((rating) => rating.workKey === work.key)

        return editions.length > 0 ? await convertWork(work, workEditions, workRatings) : null
      }),
  ).then((results) => results.filter((work): work is BookInfoWork => work != null))
}
