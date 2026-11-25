import { PLATFORM_IDS, type PlatformId } from '@/core/types'
import { inspectImageSource, inspectUrl } from '@/core/security/policy'
import { WECHAT_TEMPLATES } from '@/platforms/wechat/theme'
import type { StudioState } from './studio-state'

const DATABASE = 'typeset-studio'
const STORE = 'drafts'
const KEY = 'current'
const VERSION = 1

const SAVED_FIELDS = [
  'markdown', 'sourceLocked', 'platform', 'revision', 'report', 'platformTemplates',
  'typesetBaselines', 'retainedDocuments', 'titleOverrides', 'bodyPatches', 'boundAssets',
] as const satisfies readonly (keyof StudioState)[]

type DraftState = Pick<StudioState, typeof SAVED_FIELDS[number]>
interface DraftSnapshot {
  readonly version: typeof VERSION
  readonly state: DraftState
  readonly images: ReadonlyMap<string, Blob>
}

export function draftChanged(previous: StudioState, next: StudioState): boolean {
  return SAVED_FIELDS.some((field) => previous[field] !== next[field]) &&
    (previous.markdown !== '' || next.markdown !== '')
}

function mapDraftImages(state: DraftState, mapUrl: (url: string) => string): DraftState {
  const { report } = state
  const mapHtml = (html: string) => html.replace(/(<img\b[^>]*?\ssrc=")(blob:[^"]+)(")/gi,
    (_, before: string, url: string, after: string) => `${before}${mapUrl(url)}${after}`)
  const mapDocument = <T extends { readonly html: string }>(document: T): T => ({ ...document, html: mapHtml(document.html) })
  return {
    ...state,
    boundAssets: Object.fromEntries(Object.entries(state.boundAssets).map(([raw, url]) => [raw, mapUrl(url)])),
    report: report && { ...report, results: report.results.map((entry) => entry.outcome.ok
      ? { ...entry, outcome: { ok: true, document: mapDocument(entry.outcome.document) } }
      : entry) },
    retainedDocuments: Object.fromEntries(Object.entries(state.retainedDocuments).map(([id, doc]) => [id, mapDocument(doc)])),
    bodyPatches: Object.fromEntries(Object.entries(state.bodyPatches).map(([id, patch]) => [id,
      { ...mapDocument(patch), baseline: mapDocument(patch.baseline) },
    ])),
  }
}

function draftFields(state: DraftState): DraftState {
  return {
    markdown: state.markdown, sourceLocked: state.sourceLocked, platform: state.platform, revision: state.revision,
    report: state.report, platformTemplates: state.platformTemplates, typesetBaselines: state.typesetBaselines,
    retainedDocuments: state.retainedDocuments, titleOverrides: state.titleOverrides, bodyPatches: state.bodyPatches,
    boundAssets: state.boundAssets,
  }
}

export function captureDraft(state: StudioState, ownedImages: ReadonlyMap<string, Blob>): DraftSnapshot {
  const draft = draftFields(state)
  const images = new Map<string, Blob>()
  if (ownedImages.size) {
    mapDraftImages(draft, (url) => {
      const image = ownedImages.get(url)
      if (image) images.set(url, image)
      return url
    })
  }
  return { version: VERSION, state: draft, images }
}

// The record is private to this origin, but is still parsed before any saved HTML reaches the DOM.
const htmlTags = new Set('a b blockquote br code del div em font h1 h2 h3 h4 h5 h6 hr i img li mark ol p pre s section span strike strong sub sup table tbody td th thead tr u ul'.split(' '))
const htmlAttributes = new Set('align alt class color dir face height size start style title type value width colspan rowspan rel target'.split(' '))
const metadataAttributes = new Set('article image code align table format title'.split(' ').map((name) => `data-uma-source-${name}`))

function isSafeHtml(html: string, images: ReadonlyMap<string, Blob>): boolean {
  const template = document.createElement('template')
  template.innerHTML = html
  return [...template.content.querySelectorAll('*')].every((element) =>
    htmlTags.has(element.localName) && element.namespaceURI === 'http://www.w3.org/1999/xhtml' &&
    [...element.attributes].every(({ name, value }) => {
      if (name === 'src') return element.localName === 'img' && (value.startsWith('blob:')
        ? images.has(value)
        : inspectImageSource(value).allowed && !/^blob:/i.test(value.trim()))
      if (name === 'href') return element.localName === 'a' && inspectUrl(value).allowed
      // App formatting uses inline declarations and gradients, not resource-loading CSS.
      if (name === 'style') return !/\\|\/\*|(?:url|image-set|image|expression|attr|var)\s*\(/i.test(value)
      return htmlAttributes.has(name) || metadataAttributes.has(name)
    }))
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}
const text = (value: unknown): value is string => typeof value === 'string'
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const platform = (value: unknown): value is PlatformId => PLATFORM_IDS.some((id) => id === value)
const nullableText = (value: unknown): boolean => value === null || text(value)
const stats = (value: unknown): boolean => record(value) && number(value.characters) && number(value.blocks)
const span = (value: unknown): boolean => record(value) && number(value.start) && number(value.end)
const location = (value: unknown): boolean => record(value) && (value.kind === 'image' ? number(value.index)
  : value.kind === 'block' ? span(value.span) : value.kind === 'source' && span(value.span) && span(value.block))
const warnings = (value: unknown): boolean => Array.isArray(value) && value.every((entry: unknown) => record(entry) &&
  text(entry.id) && text(entry.kind) && text(entry.severity) && text(entry.message) && text(entry.action) &&
  text(entry.excerpt) && (entry.locations === undefined || (Array.isArray(entry.locations) && entry.locations.every(location))))
const platformRecord = (value: unknown, valid: (entry: unknown, id: string) => boolean): boolean =>
  record(value) && Object.entries(value).every(([id, entry]) => platform(id) && valid(entry, id))

function isSnapshot(value: unknown): value is DraftSnapshot {
  if (!record(value) || value.version !== VERSION || !record(value.state) || !(value.images instanceof Map)) return false
  const { state, images } = value
  if (![...images].every(([url, blob]: [unknown, unknown]) => text(url) && url.startsWith('blob:') && blob instanceof Blob)) return false
  const html = (value: unknown): value is string => text(value) && isSafeHtml(value, images)
  const baseline = (value: unknown): boolean => record(value) && html(value.html) && warnings(value.warnings)
  const rendered = (value: unknown, id: string): boolean => record(value) && value.platform === id &&
    nullableText(value.title) && text(value.plainText) && stats(value.stats) && baseline(value)
  const { report } = state
  return text(state.markdown) && typeof state.sourceLocked === 'boolean' && platform(state.platform) &&
    number(state.revision) && platformRecord(state.titleOverrides, text) &&
    platformRecord(state.platformTemplates, (value) => WECHAT_TEMPLATES.some(({ id }) => id === value)) &&
    platformRecord(state.bodyPatches, (value) => record(value) && html(value.html) && text(value.plainText) &&
      baseline(value.baseline) && (value.linkedMarkdown === undefined || text(value.linkedMarkdown)) &&
      (value.linkedSource === undefined || value.linkedSource === true)) &&
    platformRecord(state.typesetBaselines, (value) => record(value) && number(value.revision) && text(value.markdown)) &&
    platformRecord(state.retainedDocuments, rendered) && record(state.boundAssets) &&
    Object.values(state.boundAssets).every((url) => text(url) && images.has(url)) &&
    (report === null || (record(report) && nullableText(report.title) && nullableText(report.parseError) &&
      (report.typesetAt === null || number(report.typesetAt)) && stats(report.stats) && number(report.durationMs) &&
      Array.isArray(report.results) && report.results.every((entry: unknown) => {
        if (!record(entry) || !platform(entry.platform) || !record(entry.outcome)) return false
        if (entry.outcome.ok === true) return rendered(entry.outcome.document, entry.platform)
        const { failure } = entry.outcome
        return entry.outcome.ok === false && record(failure) && failure.platform === entry.platform &&
          failure.code === 'render' && text(failure.reason)
      })))
}

export class DraftConflict extends Error {}

export function restoreDraft(snapshot: DraftSnapshot, initial: StudioState, ownedImages: Map<string, Blob>): StudioState {
  const urls = new Map<string, string>()
  try {
    const state = mapDraftImages(draftFields(snapshot.state), (oldUrl) => {
      const existing = urls.get(oldUrl)
      if (existing) return existing
      const image = snapshot.images.get(oldUrl)
      if (!image) throw new Error('Missing draft image')
      const url = URL.createObjectURL(image)
      urls.set(oldUrl, url)
      ownedImages.set(url, image)
      return url
    })
    return { ...initial, ...state, generation: state.report ? 1 : 0 }
  } catch (error) {
    for (const url of urls.values()) {
      URL.revokeObjectURL(url)
      ownedImages.delete(url)
    }
    throw error
  }
}

export interface DraftStore {
  readonly snapshot: DraftSnapshot | null
  save(snapshot: DraftSnapshot): Promise<void>
  close(): void
}

export async function openDraftStore(): Promise<DraftStore> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION)
    let blocked = false
    request.onblocked = () => { blocked = true; reject(new Error('Draft database blocked')) }
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onerror = () => reject(request.error ?? new Error('Could not open draft database'))
    request.onsuccess = () => {
      if (blocked) request.result.close()
      else resolve(request.result)
    }
  })
  db.onversionchange = () => db.close()

  try {
    const stored = await new Promise<unknown>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readonly')
      const request = transaction.objectStore(STORE).get(KEY)
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not read draft'))
      transaction.oncomplete = () => resolve(request.result as unknown)
    })
    const snapshot = stored === undefined ? null : record(stored) && isSnapshot(stored.snapshot) ? stored.snapshot : undefined
    if (snapshot === undefined || (stored !== undefined && (!record(stored) || !number(stored.revision)))) {
      throw new Error('Unsupported draft record')
    }
    let revision = record(stored) && number(stored.revision) ? stored.revision : 0
    return {
      snapshot,
      close: () => db.close(),
      save: (next) => new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE, 'readwrite', { durability: 'strict' })
        const store = transaction.objectStore(STORE)
        const read = store.get(KEY)
        const expected = revision
        let failure: unknown
        transaction.onabort = () => reject(failure instanceof Error ? failure : transaction.error ?? new Error('Could not save draft'))
        transaction.oncomplete = () => { revision = expected + 1; resolve() }
        read.onsuccess = () => {
          try {
            const current: unknown = read.result
            const actual = current === undefined ? 0 : record(current) ? current.revision : null
            if (actual !== expected) throw new DraftConflict('Draft changed in another tab')
            // Keep advancing the revision even when the user intentionally clears the draft.
            store.put({ revision: expected + 1, snapshot: next }, KEY)
          } catch (error) {
            failure = error
            transaction.abort()
          }
        }
      }),
    }
  } catch (error) {
    db.close()
    throw error
  }
}
