import * as ids from '../../ids'
import * as model from '../../model'

export default async function edition(id: string): Promise<Response> {
  try {
    const edition = await model.getEdition(id)

    if (!edition) {
      return new Response(null, { status: 404 })
    }

    // This endpoint is meant to redirect to either an author or a work
    // Readarr has a code path to use this vs bulk if there's only one search result
    // however there's a bug which means if we redirect to work it causes an error if the
    // author doesn't already exist in the client. To work around this we instead always
    // redirect to author, but we add an edition parameter that Readarr passed on, which
    // tells the authot endpoint to limit to just that edition
    const location = '/bookinfo/v1/author/' + ids.encodeReadarrId(edition.authors[0]) + '?edition=' + id

    return new Response(null, {
      status: 302,
      headers: { Location: location },
    })
  } catch (error) {
    const err = error as Error
    throw new Error(`Error processing edition: ${err.message}`)
  }
}
