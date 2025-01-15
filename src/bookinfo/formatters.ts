import config from '../config'
import { escapeHTML } from 'bun'

import languages from '@cospired/i18n-iso-languages'
languages.registerLocale(require('@cospired/i18n-iso-languages/langs/en.json'))

/** Converts data object to string */
export function formatDate(date: Date | null | undefined, required: boolean = true): string {
  return date && !isNaN(date.getTime()) ? date.toISOString().slice(0, 19) : required ? '1970-01-01 00:00:00' : ''
}

/** I.e. https://covers.openlibrary.org/b/id/10521270-L.jpg */
export function formatCover(id: string, type: 'book' | 'author'): string {
  return `https://covers.openlibrary.org/${type === 'book' ? 'b' : 'a'}/id/${id}-L.jpg`
}

/** Formats format e.g. paperback */
export function formatFormat(physicalFormat: string | undefined): string {
  if (physicalFormat) {
    // Using assignment to different name to keep TS happy
    // Since just using format makes it think format may be null despite the if block
    const format = physicalFormat.toLowerCase()

    const ebookFormats = ['epub', 'mobi', 'ebook', 'e-book', 'digital', 'kindle']
    const audiobookFormats = ['audio', 'mp3', 'cd', 'cassette']
    const hardbackFormats = ['hardback', 'hardcover', 'hard back', 'hard cover']

    // Redarr checks for ebook lowercase, yet Audiobook capitalise
    if (ebookFormats.some((keyword) => format.includes(keyword))) return 'ebook'
    if (audiobookFormats.some((keyword) => format.includes(keyword))) return 'Audiobook'
    if (hardbackFormats.some((keyword) => format.includes(keyword))) return 'Hardback'
  }

  return 'Paperback'
}

/** Escapes html */
export function formatHtml(html: string | undefined): string {
  return html ? escapeHTML(html) : ''
}

/** Converts html/markdown to plaintext **/
export function formatPlaintext(html: string | undefined): string {
  return html
    ? escapeHTML(
        // Extract any <a> links as plaintext urls
        html
          .replace(/<a\s+href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi, '$1')
          // Remove html tags and everything inside them
          .replace(/<[^>]*>.*?<\/[^>]*>/gs, '')
          // Remove up any stray tags
          .replace(/<[^>]+>/g, '')
          // Remove markdown bold and italics
          .replace(/(\*\*|__|\*|_)(.*?)\1/g, '$2')
          // Convert any markdown urls to just plaintext urls
          .replace(/\[(.*?)\]\(.*?\)/g, '$1'),
      )
    : ''
}

/** Converts to 3 character code **/
export function formatLanguage(lang: string | undefined): string | null {
  if (!lang) {
    return config.defaultLanguage
  }

  lang = lang.trim().toLowerCase()

  if (languages.isValid(lang)) {
    return lang
  }

  return (
    languages.getAlpha3BCode(lang, 'name') ||
    languages.getAlpha3BCode(lang.includes('-') ? lang.split('-')[0] : lang, 'iso639-1') ||
    config.defaultLanguage
  )
}

/** Convert OL ID to Url **/
export function formatUrl(key: string): string {
  return 'https://openlibrary.org' + key
}
