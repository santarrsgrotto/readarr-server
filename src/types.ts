export type Id = string;

export interface Model {
  key: Id;
  type: string;
  revision: number;
  created: Date;
  lastModified: Date;
}

export interface Author extends Model {
  entity_type?: string;
  name: string;
  personalName?: string;
  fullerName?: string;
  alternateNames?: string[];
  title?: string;

  bio?: string;
  birthDate?: Date;
  deathDate?: Date;

  // IDs for the cover images
  photos?: Id[];
}

export interface Edition extends Model {
  title: string;
  full_title?: string;
  description?: string;
  editionName?: string;

  isbn_10: string[];
  isbn_13: string[];

  series?: { name: string; position?: number }[];
  works: Id[];
  workKey: string;
  authors: Id[];

  covers?: Id[];

  publishCountry?: string;
  publishDate?: Date;
  publishers?: string[];
  contributions?: string[];

  numberOfPages?: number;
  sourceRecords?: string[];

  titleNativeLanguage?: string;
  languages?: string[];
  translatedFrom?: string[];
  physicalFormat?: string;
}

export interface Rating {
  workKey: Id;
  editionKey?: Id;
  average: number;
  count: number;
}

export interface Record {
  key: Id;
  type: { key: string };
  revision: number;
  last_modified: { type: string; value: string };
  authors?: { author: { key: string } }[];
  works?: { key?: string }[];
}

export interface Series {
  workId: number;
  seriesId: number;
  position: number;
  title: string;
}

export interface Work extends Model {
  authorKey?: string;

  title: string;
  subtitle?: string;
  description?: string;

  covers?: Id[];
  authors?: Id[];
  // Set by us as cache
  author?: Author | null;

  // For convenience, this also includes authors
  contributors?: {
    type: string;
    key: string;
  }[];

  // Related URLs
  links?: { url: string; title: string }[];

  subjects?: string[];
  subjectPlaces?: string[];
  subjectTimes?: string[];
  subjectPeople?: string[];

  firstPublishDate?: string;
}
