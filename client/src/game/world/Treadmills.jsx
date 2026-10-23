import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  Matrix4,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three'

import { TREADMILL_BY_ID, TREADMILLS } from '../../state/content'
import { formatNumber, isTreadmillOp, treadmillUnlocked } from '../../state/economy'
import { useGameStore } from '../../state/gameStore'
import { remotes } from '../../net/netStore'
import { context, player } from '../../state/runtime'
import { createEffectColumnGeometry, createEffectColumnMaterial, setEffectInstance } from '../fx/effectColumn'
import { createLabel, escapeHtml } from '../labels'
import { BELT_LENGTH, BELT_WIDTH, PAD_SPOTS } from '../layout'
import { useColliders } from '../physics'
import { usePreset } from '../quality'
import { icon } from '../../ui/icons'
import { box, merge } from './kit'
import { setUniform } from './materials'

const N = TREADMILLS.length
const DECK_Y = 0.36
/** Segments along each lightning arc. */
const ARC_SEGMENTS = 24
/** Glow strength: locked, unlocked, someone running on it; Treadmill OP adds a boost. */
const ENERGY = { locked: 0.22, unlocked: 0.6, busy: 1.15, op: 0.25 }
/** How often (s) to look for who is running where. */
const BUSY_CHECK = 0.25
/** The electric column over a belt: height (m) and strength while idle / running. */
const COLUMN_HEIGHT = 3.2
const COLUMN = { unlocked: 0.4, busy: 1.2 }

const _dummy = new Object3D()
const _color = new Color()

/**
 * One treadmill, facing +X (the runner looks towards the console): deck, side rails,
 * console uprights, handlebar and screen. White parts take the instance colour (the
 * treadmill's frame colour); dark parts stay dark.
 */
function buildFrame() {
  const L = BELT_LENGTH
  const W = BELT_WIDTH
  const front = L / 2 + 0.2
  return merge([
    box(L + 0.7, DECK_Y - 0.02, W + 0.6, '#ffffff', { pos: [0, (DECK_Y - 0.02) / 2, 0] }),
    box(L + 0.1, 0.26, 0.28, '#ffffff', { pos: [0, DECK_Y + 0.13, W / 2 + 0.16] }),
    box(L + 0.1, 0.26, 0.28, '#ffffff', { pos: [0, DECK_Y + 0.13, -W / 2 - 0.16] }),
    box(0.22, 1.5, 0.22, '#2a2c31', { pos: [front, DECK_Y + 0.75, W / 2 + 0.05] }),
    box(0.22, 1.5, 0.22, '#2a2c31', { pos: [front, DECK_Y + 0.75, -W / 2 - 0.05] }),
    box(0.26, 0.16, W + 0.4, '#2a2c31', { pos: [front, DECK_Y + 1.5, 0] }),
    box(0.4, 0.62, 1.3, '#ffffff', { pos: [front + 0.12, DECK_Y + 1.62, 0], rot: [0, 0, 0.35] }),
    box(0.1, 0.46, 1.1, '#101418', { pos: [front - 0.05, DECK_Y + 1.6, 0], rot: [0, 0, 0.35] }),
    // Rollers at both ends of the belt.
    box(0.34, 0.34, W + 0.1, '#3a3d44', { pos: [L / 2 - 0.05, DECK_Y - 0.05, 0] }),
    box(0.34, 0.34, W + 0.1, '#3a3d44', { pos: [-L / 2 + 0.05, DECK_Y - 0.05, 0] }),
  ])
}

const beltVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  void main() {
    vUv = uv;
    vColor = vec3(1.0);
    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #endif
    vec4 p = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      p = instanceMatrix * p;
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * p;
  }
`
const beltFragment = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vColor;
  void main() {
    // Slats racing back under the runner, with a glowing centre lane and chevrons of
    // energy streaming down it.
    float slat = step(0.5, fract(vUv.x * 9.0 + uTime * 3.2));
    float lane = smoothstep(0.42, 0.0, abs(vUv.y - 0.5));
    float chevron = fract(vUv.x * 3.0 + uTime * 1.6 + abs(vUv.y - 0.5) * 1.6);
    float arrow = smoothstep(0.0, 0.07, chevron) * smoothstep(0.32, 0.12, chevron) * lane;
    vec3 base = mix(vec3(0.07, 0.08, 0.1), vec3(0.13, 0.14, 0.17), slat);
    vec3 c = base + vColor * (0.25 + lane * 0.75) * (0.6 + 0.4 * slat) + mix(vColor, vec3(1.0), 0.5) * arrow * 0.9;
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`

/*
 * Electric glow, one instanced mesh for every treadmill. `aKind` picks the part:
 *   0 a neon ring and glow on the ground round the base   1 neon strips along the rails
 *   2-5 lightning over the rails: a thick and a thin bolt each side   6 the equaliser
 * Per instance: the tier colour (instanceColor) and `aState` = (energy, rainbow).
 */
const fxVertex = /* glsl */ `
  attribute float aKind;
  attribute vec2 aUv;
  attribute vec2 aState;
  uniform float uTime;
  uniform float uSimple;
  varying vec2 vUv;
  varying float vKind;
  varying vec3 vColor;
  varying vec2 vState;
  varying float vSeed;

  float hash(float n) {
    return fract(sin(n) * 43758.5453);
  }
  float noise(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash(i), hash(i + 1.0), f);
  }

  void main() {
    vUv = aUv;
    vKind = aKind;
    vState = aState;
    vColor = vec3(1.0);
    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #endif
    float seed = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.61;
    vSeed = seed;
    vec3 p = position;
    if (aKind > 1.5 && aKind < 5.5) {
      // Lightning: a jagged bolt along the rail, struck afresh many times a second,
      // pinned at both ends. Both ribbons of a bolt share the same jags; the thin bolts
      // (4, 5) jag harder.
      float strike = floor(uTime * mix(15.0, 8.0, uSimple));
      float pin = sin(aUv.x * 3.14159);
      float bolt = aKind * 7.0;
      float wild = aKind > 3.5 ? 1.5 : 1.0;
      p.y += (noise(aUv.x * 11.0 * wild + strike * 3.1 + seed + bolt) - 0.5) * 0.42 * wild * pin;
      p.z += (noise(aUv.x * 8.0 * wild + strike * 2.3 + seed * 1.3 + bolt) - 0.5) * 0.3 * wild * pin;
    }
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  }
`
const fxFragment = /* glsl */ `
  uniform float uTime;
  uniform float uSimple;
  varying vec2 vUv;
  varying float vKind;
  varying vec3 vColor;
  varying vec2 vState;
  varying float vSeed;

  float hash(float n) {
    return fract(sin(n) * 43758.5453);
  }
  vec3 hue(float h) {
    return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  }

  void main() {
    float energy = vState.x;
    vec3 tint = vState.y > 0.5 ? hue(fract(uTime * 0.12 + vUv.x * 0.6)) : vColor;
    vec3 c = tint;
    float a = 0.0;
    if (vKind < 0.5) {
      // On the ground: a crisp neon ring just outside the deck over a soft glow,
      // breathing. The ring is what reads on bright grass.
      vec2 d = abs(vUv - 0.5) * 2.0;
      float edge = length(max(d - 0.55, 0.0)) / 0.45;
      float ring = smoothstep(0.09, 0.0, abs(edge - 0.55));
      float soft = smoothstep(1.0, 0.0, edge) * 0.4;
      c = mix(tint, vec3(1.0), ring * 0.35);
      a = (ring * 1.3 + soft) * (0.85 + 0.15 * sin(uTime * 3.0 + vSeed));
    } else if (vKind < 1.5) {
      // Neon rails: a bright core, and pulses of energy racing to the console.
      float core = smoothstep(0.5, 0.1, abs(vUv.y - 0.5));
      float pulse = smoothstep(0.78, 1.0, fract(vUv.x * 1.4 - uTime * 1.7 + vSeed)) * (1.0 - uSimple);
      c = mix(tint, vec3(1.0), core * 0.45 + pulse * 0.5);
      a = (0.5 + 0.5 * core) * (1.0 + pulse * 1.2);
    } else if (vKind < 5.5) {
      // Lightning: a white-hot core inside a glow in the tier colour, flickering.
      float across = abs(vUv.y - 0.5);
      float core = smoothstep(0.17, 0.0, across);
      float halo = smoothstep(0.5, 0.0, across);
      float on = step(0.3, hash(floor(uTime * 15.0) + vSeed * 13.0 + vKind * 5.0));
      c = mix(tint, vec3(1.0), core);
      a = (core * 1.3 + halo * halo * 0.7) * on * step(0.4, energy);
    } else {
      // Console screen: an equaliser jumping to the runner's beat.
      float bars = 7.0;
      float col = floor(vUv.x * bars);
      float level = 0.2 + 0.75 * abs(sin(uTime * (2.2 + hash(col + vSeed) * 3.0) + col * 1.7));
      float inBar = step(0.18, fract(vUv.x * bars)) * step(fract(vUv.x * bars), 0.82);
      float lit = step(vUv.y, level) * inBar * step(0.4, energy);
      c = mix(tint * 0.6, mix(tint, vec3(1.0), 0.35), lit);
      a = 0.3 + lit * 0.9;
    }
    a *= energy;
    if (a < 0.003) discard;
    gl_FragColor = vec4(c, min(a, 1.0));
  }
`

/** The glow parts of one treadmill (local frame, facing +X), as raw triangles. */
function buildFx() {
  const L = BELT_LENGTH
  const W = BELT_WIDTH
  const front = L / 2 + 0.2
  const positions = []
  const kinds = []
  const uvs = []
  const quad = (corners, kind, cornerUvs = [[0, 0], [1, 0], [1, 1], [0, 1]]) => {
    for (const k of [0, 1, 2, 0, 2, 3]) {
      positions.push(...corners[k])
      uvs.push(...cornerUvs[k])
      kinds.push(kind)
    }
  }
  // Ground glow, reaching past the deck.
  const hx = L / 2 + 1.2
  const hz = W / 2 + 1.1
  quad([[-hx, 0.03, -hz], [hx, 0.03, -hz], [hx, 0.03, hz], [-hx, 0.03, hz]], 0)
  const x0 = -(L + 0.1) / 2
  const x1 = (L + 0.1) / 2
  for (const side of [-1, 1]) {
    const rail = side * (W / 2 + 0.16)
    // Neon down the rail's outer face, and along its top.
    const outer = side * (W / 2 + 0.16 + 0.145)
    quad([[x0, 0.43, outer], [x1, 0.43, outer], [x1, 0.57, outer], [x0, 0.57, outer]], 1)
    const top = DECK_Y + 0.265
    quad([[x0, top, rail - 0.07], [x1, top, rail - 0.07], [x1, top, rail + 0.07], [x0, top, rail + 0.07]], 1)
    // Lightning over the rail - a thick bolt and a thin, wilder one - each a standing
    // and a flat ribbon, so it shows from any side. The ribbons are wide: the bolt's
    // glow fills them round its thin white core.
    const bolts = [
      { y: DECK_Y + 0.55, t: 0.11, kind: side < 0 ? 2 : 3 },
      { y: DECK_Y + 0.68, t: 0.07, kind: side < 0 ? 4 : 5 },
    ]
    for (const { y, t, kind } of bolts) {
      for (let i = 0; i < ARC_SEGMENTS; i += 1) {
        const u0 = i / ARC_SEGMENTS
        const u1 = (i + 1) / ARC_SEGMENTS
        const xa = x0 + (x1 - x0) * u0
        const xb = x0 + (x1 - x0) * u1
        const span = [[u0, 0], [u1, 0], [u1, 1], [u0, 1]]
        quad([[xa, y - t, rail], [xb, y - t, rail], [xb, y + t, rail], [xa, y + t, rail]], kind, span)
        quad([[xa, y, rail - t], [xb, y, rail - t], [xb, y, rail + t], [xa, y, rail + t]], kind, span)
      }
    }
  }
  // The equaliser on the console screen, facing the runner (-X), tilted with it.
  const screen = new Matrix4().makeRotationZ(0.35).setPosition(front - 0.05, DECK_Y + 1.6, 0)
  const corner = (z, yy) => new Vector3(-0.056, yy, z).applyMatrix4(screen).toArray()
  quad([corner(0.5, -0.2), corner(-0.5, -0.2), corner(-0.5, 0.2), corner(0.5, 0.2)], 6)

  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  g.setAttribute('aUv', new BufferAttribute(new Float32Array(uvs), 2))
  g.setAttribute('aKind', new BufferAttribute(new Float32Array(kinds), 1))
  g.setAttribute('aState', new InstancedBufferAttribute(new Float32Array(N * 2), 2))
  return g
}

/** True when someone is running on the treadmill at `spot`: you, or another player. */
function isBusy(spot) {
  if (player.training && context.pad === spot.id) return true
  for (const r of remotes.values()) {
    if (r.train && Math.abs(r.x - spot.x) < BELT_LENGTH / 2 && Math.abs(r.z - spot.z) < BELT_WIDTH / 2 + 0.2) return true
  }
  return false
}

function labelHtml(pad, state) {
  const unlocked = treadmillUnlocked(state, pad.id)
  let top
  if (unlocked) top = `<div class="lbl-top owned">${icon('check')} Unlocked</div>`
  else if (pad.req.rebirths)
    top = `<div class="lbl-top locked">${icon('rebirth')} ${pad.req.rebirths} Rebirth${pad.req.rebirths === 1 ? '' : 's'}</div>`
  else top = `<div class="lbl-top ${state.wins >= pad.req.wins ? 'affordable' : 'locked'}">${icon('trophy')} ${formatNumber(pad.req.wins)} Wins</div>`
  return `${top}<div class="lbl-name" style="color:${pad.rainbow ? '#ffffff' : pad.color}">x${formatNumber(pad.mult)} Speed</div><div class="lbl-gain">${escapeHtml(pad.name)}</div>`
}

/**
 * The training treadmills. Step on one and your villain runs in place, every step
 * paying its multiplier. Frames, belts and screens are one instanced mesh each; the
 * belts scroll in the shader. Labels show the multiplier and how to unlock it.
 *
 * Each one glows in its tier colour: neon rails, lightning over the rails, a glow on
 * the ground and a jumping equaliser - dim while locked, bright once unlocked, and
 * blazing while someone runs on it, with an electric column rising over the belt.
 * All of it for every treadmill is two more instanced draw calls (about 5k
 * triangles); LOW keeps it, with calmer animation.
 */
export function Treadmills() {
  const preset = usePreset()
  const frameRef = useRef(null)
  const beltRef = useRef(null)
  const fxRef = useRef(null)
  const columnRef = useRef(null)
  /** Unlocked per treadmill, and the last energies written, to skip no-op updates. */
  const glow = useRef({ unlocked: new Array(N).fill(false), written: new Float32Array(N), next: 0 })

  const geo = useMemo(
    () => ({
      frame: buildFrame(),
      belt: new PlaneGeometry(BELT_LENGTH, BELT_WIDTH).rotateX(-Math.PI / 2),
      fx: buildFx(),
      column: createEffectColumnGeometry(N, 1.25),
    }),
    [],
  )
  const mat = useMemo(
    () => ({
      frame: new MeshLambertMaterial({ vertexColors: true }),
      belt: new ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: beltVertex, fragmentShader: beltFragment }),
      fx: new ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uSimple: { value: 0 } },
        vertexShader: fxVertex,
        fragmentShader: fxFragment,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
      column: createEffectColumnMaterial(),
    }),
    [],
  )
  useEffect(
    () => () => {
      Object.values(geo).forEach((g) => g.dispose())
      Object.values(mat).forEach((m) => m.dispose())
    },
    [geo, mat],
  )

  useLayoutEffect(() => {
    PAD_SPOTS.forEach((spot, i) => {
      const pad = TREADMILL_BY_ID[spot.id]
      // The frame geometry faces +X already; the runner yaw is +X too.
      _dummy.position.set(spot.x, 0, spot.z)
      _dummy.rotation.set(0, 0, 0)
      _dummy.scale.set(1, 1, 1)
      _dummy.updateMatrix()
      frameRef.current?.setMatrixAt(i, _dummy.matrix)
      frameRef.current?.setColorAt(i, _color.set(pad.frame))
      _dummy.position.set(spot.x, DECK_Y + 0.005, spot.z)
      _dummy.updateMatrix()
      beltRef.current?.setMatrixAt(i, _dummy.matrix)
      beltRef.current?.setColorAt(i, _color.set(pad.color))
      _dummy.position.set(spot.x, 0, spot.z)
      _dummy.updateMatrix()
      fxRef.current?.setMatrixAt(i, _dummy.matrix)
      fxRef.current?.setColorAt(i, _color.set(pad.color))
      geo.fx.getAttribute('aState').setY(i, pad.rainbow ? 1 : 0)
      // Columns start hidden (scale 0) until the glow update finds them unlocked.
      _dummy.position.set(spot.x, DECK_Y + COLUMN_HEIGHT / 2, spot.z)
      _dummy.scale.set(0, 0, 0)
      _dummy.updateMatrix()
      columnRef.current?.setMatrixAt(i, _dummy.matrix)
      _dummy.scale.set(1, 1, 1)
      setEffectInstance(geo.column, i, { color: pad.rainbow ? '#ffffff' : pad.color, type: 'electric', strength: 0 })
    })
    geo.fx.getAttribute('aState').needsUpdate = true
    for (const ref of [frameRef, beltRef, fxRef, columnRef]) {
      const m = ref.current
      if (!m) continue
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
      m.computeBoundingSphere()
    }
  }, [geo, preset.name])

  // Labels, refreshed when unlocks or Wins change.
  useEffect(() => {
    const labels = PAD_SPOTS.map((spot) =>
      createLabel({
        position: [spot.x, 3.4, spot.z],
        className: 'pad-label treadmill-label',
        lobby: true,
        maxDistance: 34,
        refDistance: 12,
        minScale: 0.4,
        maxScale: 1,
      }),
    )
    let lastKey = ''
    const update = (s) => {
      const key = `${s.rebirths}|${s.ownedPads.join(',')}|${s.wins >= 40}`
      if (key === lastKey) return
      lastKey = key
      PAD_SPOTS.forEach((spot, i) => {
        labels[i].setHtml(labelHtml(TREADMILL_BY_ID[spot.id], s))
        glow.current.unlocked[i] = treadmillUnlocked(s, spot.id)
      })
      glow.current.next = 0
    }
    update(useGameStore.getState())
    const unsubscribe = useGameStore.subscribe(update)
    return () => {
      unsubscribe()
      labels.forEach((l) => l.remove())
    }
  }, [])

  useFrame((state) => {
    // Belts run twice as fast during Treadmill OP, and fastest under a runner.
    const op = isTreadmillOp() ? 2 : 1
    const busy = context.pad && player.training ? 1.6 : 1
    setUniform(beltRef.current?.material, 'uTime', state.clock.elapsedTime * op * busy)

    const fx = fxRef.current
    if (!fx) return
    setUniform(fx.material, 'uTime', state.clock.elapsedTime)
    setUniform(fx.material, 'uSimple', preset.name === 'LOW' ? 1 : 0)
    // The columns' electric style is cheap, so it stays on LOW too (only 11 of them).
    setUniform(columnRef.current?.material, 'uTime', state.clock.elapsedTime)
    // Who is running where: a few times a second, writing only what changed.
    const g = glow.current
    if (state.clock.elapsedTime < g.next) return
    g.next = state.clock.elapsedTime + BUSY_CHECK
    const attr = geo.fx.getAttribute('aState')
    let dirty = false
    for (let i = 0; i < N; i += 1) {
      const spot = PAD_SPOTS[i]
      let energy = ENERGY.locked
      if (g.unlocked[i]) energy = (isBusy(spot) ? ENERGY.busy : ENERGY.unlocked) + (op > 1 ? ENERGY.op : 0)
      if (g.written[i] !== energy) {
        g.written[i] = energy
        attr.setX(i, energy)
        dirty = true
        // The column: hidden while locked, crackling once unlocked, blazing in use.
        const strength = !g.unlocked[i] ? 0 : energy >= ENERGY.busy ? COLUMN.busy : COLUMN.unlocked
        _dummy.position.set(spot.x, DECK_Y + COLUMN_HEIGHT / 2, spot.z)
        _dummy.rotation.set(0, 0, 0)
        const size = strength > 0 ? 1 : 0
        // Stretched along the belt (X), round the runner.
        _dummy.scale.set(size * 1.6, COLUMN_HEIGHT * size, size)
        _dummy.updateMatrix()
        columnRef.current?.setMatrixAt(i, _dummy.matrix)
        geo.column.getAttribute('aStrength').setX(i, strength)
        geo.column.getAttribute('aStrength').needsUpdate = true
        if (columnRef.current) columnRef.current.instanceMatrix.needsUpdate = true
      }
    }
    if (dirty) attr.needsUpdate = true
  })

  // Only the console is solid: the belt is walked on.
  useColliders(
    () => PAD_SPOTS.map((spot) => ({ box: [spot.x + BELT_LENGTH / 2 + 0.25, spot.z, 0.3, BELT_WIDTH / 2 + 0.2] })),
    [],
  )

  return (
    <>
      <instancedMesh ref={frameRef} args={[geo.frame, mat.frame, N]} castShadow receiveShadow />
      <instancedMesh ref={beltRef} args={[geo.belt, mat.belt, N]} />
      <instancedMesh ref={fxRef} args={[geo.fx, mat.fx, N]} renderOrder={2} />
      {/* Not culled: columns are scaled from zero once unlocked, after bounds are taken. */}
      <instancedMesh ref={columnRef} args={[geo.column, mat.column, N]} renderOrder={2} frustumCulled={false} />
    </>
  )
}

export default Treadmills
