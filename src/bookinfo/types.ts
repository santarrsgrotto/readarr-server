export type BookInfoAuthor = {
  ForeignId: number
  Name: string
  Description: string
  ImageUrl: string
  Url: string
  RatingCount: number
  AverageRating: number
  Works?: BookInfoWork[]
  Series?: BookInfoSeries[] | null
}

export type BookInfoBook = {
  ForeignId: number
  Title: string
  TitleWithoutSeries?: string
  Description: string
  Isbn13: string

  CountryCode: string
  Language: string | null
  Format: string
  EditionInformation: string
  Publisher: string
  ReleaseDate: string

  IsEbook: boolean
  NumPages: number
  RatingCount: number
  AverageRating: number

  ImageUrl: string
  Url: string

  Contributors: {
    ForeignId: number
    Role: string
  }[]
}

export type BookInfoSeries = {
  ForeignId: number
  Title: string
  Description: string

  LinkItems: BookInfoSeriesLinkItem[]
}

export type BookInfoSeriesLinkItem = {
  // TODO: Goodreads flags series as being primary or secondary, but OL has no equivalent
  Primary: boolean
  // Starting at 1
  PositionInSeries: string
  SeriesPosition: number
  ForeignSeriesId: number
  ForeignWorkId: number
}

export type BookInfoWork = {
  ForeignId: number
  Title: string
  OriginalTitle?: string
  ReleaseDate: string
  Url: string
  Genres: string[]
  RatingCount: number
  AverageRating: number
  Authors?: BookInfoAuthor[] | null
  // Foreign IDs
  RelatedWorks: number[]
  Books: BookInfoBook[] | null
  Series?: BookInfoSeries[]
}

export type BookSearch = {
  // Unique per query string
  qid: string

  // Both strings despite being numbers
  workId: string
  bookId: string

  bookUrl: string
  kcrPreviewUrl: string | null

  title: string
  bookTitleBare: string

  description: {
    html: string
    truncated: boolean
    fullContentUrl: string
  }

  numPages: number
  avgRating: string
  ratingsCount: number
  imageUrl: string

  author: BookSearchAuthor

  from_search: true
  from_srp: true

  // Index of result in the search results
  rank: number
}

export type BookSearchAuthor = {
  id: number
  name: string
  isGoodreadsAuthor: boolean
  profileUrl: string
  worksListUrl: string
}
