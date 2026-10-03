import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getBook, getContent, listAnnotations, putAnnotation, removeAnnotation, saveProgress, touchBook, uid, saveSettings } from './lib/db.js'
import { NotesView, COLORS } from './Notes.jsx'
import Sidebar from './Sidebar.jsx'
import { download, notesToMarkdown } from './lib/portable.js'

export const FONTS = [
  ['literata', 'Literata', "'Literata', Georgia, serif", 'Designed for long on-screen reading (default)'],
  ['atkinson', 'Atkinson Hyperlegible', "'Atkinson Hyperlegible', system-ui, sans-serif", 'Max letter distinction, great for low vision'],
  ['source', 'Source Serif 4', "'Source Serif 4', Georgia, serif", 'Crisp, neutral book serif'],
  ['lora', 'Lora', "'Lora', Georgia, serif", 'Warm, calligraphic serif'],
  ['georgia', 'Georgia', "Georgia, 'Times New Roman', serif", 'Classic screen serif'],
  ['charter', 'Charter / Iowan', "'Iowan Old Style', 'Charter', 'Palatino', serif", 'System book serif'],
  ['system', 'System Sans', "-apple-system, 'Segoe UI', system-ui, sans-serif", 'Native UI sans']
]
export const THEMES = [['paper', 'Paper'], ['sepia', 'Sepia'], ['gray', 'Gray'], ['dark', 'Dark'], ['black', 'Black']]

function posOf(node, off, page) {
  let el = node.nodeType === 1 ? node : node.parentElement
  el = el && el.closest('[data-b]')
  if (!el || !page.contains(el)) return null
  const r = document.createRange()
  r.selectNodeContents(el)
  r.setEnd(node, off)
  return { b: +el.dataset.b, o: r.toString().length }
}

function segmentsFor(text, ranges) {
  const cuts = new Set([0, text.length])
  ranges.forEach((r) => { cuts.add(Math.max(0, Math.min(text.length, r.s))); cuts.add(Math.max(0, Math.min(text.length, r.e))) })
  const pts = [...cuts].sort((a, b) => a - b)
  const out = []
  for (let k = 0; k < pts.length - 1; k++) {
    const s = pts[k], e = pts[k + 1]
    if (s === e) continue
    out.push({ s, e, cover: ranges.filter((r) => r.s <= s && r.e >= e) })
  }
  return out
}

const Block = memo(function Block({ b, i, ranges }) {
  let content = b.x
  if (ranges && ranges.length) {
    content = segmentsFor(b.x, ranges).map(({ s, e, cover }) => {
      const t = b.x.slice(s, e)
      if (!cover.length) return t
      const hl = [...cover].reverse().find((r) => !r.find)
      const find = cover.some((r) => r.find)
      const cls = ['hl', hl ? 'c-' + hl.color : '', find ? 'hit' : '', cover.some((r) => r.note && r.last && r.e === e) ? 'has-note' : ''].join(' ')
      return <mark key={s} className={cls} data-ids={cover.filter((r) => r.id).map((r) => r.id).join(',')}>{t}</mark>
    })
  }
  if (b.t === 'h') { const H = 'h' + (b.l + 1 > 4 ? 4 : b.l + 1); return <H data-b={i} className="blk">{content}</H> }
  return <p data-b={i} className="blk">{content}</p>
})

function NotePopover({ ann, x, y, onSave, onColor, onDelete, onClose }) {
  const [note, setNote] = useState(ann.note || '')
  const left = Math.max(12, Math.min(window.innerWidth - 332, x - 160))
  const top = Math.max(60, Math.min(window.innerHeight - 260, y + 18))
  const done = () => { onSave(note); onClose() }
  return (
    <>
      <div className="overlay" onMouseDown={done} />
      <div className={`popover sticky c-${ann.color}`} style={{ left, top }}>
        <blockquote>{ann.text.length > 140 ? ann.text.slice(0, 140) + '…' : ann.text}</blockquote>
        <textarea autoFocus rows={4} placeholder="Sticky note…" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) done() }} />
        <div className="card-actions">
          {COLORS.map((c) => <i key={c} className={`dot c-${c} ${ann.color === c ? 'sel' : ''}`} onClick={() => onColor(c)} />)}
          <button className="danger" onClick={() => { onDelete(); onClose() }}>Delete</button>
          <button className="primary" onClick={done}>Done</button>
        </div>
      </div>
    </>
  )
}

export default function Reader({ id, goto, settings, setSettings, onExit, onNotes }) {
  const [meta, setMeta] = useState(null)
  const [blocks, setBlocks] = useState([])
  const [anns, setAnns] = useState([])
  const [ch, setCh] = useState(0)
  const [cur, setCur] = useState(0)
  const [panel, setPanel] = useState(null)
  const [showAa, setShowAa] = useState(false)
  const [sel, setSel] = useState(null)
  const [pop, setPop] = useState(null)
  const [findQ, setFindQ] = useState('')
  const [toast, setToast] = useState('')
  const scroller = useRef(null), pageRef = useRef(null), pending = useRef(null), curRef = useRef(0), saveT = useRef(null), persistRef = useRef(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      const m = await getBook(id), c = await getContent(id), a = await listAnnotations(id)
      if (!live || !m || !c) return
      const start = goto ?? m.progress?.block ?? 0
      const ci = Math.max(0, m.chapters.findIndex((x) => start >= x.start && start < x.end))
      pending.current = start; curRef.current = start
      setMeta(m); setBlocks(c.blocks); setAnns(a); setCh(ci); setCur(start)
      if (goto == null && m.progress) setToast('Resumed where you left off')
      touchBook(id)
    })()
    return () => { live = false }
  }, [id, goto])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2600); return () => clearTimeout(t) }, [toast])

  const chapters = meta?.chapters || []
  const chap = chapters[ch]
  const chapterOf = useCallback((b) => chapters.find((c) => b >= c.start && b < c.end)?.title, [chapters])
  const cum = useMemo(() => { let n = 0; return blocks.map((b) => (n += (b.x.match(/\S+/g) || []).length)) }, [blocks])

  useLayoutEffect(() => {
    if (pending.current == null || !pageRef.current || !chap) return
    const b = pending.current
    const el = pageRef.current.querySelector(`[data-b="${b}"]`)
    if (el && b !== chap.start) {
      scroller.current.scrollTop = el.offsetTop + pageRef.current.offsetTop - 24
      el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1800)
    } else scroller.current.scrollTop = 0
    pending.current = null
  }, [ch, blocks, chap])

  const topBlock = () => {
    const sc = scroller.current, pg = pageRef.current
    if (!sc || !pg) return null
    const els = pg.querySelectorAll('[data-b]')
    const y = sc.scrollTop - pg.offsetTop + 8
    for (const el of els) if (el.offsetTop + el.offsetHeight > y) return +el.dataset.b
    return els.length ? +els[els.length - 1].dataset.b : null
  }
  persistRef.current = async () => {
    if (!meta || !blocks.length || pending.current != null) return
    const b = topBlock() ?? curRef.current
    curRef.current = b; setCur(b)
    await saveProgress(id, { chapter: ch, block: b, pct: blocks.length > 1 ? b / (blocks.length - 1) : 0, updatedAt: Date.now() })
  }
  const onScroll = () => { clearTimeout(saveT.current); saveT.current = setTimeout(() => persistRef.current?.(), 350) }
  useEffect(() => {
    const flush = () => persistRef.current?.()
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('beforeunload', flush)
    return () => { document.removeEventListener('visibilitychange', flush); window.removeEventListener('beforeunload', flush); clearTimeout(saveT.current) }
  }, [])

  const goTo = (b) => {
    const ci = chapters.findIndex((c) => b >= c.start && b < c.end)
    if (ci < 0) return
    pending.current = b
    if (ci === ch) { setCh(ci); setBlocks((x) => [...x]) } else setCh(ci)
  }
  const goChapter = (i) => { if (i < 0 || i >= chapters.length) return; pending.current = chapters[i].start; setCh(i); setCur(chapters[i].start); setTimeout(() => persistRef.current?.(), 100) }
  const exit = async () => { clearTimeout(saveT.current); await persistRef.current?.(); onExit() }

  // ---- selection -> highlight ----
  const textOf = (a, b) => {
    if (a.b === b.b) return blocks[a.b].x.slice(a.o, b.o)
    const parts = [blocks[a.b].x.slice(a.o)]
    for (let i = a.b + 1; i < b.b; i++) parts.push(blocks[i].x)
    parts.push(blocks[b.b].x.slice(0, b.o))
    return parts.join(' ')
  }
  const capture = () => setTimeout(() => {
    const s = window.getSelection(), pg = pageRef.current
    if (!s || s.isCollapsed || !pg || !s.rangeCount) { setSel(null); return }
    const r = s.getRangeAt(0)
    let a = posOf(r.startContainer, r.startOffset, pg), b = posOf(r.endContainer, r.endOffset, pg)
    if (!a || !b) { setSel(null); return }
    if (b.b < a.b || (b.b === a.b && b.o < a.o)) [a, b] = [b, a]
    if (b.o === 0 && b.b > a.b) b = { b: b.b - 1, o: blocks[b.b - 1].x.length }
    if (a.b === b.b && a.o >= b.o) { setSel(null); return }
    const rect = r.getBoundingClientRect()
    setSel({ start: a, end: b, text: textOf(a, b).trim(), x: rect.left + rect.width / 2, y: rect.top })
  }, 10)

  const addHighlight = async (color, withNote) => {
    if (!sel || !sel.text) return
    const now = Date.now()
    const a = { id: uid(), bookId: id, type: 'highlight', start: sel.start, end: sel.end, text: sel.text, color, note: '', createdAt: now, updatedAt: now }
    await putAnnotation(a)
    setAnns((x) => [...x, a])
    window.getSelection()?.removeAllRanges()
    if (withNote) setPop({ id: a.id, x: sel.x, y: sel.y + 20 })
    setSel(null)
  }
  const updateAnn = async (a) => { const n = { ...a, updatedAt: Date.now() }; await putAnnotation(n); setAnns((x) => x.map((y) => (y.id === n.id ? n : y))) }
  const delAnn = async (a) => { await removeAnnotation(a); setAnns((x) => x.filter((y) => y.id !== a.id)) }
  const onPageClick = (e) => {
    if (!window.getSelection().isCollapsed) return
    const m = e.target.closest?.('mark[data-ids]')
    const ids = m?.dataset.ids?.split(',').filter(Boolean)
    if (ids?.length) setPop({ id: ids[ids.length - 1], x: e.clientX, y: e.clientY })
  }

  const bm = anns.find((a) => a.type === 'bookmark' && a.start.b === cur)
  const toggleBookmark = async () => {
    if (!blocks.length) return
    if (bm) return delAnn(bm)
    const now = Date.now()
    const a = { id: uid(), bookId: id, type: 'bookmark', start: { b: cur, o: 0 }, end: { b: cur, o: 0 }, text: blocks[cur].x.slice(0, 160), color: 'yellow', note: '', createdAt: now, updatedAt: now }
    await putAnnotation(a); setAnns((x) => [...x, a]); setToast('Bookmarked')
  }

  const rangesByBlock = useMemo(() => {
    const m = new Map()
    const add = (bi, r) => { if (!m.has(bi)) m.set(bi, []); m.get(bi).push(r) }
    for (const a of anns) {
      if (a.type !== 'highlight') continue
      for (let bi = a.start.b; bi <= a.end.b; bi++) {
        const len = blocks[bi]?.x.length ?? 0
        add(bi, { s: bi === a.start.b ? a.start.o : 0, e: bi === a.end.b ? a.end.o : len, id: a.id, color: a.color, note: !!a.note, last: bi === a.end.b })
      }
    }
    if (findQ.length > 1 && chap) {
      const q = findQ.toLowerCase()
      for (let bi = chap.start; bi < chap.end; bi++) {
        const t = blocks[bi].x.toLowerCase()
        for (let i = t.indexOf(q); i >= 0; i = t.indexOf(q, i + q.length)) add(bi, { s: i, e: i + q.length, find: true })
      }
    }
    return m
  }, [anns, blocks, findQ, chap])

  const findHits = useMemo(() => {
    if (findQ.length < 2) return []
    const q = findQ.toLowerCase(), out = []
    for (let i = 0; i < blocks.length && out.length < 300; i++) {
      const k = blocks[i].x.toLowerCase().indexOf(q)
      if (k >= 0) out.push({ b: i, snip: blocks[i].x.slice(Math.max(0, k - 50), k + 90) })
    }
    return out
  }, [findQ, blocks])

  useEffect(() => {
    const onKey = (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'f') { e.preventDefault(); setPanel('find') }
      else if (mod && e.key === 'b') { e.preventDefault(); toggleBookmark() }
      else if (e.key === 'Escape') { setPop(null); setSel(null); setShowAa(false); setPanel(null) }
      else if (!typing && !mod && e.key === 'ArrowRight') goChapter(ch + 1)
      else if (!typing && !mod && e.key === 'ArrowLeft') goChapter(ch - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const set = (patch) => { const n = { ...settings, ...patch }; setSettings(n); saveSettings(n) }
  const total = cum[cum.length - 1] || 1
  const pct = blocks.length > 1 ? Math.round((cur / (blocks.length - 1)) * 100) : 0
  const minsLeft = Math.max(1, Math.round((total - (cum[cur] || 0)) / 230))
  const popAnn = pop && anns.find((a) => a.id === pop.id)

  if (!meta) return <div className="loading">Opening…</div>
  return (
    <div className="reader">
      <Sidebar items={[
        { icon: '←', label: 'Library', onClick: exit },
        { sep: true },
        { icon: '☰', label: 'Contents', active: panel === 'toc', onClick: () => setPanel(panel === 'toc' ? null : 'toc') },
        { icon: '⌕', label: 'Find in book', active: panel === 'find', onClick: () => setPanel(panel === 'find' ? null : 'find') },
        { icon: '✎', label: 'Notes', badge: anns.length || null, active: panel === 'notes', onClick: () => setPanel(panel === 'notes' ? null : 'notes') },
        { icon: bm ? '★' : '☆', label: bm ? 'Bookmarked' : 'Bookmark', active: !!bm, onClick: toggleBookmark },
        { sep: true },
        { icon: 'Aa', label: 'Text & theme', active: showAa, onClick: () => setShowAa(!showAa) }
      ]} />
      {panel && (
        <aside className="panel">
          <div className="panel-head"><b>{panel === 'toc' ? 'Contents' : panel === 'find' ? 'Find in book' : 'Sticky notes'}</b><button onClick={() => setPanel(null)}>✕</button></div>
          {panel === 'toc' && <div className="toc">{chapters.map((c, i) => <button key={i} className={i === ch ? 'on' : ''} onClick={() => { goChapter(i); }}>{c.title}</button>)}</div>}
          {panel === 'find' && (
            <div className="find">
              <input autoFocus className="search" placeholder="Search this book…" value={findQ} onChange={(e) => setFindQ(e.target.value)} />
              <div className="muted small">{findQ.length > 1 ? `${findHits.length}${findHits.length >= 300 ? '+' : ''} matches` : 'Type 2+ characters'}</div>
              {findHits.map((h) => <button key={h.b} className="hit-row" onClick={() => goTo(h.b)}><span className="muted small">{chapterOf(h.b)}</span><br />…{h.snip}…</button>)}
            </div>
          )}
          {panel === 'notes' && (
            <NotesView compact anns={anns} chapterOf={chapterOf} smart={settings.smartSearch} onOpen={(a) => goTo(a.start.b)} onChange={updateAnn} onDelete={delAnn}
              onExport={() => download(`${meta.title.replace(/[^\w]+/g, '-').slice(0, 40)}-notes.md`, notesToMarkdown(meta, anns, chapterOf), 'text/markdown')} />
          )}
          {panel === 'notes' && <button className="ghost wide" onClick={() => onNotes(id)}>Open full notes board</button>}
        </aside>
      )}
      <div className="main">
        <header className="topbar slim"><div className="title"><b>{meta.title}</b><span className="muted"> · {chap?.title}</span></div></header>
      {showAa && (
        <div className="aa">
          <div className="row"><label>Font</label>
            <select value={settings.font} onChange={(e) => set({ font: e.target.value })}>
              {FONTS.map(([k, n, , d]) => <option key={k} value={k}>{n}{k === 'literata' ? ' (default)' : ''}</option>)}
            </select>
          </div>
          <div className="muted small">{FONTS.find((f) => f[0] === settings.font)?.[3]}</div>
          <Slider label="Size" min={14} max={34} step={1} v={settings.size} fmt={(v) => v + 'px'} on={(v) => set({ size: v })} />
          <Slider label="Line height" min={1.3} max={2.1} step={0.05} v={settings.lineHeight} fmt={(v) => v.toFixed(2)} on={(v) => set({ lineHeight: v })} />
          <Slider label="Line width" min={36} max={110} step={2} v={settings.width} fmt={(v) => v + ' ch'} on={(v) => set({ width: v })} />
          <Slider label="Paragraph gap" min={0} max={2} step={0.05} v={settings.para} fmt={(v) => v.toFixed(2) + 'em'} on={(v) => set({ para: v })} />
          <Slider label="Letter spacing" min={0} max={0.08} step={0.005} v={settings.letter} fmt={(v) => v.toFixed(3) + 'em'} on={(v) => set({ letter: v })} />
          <div className="row"><label>Align</label>
            <div className="pills">{['left', 'justify'].map((a) => <button key={a} className={settings.align === a ? 'on' : ''} onClick={() => set({ align: a })}>{a}</button>)}</div>
          </div>
          <div className="row"><label>Theme</label>
            <div className="pills">{THEMES.map(([k, n]) => <button key={k} className={settings.theme === k ? 'on' : ''} onClick={() => set({ theme: k })}>{n}</button>)}</div>
          </div>
          <div className="row"><label>Hyphenation</label>
            <input type="checkbox" checked={settings.hyphens} onChange={(e) => set({ hyphens: e.target.checked })} />
          </div>
          <div className="row"><label>Semantic note search</label>
            <input type="checkbox" checked={settings.smartSearch} onChange={(e) => set({ smartSearch: e.target.checked })} />
          </div>
          <div className="muted small">Semantic search downloads a ~25MB model once, then runs fully offline.</div>
          <button className="ghost" onClick={() => set({ font: 'literata', size: 19, lineHeight: 1.65, width: 66, para: 0.85, letter: 0, align: 'left', theme: 'paper', hyphens: true })}>Reset to recommended</button>
        </div>
      )}
        <div className="body">
        <div className="scroller" ref={scroller} onScroll={onScroll}>
          <article className="page" ref={pageRef} onMouseUp={capture} onTouchEnd={capture} onKeyUp={capture} onClick={onPageClick}>
            {chap && blocks.slice(chap.start, chap.end).map((b, k) => <Block key={chap.start + k} b={b} i={chap.start + k} ranges={rangesByBlock.get(chap.start + k)} />)}
            <nav className="chnav">
              <button disabled={ch === 0} onClick={() => goChapter(ch - 1)}>← Previous</button>
              <span className="muted">{ch + 1} / {chapters.length}</span>
              <button disabled={ch >= chapters.length - 1} onClick={() => goChapter(ch + 1)}>Next →</button>
            </nav>
          </article>
        </div>
        </div>
        <footer className="bottombar">
        <div className="bar"><i style={{ width: pct + '%' }} /></div>
        <span>{pct}%</span><span className="muted">~{minsLeft} min left in book</span>
      </footer>
      </div>

      {sel && !pop && (
        <div className="seltool" style={{ left: Math.max(8, Math.min(window.innerWidth - 250, sel.x - 120)), top: Math.max(56, sel.y - 48) }} onMouseDown={(e) => e.preventDefault()}>
          {COLORS.map((c) => <i key={c} className={`dot c-${c}`} onClick={() => addHighlight(c, false)} />)}
          <button onClick={() => addHighlight('yellow', true)}>✎ Note</button>
          <button onClick={() => { navigator.clipboard?.writeText(sel.text); setSel(null) }}>Copy</button>
        </div>
      )}
      {popAnn && <NotePopover key={popAnn.id} ann={popAnn} x={pop.x} y={pop.y} onSave={(note) => note !== popAnn.note && updateAnn({ ...popAnn, note })} onColor={(c) => updateAnn({ ...popAnn, color: c })} onDelete={() => delAnn(popAnn)} onClose={() => setPop(null)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function Slider({ label, min, max, step, v, fmt, on }) {
  return (
    <div className="row"><label>{label}</label>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => on(+e.target.value)} />
      <span className="val">{fmt(v)}</span>
    </div>
  )
}
