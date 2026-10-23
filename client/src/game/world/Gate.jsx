import { useEffect, useMemo } from 'react'
import { CanvasTexture, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, SRGBColorSpace } from 'three'

import { STAGE_COUNT } from '../../state/economy'
import { GATE_Z, TRACK_HALF } from '../layout'
import { useColliders } from '../physics'
import { STAGE_COLORS } from '../sceneStyle'
import { box, merge } from './kit'

const FONT = "'Fredoka', 'Arial Rounded MT Bold', 'Arial Black', sans-serif"
const ARCH_H = 14
const PILLAR_X = TRACK_HALF + 0.9
const SIGN_W = 15
const SIGN_H = 3.75

function strokedText(ctx, text, x, y, size, fill, stroke = '#1b1130', weight = 700) {
  ctx.font = `${weight} ${size}px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(4, size * 0.18)
  ctx.strokeStyle = stroke
  ctx.strokeText(text, x, y)
  ctx.fillStyle = fill
  ctx.fillText(text, x, y)
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawSign(canvas) {
  const ctx = canvas.getContext('2d')
  const { width: w, height: h } = canvas
  ctx.clearRect(0, 0, w, h)
  roundRect(ctx, 3, 3, w - 6, h - 6, 26)
  ctx.fillStyle = '#1b1130'
  ctx.fill()
  roundRect(ctx, 10, 10, w - 20, h - 20, 20)
  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, '#b06bff')
  grad.addColorStop(0.5, '#7a2fe0')
  grad.addColorStop(1, '#3a0f80')
  ctx.fillStyle = grad
  ctx.fill()
  roundRect(ctx, 20, 15, w - 40, h * 0.2, 10)
  ctx.fillStyle = 'rgba(255,255,255,0.22)'
  ctx.fill()
  strokedText(ctx, 'STAGES', w / 2, h * 0.44, h * 0.46, '#ffffff')
  strokedText(ctx, `${STAGE_COUNT} STAGES  •  BREAK WALLS  •  WIN PADS`, w / 2, h * 0.8, h * 0.13, '#ffe066', '#1b1130', 600)
}

/**
 * The STAGES gate: a stage-coloured arch over the opening in the lobby's north wall,
 * with a big purple sign on top facing spawn. Arch is one merged mesh, the sign one
 * canvas quad.
 */
export function Gate() {
  const arch = useMemo(() => {
    const parts = []
    for (const side of [-1, 1]) {
      const color = side < 0 ? STAGE_COLORS[0] : STAGE_COLORS[2]
      parts.push(box(2, ARCH_H, 2.6, color, { pos: [side * PILLAR_X, ARCH_H / 2, GATE_Z] }))
      parts.push(box(2.6, 0.8, 3.2, '#ffffff', { pos: [side * PILLAR_X, ARCH_H + 0.4, GATE_Z] }))
      parts.push(box(2.6, 0.8, 3.2, '#ffffff', { pos: [side * PILLAR_X, 0.4, GATE_Z] }))
    }
    parts.push(box(PILLAR_X * 2 + 2, 1.6, 2.4, STAGE_COLORS[1], { pos: [0, ARCH_H - 0.4, GATE_Z] }))
    return merge(parts)
  }, [])
  const sign = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 128
    drawSign(canvas)
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = 4
    return {
      texture,
      material: new MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }),
      geometry: new PlaneGeometry(SIGN_W, SIGN_H),
    }
  }, [])
  const archMaterial = useMemo(() => new MeshLambertMaterial({ vertexColors: true }), [])

  useEffect(() => {
    let cancelled = false
    // Web fonts may arrive after the first draw.
    document.fonts?.ready.then(() => {
      if (cancelled) return
      drawSign(sign.texture.image)
      sign.texture.needsUpdate = true
    })
    return () => {
      cancelled = true
    }
  }, [sign])

  useEffect(
    () => () => {
      arch.dispose()
      archMaterial.dispose()
      sign.texture.dispose()
      sign.material.dispose()
      sign.geometry.dispose()
    },
    [arch, archMaterial, sign],
  )

  useColliders(() => [-1, 1].map((side) => ({ box: [side * PILLAR_X, GATE_Z, 1, 1.3] })), [])

  return (
    <>
      <mesh geometry={arch} material={archMaterial} castShadow receiveShadow />
      <mesh geometry={sign.geometry} material={sign.material} position={[0, ARCH_H + SIGN_H / 2 + 0.6, GATE_Z + 1.3]} />
    </>
  )
}

export default Gate
