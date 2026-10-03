import { useEffect, useState } from 'react'

// Collapsible left sidebar. Expanded = icons + labels, collapsed = icon rail. Cmd/Ctrl+\ toggles.
export default function Sidebar({ items }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('sidebar') !== '0' } catch { return true } })
  const toggle = () => setOpen((o) => { try { localStorage.setItem('sidebar', o ? '0' : '1') } catch {} return !o })
  useEffect(() => {
    const k = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); toggle() } }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  return (
    <nav className={'sidebar ' + (open ? 'open' : 'rail')}>
      <div className="sb-head">
        {open && <b className="sb-brand wordmark">FOCUS</b>}
        <button className="sb-toggle" onClick={toggle} title={(open ? 'Collapse' : 'Expand') + ' sidebar (Cmd/Ctrl+\\)'}>{open ? '«' : '»'}</button>
      </div>
      {items.map((it, i) =>
        it.sep ? <hr key={i} /> : (
          <button key={i} className={'sb-item' + (it.active ? ' on' : '')} title={it.label} disabled={it.disabled} onClick={it.onClick}>
            <span className="ic">{it.icon}</span>
            {open && <span className="lb">{it.label}</span>}
            {it.badge ? <span className="badge">{it.badge}</span> : null}
          </button>
        )
      )}
    </nav>
  )
}
