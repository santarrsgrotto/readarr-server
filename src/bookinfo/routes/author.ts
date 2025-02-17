import type { Author, Edition, Work } from '../../types'
import type { BookInfoWork } from '../types'
import { convertAuthor, convertSeries, convertWork } from '../convert'
import * as ids from '../../ids'
import * as model from '../../model'

export default async function author(
  id: string,
  editionId: string | null = null,
  workLimit: number = 1000,
): Promise<Response> {
  try {
    // If there's an edition we will limit to just that
    const edition = editionId ? await model.getEdition(editionId) : null

    if (!edition) {
      const response = await getCachedResponse(id)
      if (response) response
    }

    const author = await model.getAuthor(id)
    if (!author) {
      return new Response(null, { status: 404 })
    }

    const bookInfoAuthor = await convertAuthor(author)

    bookInfoAuthor.Works = (await getWorks(author, edition, workLimit)).map((work: BookInfoWork) => {
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

async function getCachedResponse(id: string): Promise<Response | null> {
  const response = await model.getCache('/type/author', id)

  return response
    ? new Response(response, {
        headers: { 'Content-Type': 'application/json' },
      })
    : null
}

async function getWorks(author: Author, edition: Edition | null, workLimit: number | null): Promise<BookInfoWork[]> {
  const works = edition
    ? [await model.getWork(edition.workKey)].filter((work): work is Work => work !== null)
    : await model.getAuthorWorks(author.key, workLimit)

  const workKeys = works.map((work) => work.key)

  const [editions, ratings] = await Promise.all([
    edition ? [edition] : model.getWorkEditions(workKeys),
    model.getWorkRatings(workKeys, true),
  ])

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
