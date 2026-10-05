import { useCallback, useEffect, useRef, useState } from 'react'
import { listBooks, listAllAnnotationsRaw, loadSettings, deleteBook, uid } from './lib/db.js'
import { importFile, SUPPORTED } from './lib/extract.js'
import { exportBundle, importBundle } from './lib/portable.js'
import Reader, { FONTS } from './Reader.jsx'
import { NotesPage } from './Notes.jsx'
import Sidebar from './Sidebar.jsx'
import { useUpdater, UpdateBanner } from './Updater.jsx'

const Cover = ({ b, onClick }) => b.cover
  ? <img className="cover img" src={b.cover} alt={b.title} onClick={onClick} draggable={false} />
  : <div className="cover" style={{ '--h': hue(b.id) }} onClick={onClick}>{b.title.slice(0, 2)}</div>
const kWords = (n) => (n < 1000 ? '<1k' : Math.round(n / 1000) + 'k')
const hue = (id) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)

export default function App() {
  const [settings, setSettings] = useState(null)
  const [route, setRoute] = useState({ name: 'library' })
  const [books, setBooks] = useState([])
  const [counts, setCounts] = useState({})
  const [jobs, setJobs] = useState([])
  const [drag, setDrag] = useState(false)
  const bookInput = useRef(), restoreInput = useRef()
  const up = useUpdater()

  useEffect(() => { loadSettings().then(setSettings) }, [])
  useEffect(() => {
    if (!settings) return
    const r = document.documentElement
    r.dataset.theme = settings.theme
    r.style.setProperty('--font', FONTS.find((f) => f[0] === settings.font)?.[2] || FONTS[0][2])
    r.style.setProperty('--size', settings.size + 'px')
    r.style.setProperty('--lh', settings.lineHeight)
    r.style.setProperty('--width', settings.width + 'ch')
    r.style.setProperty('--para', settings.para + 'em')
    r.style.setProperty('--letter', settings.letter + 'em')
    r.style.setProperty('--align', settings.align)
    r.style.setProperty('--hyphens', settings.hyphens ? 'auto' : 'manual')
  }, [settings])
  useEffect(() => { if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {}) }, [])

  const refresh = useCallback(async () => {
    setBooks((await listBooks()).sort((a, b) => (b.lastOpened || b.addedAt) - (a.lastOpened || a.addedAt)))
    const c = {}
    for (const a of await listAllAnnotationsRaw()) if (!a.deleted) { c[a.bookId] ??= { n: 0, b: 0 }; a.type === 'bookmark' ? c[a.bookId].b++ : c[a.bookId].n++ }
    setCounts(c)
  }, [])
  useEffect(() => { if (route.name === 'library') refresh() }, [route.name, refresh])

  const patchJob = (id, p) => setJobs((j) => j.map((x) => (x.id === id ? { ...x, ...p } : x)))
  const onFiles = async (files) => {
    for (const f of [...files]) {
      const id = uid()
      setJobs((j) => [...j, { id, name: f.name, status: 'Starting…' }])
      try {
        if (/\.json$/i.test(f.name)) {
          const r = await importBundle(f)
          setSettings(await loadSettings())
          patchJob(id, { status: `Restored: ${r.addedBooks} new books, ${r.annotations} notes/highlights merged, ${r.updatedProgress} reading positions updated`, done: true })
        } else {
          const r = await importFile(f, (s) => patchJob(id, { status: s }))
          patchJob(id, { status: r.duplicate ? (r.coverAdded ? 'Cover added' : 'Already in your library') : `Added. Removed ${r.removed} ad/boilerplate lines.`, done: true })
        }
      } catch (e) {
        console.error(e)
        patchJob(id, { status: e.message || String(e), error: true })
      }
      await refresh()
    }
    setTimeout(() => setJobs((j) => j.filter((x) => !x.done)), 7000)
  }

  if (!settings) return null
  if (route.name === 'reader') return <Reader key={route.id + ':' + (route.goto ?? '')} id={route.id} goto={route.goto} settings={settings} setSettings={setSettings} onExit={() => setRoute({ name: 'library' })} onNotes={(id) => setRoute({ name: 'notes', id })} />
  if (route.name === 'notes') return <NotesPage id={route.id} settings={settings} onBack={() => setRoute({ name: 'library' })} onOpen={(id, goto) => setRoute({ name: 'reader', id, goto })} />

  const last = books.find((b) => b.progress)
  return (
    <div className="library"
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files) }}>
      <Sidebar items={[
        { icon: '＋', label: 'Add books', onClick: () => bookInput.current.click() },
        { icon: '⤒', label: 'Restore backup', onClick: () => restoreInput.current.click() },
        { icon: '⤓', label: 'Export everything', disabled: !books.length, onClick: async () => { const r = await exportBundle(); setJobs((j) => [...j, { id: uid(), name: 'Backup', status: `Exported ${r.books} books, ${r.annotations} notes & highlights`, done: true }]); setTimeout(() => setJobs((j) => j.filter((x) => !x.done)), 6000) } },
        ...(up.available ? [{ sep: true }, { icon: '⟳', label: up.label, badge: up.badge, disabled: up.busy, onClick: up.onClick }] : [])
      ]} />
      <input ref={bookInput} type="file" hidden multiple accept={SUPPORTED + ',.json'} onChange={(e) => { onFiles(e.target.files); e.target.value = '' }} />
      <input ref={restoreInput} type="file" hidden accept=".json,application/json" onChange={(e) => { onFiles(e.target.files); e.target.value = '' }} />
      <div className="libmain">
        <header className="topbar slim"><div className="title"><b>Library</b>{up.version && <span className="muted small ver"> v{up.version}</span>}</div></header>
        <UpdateBanner up={up} />

      {jobs.length > 0 && (
        <div className="jobs">
          {jobs.map((j) => <div key={j.id} className={'job ' + (j.error ? 'err' : j.done ? 'ok' : '')}><b>{j.name}</b> {j.status}{j.error && <button onClick={() => setJobs((x) => x.filter((y) => y.id !== j.id))}>✕</button>}</div>)}
        </div>
      )}

      <main>
        {last && (
          <section className="continue" onClick={() => setRoute({ name: 'reader', id: last.id })}>
            <Cover b={last} />
            <div><div className="muted small">Continue reading</div><h2>{last.title}</h2><div className="muted">{Math.round((last.progress.pct || 0) * 100)}% · {last.chapters[last.progress.chapter]?.title}</div></div>
          </section>
        )}
        {!books.length ? (
          <div className="dropzone"><h2>Drop a book here</h2><p>PDF, EPUB, DOCX, HTML, TXT or Markdown. Ads, watermarks, page numbers and headers are stripped on import. Everything stays on this device.</p><button className="primary" onClick={() => bookInput.current.click()}>Choose files</button></div>
        ) : (
          <div className="grid">
            {books.map((b) => (
              <div key={b.id} className="book">
                <Cover b={b} onClick={() => setRoute({ name: 'reader', id: b.id })} />
                <div className="meta">
                  <b title={b.title} onClick={() => setRoute({ name: 'reader', id: b.id })}>{b.title}</b>
                  <div className="muted small">{b.author || b.format.toUpperCase()} · {kWords(b.words)} words</div>
                  <div className="bar"><i style={{ width: Math.round((b.progress?.pct || 0) * 100) + '%' }} /></div>
                  <div className="row-actions">
                    <button onClick={() => setRoute({ name: 'notes', id: b.id })}>✎ {counts[b.id]?.n || 0} notes · ★ {counts[b.id]?.b || 0}</button>
                    <button title="Export this book with its notes" onClick={() => exportBundle([b.id])}>Export</button>
                    <button className="danger" onClick={async () => { if (confirm(`Delete "${b.title}" and all its notes from this device?`)) { await deleteBook(b.id); refresh() } }}>Delete</button>
                  </div>
                  {b.cleanReport?.removedCount > 0 && <details className="clean"><summary className="muted small">Cleaned: {b.cleanReport.removedCount} lines removed</summary>{b.cleanReport.samples.slice(0, 12).map((s, i) => <div key={i} className="small muted">[{s.reason}] {s.text}</div>)}</details>}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      </div>
      {drag && <div className="dropveil">Drop to import</div>}
    </div>
  )
}
