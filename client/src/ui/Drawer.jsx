import { useState } from 'react'

import { events } from '../state/runtime'

const STORAGE_PREFIX = 'villain-evo-drawer:'

function readOpen(id) {
  try {
    return localStorage.getItem(STORAGE_PREFIX + id) !== '0'
  } catch {
    return true
  }
}

function writeOpen(id, open) {
  try {
    localStorage.setItem(STORAGE_PREFIX + id, open ? '1' : '0')
  } catch {
    // Not fatal: the drawer just reopens next session.
  }
}

/**
 * A group of HUD buttons that slides away behind an arrow tab, so phone players can
 * clear the screen. The tab only shows on compact layouts; on a big screen the group
 * is always open. Remembers its state per device.
 *
 * @param {{ id: string, side: 'left' | 'right', label: string, children: React.ReactNode }} props
 */
export function Drawer({ id, side, label, children }) {
  const [open, setOpen] = useState(() => readOpen(id))
  const toggle = () => {
    const next = !open
    setOpen(next)
    writeOpen(id, next)
    events.emit('ui')
  }
  // The arrow points the way the group will move (CSS triangle: no symbol font needed).
  const pointsLeft = side === 'left' ? open : !open
  const tab = (
    <button
      type="button"
      className="gbtn drawer-tab bg-dark live"
      onClick={toggle}
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} ${label}`}
    >
      <span className={`tri ${pointsLeft ? 'tri-left' : 'tri-right'}`} aria-hidden />
    </button>
  )
  return (
    <div className={`drawer drawer-${side} ${open ? 'is-open' : 'is-closed'}`}>
      {side === 'right' && tab}
      <div className="drawer-body">{children}</div>
      {side === 'left' && tab}
    </div>
  )
}

export default Drawer
