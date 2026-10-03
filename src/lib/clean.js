// Text cleaning + chapter building. Pure functions, no DOM.

const URL_RE = /https?:\/\/\S+|\bwww\.\S+\.\S+/i
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/
const STRONG_AD = [
  /downloaded\s+from/i,
  /free\s+(e-?books?|pdf|download)/i,
  /(join|follow|subscribe|visit|like)\s+(us|our|the)\b.*(telegram|whatsapp|facebook|twitter|instagram|youtube|channel|website|site|group|page)/i,
  /(telegram|whatsapp)\s*(channel|group)/i,
  /scan\s+(the\s+)?(qr|code)/i,
  /for\s+more\s+(free\s+)?(e-?books?|books|pdfs?)/i,
  /z-?library|libgen|library\s+genesis|pdf\s?drive|ebook\s?hunter|bookfi|\bb-ok\b|oceanofpdf|ocean\s+of\s+pdf|freebookspot|getfreebooks|manybooks|bookboon|bookrix|obooko|feedbooks|epubbud|pdfcoffee|scribd\.com|dokumen\.pub|vdoc\.pub/i,
  /(buy|get)\s+(the\s+)?(full|complete)\s+(book|version)/i,
  /this\s+(e-?book|pdf)\s+(is|was)\s+(provided|downloaded|shared|distributed|created)/i,
  /click\s+here\s+to/i,
  /download\s+(more|now|free|the\s+full|our)/i,
  /not\s+for\s+(sale|resale)/i,
  /^\s*(sponsored|advertisement|advertisment|ad)\s*$/i,
  /(like|share)\s+(and|&)\s+(share|subscribe)/i
]
// credit lines, only dropped when the block is very short
const CREDIT = /(scanned|ocr(?:'?ed)?|uploaded|shared|proofread|converted|formatted|ripped|edited\s+for\s+ebook)\s+by\b|ebook\s+created\s+(by|with)/i
const PAGENUM = /^[\s\-–—.]*(page\s*)?([0-9]{1,4}|[ivxlcdm]{1,7})([\s\-–—.]*(of|\/)\s*[0-9]{1,4})?[\s\-–—.]*$/i
const RULE = /^[\s_\-=.·•~*]{6,}$/ // lines of only dashes/underscores/dots (not "* * *")

export function adReason(text, isHeading = false) {
  const t = text.trim()
  if (!t) return 'empty'
  if (RULE.test(t) && !/^(\*\s*){3,}$/.test(t)) return 'rule'
  if (t.length <= 220) {
    if (URL_RE.test(t) && t.length <= 160) return 'url'
    if (EMAIL_RE.test(t) && t.length <= 120) return 'email'
    for (const re of STRONG_AD) if (re.test(t)) return 'ad'
  }
  if (t.length <= 100 && CREDIT.test(t)) return 'credit'
  if (!isHeading && PAGENUM.test(t) && t.length <= 14 && /\d/.test(t)) return 'page-number'
  return null
}

// stricter check used per physical PDF line (before paragraphs are assembled)
export function lineAdReason(text) {
  const t = text.trim()
  if (!t || t.length > 200) return null
  const url = t.match(URL_RE)
  if (url && url[0].length / t.length > 0.5) return 'url'
  const em = t.match(EMAIL_RE)
  if (em && em[0].length / t.length > 0.5) return 'email'
  for (const re of STRONG_AD) if (re.test(t)) return 'ad'
  if (t.length <= 100 && CREDIT.test(t)) return 'credit'
  return null
}

export function stripGutenberg(text) {
  const s = text.search(/\*{3}\s*START OF (THE|THIS) PROJECT GUTENBERG[^\n]*\n/i)
  if (s >= 0) {
    const m = text.slice(s).match(/\*{3}\s*START OF[^\n]*\n/i)
    text = text.slice(s + m[0].length)
  }
  const e = text.search(/\*{3}\s*END OF (THE|THIS) PROJECT GUTENBERG/i)
  if (e >= 0) text = text.slice(0, e)
  return text
}

const norm = (s) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f­​﻿]/g, '').replace(/\s+/g, ' ').trim()
const keyOf = (s) => s.toLowerCase().replace(/\d+/g, '#').replace(/[^a-z#]+/g, ' ').trim()

export function cleanBlocks(input) {
  const removed = []
  const note = (x, reason) => removed.length < 80 && removed.push({ text: x.slice(0, 140), reason })
  let blocks = []
  for (const b of input) {
    const x = norm(b.x)
    if (!x) continue
    const why = adReason(x, b.t === 'h')
    if (why) { note(x, why); continue }
    const last = blocks[blocks.length - 1]
    if (last && last.x === x && last.t === b.t) continue // consecutive duplicate
    blocks.push({ ...b, x })
  }
  // short non-heading blocks repeated many times = running headers/footers (EPUB/DOCX/TXT)
  const freq = new Map()
  for (const b of blocks) if (b.t === 'p' && b.x.length < 80) freq.set(keyOf(b.x), (freq.get(keyOf(b.x)) || 0) + 1)
  blocks = blocks.filter((b) => {
    if (b.t === 'p' && b.x.length < 80) {
      const k = keyOf(b.x)
      if (k && (freq.get(k) || 0) >= 8) { note(b.x, 'repeated header/footer'); return false }
    }
    return true
  })
  return { blocks, removed }
}

export function buildChapters(blocks) {
  const n = blocks.length
  const at = (maxL) => blocks.map((b, i) => (b.t === 'h' && b.l <= maxL ? i : -1)).filter((i) => i >= 0)
  let starts = at(1)
  if (starts.length < 2) starts = at(2)
  if (starts.length < 2) starts = at(3)
  if (starts[0] !== 0) starts.unshift(0)
  starts = [...new Set(starts)]
  let ch = starts.map((s, i) => ({ start: s, end: starts[i + 1] ?? n }))
  // merge tiny chapters (e.g. a lone "PART ONE" heading) into the next one
  const merged = []
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i]
    if (c.end - c.start < 3 && i < ch.length - 1) {
      const hasHead = blocks[c.start]?.t === 'h'
      ch[i + 1] = { ...ch[i + 1], realStart: c.start, pre: hasHead ? titleOf(blocks, c) : c.pre }
      continue
    }
    merged.push(c)
  }
  const out = []
  for (const c0 of merged) {
    const c = { ...c0, start: c0.realStart ?? c0.start }
    let t = titleOf(blocks, { start: c0.start })
    if (c0.pre && c0.pre !== t) t = c0.pre + ' · ' + t
    const len = c.end - c.start
    if (len > 300) {
      const parts = Math.ceil(len / 150)
      for (let p = 0; p < parts; p++) {
        out.push({ title: parts > 1 ? `${t} (${p + 1}/${parts})` : t, start: c.start + p * 150, end: Math.min(c.end, c.start + (p + 1) * 150) })
      }
    } else out.push({ title: t, start: c.start, end: c.end })
  }
  return out.length ? out : [{ title: 'Book', start: 0, end: n }]
}
function titleOf(blocks, c) {
  const b = blocks[c.start]
  return b && b.t === 'h' ? b.x.slice(0, 90) : c.start === 0 ? 'Beginning' : 'Section'
}

export const wordCount = (s) => (s.match(/\S+/g) || []).length
