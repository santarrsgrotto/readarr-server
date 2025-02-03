import * as ids from '../../ids'
import * as model from '../../model'

export default async function edition(id: string): Promise<Response> {
  try {
    const edition = await model.getEdition(id)

    if (!edition) {
      return new Response(null, { status: 404 })
    }

    // We always redirect to author because whereas Readarr has code to handle works too
    // that doesn't appear to work if the author hasn't been previously added by the client
    return new Response(null, {
      status: 302,
      headers: { Location: '/bookinfo/v1/author/' + ids.encodeReadarrId(edition.authors[0]) },
    })
  } catch (error) {
    const err = error as Error
    throw new Error(`Error processing edition: ${err.message}`)
  }
}
