// Turns raw pdf.js text items into clean paragraphs. Pure functions (testable in Node).

import { lineAdReason } from './clean.js'

const SENT_END = /[.!?…:;"”’')\]]\s*$/
const BULLET = /^([•▪●◦‣\-–*]|\(?\d{1,3}[.)]|\(?[a-z][.)])\s+\S/
const PAGENUM = /^[\s\-–—.]*(page\s*)?([0-9]{1,4}|[ivxlcdm]{1,7})([\s\-–—.]*(of|\/)\s*[0-9]{1,4})?[\s\-–—.]*$/i
const H_CHAPTER = /^(chapter|part|book|section)\s+([ivxlcdm]{1,8}|\d{1,3})\b[\s.:\-–—]*[^.!?]{0,60}$/i
const H_WORD = /^(prologue|epilogue|preface|foreword|introduction|contents|table of contents|appendix[\s\w]*|acknowledg(e)?ments?|afterword|dedication|bibliography|index)$/i
const norm = (t) => t.toLowerCase().replace(/\d+/g, '#').replace(/[^a-z#]+/g, ' ').trim()
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] }

export function itemsToLines(items) {
  const its = items
    .filter((i) => i.str !== undefined && i.transform)
    .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0, size: Math.abs(i.transform[3]) || i.height || 10 }))
    .filter((i) => i.str.length)
  its.sort((a, b) => b.y - a.y || a.x - b.x)
  const rows = []
  for (const it of its) {
    const r = rows[rows.length - 1]
    if (r && Math.abs(r.y - it.y) <= Math.max(1.5, it.size * 0.45)) r.items.push(it)
    else rows.push({ y: it.y, items: [it] })
  }
  const lines = []
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x)
    let text = ''
    let prev = null
    for (const it of r.items) {
      if (prev) {
        const gap = it.x - (prev.x + prev.w)
        const needSpace = !/\s$/.test(text) && !/^\s/.test(it.str) && gap > it.size * 0.15
        if (needSpace) text += ' '
      }
      text += it.str
      prev = it
    }
    text = text.replace(/\s+/g, ' ').trim()
    if (!text) continue
    const main = r.items.reduce((m, i) => (i.str.length > m.str.length ? i : m), r.items[0])
    const last = r.items[r.items.length - 1]
    lines.push({ text, x: r.items[0].x, x2: last.x + last.w, y: r.y, size: main.size })
  }
  return lines
}

const joinLine = (a, b) => (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b) ? a.slice(0, -1) + b : a + ' ' + b)

/** pages: [{height, lines:[{text,x,x2,y,size}]}] -> {blocks, removed} */
export function pagesToBlocks(pagesIn) {
  const removed = []
  const note = (t, reason) => removed.length < 60 && removed.push({ text: t.slice(0, 140), reason })
  const n = pagesIn.length
  const inZone = (p, l) => l.y > p.height * 0.88 || l.y < p.height * 0.12

  // drop ad/watermark lines first so they can never glue onto real paragraphs
  pagesIn = pagesIn.map((p) => ({ ...p, lines: p.lines.filter((l) => { const why = lineAdReason(l.text); if (why) { note(l.text, why); return false } return true }) }))

  const allSizes = new Map()
  for (const p of pagesIn) for (const l of p.lines) { const k = Math.round(l.size * 2) / 2; allSizes.set(k, (allSizes.get(k) || 0) + l.text.length) }
  const body0 = [...allSizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 12
  const isChapterLine = (l) => l.size >= body0 * 1.2 || /^(chapter|part|book)\s+([ivxlcdm]{1,8}|\d{1,3})$/i.test(l.text.trim())

  const zoneCount = new Map()
  for (const p of pagesIn) {
    const seen = new Set()
    for (const l of p.lines) if (inZone(p, l)) { const k = norm(l.text); if (k && !seen.has(k)) { seen.add(k); zoneCount.set(k, (zoneCount.get(k) || 0) + 1) } }
  }
  const thresh = Math.max(3, Math.ceil(n * 0.2))
  const pages = pagesIn.map((p, i) => ({
    ...p,
    i,
    lines: p.lines.filter((l) => {
      if (!inZone(p, l)) return true
      if (PAGENUM.test(l.text.trim())) { note(l.text, 'page-number'); return false }
      if (isChapterLine(l)) return true
      if ((zoneCount.get(norm(l.text)) || 0) >= thresh) { note(l.text, 'header/footer'); return false }
      return true
    })
  }))

  const sizeW = new Map()
  for (const p of pages) for (const l of p.lines) { const k = Math.round(l.size * 2) / 2; sizeW.set(k, (sizeW.get(k) || 0) + l.text.length) }
  const body = [...sizeW.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 12
  const headSizes = [...new Set([...sizeW.keys()].filter((s) => s >= body * 1.2))].sort((a, b) => b - a)
  const isBodySize = (l) => Math.abs(l.size - body) <= body * 0.12

  const metrics = pages.map((p) => {
    const bl = p.lines.filter(isBodySize)
    const ys = []
    for (let k = 1; k < bl.length; k++) { const d = bl[k - 1].y - bl[k].y; if (d > 0 && d < body * 3) ys.push(d) }
    return { left: pct(bl.map((l) => l.x), 0.15), maxX: pct(bl.map((l) => l.x2), 0.95), step: median(ys) || body * 1.3 }
  })

  const blocks = []
  let cur = null
  let prev = null
  const flush = () => { if (cur) { blocks.push({ t: 'p', x: cur }); cur = null } }

  for (const p of pages) {
    const m = metrics[p.i]
    for (const l of p.lines) {
      const bigHead = l.size >= body * 1.2 && l.text.length <= 140
      const canPattern = cur == null || SENT_END.test(cur)
      const patHead = !bigHead && canPattern && l.size >= body * 0.95 && ((H_CHAPTER.test(l.text) && l.text.length < 70) || H_WORD.test(l.text.trim()))
      if (bigHead || patHead) {
        flush()
        let lv = 2
        if (bigHead) { const r = headSizes.findIndex((h) => Math.abs(h - Math.round(l.size * 2) / 2) < 0.5); lv = r <= 0 ? 1 : r === 1 ? 2 : 3 } else if (H_CHAPTER.test(l.text)) lv = 1
        const last = blocks[blocks.length - 1]
        if (last && last.t === 'h' && last.l === lv && prev && prev.heading && prev.page === p.i && prev.y - l.y < l.size * 2.4) last.x += ' ' + l.text
        else blocks.push({ t: 'h', l: lv, x: l.text })
        prev = { ...l, heading: true, page: p.i }
        continue
      }
      let newPara = cur == null
      if (!newPara) {
        const samePage = prev && prev.page === p.i
        const ends = SENT_END.test(cur)
        const indent = l.x - m.left > l.size * 0.8
        const prevShort = m.maxX - m.left > 0 && (prev.x2 - m.left) / (m.maxX - m.left) < 0.62
        if (BULLET.test(l.text)) newPara = true
        else if (samePage && prev.y - l.y > m.step * 1.55) newPara = true
        else if (ends && (indent || prevShort)) newPara = true
      }
      if (newPara) { flush(); cur = l.text } else cur = joinLine(cur, l.text)
      prev = { ...l, page: p.i }
    }
  }
  flush()
  return { blocks, removed }
}
