#!/usr/bin/env bun

import bookInfoAuthor from '../bookinfo/routes/author'
import * as model from '../model'

async function cacheAuthors(): Promise<void> {
  try {
    const authorKeys = await model.getLargeAuthors()

    for (const authorKey of authorKeys) {
      cacheAuthor(authorKey)
    }
  } catch (error) {
    console.log('error', error)
    const err = error as Error
    throw new Error(`Error saving cache: ${err.message}`)
  }
}

export async function cacheAuthor(key: string): Promise<void> {
  const cached = await model.isCached('/type/author', key)

  if (cached) {
    return
  }

  const author = await model.getAuthor(key)

  // This can happen if an author has been merged
  if (!author) {
    return
  }

  console.log(`Caching author ${key}`)

  const response = await bookInfoAuthor(key)
  const data = await response.text()

  await model.saveCache('/type/author', key, data)
}

if (import.meta.main) {
  cacheAuthors()
    .then(() => process.exit(0))
    .catch(() => process.exit(1))
}
