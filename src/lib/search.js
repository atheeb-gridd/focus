// Local search over sticky notes/highlights.
// Default: offline lexical-fuzzy ranking (TF-IDF over stems + bigrams + char trigrams).
// Optional: real semantic embeddings (MiniLM via transformers.js, downloads ~25MB once, then runs offline).
import { getKV, putKV } from './db.js'

const STOP = new Set('a an the and or of to in on at is are was were be been it this that for with as by from i you he she we they my your'.split(' '))
const stem = (w) => (w.length > 4 ? w.replace(/(ingly|edly|ing|ed|es|ly|s)$/, '') : w)

function feats(text) {
  const f = new Map()
  const add = (k, w) => f.set(k, (f.get(k) || 0) + w)
  const words = (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) || []).filter((w) => !STOP.has(w)).map(stem)
  words.forEach((w) => {
    add('w:' + w, 1)
    for (let i = 0; i + 3 <= w.length; i++) add('c:' + w.slice(i, i + 3), 0.25)
  })
  for (let i = 0; i < words.length - 1; i++) add('b:' + words[i] + '_' + words[i + 1], 0.5)
  return f
}
const cos = (a, b, w) => {
  let dot = 0, na = 0, nb = 0
  for (const [k, v] of a) { const x = v * (w.get(k) || 1); na += x * x; const y = b.get(k); if (y) dot += x * y * (w.get(k) || 1) }
  for (const [k, v] of b) { const y = v * (w.get(k) || 1); nb += y * y }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

export const annText = (a) => [a.text, a.note].filter(Boolean).join(' — ')

function lexical(query, anns) {
  const docs = anns.map((a) => feats(annText(a)))
  const q = feats(query)
  const df = new Map()
  docs.forEach((d) => d.forEach((_, k) => df.set(k, (df.get(k) || 0) + 1)))
  const idf = new Map()
  df.forEach((c, k) => idf.set(k, Math.log(1 + anns.length / c)))
  const ql = query.toLowerCase()
  return anns.map((a, i) => ({ a, score: cos(q, docs[i], idf) + (annText(a).toLowerCase().includes(ql) ? 0.4 : 0) }))
}

// ---- optional embeddings ----
let extractor
async function embedder() {
  if (!extractor) {
    const { pipeline, env } = await import('@huggingface/transformers')
    env.allowLocalModels = false
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
  }
  return extractor
}
const h = (s) => { let x = 5381; for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0; return (x >>> 0).toString(36) + s.length }
async function embed(text) {
  const key = 'emb:' + h(text)
  const hit = await getKV(key)
  if (hit) return hit
  const ex = await embedder()
  const out = await ex(text, { pooling: 'mean', normalize: true })
  const v = new Float32Array(out.data)
  await putKV(key, v)
  return v
}
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }

export async function searchAnnotations(query, anns, { smart = false } = {}) {
  const lex = lexical(query, anns)
  if (smart) {
    try {
      const qv = await embed(query)
      const scored = []
      for (let i = 0; i < anns.length; i++) {
        const dv = await embed(annText(anns[i]))
        scored.push({ a: anns[i], score: dot(qv, dv) * 0.8 + lex[i].score * 0.5, sem: true })
      }
      return scored.filter((r) => r.score > 0.25).sort((x, y) => y.score - x.score)
    } catch (e) {
      console.warn('Semantic model unavailable, using lexical search', e)
    }
  }
  return lex.filter((r) => r.score > 0.05).sort((x, y) => y.score - x.score)
}
