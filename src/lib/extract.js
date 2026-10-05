import JSZip from 'jszip'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { itemsToLines, pagesToBlocks } from './pdfLines.js'
import { cleanBlocks, buildChapters, stripGutenberg, wordCount } from './clean.js'
import { putBook, getBook } from './db.js'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const cyrb53 = (str, seed = 0) => {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677) }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

const norm = (s) => s.replace(/\s+/g, ' ').trim()
const prettyName = (n) => n.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()


// ---------- covers ----------
const COVER_W = 320
const canvasToCover = (src, w, h) => {
  const k = Math.min(1, COVER_W / w)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k))
  const g = c.getContext('2d')
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height)
  g.drawImage(src, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.82)
}
async function shrinkBlob(blob) {
  try {
    const bmp = await createImageBitmap(blob)
    const out = canvasToCover(bmp, bmp.width, bmp.height)
    bmp.close?.()
    return out
  } catch { return '' }
}
async function pdfCover(pdf) {
  try {
    const page = await pdf.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const vp = page.getViewport({ scale: (COVER_W * 1.5) / base.width })
    const c = document.createElement('canvas')
    c.width = Math.round(vp.width); c.height = Math.round(vp.height)
    const g = c.getContext('2d')
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height)
    await page.render({ canvasContext: g, viewport: vp }).promise
    return canvasToCover(c, c.width, c.height)
  } catch (e) { console.warn('cover failed', e); return '' }
}
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }
const cleanTitle = (t) => t.replace(/\s*[\(\[](z-?lib[^)\]]*|libgen[^)\]]*|www\.[^)\]]*|pdfdrive[^)\]]*)[\)\]]/gi, '').replace(/\s+/g, ' ').trim()

// ---------- HTML -> blocks (EPUB, HTML, DOCX) ----------
const SKIP = new Set(['script', 'style', 'nav', 'noscript', 'svg', 'img', 'head', 'button', 'form'])
const HEAD = /^h[1-6]$/
const BLOCK = new Set(['p', 'div', 'section', 'article', 'blockquote', 'ul', 'ol', 'li', 'table', 'tbody', 'thead', 'tr', 'pre', 'header', 'footer', 'main', 'body', 'figure', 'figcaption', 'dl', 'dt', 'dd', 'aside', 'center', 'html'])
function walk(node, out) {
  let buf = ''
  const flush = () => { const s = norm(buf); if (s) out.push({ t: 'p', x: s }); buf = '' }
  for (const c of node.childNodes) {
    if (c.nodeType === 3) { buf += c.nodeValue; continue }
    if (c.nodeType !== 1) continue
    const t = c.tagName.toLowerCase()
    if (SKIP.has(t)) continue
    if (t === 'br') { buf += ' '; continue }
    if (HEAD.test(t)) { flush(); const s = norm(c.textContent); if (s) out.push({ t: 'h', l: Math.min(3, +t[1]), x: s }); continue }
    if (BLOCK.has(t)) {
      flush()
      if (t === 'tr') { const s = [...c.children].map((k) => norm(k.textContent)).filter(Boolean).join(' · '); if (s) out.push({ t: 'p', x: s }) }
      else if (t === 'pre') { const s = norm(c.textContent); if (s) out.push({ t: 'p', x: s }) }
      else walk(c, out)
      continue
    }
    buf += c.textContent
  }
  flush()
}
const htmlToBlocks = (html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out = []
  walk(doc.body, out)
  return { blocks: out, title: norm(doc.querySelector('title')?.textContent || '') }
}

// ---------- plain text / markdown ----------
const H_CHAPTER = /^(chapter|part|book|section)\s+([ivxlcdm]{1,8}|\d{1,3}|[a-z]{3,10})\b[\s.:\-–—]*[^.!?]{0,60}$/i
const H_WORD = /^(prologue|epilogue|preface|foreword|introduction|contents|table of contents|appendix[\s\w]*|acknowledg(e)?ments?|afterword|dedication|bibliography)$/i
function textToBlocks(raw) {
  let text = stripGutenberg(raw.replace(/\r\n?/g, '\n'))
  const out = []
  for (const chunk of text.split(/\n\s*\n+/)) {
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean)
    if (!lines.length) continue
    const md = lines[0].match(/^(#{1,6})\s+(.*)$/)
    if (md) { out.push({ t: 'h', l: Math.min(3, md[1].length), x: md[2] }); if (lines.length > 1) out.push({ t: 'p', x: lines.slice(1).join(' ') }); continue }
    if (lines.length === 1) {
      const l = lines[0]
      if ((H_CHAPTER.test(l) || H_WORD.test(l)) && l.length < 80) { out.push({ t: 'h', l: /^(chapter|part|book)/i.test(l) ? 1 : 2, x: l }); continue }
      if (l.length < 60 && l === l.toUpperCase() && /[A-Z]{3}/.test(l) && !/[.!?,]$/.test(l)) { out.push({ t: 'h', l: 2, x: l }); continue }
    }
    let s = lines[0]
    for (let i = 1; i < lines.length; i++) s = /[A-Za-z]-$/.test(s) && /^[a-z]/.test(lines[i]) ? s.slice(0, -1) + lines[i] : s + ' ' + lines[i]
    out.push({ t: 'p', x: s })
  }
  return out
}

// ---------- format handlers ----------
async function fromPdf(file, progress) {
  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjs.getDocument({ data }).promise
  const pages = []
  let chars = 0
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const vp = page.getViewport({ scale: 1 })
    const tc = await page.getTextContent()
    const lines = itemsToLines(tc.items)
    chars += lines.reduce((n, l) => n + l.text.length, 0)
    pages.push({ height: vp.height, lines })
    if (i % 5 === 0 || i === pdf.numPages) progress?.(`Reading page ${i} of ${pdf.numPages}`)
  }
  if (chars < 40 * Math.max(1, Math.min(pdf.numPages, 5))) {
    throw new Error('This PDF has no text layer (looks scanned). OCR is not built in yet.')
  }
  const meta = await pdf.getMetadata().catch(() => null)
  const t = norm(meta?.info?.Title || '')
  const { blocks, removed } = pagesToBlocks(pages)
  progress?.('Making cover…')
  const cover = await pdfCover(pdf)
  return {
    blocks, removed0: removed, cover,
    title: t.length > 3 && !/untitled|\.(docx?|indd|qxd|tex|pmd)$/i.test(t) ? t : '',
    author: norm(meta?.info?.Author || '')
  }
}

async function fromEpub(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const read = async (p) => { const f = zip.file(p) || zip.file(decodeURI(p)); return f ? f.async('string') : null }
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml')
  let title = '', author = '', files = [], coverPath = ''
  try {
    const container = xml(await read('META-INF/container.xml'))
    const opfPath = container.querySelector('rootfile').getAttribute('full-path')
    const opf = xml(await read(opfPath))
    const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
    title = norm(opf.getElementsByTagNameNS('*', 'title')[0]?.textContent || '')
    author = norm(opf.getElementsByTagNameNS('*', 'creator')[0]?.textContent || '')
    const manifest = {}
    for (const it of opf.getElementsByTagNameNS('*', 'item')) manifest[it.getAttribute('id')] = it
    const items = Object.values(manifest)
    const isImg = (it) => /^image\//.test(it.getAttribute('media-type') || '')
    const metaCover = [...opf.getElementsByTagNameNS('*', 'meta')].find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content')
    const ci = items.find((it) => (it.getAttribute('properties') || '').includes('cover-image'))
      || (metaCover && manifest[metaCover] && isImg(manifest[metaCover]) ? manifest[metaCover] : null)
      || items.find((it) => isImg(it) && /cover/i.test((it.getAttribute('id') || '') + (it.getAttribute('href') || '')))
    if (ci) coverPath = dir + ci.getAttribute('href')
    for (const ref of opf.getElementsByTagNameNS('*', 'itemref')) {
      const it = manifest[ref.getAttribute('idref')]
      if (!it) continue
      if ((it.getAttribute('properties') || '').includes('nav')) continue
      if (!/x?html/.test(it.getAttribute('media-type') || '')) continue
      files.push(dir + it.getAttribute('href').split('#')[0])
    }
  } catch { /* fall through */ }
  if (!files.length) files = Object.keys(zip.files).filter((n) => /\.(x?html?)$/i.test(n)).sort()
  const blocks = []
  for (const f of files) { const h = await read(f); if (h) blocks.push(...htmlToBlocks(h).blocks) }
  let cover = ''
  if (coverPath) {
    try {
      const f = zip.file(coverPath) || zip.file(decodeURI(coverPath))
      if (f) cover = await shrinkBlob(new Blob([await f.async('uint8array')], { type: MIME[coverPath.split('.').pop().toLowerCase()] || 'image/jpeg' }))
    } catch { /* no cover */ }
  }
  return { blocks, title, author, cover }
}

async function fromDocx(file) {
  const mammoth = (await import('mammoth/mammoth.browser.js')).default
  const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })
  return { blocks: htmlToBlocks(value).blocks, title: '', author: '' }
}

async function decodeText(file) {
  const buf = await file.arrayBuffer()
  let s = new TextDecoder('utf-8').decode(buf)
  if ((s.match(/�/g) || []).length > 5) s = new TextDecoder('windows-1252').decode(buf)
  return s
}

export const SUPPORTED = '.pdf,.epub,.txt,.md,.markdown,.html,.htm,.xhtml,.docx'

export async function importFile(file, progress) {
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  progress?.('Extracting text…')
  let r
  if (ext === 'pdf') r = await fromPdf(file, progress)
  else if (ext === 'epub') r = await fromEpub(file)
  else if (ext === 'docx') r = await fromDocx(file)
  else if (['html', 'htm', 'xhtml'].includes(ext)) { const h = htmlToBlocks(await decodeText(file)); r = { blocks: h.blocks, title: h.title, author: '' } }
  else if (['txt', 'md', 'markdown'].includes(ext) || file.type.startsWith('text/')) r = { blocks: textToBlocks(await decodeText(file)), title: '', author: '' }
  else throw new Error(`Unsupported format ".${ext}". Supported: PDF, EPUB, DOCX, HTML, TXT, MD.`)

  progress?.('Removing ads and boilerplate…')
  const { blocks, removed } = cleanBlocks(r.blocks)
  if (blocks.length < 3) throw new Error('Could not find readable text in this file.')
  const id = cyrb53(blocks.slice(0, 150).map((b) => b.x).join('|') + '#' + blocks.length)
  const old = await getBook(id)
  if (old) {
    if (!old.cover && r.cover) { await putBook({ ...old, cover: r.cover }, null); return { id, duplicate: true, coverAdded: true, title: old.title } }
    return { id, duplicate: true, title: old.title }
  }
  const words = blocks.reduce((n, b) => n + wordCount(b.x), 0)
  const meta = {
    id,
    title: cleanTitle(r.title || prettyName(file.name)),
    cover: r.cover || '',
    author: r.author || '',
    format: ext,
    addedAt: Date.now(),
    lastOpened: 0,
    words,
    blockCount: blocks.length,
    chapters: buildChapters(blocks),
    progress: null,
    cleanReport: { removedCount: removed.length + (r.removed0?.length || 0), samples: [...(r.removed0 || []), ...removed].slice(0, 60) }
  }
  await putBook(meta, blocks)
  return { id, title: meta.title, removed: meta.cleanReport.removedCount }
}
