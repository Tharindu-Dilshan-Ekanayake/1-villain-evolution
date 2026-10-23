/**
 * World-anchored text labels ("billboards") rendered as DOM, not WebGL.
 *
 * Every label in the game - villain prices, treadmill names, wall HP, the
 * player's nameplate - is a div positioned by one frame loop (LabelLayer). That keeps
 * text crisp at any resolution and costs zero draw calls. Labels beyond their
 * distance (or the quality preset's) or behind the camera are hidden.
 */

let container = null

export function getLabelContainer() {
  if (!container) {
    container = document.createElement('div')
    container.className = 'label-layer'
  }
  return container
}

/** Live labels, iterated by LabelLayer every frame. */
export const labelRegistry = new Set()

/**
 * @param {object} opts
 * @param {[number, number, number]} opts.position world anchor (the label's bottom centre)
 * @param {string} [opts.className]
 * @param {string} [opts.html]
 * @param {number} [opts.maxDistance] hide beyond this many metres
 * @param {number} [opts.refDistance] distance at which the label is drawn at scale 1
 * @param {number} [opts.minScale]
 * @param {number} [opts.maxScale]
 * @param {() => [number, number, number] | null} [opts.follow] called each frame for moving anchors
 * @param {boolean} [opts.far] use `maxDistance` as is, past the quality preset's label range
 * @param {boolean} [opts.lobby] a lobby sign: hidden while the camera is inside the stage tunnel
 */
export function createLabel({
  position = [0, 0, 0],
  className = '',
  html = '',
  maxDistance = 60,
  refDistance = 14,
  minScale = 0.35,
  maxScale = 1.25,
  follow = null,
  far = false,
  lobby = false,
} = {}) {
  const el = document.createElement('div')
  el.className = `world-label ${className}`
  el.innerHTML = html
  el.style.display = 'none'
  getLabelContainer().appendChild(el)

  const label = {
    el,
    x: position[0],
    y: position[1],
    z: position[2],
    maxDistance,
    refDistance,
    minScale,
    maxScale,
    follow,
    far,
    lobby,
    shown: false,
    hidden: false,
    lastX: -1,
    lastY: -1,
    lastS: -1,
  }
  labelRegistry.add(label)

  return {
    el,
    setHtml(next) {
      if (el.innerHTML === next) return
      el.innerHTML = next
    },
    setPosition(x, y, z) {
      label.x = x
      label.y = y
      label.z = z
    },
    /** Force-hide regardless of distance (e.g. a broken wall's label). */
    setHidden(hidden) {
      label.hidden = hidden
    },
    remove() {
      labelRegistry.delete(label)
      el.remove()
    },
  }
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
