import { openDB } from 'idb'

let _db
export const db = () =>
  (_db ??= openDB('focus-reader', 1, {
    upgrade(d) {
      d.createObjectStore('books', { keyPath: 'id' })
      d.createObjectStore('content', { keyPath: 'id' })
      const a = d.createObjectStore('annotations', { keyPath: 'id' })
      a.createIndex('bookId', 'bookId')
      d.createObjectStore('kv')
    }
  }))

export const uid = () =>
  globalThis.crypto?.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)

export const listBooks = async () => (await db()).getAll('books')
export const getBook = async (id) => (await db()).get('books', id)
export const getContent = async (id) => (await db()).get('content', id)

export async function putBook(meta, blocks) {
  const d = await db()
  const tx = d.transaction(['books', 'content'], 'readwrite')
  tx.objectStore('books').put(meta)
  if (blocks) tx.objectStore('content').put({ id: meta.id, blocks })
  await tx.done
}

export async function saveProgress(id, progress) {
  const d = await db()
  const m = await d.get('books', id)
  if (!m) return
  m.progress = progress
  await d.put('books', m)
}

export async function touchBook(id) {
  const d = await db()
  const m = await d.get('books', id)
  if (!m) return
  m.lastOpened = Date.now()
  await d.put('books', m)
}

export async function deleteBook(id) {
  const d = await db()
  const keys = await d.getAllKeysFromIndex('annotations', 'bookId', id)
  const tx = d.transaction(['books', 'content', 'annotations'], 'readwrite')
  tx.objectStore('books').delete(id)
  tx.objectStore('content').delete(id)
  keys.forEach((k) => tx.objectStore('annotations').delete(k))
  await tx.done
}

// annotations: soft-deleted (tombstones) so deletions survive export/import merges
export const listAnnotations = async (bookId) =>
  (await (await db()).getAllFromIndex('annotations', 'bookId', bookId)).filter((a) => !a.deleted)
export const listAllAnnotationsRaw = async () => (await db()).getAll('annotations')
export const putAnnotation = async (a) => (await db()).put('annotations', a)
export async function removeAnnotation(a) {
  await putAnnotation({ id: a.id, bookId: a.bookId, deleted: true, updatedAt: Date.now() })
}

export const getKV = async (k) => (await db()).get('kv', k)
export const putKV = async (k, v) => (await db()).put('kv', v, k)

export const DEFAULT_SETTINGS = {
  font: 'literata',
  size: 19,
  lineHeight: 1.65,
  width: 66,
  para: 0.85,
  letter: 0,
  align: 'left',
  theme: 'paper',
  hyphens: true,
  smartSearch: false,
  updatedAt: 0
}
export async function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...((await getKV('settings')) || {}) }
}
export const saveSettings = (s) => putKV('settings', { ...s, updatedAt: Date.now() })
