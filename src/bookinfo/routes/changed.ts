import config from '../../config'
import * as ids from '../../ids'
import * as model from '../../model'

export default async function changed(since: string): Promise<Response> {
  try {
    const earliest: Date = earliestTime()
    const date: Date = isNaN(new Date(since).getTime()) ? earliest : new Date(since)

    let limited: boolean = date < earliest
    let authorIds: number[] = []

    authorIds = limited
      ? []
      : await model
          .getAuthorsUpdatedSince(date, config.changed.limit)
          .then((authorIds) => authorIds.map((id) => ids.encodeReadarrId(id)))

    return new Response(
      JSON.stringify({
        Limited: limited || authorIds.length === config.changed.limit,
        Since: date.toISOString(),
        Ids: limited ? [] : authorIds,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      },
    )
  } catch (error) {
    const err = error as Error
    throw new Error(`Error processing author: ${err.message}`)
  }
}

function earliestTime(): Date {
  const now = new Date()
  now.setMonth(now.getMonth() - config.changed.maxMonths)
  return now
}
