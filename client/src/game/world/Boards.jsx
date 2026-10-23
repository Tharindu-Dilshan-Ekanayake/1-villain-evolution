import { useEffect, useMemo, useRef } from 'react'
import { CanvasTexture, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, SRGBColorSpace } from 'three'

import { displayName } from '../../net/identity'
import { useLeaderboard } from '../../net/leaderboard'
import { formatNumber } from '../../state/economy'
import { useGameStore } from '../../state/gameStore'
import { player } from '../../state/runtime'
import { BOARDS, GATE_Z } from '../layout'
import { box, merge } from './kit'

/** Board size in metres; mounted high on the lobby's north wall. */
const BOARD_SIZE = 9
const BOARD_Y = 6.4

const FONT = "'Fredoka', 'Arial Rounded MT Bold', 'Arial Black', sans-serif"

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

const BOARD_PX = 512
const BOARD_ROWS = 10
const MEDALS = [
  ['#fff1a8', '#f2b705'],
  ['#ffffff', '#aab6c6'],
  ['#ffd2a6', '#c8742e'],
]

function formatHours(seconds) {
  const m = Math.floor(seconds / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

const formatBoardValue = (id, value) => (id === 'time' ? formatHours(value) : formatNumber(value))

/** This player's own record on a board, straight from the save. */
function localValue(id, s) {
  switch (id) {
    case 'speed':
      return s.stats.bestSpeed
    case 'wins':
      return s.stats.winsEarned
    case 'rebirths':
      return s.rebirths
    case 'time':
    default:
      return Math.floor(s.stats.playSeconds)
  }
}

/**
 * The rows to draw: the server's top ten with this player merged in at their live
 * value, so the board reacts at once instead of on the next poll.
 */
function boardRows(id, s, lb) {
  const mine = localValue(id, s)
  const rows = (lb.boards?.[id] || []).filter((r) => r.id !== 'you').map((r) => ({ name: r.name, value: r.value }))
  const server = lb.boards?.[id]?.find((r) => r.id === 'you')
  rows.push({ name: displayName(), value: Math.max(mine, server?.value || 0), you: true })
  rows.sort((a, b) => b.value - a.value)
  const index = rows.findIndex((r) => r.you)
  const rank = index < BOARD_ROWS ? index + 1 : Math.max(BOARD_ROWS + 1, lb.you?.[id] || 0)
  return { rows: rows.slice(0, BOARD_ROWS), rank, value: rows[index].value, online: lb.online }
}

function star(ctx, x, y, r, fill) {
  ctx.beginPath()
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * 0.45 : r
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
  }
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = '#1b1130'
  ctx.stroke()
}

/** Shortens text with an ellipsis until it fits `max` px in the current font. */
function fitText(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1)
  return `${t}…`
}

function drawLeaderboard(ctx, board, data) {
  const S = BOARD_PX
  ctx.clearRect(0, 0, S, S)

  // Frame in the board colour around a dark panel.
  roundRect(ctx, 0, 0, S, S, 34)
  ctx.fillStyle = board.color
  ctx.fill()
  roundRect(ctx, 10, 10, S - 20, S - 20, 26)
  const bg = ctx.createLinearGradient(0, 0, 0, S)
  bg.addColorStop(0, '#1f2747')
  bg.addColorStop(1, '#0b1020')
  ctx.fillStyle = bg
  ctx.fill()

  // Header band.
  ctx.save()
  roundRect(ctx, 10, 10, S - 20, S - 20, 26)
  ctx.clip()
  const head = ctx.createLinearGradient(0, 10, 0, 96)
  head.addColorStop(0, 'rgba(255,255,255,0.35)')
  head.addColorStop(0.08, board.color)
  head.addColorStop(1, board.color)
  ctx.fillStyle = head
  ctx.fillRect(10, 10, S - 20, 86)
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  ctx.fillRect(10, 92, S - 20, 4)
  ctx.restore()
  strokedText(ctx, board.title, S / 2, 56, 46, '#ffffff')
  star(ctx, 46, 54, 17, '#ffe066')
  star(ctx, S - 46, 54, 17, '#ffe066')

  // Ranked rows.
  const top = 104
  const rowH = 33
  ctx.textBaseline = 'middle'
  data.rows.forEach((row, i) => {
    const y = top + i * rowH
    const cy = y + rowH / 2
    if (row.you) {
      roundRect(ctx, 18, y + 1, S - 36, rowH - 2, 10)
      ctx.fillStyle = board.color
      ctx.globalAlpha = 0.45
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.lineWidth = 3
      ctx.strokeStyle = board.color
      ctx.stroke()
    } else if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)'
      ctx.fillRect(18, y + 1, S - 36, rowH - 2)
    }
    ctx.textAlign = 'center'
    if (i < 3) {
      const [light, dark] = MEDALS[i]
      const g = ctx.createRadialGradient(42, cy - 5, 2, 46, cy, 15)
      g.addColorStop(0, light)
      g.addColorStop(1, dark)
      ctx.beginPath()
      ctx.arc(46, cy, 14, 0, Math.PI * 2)
      ctx.fillStyle = g
      ctx.fill()
      ctx.lineWidth = 3
      ctx.strokeStyle = '#1b1130'
      ctx.stroke()
      ctx.font = `700 17px ${FONT}`
      ctx.fillStyle = '#1b1130'
    } else {
      ctx.font = `700 19px ${FONT}`
      ctx.fillStyle = '#9fb0d9'
    }
    ctx.fillText(String(i + 1), 46, cy + 1)

    ctx.font = `700 22px ${FONT}`
    ctx.textAlign = 'right'
    const value = formatBoardValue(board.id, row.value)
    ctx.fillStyle = '#ffe066'
    ctx.fillText(value, S - 30, cy + 1)
    const valueW = ctx.measureText(value).width
    ctx.textAlign = 'left'
    ctx.font = `${row.you ? 700 : 600} 21px ${FONT}`
    ctx.fillStyle = row.you ? '#ffffff' : '#e6ecff'
    ctx.fillText(fitText(ctx, row.name, S - 30 - valueW - 90), 74, cy + 1)
  })

  // Footer: your own rank and record.
  const fy = 448
  roundRect(ctx, 18, fy, S - 36, 48, 16)
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = board.color
  ctx.stroke()
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.font = `700 21px ${FONT}`
  ctx.fillStyle = '#cfe0ff'
  // Past the top ten, the rank is only known once the server has answered.
  const rank = data.rank <= BOARD_ROWS || data.online ? `#${data.rank}` : '—'
  ctx.fillText(`YOUR RANK  ${rank}`, 36, fy + 25)
  ctx.textAlign = 'right'
  ctx.fillStyle = '#ffe066'
  ctx.fillText(formatBoardValue(board.id, data.value), S - 36, fy + 25)
}

/**
 * The four record boards on the lobby's north wall, either side of the STAGES gate:
 * top Speed, Wins, Rebirths and Play time. Each board is one canvas texture (512px)
 * on one quad; the frames are one merged mesh. Redrawn from the store and the server
 * leaderboard every few seconds - never from the frame loop.
 */
export function Boards() {
  const frames = useMemo(
    () => merge(BOARDS.map((b) => box(BOARD_SIZE + 0.7, BOARD_SIZE + 0.7, 0.3, b.color, { pos: [b.x, BOARD_Y, b.z - 0.1] }))),
    [],
  )
  const quad = useMemo(() => new PlaneGeometry(BOARD_SIZE, BOARD_SIZE), [])
  const frameMaterial = useMemo(() => new MeshLambertMaterial({ vertexColors: true }), [])
  const materials = useMemo(
    () =>
      BOARDS.map(() => {
        const canvas = document.createElement('canvas')
        canvas.width = BOARD_PX
        canvas.height = BOARD_PX
        const texture = new CanvasTexture(canvas)
        texture.colorSpace = SRGBColorSpace
        texture.anisotropy = 4
        return new MeshBasicMaterial({ map: texture, toneMapped: false })
      }),
    [],
  )
  const meshRefs = useRef([])

  useEffect(() => {
    const lastKeys = BOARDS.map(() => '')
    let cancelled = false
    const redraw = (force = false) => {
      // Boards are only seen from the lobby: no texture uploads while deep in a stage.
      if (!force && player.z < GATE_Z - 60) return
      const s = useGameStore.getState()
      const lb = useLeaderboard.getState()
      BOARDS.forEach((b, i) => {
        const texture = meshRefs.current[i]?.material.map
        if (!texture) return
        const data = boardRows(b.id, s, lb)
        const key = JSON.stringify([data.rows.map((r) => [r.name, formatBoardValue(b.id, r.value), !!r.you]), data.rank, data.online])
        if (!force && key === lastKeys[i]) return
        lastKeys[i] = key
        drawLeaderboard(texture.image.getContext('2d'), b, data)
        texture.needsUpdate = true
      })
    }
    redraw(true)
    // Web fonts may arrive after the first draw.
    document.fonts?.ready.then(() => !cancelled && redraw(true))
    const id = setInterval(redraw, 3000)
    const unsubscribe = useLeaderboard.subscribe(() => redraw())
    return () => {
      cancelled = true
      clearInterval(id)
      unsubscribe()
    }
  }, [])

  useEffect(
    () => () => {
      frames?.dispose()
      quad.dispose()
      frameMaterial.dispose()
      materials.forEach((m) => {
        m.map.dispose()
        m.dispose()
      })
    },
    [frames, quad, frameMaterial, materials],
  )

  return (
    <>
      <mesh geometry={frames} material={frameMaterial} />
      {BOARDS.map((b, i) => (
        <mesh
          key={b.id}
          ref={(m) => {
            meshRefs.current[i] = m
          }}
          geometry={quad}
          material={materials[i]}
          position={[b.x, BOARD_Y, b.z + 0.08]}
        />
      ))}
    </>
  )
}

export default Boards
