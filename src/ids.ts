// OL Readarr IDs start at 1 billion, anything less = Goodreads ID
const THRESHOLD = 1_000_000_000
const MAX_VALUE = 0x7fffffff

/** Encodes OL ID to 32-bit integer */
export function encodeReadarrId(olId: string): number {
  const match = olId.match(/OL(\d+)[AMW]/)
  if (!match) {
    throw new Error('Invalid Open Library ID format')
  }

  const value = parseInt(match[1], 10)
  const id = THRESHOLD + value

  if (id > MAX_VALUE) {
    throw new Error('Value too large for encoding')
  }

  return id
}

/** Decodes 32-bit integer into an OL ID */
export function decodeReadarrId(id: number, type: string): string {
  if (isGoodreadsId(id)) {
    throw new Error('Trying to decode Goodreads ID')
  }

  if (id > MAX_VALUE) {
    throw new Error(`ID is above ${MAX_VALUE}`)
  }

  const olNum = id - THRESHOLD
  let prefix: string
  let suffix: string

  // We accept edition as that's the name we use internally
  type = type === 'edition' ? 'book' : type

  if (type === 'author') {
    prefix = 'authors'
    suffix = 'A'
  } else if (type === 'book' || type === 'edition') {
    prefix = 'books'
    suffix = 'M'
  } else if (type === 'work') {
    prefix = 'works'
    suffix = 'W'
  } else {
    throw new Error(`Unknown type: ${type}`)
  }

  return `/${prefix}/OL${olNum}${suffix}`
}

/** Converts any other type of ID into an OL ID */
export function convertOlId(id: number | string, type: string): string {
  if (isOlId(id) || isGoodreadsId(id)) {
    return String(id)
  }

  // OL in short form, so convert it to Readarr
  // Yes we decode it straight away but this lets us keep things in one place
  if (typeof id === 'string' && id.startsWith('O')) {
    id = encodeReadarrId(id)
  }

  return decodeReadarrId(Number(id), type)
}

/** Whether the ID is a Goodreads ID */
export function isGoodreadsId(id: number | string): boolean {
  if (id === 'string' && /\D/.test(id)) {
    return false
  }

  id = typeof id === 'number' ? id : parseInt(id, 10)

  return !isNaN(id) && id < THRESHOLD
}

/** Whether the ID is a full OL ID */
export function isOlId(id: number | string): boolean {
  if (typeof id === 'string' && id.startsWith('/')) {
    return true
  }

  return false
}
