const { app, BrowserWindow, shell, protocol, net } = require('electron')
const path = require('path')
const { pathToFileURL } = require('url')
const updater = require('./updater.cjs')
let mainWin = null

// Serve the built app from a real origin (app://reader) instead of file:// so that
// IndexedDB, web workers (pdf.js) and WASM behave exactly like in a browser.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])
const DIST = path.join(__dirname, '..', 'dist')

function create() {
  const win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 720, minHeight: 520,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#f7f3ea',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') }
  })
  mainWin = win
  win.on('closed', () => { mainWin = null })
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  if (process.env.ELECTRON_DEV) win.loadURL('http://localhost:5173')
  else win.loadURL('app://reader/index.html')
}

app.whenReady().then(() => {
  updater.register(() => mainWin)
  protocol.handle('app', (req) => {
    let p = decodeURIComponent(new URL(req.url).pathname)
    if (p === '/' || !p) p = '/index.html'
    const file = path.normalize(path.join(DIST, p))
    if (!file.startsWith(DIST)) return new Response('forbidden', { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })
  create()
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) create() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
