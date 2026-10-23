import { useRef } from 'react'

import { virtualInput } from '../state/runtime'
import Icon from './Icon'

/**
 * Movement joystick for touch screens. Writes straight into `virtualInput`, which
 * Player reads every frame. Its size comes from CSS; the throw radius is measured.
 */
export function Joystick() {
  const baseRef = useRef(null)
  const knobRef = useRef(null)
  const pointerId = useRef(null)

  const move = (e) => {
    const base = baseRef.current
    if (!base) return
    const rect = base.getBoundingClientRect()
    const radius = rect.width * 0.4
    let dx = e.clientX - (rect.left + rect.width / 2)
    let dy = e.clientY - (rect.top + rect.height / 2)
    const len = Math.hypot(dx, dy)
    if (len > radius) {
      dx = (dx / len) * radius
      dy = (dy / len) * radius
    }
    virtualInput.x = dx / radius
    virtualInput.y = dy / radius
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`
  }
  const release = () => {
    pointerId.current = null
    virtualInput.x = 0
    virtualInput.y = 0
    if (knobRef.current) knobRef.current.style.transform = ''
  }

  return (
    <div
      ref={baseRef}
      className="joystick live"
      onPointerDown={(e) => {
        pointerId.current = e.pointerId
        e.currentTarget.setPointerCapture(e.pointerId)
        move(e)
      }}
      onPointerMove={(e) => e.pointerId === pointerId.current && move(e)}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <div ref={knobRef} className="knob" />
    </div>
  )
}

/** Jump, for the right thumb. */
export function ActionButtons() {
  const releaseJump = () => {
    virtualInput.jump = false
  }
  return (
    <div className="actions">
      <button
        type="button"
        className="gbtn act-jump bg-blue ol live"
        onPointerDown={(e) => {
          e.preventDefault()
          virtualInput.jump = true
        }}
        onPointerUp={releaseJump}
        onPointerCancel={releaseJump}
        onPointerLeave={releaseJump}
        aria-label="Jump"
      >
        <Icon name="up" />
      </button>
    </div>
  )
}
