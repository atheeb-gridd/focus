import { useEffect, useMemo, useState } from 'react'
import { searchAnnotations } from './lib/search.js'
import { getBook, listAnnotations, putAnnotation, removeAnnotation } from './lib/db.js'
import { download, notesToMarkdown } from './lib/portable.js'
import Sidebar from './Sidebar.jsx'

export const COLORS = ['yellow', 'green', 'blue', 'pink']
const FILTERS = [['all', 'All'], ['notes', 'Notes'], ['highlights', 'Highlights'], ['bookmarks', 'Bookmarks']]

export function NotesView({ anns, chapterOf, onOpen, onChange, onDelete, smart, compact, onExport }) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [ranked, setRanked] = useState(null)
  const [busy, setBusy] = useState(false)
  const base = useMemo(
    () => anns.filter((a) => filter === 'all' || (filter === 'notes' ? a.type === 'highlight' && a.note : filter === 'highlights' ? a.type === 'highlight' : a.type === 'bookmark')),
    [anns, filter]
  )
  useEffect(() => {
    if (!q.trim()) { setRanked(null); return }
    let live = true
    const t = setTimeout(async () => {
      setBusy(true)
      const r = await searchAnnotations(q, base, { smart })
      if (live) { setRanked(r); setBusy(false) }
    }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [q, base, smart])
  const list = ranked ? ranked.map((r) => r.a) : [...base].sort((a, b) => a.start.b - b.start.b || a.start.o - b.start.o)

  return (
    <div className={'notes ' + (compact ? 'compact' : 'board')}>
      <div className="notes-tools">
        <input className="search" placeholder={smart ? 'Search by meaning…' : 'Search notes & highlights…'} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="pills">
          {FILTERS.map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}
          {onExport && <button className="ghost" onClick={onExport}>Export .md</button>}
        </div>
        <div className="muted small">{busy ? 'Searching…' : `${list.length} ${list.length === 1 ? 'item' : 'items'}${ranked ? ' · best match first' : ''}`}</div>
      </div>
      {!list.length && <div className="empty">{anns.length ? 'Nothing matches.' : 'Select text in the book to highlight it or attach a sticky note.'}</div>}
      <div className="cards">
        {list.map((a) => <Card key={a.id} a={a} chapter={chapterOf(a.start.b)} onOpen={onOpen} onChange={onChange} onDelete={onDelete} />)}
      </div>
    </div>
  )
}

function Card({ a, chapter, onOpen, onChange, onDelete }) {
  const [note, setNote] = useState(a.note || '')
  useEffect(() => setNote(a.note || ''), [a.note])
  const bookmark = a.type === 'bookmark'
  return (
    <div className={`card c-${bookmark ? 'bookmark' : a.color}`}>
      <div className="card-meta">
        <span>{bookmark ? '★ Bookmark' : a.note ? '✎ Note' : 'Highlight'}</span>
        <span className="muted">{chapter ? chapter.slice(0, 40) + ' · ' : ''}{new Date(a.createdAt).toLocaleDateString()}</span>
      </div>
      <blockquote onClick={() => onOpen(a)}>{a.text.length > 320 ? a.text.slice(0, 320) + '…' : a.text}</blockquote>
      {!bookmark && (
        <textarea
          placeholder="Add a note…"
          value={note}
          rows={note ? Math.min(6, Math.ceil(note.length / 36) + 1) : 1}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== (a.note || '') && onChange({ ...a, note })}
        />
      )}
      <div className="card-actions">
        <button onClick={() => onOpen(a)}>Open in book</button>
        {!bookmark && COLORS.map((c) => <i key={c} className={`dot c-${c} ${a.color === c ? 'sel' : ''}`} onClick={() => onChange({ ...a, color: c })} />)}
        <button className="danger" onClick={() => onDelete(a)}>Delete</button>
      </div>
    </div>
  )
}

export function NotesPage({ id, settings, onBack, onOpen }) {
  const [meta, setMeta] = useState(null)
  const [anns, setAnns] = useState([])
  useEffect(() => { (async () => { setMeta(await getBook(id)); setAnns(await listAnnotations(id)) })() }, [id])
  if (!meta) return null
  const chapterOf = (b) => meta.chapters.find((c) => b >= c.start && b < c.end)?.title
  const change = async (a) => { const n = { ...a, updatedAt: Date.now() }; await putAnnotation(n); setAnns((x) => x.map((y) => (y.id === n.id ? n : y))) }
  const del = async (a) => { await removeAnnotation(a); setAnns((x) => x.filter((y) => y.id !== a.id)) }
  return (
    <div className="page-notes">
      <Sidebar items={[{ icon: '←', label: 'Library', onClick: onBack }]} />
      <div className="libmain">
      <header className="topbar slim"><div className="title"><b>{meta.title}</b><span className="muted"> · Sticky notes</span></div></header>
      <div className="notes-wrap">
        <NotesView
          anns={anns} chapterOf={chapterOf} smart={settings.smartSearch}
          onOpen={(a) => onOpen(id, a.start.b)} onChange={change} onDelete={del}
          onExport={() => download(`${meta.title.replace(/[^\w]+/g, '-').slice(0, 40)}-notes.md`, notesToMarkdown(meta, anns, chapterOf), 'text/markdown')}
        />
      </div>
      </div>
    </div>
  )
}
