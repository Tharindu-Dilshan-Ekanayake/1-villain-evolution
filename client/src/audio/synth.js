/**
 * Procedural sound synthesis. Every effect and the music loop are computed as raw
 * sample arrays in a Web Worker (synth.worker.js) once the game is loaded: no audio
 * files ship with the game, so sound costs 0 bytes of the load budget and nothing
 * stalls the main thread.
 *
 * Playback is just a buffer source with a random pitch nudge, which is far cheaper
 * per hit than live oscillator graphs.
 */

const TAU = Math.PI * 2

/** Deterministic PRNG so the music is identical every session. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = Math.random
const noise = () => rand() * 2 - 1

/** One-pole coefficient for a cutoff frequency. */
const lpCoef = (fc, sr) => 1 - Math.exp((-TAU * fc) / sr)

/** Chamberlin state-variable filter; returns band-pass by default. */
function createSVF() {
  return { low: 0, band: 0 }
}
function svf(state, x, fc, sr, damping) {
  const f = 2 * Math.sin((Math.PI * Math.min(fc, sr * 0.22)) / sr)
  state.low += f * state.band
  const high = x - state.low - damping * state.band
  state.band += f * high
  return state.band
}

function softClip(x) {
  return Math.tanh(x)
}

function normalize(channels, peak = 0.95) {
  let max = 0
  for (const data of channels) for (let i = 0; i < data.length; i += 1) max = Math.max(max, Math.abs(data[i]))
  if (max < 1e-6) return
  const k = peak / max
  for (const data of channels) for (let i = 0; i < data.length; i += 1) data[i] *= k
}

/** Short fade at both ends so no buffer ever clicks. */
function fadeEdges(data, sr, inMs = 1, outMs = 8) {
  const inN = Math.min(data.length, Math.floor((inMs / 1000) * sr))
  const outN = Math.min(data.length, Math.floor((outMs / 1000) * sr))
  for (let i = 0; i < inN; i += 1) data[i] *= i / inN
  for (let i = 0; i < outN; i += 1) data[data.length - 1 - i] *= i / outN
}

/** Inharmonic struck-bell partials. */
function bell(t, f, decay = 4) {
  return (
    Math.sin(TAU * f * t) * Math.exp(-t * decay) +
    0.45 * Math.sin(TAU * f * 2.76 * t) * Math.exp(-t * decay * 1.8) +
    0.2 * Math.sin(TAU * f * 5.4 * t) * Math.exp(-t * decay * 3)
  )
}

/* --- Effects ----------------------------------------------------------------- */

/** A body punch: sub thump, low-passed meat, a tiny transient. */
function punch(data, sr, { pitch = 1, weight = 1 } = {}) {
  let phase = 0
  let lp = 0
  const a = lpCoef(700, sr)
  for (let i = 0; i < data.length; i += 1) {
    const t = i / sr
    const f = (52 + 130 * Math.exp(-t * 38)) * pitch
    phase += (TAU * f) / sr
    const sub = Math.sin(phase) * Math.exp(-t * 20)
    const n = noise()
    lp += a * (n - lp)
    const body = lp * 3.2 * Math.exp(-t * 42)
    const click = t < 0.004 ? n * 0.7 * (1 - t / 0.004) : 0
    data[i] = softClip(1.7 * weight * (sub * 0.95 + body * 0.75 + click))
  }
}

/** Air swish for a swung fist: band-passed noise sweeping up. */
function whoosh(data, sr, { from = 500, to = 2600 } = {}) {
  const st = createSVF()
  const len = data.length
  for (let i = 0; i < len; i += 1) {
    const p = i / len
    const fc = from * (to / from) ** p
    const env = Math.sin(Math.PI * p) ** 1.5
    data[i] = svf(st, noise(), fc, sr, 0.9) * env * 0.9
  }
}

/** A punch landing on stone: heavier thump, gritty crunch and a dull knock. */
function wallHit(data, sr) {
  punch(data, sr, { pitch: 0.8, weight: 1.15 })
  const st = createSVF()
  for (let i = 0; i < data.length; i += 1) {
    const t = i / sr
    const crunch = svf(st, noise(), 2600, sr, 0.5) * Math.exp(-t * 55) * 0.9
    const knock =
      (Math.sin(TAU * 185 * t) + 0.6 * Math.sin(TAU * 317 * t)) * Math.exp(-t * 32) * 0.45
    data[i] = softClip(data[i] + crunch + knock)
  }
}

/** Splitting stone: a ragged burst of sharp ticks over a groaning creak. */
function crack(data, sr) {
  const ticks = 10 + Math.floor(rand() * 6)
  const times = Array.from({ length: ticks }, () => rand() ** 1.6 * 0.28).sort()
  for (const t0 of times) {
    const start = Math.floor(t0 * sr)
    const amp = 0.4 + rand() * 0.6
    const tau = 0.0015 + rand() * 0.003
    let lp = 0
    for (let i = 0; i < sr * 0.02 && start + i < data.length; i += 1) {
      const n = noise()
      lp += 0.3 * (n - lp)
      data[start + i] += (n - lp) * amp * Math.exp(-i / sr / tau)
    }
  }
  const st = createSVF()
  for (let i = 0; i < data.length; i += 1) {
    const t = i / sr
    const creak = svf(st, noise(), 320 + 80 * Math.sin(t * 40), sr, 0.08) * 0.05
    data[i] = softClip(data[i] + creak * Math.exp(-t * 6) * (t < 0.3 ? 1 : 0))
  }
}

/**
 * A wall breaking apart: a low boom with a sub drop, a dense crack burst, then debris
 * raining down. Each stereo channel gets its own debris grains, so the rubble spreads
 * wide while the boom stays centred.
 */
function shatter(channels, sr) {
  const len = channels[0].length
  const boom = new Float32Array(len)
  let lp = 0
  let phase = 0
  for (let i = 0; i < len; i += 1) {
    const t = i / sr
    const fc = 150 + 3800 * Math.exp(-t * 7)
    lp += lpCoef(fc, sr) * (noise() - lp)
    const attack = Math.min(1, t / 0.002)
    const f = 32 + 48 * Math.exp(-t * 5)
    phase += (TAU * f) / sr
    boom[i] = attack * (lp * 2.4 * Math.exp(-t * 3.6) + Math.sin(phase) * 1.1 * Math.exp(-t * 4.2))
  }

  channels.forEach((data) => {
    data.set(boom)
    // Opening crack burst.
    for (let k = 0; k < 26; k += 1) {
      const start = Math.floor(rand() * 0.07 * sr)
      const amp = 0.5 + rand() * 0.5
      for (let i = 0; i < sr * 0.006 && start + i < len; i += 1) {
        data[start + i] += noise() * amp * Math.exp(-i / sr / 0.0015)
      }
    }
    // Debris: resonant stone ticks and the odd heavy chunk landing.
    for (let g = 0; g < 80; g += 1) {
      const t0 = 0.05 + 1.4 * rand() ** 1.8
      const start = Math.floor(t0 * sr)
      const dur = 0.004 + rand() * 0.022
      const amp = (0.2 + 0.8 * rand()) * Math.exp(-t0 * 1.3) * 0.75
      const fc = 700 + rand() * 4200
      const damping = 0.12 + rand() * 0.35
      const st = createSVF()
      const n = Math.floor(dur * sr * 3)
      for (let i = 0; i < n && start + i < len; i += 1) {
        const env = Math.exp(-i / sr / dur)
        data[start + i] += svf(st, noise(), fc, sr, damping) * amp * env * 2
      }
    }
    for (let c = 0; c < 9; c += 1) {
      const t0 = 0.12 + rand() * 1.1
      const start = Math.floor(t0 * sr)
      const f = 110 + rand() * 150
      const amp = 0.45 * Math.exp(-t0 * 1.2)
      for (let i = 0; i < sr * 0.12 && start + i < len; i += 1) {
        const t = i / sr
        data[start + i] += (Math.sin(TAU * f * t) * 0.8 + noise() * 0.35) * amp * Math.exp(-t * 38)
      }
    }
    for (let i = 0; i < len; i += 1) data[i] = softClip(data[i] * 0.9)
  })
}

/** A Speed gain: a bright, slightly rising magic pop (pitched up as gains chain). */
function gainPop(data, sr) {
  let phase = 0
  let lp = 0
  for (let i = 0; i < data.length; i += 1) {
    const t = i / sr
    const f = 760 * (1 + 0.3 * Math.min(1, t / 0.03))
    phase += (TAU * f) / sr
    const env = Math.min(1, t / 0.003) * Math.exp(-t * 32)
    const tone = (Math.sin(phase) + 0.3 * Math.sin(2 * phase) + 0.12 * Math.sin(3 * phase)) * env
    const n = noise()
    lp += 0.5 * (n - lp)
    const sparkle = (n - lp) * Math.exp(-t * 90) * 0.18
    data[i] = tone * 0.7 + sparkle
  }
}

/** Bright ascending chime for collecting Wins. */
function winChime(data, sr) {
  const notes = [
    [0, 1046.5],
    [0.08, 1318.5],
    [0.16, 1568],
    [0.27, 2093],
  ]
  for (let i = 0; i < data.length; i += 1) {
    const t = i / sr
    let v = 0
    for (const [start, f] of notes) if (t >= start) v += bell(t - start, f, 3.2) * 0.5
    v += t < 0.05 ? noise() * 0.15 * (1 - t / 0.05) : 0
    data[i] = v
  }
}

/** A bright "ding" as a trophy lands in the Wins counter (played at rising pitch). */
function trophyDing(data, sr) {
  for (let i = 0; i < data.length; i += 1) {
    const t = i / sr
    data[i] = bell(t, 1760, 7) * 0.6 + bell(t, 2637, 10) * 0.25
  }
}

function levelUp(data, sr) {
  let phase = 0
  for (let i = 0; i < data.length; i += 1) {
    const t = i / sr
    let v = 0
    if (t < 0.3) {
      const f = 380 * 4 ** (t / 0.3)
      phase += (TAU * f) / sr
      v += Math.sin(phase) * Math.sin((Math.PI * t) / 0.3) * 0.5
    }
    for (const f of [784, 987.8, 1174.7, 1568]) if (t >= 0.24) v += bell(t - 0.24, f, 2.6) * 0.3
    data[i] = v
  }
}

function rebirth(channels, sr) {
  const len = channels[0].length
  const st = createSVF()
  const mono = new Float32Array(len)
  let phase = 0
  for (let i = 0; i < len; i += 1) {
    const t = i / sr
    let v = 0
    if (t < 1.05) {
      const p = t / 1.05
      v += svf(st, noise(), 180 * 18 ** p, sr, 0.6) * p ** 2 * 0.9
    }
    if (t >= 0.95) {
      const u = t - 0.95
      const f = 30 + 50 * Math.exp(-u * 5)
      phase += (TAU * f) / sr
      v += Math.sin(phase) * Math.exp(-u * 3) * 1.1
      for (const fr of [523.3, 659.3, 784, 1046.5, 1318.5]) v += bell(u, fr, 1.6) * 0.22
      v += Math.sin(TAU * 261.6 * u) * Math.exp(-u * 1.2) * 0.25
    }
    mono[i] = v
  }
  channels.forEach((data, c) => {
    for (let i = 0; i < len; i += 1) {
      const t = i / sr
      const shimmer = t > 1 ? Math.sin(TAU * (2093 + c * 7) * t) * Math.exp(-(t - 1) * 2.5) * 0.06 : 0
      data[i] = softClip(mono[i] + shimmer)
    }
  })
}

function purchase(data, sr) {
  for (let i = 0; i < data.length; i += 1) {
    const t = i / sr
    let v = bell(t, 987.8, 9) * 0.55
    if (t > 0.075) v += bell(t - 0.075, 1318.5, 6) * 0.6
    v += t < 0.01 ? noise() * 0.3 * (1 - t / 0.01) : 0
    data[i] = v
  }
}

function equip(data, sr) {
  const st = createSVF()
  const len = data.length
  for (let i = 0; i < len; i += 1) {
    const t = i / sr
    const p = Math.min(1, t / 0.35)
    let v = svf(st, noise(), 3200 * 0.15 ** p, sr, 0.5) * Math.sin(Math.PI * p) * 0.5
    if (t > 0.18) v += bell(t - 0.18, 1568, 5) * 0.35 + bell(t - 0.18, 2349, 6) * 0.2
    data[i] = v
  }
}

function uiTick(data, sr) {
  for (let i = 0; i < data.length; i += 1) {
    const t = i / sr
    data[i] = Math.sin(TAU * 1500 * t) * Math.exp(-t * 85) * 0.5 + (t < 0.002 ? noise() * 0.3 : 0)
  }
}

function errorBuzz(data, sr) {
  let lp = 0
  for (let i = 0; i < data.length; i += 1) {
    const t = i / sr
    const on = (t < 0.1 || (t > 0.14 && t < 0.24)) ? 1 : 0
    const sq = Math.sign(Math.sin(TAU * 165 * t)) * on
    lp += 0.15 * (sq - lp)
    data[i] = lp * 0.5
  }
}

function step(data, sr) {
  let lp = 0
  for (let i = 0; i < data.length; i += 1) {
    const t = i / sr
    lp += 0.06 * (noise() - lp)
    data[i] = Math.sin(TAU * (60 + 40 * Math.exp(-t * 60)) * t) * Math.exp(-t * 45) * 0.6 + lp * 2 * Math.exp(-t * 70)
  }
}


/* --- Music ----------------------------------------------------------------- */

const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12)

/**
 * A sneaky, bouncy villain loop in A minor: marimba melody, plucked strums, bass and
 * shaker over Am - F - C - E (the E major turnaround gives it the scheming edge).
 * Notes that ring past the loop end wrap to the start, so the loop is seamless.
 */
function villainMusic(data, sr) {
  const rng = mulberry32(42)
  const bpm = 116
  const beat = 60 / bpm
  const bar = beat * 4
  const len = data.length
  const add = (startSec, samples, fn) => {
    const start = Math.floor(startSec * sr)
    for (let i = 0; i < samples; i += 1) data[(start + i) % len] += fn(i / sr)
  }

  // Am  F  C  E  Am  F  C  E (roots as MIDI)
  const chords = [
    [45, [57, 60, 64]],
    [41, [57, 60, 65]],
    [48, [60, 64, 67]],
    [40, [56, 59, 64]],
    [45, [57, 60, 64]],
    [41, [57, 60, 65]],
    [48, [60, 64, 67]],
    [40, [56, 59, 64]],
  ]
  // A minor pentatonic.
  const pentatonic = [69, 72, 74, 76, 79, 81]

  chords.forEach(([root, tones], b) => {
    const t0 = b * bar

    // Plucked bass on 1, the "and" of 2, and 3.
    for (const [offset, note] of [
      [0, root],
      [1.5 * beat, root + 7],
      [2 * beat, root],
      [3.5 * beat, root + 12],
    ]) {
      const f = midiToHz(note)
      add(t0 + offset, Math.floor(0.45 * sr), (t) =>
        (Math.sin(TAU * f * t) + 0.35 * Math.sin(TAU * 2 * f * t)) * Math.exp(-t * 7) * 0.32,
      )
    }

    // Soft kick on 1 and 3.
    for (const offset of [0, 2 * beat]) {
      add(t0 + offset, Math.floor(0.2 * sr), (t) =>
        Math.sin(TAU * (48 + 60 * Math.exp(-t * 40)) * t) * Math.exp(-t * 18) * 0.35,
      )
    }

    // Plucked strums on 2 and 4 (Karplus-Strong, strings staggered like a strum).
    for (const offset of [beat, 3 * beat]) {
      tones.forEach((note, s) => {
        const f = midiToHz(note + 12)
        const period = Math.max(2, Math.round(sr / f))
        const ring = new Float32Array(period)
        for (let i = 0; i < period; i += 1) ring[i] = noise()
        let idx = 0
        add(t0 + offset + s * 0.014, Math.floor(0.7 * sr), (t) => {
          const next = (idx + 1) % period
          const out = ring[idx]
          ring[idx] = 0.5 * (ring[idx] + ring[next]) * 0.996
          idx = next
          return out * 0.11 * Math.exp(-t * 2.5)
        })
      })
    }

    // Shaker 16ths, accented on the off-beats.
    for (let k = 0; k < 16; k += 1) {
      const accent = k % 4 === 2 ? 1 : k % 2 === 1 ? 0.55 : 0.3
      let lp = 0
      add(t0 + (k * beat) / 4, Math.floor(0.05 * sr), (t) => {
        const n = noise()
        lp += 0.6 * (n - lp)
        return (n - lp) * Math.exp(-t * 90) * 0.05 * accent
      })
    }

    // Marimba melody: chord tones on strong 8ths, pentatonic passing notes, rests.
    for (let k = 0; k < 8; k += 1) {
      const strong = k % 2 === 0
      if (rng() < (strong ? 0.18 : 0.42)) continue
      const note = strong
        ? tones[Math.floor(rng() * tones.length)] + 12
        : pentatonic[Math.floor(rng() * pentatonic.length)]
      const f = midiToHz(note)
      add(t0 + (k * beat) / 2, Math.floor(0.6 * sr), (t) =>
        (Math.sin(TAU * f * t) * Math.exp(-t * 6) + 0.3 * Math.sin(TAU * f * 3.93 * t) * Math.exp(-t * 26)) * 0.2,
      )
    }
  })

  // Gentle compression-ish soft clip.
  for (let i = 0; i < len; i += 1) data[i] = Math.tanh(data[i] * 1.3) * 0.8
  return { loopSeconds: chords.length * bar }
}

/** A soft breeze over the lobby: brown noise with slow swells, cross-faded to loop. */
function breezeAmbience(data, sr) {
  const len = data.length
  const fade = Math.floor(0.8 * sr)
  const total = len + fade
  const raw = new Float32Array(total)
  let lp = 0
  let lp2 = 0
  const loopSec = len / sr
  for (let i = 0; i < total; i += 1) {
    const t = i / sr
    lp += 0.02 * (noise() - lp)
    lp2 += 0.2 * (noise() - lp2)
    const swell = 0.55 + 0.45 * Math.sin((TAU * t) / loopSec) * Math.sin((TAU * t * 2) / loopSec + 1)
    raw[i] = lp * 6 * swell + lp2 * 0.04 * swell
  }
  for (let i = 0; i < len; i += 1) data[i] = raw[i]
  for (let i = 0; i < fade; i += 1) {
    const k = i / fade
    data[i] = raw[len + i] * (1 - k) + raw[i] * k
  }
}

/** An egg hatching: three wobbly cracks, then a sparkling reveal chime. */
function hatch(data, sr) {
  const cracks = [0, 0.22, 0.42]
  for (let i = 0; i < data.length; i += 1) {
    const t = i / sr
    let v = 0
    for (const c of cracks) {
      const dt = t - c
      if (dt >= 0 && dt < 0.09) v += noise() * Math.exp(-dt * 60) * 0.55 + Math.sin(TAU * 180 * dt) * Math.exp(-dt * 40) * 0.3
    }
    for (const [start, f] of [
      [0.62, 784],
      [0.7, 1046.5],
      [0.78, 1318.5],
      [0.86, 1568],
      [0.94, 2093],
    ]) {
      if (t >= start) v += bell(t - start, f, 3.4) * 0.34
    }
    if (t > 0.6 && t < 0.7) v += noise() * 0.12 * (1 - (t - 0.6) / 0.1)
    data[i] = v
  }
}

/**
 * Becoming a villain: a rising, swelling whoosh into a dark minor chord with a
 * sparkle on top.
 */
function transform(data, sr) {
  const st = createSVF()
  let phase = 0
  for (let i = 0; i < data.length; i += 1) {
    const t = i / sr
    let v = 0
    if (t < 0.55) {
      const fc = 300 + 4200 * (t / 0.55) ** 2
      v += svf(st, noise(), fc, sr, 0.35) * Math.sin((Math.PI * t) / 0.55) * 0.5
      phase += (TAU * (90 + 500 * (t / 0.55) ** 2)) / sr
      v += Math.sin(phase) * 0.22 * (t / 0.55)
    }
    if (t >= 0.5) {
      const u = t - 0.5
      for (const f of [146.8, 174.6, 220, 293.7]) v += Math.sin(TAU * f * u) * Math.exp(-u * 2.2) * 0.16
      for (const f of [1174.7, 1760, 2349]) v += bell(u, f, 4.5) * 0.12
    }
    data[i] = softClip(v * 1.4)
  }
}

/**
 * A cartoon evil laugh, "mwa-ha-ha-ha": buzzy voiced syllables through two vowel
 * formants, falling in pitch. Played faster for a higher voice.
 */
function evilLaugh(data, sr) {
  const f1 = createSVF()
  const f2 = createSVF()
  const syllables = [
    [0, 0.26, 150, 1.0],
    [0.34, 0.16, 172, 0.85],
    [0.56, 0.16, 162, 0.85],
    [0.78, 0.16, 150, 0.8],
    [1.0, 0.28, 130, 0.9],
  ]
  let phase = 0
  for (let i = 0; i < data.length; i += 1) {
    const t = i / sr
    let env = 0
    let pitch = 140
    for (const [start, len, f, amp] of syllables) {
      if (t >= start && t < start + len) {
        const u = (t - start) / len
        env = amp * Math.min(1, u * 8) * Math.min(1, (1 - u) * 5)
        pitch = f * (1 - u * 0.12)
      }
    }
    phase += pitch / sr
    const saw = (phase % 1) * 2 - 1
    const voice = svf(f1, saw, 760, sr, 0.25) * 1.2 + svf(f2, saw, 1220, sr, 0.3) * 0.8
    data[i] = softClip(voice * env * 1.6 + noise() * env * 0.04)
  }
}

/* --- Render ------------------------------------------------------------------ */

/** Effects are rendered at 44.1 kHz; playback resamples to the device rate. */
const EFFECT_RATE = 44100
const LOOP_RATE = 22050

/**
 * Renders raw samples: { sampleRate, channels: Float32Array[] }. No AudioContext is
 * needed, so this runs inside a Web Worker, off the main thread.
 */
function render(seconds, channelCount, fill, { sampleRate = EFFECT_RATE, peak = 0.95, edges = true } = {}) {
  const length = Math.max(1, Math.ceil(seconds * sampleRate))
  const channels = Array.from({ length: channelCount }, () => new Float32Array(length))
  if (channelCount === 1) fill(channels[0], sampleRate)
  else fill(channels, sampleRate)
  normalize(channels, peak)
  if (edges) for (const d of channels) fadeEdges(d, sampleRate)
  return { sampleRate, channels }
}

/** Every one-shot effect: name -> raw samples. Most-used first. */
export function renderEffects() {
  return {
    click: render(0.14, 1, gainPop, { peak: 0.6 }),
    punch: render(0.26, 1, (d, sr) => punch(d, sr), { peak: 0.9 }),
    whoosh: render(0.14, 1, (d, sr) => whoosh(d, sr), { peak: 0.6 }),
    ui: render(0.06, 1, uiTick, { peak: 0.45 }),
    wallHit: render(0.32, 1, wallHit, { peak: 0.95 }),
    crack: render(0.4, 1, crack, { peak: 0.9 }),
    shatter: render(1.8, 2, shatter, { peak: 0.98 }),
    win: render(1.5, 1, winChime, { peak: 0.75 }),
    trophy: render(0.4, 1, trophyDing, { peak: 0.6 }),
    levelUp: render(1.4, 1, levelUp, { peak: 0.75 }),
    rebirth: render(2.8, 2, rebirth, { peak: 0.9 }),
    buy: render(0.7, 1, purchase, { peak: 0.7 }),
    equip: render(0.8, 1, equip, { peak: 0.65 }),
    error: render(0.28, 1, errorBuzz, { peak: 0.5 }),
    step: render(0.09, 1, step, { peak: 0.35 }),
    jump: render(0.18, 1, (d, sr) => whoosh(d, sr, { from: 300, to: 1400 }), { peak: 0.4 }),
    land: render(0.14, 1, (d, sr) => punch(d, sr, { pitch: 0.55, weight: 0.6 }), { peak: 0.5 }),
    hatch: render(1.6, 1, hatch, { peak: 0.8 }),
    transform: render(1.9, 1, transform, { peak: 0.85 }),
    laugh: render(1.35, 1, evilLaugh, { peak: 0.75 }),
  }
}

/** The music loop and the breeze ambience (~26 s of audio). */
export function renderLoops() {
  return {
    music: render((8 * 4 * 60) / 116, 1, villainMusic, { sampleRate: LOOP_RATE, peak: 0.8, edges: false }),
    ambience: render(9, 1, breezeAmbience, { sampleRate: LOOP_RATE, peak: 0.6, edges: false }),
  }
}

/** Wraps rendered samples in an AudioBuffer (a cheap copy). */
export function toAudioBuffer(ctx, { sampleRate, channels }) {
  const buffer = ctx.createBuffer(channels.length, channels[0].length, sampleRate)
  channels.forEach((data, c) => buffer.copyToChannel(data, c))
  return buffer
}

/** Transfer list for posting rendered sets out of a worker without copying. */
export function transferables(set) {
  return Object.values(set).flatMap((r) => r.channels.map((c) => c.buffer))
}
