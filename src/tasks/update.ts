#!/usr/bin/env bun

import type { Record } from '../types'
import config from '../config'
import * as model from '../model'

async function update(): Promise<void> {
  try {
    let unprocessedKeys: { authors: string[]; works: string[]; editions: string[] }

    unprocessedKeys = await model.getUnprocessedKeys()

    // We process saved keys first, and if there are none we check OL for new updates
    if (!unprocessedKeys.authors.length && !unprocessedKeys.works.length && !unprocessedKeys.editions.length) {
      await model.saveDatetime('update_keys_start_time', new Date())
      unprocessedKeys = await fetchKeys()

      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      await model.saveDatetime('update_keys_time', yesterday, true)
    }

    await model.saveDatetime('update_started', new Date())
    await model.setStore('update_finished', null)
    await processKeys('author', unprocessedKeys.authors)
    await processKeys('work', unprocessedKeys.works)
    await processKeys('edition', unprocessedKeys.editions)

    const finished = new Date()
    await model.saveDatetime('update_finished', finished)
    await model.setStore('update_error', null)
  } catch (error) {
    const errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    await model.setStore('update_error', errorMessage)

    const err = error as Error
    throw new Error(`Error updating: ${err.message}`)
  }
}

/** Fetches all the OL IDs of models that need updating since the last update */
async function fetchKeys(): Promise<{ authors: string[]; works: string[]; editions: string[] }> {
  const kinds = ['add-book', 'edit-book', 'merge-authors', 'revert', 'update']

  // Keys of authors, works, and editions to look up
  const authorKeys: Set<string> = new Set()
  const workKeys: Set<string> = new Set()
  const editionKeys: Set<string> = new Set()

  // Start of today day UTC
  let currentDate = new Date()
  currentDate.setUTCHours(0, 0, 0, 0)

  // We only process full days, so starting date is always +1
  let date = await model.getUpdateTime()
  date.setDate(date.getDate() + 1)

  // Get all the updates keys from last refresh until yesterday
  // We only deal with full days worth of updates
  while (date < currentDate) {
    // If processing day set the time portion too
    if (date.toDateString() === currentDate.toDateString()) {
      currentDate = new Date()
      date.setHours(currentDate.getHours())
      date.setMinutes(currentDate.getMinutes())
      date.setSeconds(currentDate.getSeconds())
      date.setMilliseconds(0)
    }

    for (const kind of kinds) {
      // This updates the passed in sets
      await addChangedKeys(authorKeys, workKeys, editionKeys, date, kind)
    }

    // Save keys after each date
    await model.setStore('unprocessed_author_keys', Array.from(authorKeys), false)
    await model.setStore('unprocessed_work_keys', Array.from(workKeys), false)
    await model.setStore('unprocessed_edition_keys', Array.from(editionKeys), false)
    await model.saveDatetime('update_keys_time', date)

    date.setDate(date.getDate() + 1)
  }

  return {
    authors: Array.from(authorKeys),
    works: Array.from(workKeys),
    editions: Array.from(editionKeys),
  }
}

/** Process updated keys in batches */
async function processKeys(type: string, keys: string[]) {
  let remainingKeys = [...keys]
  let delay: number = 0

  while (remainingKeys.length > 0) {
    const batch = remainingKeys.slice(0, config.update.batchSize)
    const failedKeys = await updateModels(batch)

    // Remove batch items from database
    await model.saveBatchUpdate(type, batch.length, failedKeys)

    if (failedKeys.length) {
      // Add failed keys back to the remainingKeys list for retry
      remainingKeys = [...remainingKeys.slice(batch.length), ...failedKeys]

      // Wait 5 minutes if too much of the batch has failed
      if (failedKeys.length > batch.length / 2) {
        delay = 5 * 60 * 1000
      }
    } else {
      // If no keys failed, remove the processed batch from remainingKeys
      remainingKeys = remainingKeys.slice(batch.length)
    }

    if (delay) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

/** Update the given keys, returning any that failed to update */
async function updateModels(keys: string[]): Promise<string[]> {
  const failedKeys: string[] = []

  for (const key of keys) {
    try {
      await updateModel(key)
    } catch (error) {
      failedKeys.push(key)
    }

    // 200ms between requests
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  return failedKeys
}

/** Fetch a model from OL and save it */
async function updateModel(key: string): Promise<boolean> {
  const response = await fetch(`https://openlibrary.org${key}.json`, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(config.update.timeout * 1000),
  })

  const data: Record | null = response.ok ? await response.json() : null

  if (!response.ok || !data || !data.key) {
    throw new Error(`Server Error`)
  }

  await model.saveModel(data)
  return true
}

/** Append all the keys modified on the given date to the passed in sets */
async function addChangedKeys(
  authorKeys: Set<string>,
  workKeys: Set<string>,
  editionKeys: Set<string>,
  date: Date,
  kind: string,
): Promise<void> {
  // Format the date to yyyy/mm/dd
  const datePath = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('/')

  let offset = 0
  let limit = 1000
  let retries = 0
  let url: string

  // The endpoints are paginated using offset
  while (offset <= 10000) {
    url = `https://openlibrary.org/recentchanges/${datePath}/${kind}.json?offset=${offset}&limit=${limit}`

    try {
      const response = await fetch(url)

      const data: { timestamp: string; changes: { key: string }[] }[] | null = response.ok
        ? await response.json()
        : null

      if (!response.ok || !Array.isArray(data)) {
        const error = new Error(`Server Error`) as Error & { response?: Response }
        error.response = response
        throw error
      }

      retries = 0

      data.forEach((item) => {
        item.changes.forEach((change: { key: string }) => {
          if (change.key.startsWith('/authors/')) {
            authorKeys.add(change.key)
          } else if (change.key.startsWith('/works/')) {
            workKeys.add(change.key)
          } else if (change.key.startsWith('/books/')) {
            editionKeys.add(change.key)
          }
        })
      })

      if (data.length < limit) {
        break
      }

      offset += 1000

      // Sleep for 1 second
      await new Promise((resolve) => setTimeout(resolve, 1000))
    } catch (err: unknown) {
      if (++retries > config.update.retries) {
        const error = err as Error & { response?: Response }

        const errorData = {
          time: new Date().toISOString(),
          url: url,
          status: error.response ? error.response.status : null,
          error: error.response
            ? error.response.headers.get('content-type')?.includes('application/json')
              ? await error.response.json()
              : await error.response.text()
            : error.message,
        }

        await model.setStore('update_keys_error', errorData)
        throw err
      }

      // Sleep for 5 seconds
      await new Promise((resolve) => setTimeout(resolve, 5 * 1000))
    }
  }
}

if (import.meta.main) {
  update()
    .then(() => process.exit(0))
    .catch(() => process.exit(1))
}
