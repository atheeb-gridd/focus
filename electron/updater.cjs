// In-app updater. Works without paid code signing: files downloaded by the app itself carry no
// "downloaded from the internet" flag, so Gatekeeper / SmartScreen are not triggered for updates.
const { app, ipcMain, net } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, execFile } = require('child_process')
const { newer, pickAsset, MAC_SWAP_SCRIPT } = require('./updater-core.cjs')

const REPO = 'atheeb-gridd/focus'
let getWin = () => null
let latest = null

const send = (s) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send('updater:status', s) }
const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, (e, out, err) => (e ? rej(new Error(err || e.message)) : res(out))))

async function check() {
  if (!app.isPackaged) return { state: 'dev', version: app.getVersion() }
  const r = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { 'User-Agent': 'FOCUS-updater', Accept: 'application/vnd.github+json' } })
  if (!r.ok) throw new Error(`Could not reach the update server (${r.status})`)
  const rel = await r.json()
  const version = String(rel.tag_name).replace(/^v/, '')
  if (!newer(version, app.getVersion())) { latest = null; return { state: 'current', version: app.getVersion() } }
  const asset = pickAsset(rel.assets || [], process.platform, process.arch)
  if (!asset) { latest = null; return { state: 'current', version: app.getVersion(), note: 'A new version exists but its installer is still being built. Try again in a few minutes.' } }
  latest = { version, url: asset.browser_download_url, size: asset.size, name: asset.name }
  return { state: 'available', version, notes: String(rel.body || '').slice(0, 600) }
}

async function download(url, dest, onProgress) {
  const r = await net.fetch(url, { redirect: 'follow' })
  if (!r.ok) throw new Error(`Download failed (${r.status})`)
  const total = Number(r.headers.get('content-length')) || latest.size || 0
  let got = 0
  const out = fs.createWriteStream(dest)
  const reader = r.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    got += value.length
    if (!out.write(value)) await new Promise((res) => out.once('drain', res))
    onProgress(total ? got / total : 0)
  }
  await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())))
}

async function install() {
  if (!app.isPackaged) throw new Error('Updates only work in the installed app.')
  if (!latest) throw new Error('No update to install. Check for updates first.')
  let dest = null
  if (process.platform === 'darwin') {
    dest = path.resolve(process.execPath, '..', '..', '..')
    if (!dest.endsWith('.app')) throw new Error('Could not locate the app bundle.')
    if (dest.startsWith('/Volumes/')) throw new Error('Drag FOCUS into your Applications folder first, then update.')
    try { fs.accessSync(path.dirname(dest), fs.constants.W_OK) } catch { throw new Error(`FOCUS cannot replace itself inside ${path.dirname(dest)}. Move it to Applications and try again.`) }
  }
  const dir = path.join(app.getPath('temp'), 'focus-update')
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, latest.name)
  send({ state: 'downloading', percent: 0, version: latest.version })
  await download(latest.url, file, (p) => send({ state: 'downloading', percent: Math.round(p * 100), version: latest.version }))
  send({ state: 'installing', version: latest.version })

  if (process.platform === 'win32') {
    spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
    setTimeout(() => app.quit(), 400)
    return
  }
  const x = path.join(dir, 'x')
  fs.mkdirSync(x)
  await run('ditto', ['-x', '-k', file, x])
  const bundle = fs.readdirSync(x).find((n) => n.endsWith('.app'))
  if (!bundle) throw new Error('The downloaded update was not a valid app.')
  const script = path.join(dir, 'swap.sh')
  fs.writeFileSync(script, MAC_SWAP_SCRIPT, { mode: 0o755 })
  spawn('/bin/bash', [script, String(process.pid), path.join(x, bundle), dest], { detached: true, stdio: 'ignore' }).unref()
  setTimeout(() => app.quit(), 400)
}

function register(winGetter) {
  getWin = winGetter
  ipcMain.handle('updater:version', () => app.getVersion())
  ipcMain.handle('updater:check', async () => { try { return await check() } catch (e) { return { state: 'error', error: e.message } } })
  ipcMain.handle('updater:install', async () => { try { await install(); return { ok: true } } catch (e) { send({ state: 'error', error: e.message }); return { ok: false } } })
}
module.exports = { register }
