import { useCallback, useEffect, useRef, useState } from 'react'

// Talks to the Electron main process (window.focusApp). Absent in the browser/iPad build.
export function useUpdater() {
  const api = typeof window !== 'undefined' ? window.focusApp : null
  const [version, setVersion] = useState('')
  const [s, setS] = useState({ state: 'idle' }) // idle|checking|current|dev|available|downloading|installing|error
  const [hidden, setHidden] = useState(false)
  const manual = useRef(false)

  const check = useCallback(async (isManual) => {
    if (!api) return
    manual.current = !!isManual
    if (isManual) { setHidden(false); setS({ state: 'checking' }) }
    try {
      const r = await api.checkUpdate()
      if (r.state === 'available') { setHidden(false); setS(r) }
      else if (isManual) setS(r)
      else setS({ state: 'idle' })
    } catch (e) { if (isManual) setS({ state: 'error', error: e.message || String(e) }) }
  }, [api])

  useEffect(() => {
    if (!api) return
    api.version().then(setVersion).catch(() => {})
    const off = api.onUpdateStatus((st) => { setHidden(false); setS((p) => ({ ...p, ...st })) })
    const t = setTimeout(() => check(false), 2500)
    return () => { off?.(); clearTimeout(t) }
  }, [api, check])

  const install = () => { setS((p) => ({ ...p, state: 'downloading', percent: 0 })); api.installUpdate().catch((e) => setS({ state: 'error', error: e.message || String(e) })) }
  const busy = s.state === 'checking' || s.state === 'downloading' || s.state === 'installing'
  return {
    available: !!api, version, s, hidden, busy, check, install, dismiss: () => setHidden(true),
    label: s.state === 'available' ? 'Update to v' + s.version : s.state === 'downloading' ? `Updating ${Math.round(s.percent || 0)}%` : s.state === 'checking' ? 'Checking…' : 'Check for updates',
    badge: s.state === 'available' ? 'new' : '',
    onClick: () => (s.state === 'available' ? install() : check(true))
  }
}

export function UpdateBanner({ up }) {
  const { s, hidden } = up
  if (!up.available || hidden || ['idle', 'checking'].includes(s.state)) return null
  if (s.state === 'available') return (
    <div className="banner"><span className="grow"><b>FOCUS {s.version} is available.</b>{s.notes ? ' ' + s.notes.split('\n')[0].slice(0, 120) : ''}</span>
      <button className="primary" onClick={up.install}>Update now</button><button onClick={up.dismiss}>Later</button></div>)
  if (s.state === 'downloading') return <div className="banner"><span>Downloading update…</span><div className="pbar"><i style={{ width: (s.percent || 0) + '%' }} /></div><span>{Math.round(s.percent || 0)}%</span></div>
  if (s.state === 'installing') return <div className="banner"><span className="grow">Installing. FOCUS will close and reopen by itself.</span></div>
  if (s.state === 'current') return <div className="banner"><span className="grow">You are on the latest version (v{up.version}).</span><button onClick={up.dismiss}>OK</button></div>
  if (s.state === 'dev') return <div className="banner"><span className="grow">Updates work in the installed app, not in dev mode.</span><button onClick={up.dismiss}>OK</button></div>
  if (s.state === 'error') return <div className="banner err"><span className="grow">Update failed: {s.error}</span><button onClick={() => up.check(true)}>Retry</button><button onClick={up.dismiss}>Close</button></div>
  return null
}
