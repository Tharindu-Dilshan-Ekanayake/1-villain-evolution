import {
  BoxGeometry,
  CanvasTexture,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three'

/**
 * Procedural textures and geometry for the toy-brick look.
 *
 * The stud pattern is drawn on a canvas at runtime rather than shipped as an image, so
 * recolouring the world is just a matter of editing sceneStyle.js.
 */

/** Blends a '#rrggbb' colour towards white (amount > 0) or black (amount < 0). */
function shade(hex, amount) {
  const value = parseInt(hex.slice(1), 16)
  const target = amount > 0 ? 255 : 0
  const t = Math.abs(amount)
  const channel = (shift) => {
    const c = (value >> shift) & 0xff
    return Math.round(c + (target - c) * t)
  }
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`
}

function fillCircle(ctx, x, y, r) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

/** One raised stud, lit from the top-left like the rest of the scene. */
function drawStud(ctx, x, y, cell, color) {
  const r = cell * 0.3

  // Drop shadow down-right, so the stud reads as raised off the plate.
  ctx.fillStyle = shade(color, -0.16)
  fillCircle(ctx, x + cell * 0.035, y + cell * 0.055, r * 1.04)

  // The stud's side: rim-lit top-left, darker bottom-right.
  const rim = ctx.createLinearGradient(x - r, y - r, x + r, y + r)
  rim.addColorStop(0, shade(color, 0.3))
  rim.addColorStop(1, shade(color, -0.12))
  ctx.fillStyle = rim
  fillCircle(ctx, x, y, r)

  // Flat top face.
  ctx.fillStyle = shade(color, 0.06)
  fillCircle(ctx, x, y, r * 0.8)
}

/**
 * A tileable studded-plate texture: a checker of `cellsPerTile` x `cellsPerTile`
 * cells alternating `base` / `alt`, each holding `studsPerCell` x `studsPerCell` studs.
 *
 * @param {{ base: string, alt?: string, studsPerCell?: number, cellsPerTile?: number,
 *           size?: number }} options
 */
export function createStudTexture({
  base,
  alt = base,
  studsPerCell = 2,
  cellsPerTile = 2,
  size = 512,
}) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  const cellPx = size / cellsPerTile
  const studPx = cellPx / studsPerCell

  for (let cy = 0; cy < cellsPerTile; cy += 1) {
    for (let cx = 0; cx < cellsPerTile; cx += 1) {
      const color = (cx + cy) % 2 === 0 ? base : alt
      ctx.fillStyle = color
      ctx.fillRect(cx * cellPx, cy * cellPx, cellPx, cellPx)

      for (let sy = 0; sy < studsPerCell; sy += 1) {
        for (let sx = 0; sx < studsPerCell; sx += 1) {
          drawStud(
            ctx,
            cx * cellPx + (sx + 0.5) * studPx,
            cy * cellPx + (sy + 0.5) * studPx,
            studPx,
            color,
          )
        }
      }

      // Faint seam between bricks.
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.07)'
      ctx.lineWidth = 2
      ctx.strokeRect(cx * cellPx + 1, cy * cellPx + 1, cellPx - 2, cellPx - 2)
    }
  }

  const texture = new CanvasTexture(canvas)
  // Canvas pixels are sRGB; without this the colours render washed out.
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  // three clamps this to what the GPU supports. Keeps the studs crisp at grazing
  // angles instead of smearing into a blur down the track.
  texture.anisotropy = 16
  return texture
}

/**
 * A box whose UVs are in world units divided by `tileSize`, on every face.
 *
 * Box UVs normally run 0..1 per face, which stretches a tiling texture differently on
 * each side of a long, thin box. World-scaled UVs keep the studs the same size on
 * every surface, whatever the box's dimensions.
 */
export function createWorldBoxGeometry(width, height, depth, tileSize) {
  const geometry = new BoxGeometry(width, height, depth)
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const uv = geometry.getAttribute('uv')

  for (let i = 0; i < position.count; i += 1) {
    // Measured from a corner so the pattern starts on a stud boundary.
    const x = position.getX(i) + width / 2
    const y = position.getY(i) + height / 2
    const z = position.getZ(i) + depth / 2

    let u
    let v
    if (Math.abs(normal.getX(i)) > 0.5) {
      u = z
      v = y
    } else if (Math.abs(normal.getY(i)) > 0.5) {
      u = x
      v = z
    } else {
      u = x
      v = y
    }
    uv.setXY(i, u / tileSize, v / tileSize)
  }

  uv.needsUpdate = true
  return geometry
}

/** A plane with UVs in world units divided by `tileSize`. See createWorldBoxGeometry. */
export function createWorldPlaneGeometry(width, height, tileSize) {
  const geometry = new PlaneGeometry(width, height)
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(i, (uv.getX(i) * width) / tileSize, (uv.getY(i) * height) / tileSize)
  }
  uv.needsUpdate = true
  return geometry
}

/** Sets planar world-space UVs (x/z divided by `tileSize`) on any flat-ish geometry. */
export function applyWorldUVs(geometry, tileSize, offsetX = 0, offsetZ = 0) {
  const pos = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < pos.count; i += 1) {
    uv.setXY(i, (pos.getX(i) + offsetX) / tileSize, (pos.getY(i) + offsetZ) / tileSize)
  }
  uv.needsUpdate = true
  return geometry
}

function mulberry32(seed) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function finishTexture(canvas, { srgb = true } = {}) {
  const texture = new CanvasTexture(canvas)
  if (srgb) texture.colorSpace = SRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.anisotropy = 8
  return texture
}

/**
 * Tileable wooden planks: rows of boards with staggered joints, grain streaks and
 * nail heads. One tile = `rows` boards.
 */
export function createPlankTexture({ base, alt, seam, size = 512, rows = 4 }) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const rand = mulberry32(11)
  const rowH = size / rows

  for (let r = 0; r < rows; r += 1) {
    const y = r * rowH
    // Joints staggered per row; segments wrap so the tile repeats seamlessly.
    const offset = (r % 2) * (size / 2) + (rand() - 0.5) * size * 0.2
    const joints = [offset % size, (offset + size / 2) % size].sort((a, b) => a - b)
    const segments = [
      [0, joints[0]],
      [joints[0], joints[1]],
      [joints[1], size],
    ]
    for (const [x0, x1] of segments) {
      if (x1 - x0 < 1) continue
      const t = rand()
      ctx.fillStyle = t < 0.5 ? base : alt
      ctx.fillRect(x0, y, x1 - x0, rowH)
      // Grain: long faint streaks along the board.
      for (let g = 0; g < 7; g += 1) {
        ctx.fillStyle = `rgba(${rand() < 0.5 ? '0,0,0' : '255,240,220'}, ${0.04 + rand() * 0.05})`
        const gy = y + 3 + rand() * (rowH - 6)
        ctx.fillRect(x0, gy, x1 - x0, 1 + rand() * 2)
      }
      // Nails near both ends.
      ctx.fillStyle = 'rgba(60,35,20,0.55)'
      for (const nx of [x0 + 8, x1 - 10]) {
        ctx.fillRect(nx, y + rowH * 0.25, 3, 3)
        ctx.fillRect(nx, y + rowH * 0.7, 3, 3)
      }
      // End joint.
      ctx.fillStyle = seam
      ctx.fillRect(x1 - 2, y, 2, rowH)
    }
    // Seam between rows, with a light bevel above it.
    ctx.fillStyle = seam
    ctx.fillRect(0, y + rowH - 3, size, 3)
    ctx.fillStyle = 'rgba(255,255,255,0.12)'
    ctx.fillRect(0, y, size, 2)
  }
  return finishTexture(canvas)
}

/** Large worn stone floor tiles in the tunnel's blue-grey, two per tile repeat. */
export function createStoneTileTexture({ base, alt, grout, size = 256 }) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const rand = mulberry32(17)
  const cell = size / 2
  for (let y = 0; y < 2; y += 1) {
    for (let x = 0; x < 2; x += 1) {
      ctx.fillStyle = (x + y) % 2 ? base : alt
      ctx.fillRect(x * cell, y * cell, cell, cell)
      // Mottling.
      for (let k = 0; k < 40; k += 1) {
        ctx.fillStyle = `rgba(${rand() < 0.5 ? '0,0,0' : '255,255,255'}, ${0.03 + rand() * 0.04})`
        const r = 4 + rand() * cell * 0.18
        ctx.beginPath()
        ctx.arc(x * cell + rand() * cell, y * cell + rand() * cell, r, 0, Math.PI * 2)
        ctx.fill()
      }
      // Bevel: light top-left edge, grout bottom-right.
      ctx.fillStyle = 'rgba(255,255,255,0.12)'
      ctx.fillRect(x * cell, y * cell, cell, 3)
      ctx.fillRect(x * cell, y * cell, 3, cell)
      ctx.fillStyle = grout
      ctx.fillRect(x * cell, y * cell + cell - 4, cell, 4)
      ctx.fillRect(x * cell + cell - 4, y * cell, 4, cell)
    }
  }
  return finishTexture(canvas)
}

/** Fine speckled sand. */
export function createSandTexture({ base, alt, size = 256 }) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const rand = mulberry32(5)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < size * 6; i += 1) {
    ctx.fillStyle = rand() < 0.5 ? alt : 'rgba(255,255,255,0.35)'
    ctx.fillRect(rand() * size, rand() * size, 2, 2)
  }
  return finishTexture(canvas)
}

/**
 * The breakable-wall crack map. Not a colour texture: per pixel, G is how strongly a
 * crack covers it and R is the damage (0..1) at which that crack appears. Cracks
 * start at the impact point in the middle and spread outward as damage rises, so the
 * shader can reveal them progressively with one texture lookup.
 */
export function createCrackTexture(size = 512) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const rand = mulberry32(23)
  ctx.fillStyle = 'rgb(255,0,0)'
  ctx.fillRect(0, 0, size, size)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const maxDist = size * 0.7
  const branch = (x, y, angle, length, width, startT, depth) => {
    let cx = x
    let cy = y
    let travelled = 0
    const step = size * 0.025
    while (travelled < length) {
      angle += (rand() - 0.5) * 0.7
      const nx = cx + Math.cos(angle) * step
      const ny = cy + Math.sin(angle) * step
      travelled += step
      const dist = Math.hypot(nx - size / 2, ny - size / 2)
      const t = Math.min(0.97, startT + (dist / maxDist) * 0.85)
      ctx.strokeStyle = `rgb(${Math.round(t * 255)},255,0)`
      ctx.lineWidth = Math.max(1.2, width * (1 - travelled / length) + 1)
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(nx, ny)
      ctx.stroke()
      cx = nx
      cy = ny
      if (depth < 3 && rand() < 0.12) {
        branch(cx, cy, angle + (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.6), length * 0.45, width * 0.6, t, depth + 1)
      }
    }
  }

  const arms = 9
  for (let i = 0; i < arms; i += 1) {
    const angle = (i / arms) * Math.PI * 2 + rand() * 0.4
    branch(size / 2, size / 2, angle, size * (0.35 + rand() * 0.3), 5, 0.02, 0)
  }
  // A second ring of cracks from the edges for the final stage.
  for (let i = 0; i < 6; i += 1) {
    const edgeAngle = rand() * Math.PI * 2
    const ex = size / 2 + Math.cos(edgeAngle) * size * 0.48
    const ey = size / 2 + Math.sin(edgeAngle) * size * 0.48
    branch(ex, ey, edgeAngle + Math.PI + (rand() - 0.5), size * 0.25, 3, 0.55, 1)
  }
  // Impact crater in the middle, visible from the first hit.
  ctx.fillStyle = 'rgb(5,255,0)'
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size * 0.025, 0, Math.PI * 2)
  ctx.fill()

  const texture = new CanvasTexture(canvas)
  texture.generateMipmaps = true
  return texture
}

/** Disposes a texture or geometry map when a component unmounts. */
export function disposeAll(...items) {
  for (const item of items) item?.dispose?.()
}
