export type Id = string

export type Author = {
  key: Id

  entity_type?: string

  name: string
  personalName?: string
  fullerName?: string
  alternateNames?: string[]
  title?: string

  bio?: string
  birthDate?: Date
  deathDate?: Date

  /** IDs for the cover images */
  photos?: Id[]

  created: Date
  lastModified?: Date
}

export type Edition = {
  key: Id
  revision: number

  title: string
  full_title?: string
  description?: string
  editionName?: string

  isbn_10: string[]
  isbn_13: string[]

  series?: { name: string; position?: number }[]
  works: Id[]
  workKey: string
  authors: Id[]

  covers?: Id[]

  publishCountry?: string
  publishDate?: Date
  publishers?: string[]
  contributions?: string[]

  numberOfPages?: number
  sourceRecords?: string[]

  titleNativeLanguage?: string
  languages?: string[]
  translatedFrom?: string[]
  physicalFormat?: string

  created: Date
  lastModified?: Date
}

// Aggregate rating for a work
export type Rating = {
  workKey: Id
  editionKey?: Id
  average: number
  count: number
}

export type Series = {
  workId: number
  seriesId: number
  position: number
  title: string
}

export type Work = {
  key: Id
  authorKey?: string

  title: string
  subtitle?: string
  description?: string

  covers?: Id[]
  authors?: Id[]

  // Set by us as cache
  author?: Author | null

  // For convenience, this also includes authors
  contributors?: {
    type: string
    key: string
  }[]

  /** Related URLs */
  links?: { url: string; title: string }[]

  subjects?: string[]
  subjectPlaces?: string[]
  subjectTimes?: string[]
  subjectPeople?: string[]

  firstPublishDate?: string

  created: Date
  lastModified?: Date
}
