import { listBooks, getContent, listAllAnnotationsRaw, putBook, getBook, putAnnotation, loadSettings, saveSettings, db } from './db.js'

const stamp = () => new Date().toISOString().slice(0, 10)
export function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/** Everything needed to continue on another device: cleaned text, progress, highlights, notes, bookmarks, settings. */
export async function exportBundle(bookIds) {
  const books = (await listBooks()).filter((b) => !bookIds || bookIds.includes(b.id))
  const ids = new Set(books.map((b) => b.id))
  const out = []
  for (const meta of books) out.push({ meta, blocks: (await getContent(meta.id))?.blocks || [] })
  const annotations = (await listAllAnnotationsRaw()).filter((a) => ids.has(a.bookId))
  const bundle = { app: 'focus', version: 1, exportedAt: Date.now(), books: out, annotations, settings: await loadSettings() }
  const single = books.length === 1 ? books[0].title.replace(/[^\w]+/g, '-').slice(0, 40) : 'library'
  download(`focus-${single}-${stamp()}.json`, JSON.stringify(bundle))
  return { books: books.length, annotations: annotations.filter((a) => !a.deleted).length }
}

/** Merge (never destructive): newer updatedAt wins per annotation / per book progress / settings. */
export async function importBundle(file) {
  const bundle = JSON.parse(await file.text())
  if (bundle.app !== 'focus' || !Array.isArray(bundle.books)) throw new Error('Not a FOCUS export file.')
  const r = { addedBooks: 0, updatedProgress: 0, annotations: 0 }
  for (const { meta, blocks } of bundle.books) {
    const local = await getBook(meta.id)
    if (!local) { await putBook(meta, blocks); r.addedBooks++ }
    else if ((meta.progress?.updatedAt || 0) > (local.progress?.updatedAt || 0)) {
      await putBook({ ...local, progress: meta.progress, lastOpened: Math.max(local.lastOpened || 0, meta.lastOpened || 0) }); r.updatedProgress++
    }
  }
  const d = await db()
  const have = new Set((await d.getAllKeys('books')))
  const local = new Map((await listAllAnnotationsRaw()).map((a) => [a.id, a]))
  for (const a of bundle.annotations || []) {
    if (!have.has(a.bookId)) continue
    const l = local.get(a.id)
    if (!l || (a.updatedAt || 0) > (l.updatedAt || 0)) { await putAnnotation(a); r.annotations++ }
  }
  if (bundle.settings && (bundle.settings.updatedAt || 0) > ((await loadSettings()).updatedAt || 0)) await saveSettings(bundle.settings)
  return r
}

export function notesToMarkdown(meta, anns, chapterOf) {
  const rows = [...anns].sort((a, b) => a.start.b - b.start.b || a.start.o - b.start.o)
  let md = `# ${meta.title}\n${meta.author ? `*${meta.author}*\n` : ''}\n`
  for (const a of rows) {
    const ch = chapterOf(a.start.b)
    md += `## ${a.type === 'bookmark' ? 'Bookmark' : 'Highlight'}${ch ? ` — ${ch}` : ''}\n> ${a.text}\n\n${a.note ? a.note + '\n\n' : ''}`
  }
  return md
}
