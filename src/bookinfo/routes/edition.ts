import * as ids from '../../ids'
import * as model from '../../model'

export default async function edition(id: string): Promise<Response> {
  try {
    const edition = await model.getEdition(id)

    if (!edition) {
      return new Response(null, { status: 404 })
    }

    const route = edition.workKey
      ? '/bookinfo/v1/work/' + ids.encodeReadarrId(edition.workKey)
      : '/bookinfo/v1/author/' + ids.encodeReadarrId(edition.authors[0])

    return new Response(null, {
      status: 302,
      headers: { Location: route },
    })
  } catch (error) {
    const err = error as Error
    throw new Error(`Error processing edition: ${err.message}`)
  }
}
