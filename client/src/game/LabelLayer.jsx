import { useFrame, useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { Vector3 } from 'three'

import { cameraHandle } from '../state/runtime'
import { labelRegistry } from './labels'
import { GATE_Z } from './layout'
import { getPreset } from './quality'

const _v = new Vector3()

/**
 * Labels are sized for views whose shorter side is ~800px; smaller screens (phones,
 * either way up) shrink them gently - not linearly, so text stays readable.
 */
const REF_VIEW_SIZE = 800
const MIN_VIEW_FIT = 0.62
/** Camera this far past the gate is inside the stage tunnel: lobby signs hide. */
const TUNNEL_Z = GATE_Z - 2

/**
 * Positions every DOM label each frame, right above its anchor and smaller with
 * distance; nearer labels draw over farther ones. Writes only when a label moves by
 * a pixel or changes visibility, so a still camera costs almost nothing.
 *
 * Also publishes the camera for DOM effects outside the Canvas (floating numbers).
 */
export function LabelLayer() {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  useEffect(() => {
    cameraHandle.camera = camera
    cameraHandle.width = size.width
    cameraHandle.height = size.height
  }, [camera, size])

  useFrame(() => {
    const limit = getPreset().labelDistance
    const w = size.width
    const h = size.height
    const fit = Math.min(1, Math.max(MIN_VIEW_FIT, Math.sqrt(Math.min(w, h) / REF_VIEW_SIZE)))
    const cam = camera.position
    const inTunnel = cam.z < TUNNEL_Z

    for (const label of labelRegistry) {
      if (label.follow) {
        const p = label.follow()
        if (p) {
          label.x = p[0]
          label.y = p[1]
          label.z = p[2]
        }
      }

      const dx = label.x - cam.x
      const dy = label.y - cam.y
      const dz = label.z - cam.z
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      const range = label.far ? label.maxDistance : Math.min(label.maxDistance, limit * (label.follow ? 2 : 1))
      let visible = !label.hidden && dist < range && !(label.lobby && inTunnel)

      let sx = 0
      let sy = 0
      if (visible) {
        _v.set(label.x, label.y, label.z).project(camera)
        visible = _v.z < 1 && _v.x > -1.3 && _v.x < 1.3 && _v.y > -1.3 && _v.y < 1.3
        // Sub-pixel (to a tenth): whole-pixel snapping made moving text stair-step.
        sx = Math.round(((_v.x + 1) / 2) * w * 10) / 10
        sy = Math.round(((1 - _v.y) / 2) * h * 10) / 10
      }

      if (visible !== label.shown) {
        label.el.style.display = visible ? '' : 'none'
        label.shown = visible
        label.lastX = -1
        label.lastO = -1
      }
      if (!visible) continue

      // Fade out over the last fifth of the range instead of popping.
      const fade = Math.min(1, (range - dist) / (range * 0.2))
      const o = Math.round(fade * 20) / 20
      if (o !== label.lastO) {
        label.el.style.opacity = o >= 1 ? '' : String(o)
        label.lastO = o
      }

      const s = fit * Math.min(label.maxScale, Math.max(label.minScale, label.refDistance / Math.max(dist, 0.01)))
      const sRounded = Math.round(s * 500) / 500
      if (sx !== label.lastX || sy !== label.lastY || sRounded !== label.lastS) {
        label.el.style.transform = `translate3d(${sx}px, ${sy}px, 0) translate(-50%, -100%) scale(${sRounded})`
        const z = String(1000 - Math.round(dist * 4))
        if (label.el.style.zIndex !== z) label.el.style.zIndex = z
        label.lastX = sx
        label.lastY = sy
        label.lastS = sRounded
      }
    }
  })

  return null
}

export default LabelLayer
