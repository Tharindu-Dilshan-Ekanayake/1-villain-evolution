/**
 * The scene's whole look in one place: a bright toy-brick world with a saturated blue
 * sky, lime studded baseplate, tan checker brick walls and orange wooden fences.
 *
 * Colours are sRGB hex, exactly as you would pick them in an image editor.
 *
 * Light intensities are three.js physical units: a light of intensity PI (~3.14)
 * lights a surface facing it to its full texture colour. The hemisphere fill plus the
 * sun add up to just over that on the ground, which is what keeps the greens vivid;
 * shadowed ground only gets the fill, so shadows read as a softer, darker green.
 */

export const SKY = {
  /** Straight up. */
  top: '#2a8af5',
  /** At eye level. Fog uses the same colour so distant ground melts into the sky. */
  horizon: '#86c8fb',
  /** Lower = the deep blue reaches further down towards the horizon. */
  exponent: 0.3,
}

/** Just a light haze at the far end of the track. `far` is overridden per quality preset. */
export const FOG = {
  color: SKY.horizon,
  near: 120,
  far: 420,
}

export const CLOUDS = {
  /** Sunlit tops. */
  top: '#ffffff',
  /** Undersides, a cool blue-grey. */
  bottom: '#cfdff2',
  count: 18,
}

/** Neon lime baseplate, two shades in a checker. */
export const GROUND = {
  base: '#5cee30',
  alt: '#52de2b',
}

/** Tan checker brick: the template's boundary walls, reused for the breakable stage walls. */
export const WALLS = {
  base: '#c4955c',
  alt: '#a3774a',
}

export const FENCE = {
  rail: '#c8662e',
  post: '#a8501f',
}

export const LIGHTS = {
  /** Fill from above (sky) and below (bounce off the grass). */
  hemiSky: '#ffffff',
  hemiGround: '#b7c9a3',
  hemiIntensity: 2.1,

  sunColor: '#fff6e8',
  sunIntensity: 1.7,
  /**
   * Direction *towards* the sun: high and a little to the left, behind the default
   * camera, so the side of the character you look at is lit and its shadow falls
   * beside it where you can see it, not hidden behind its back.
   */
  sunDirection: [-0.35, 0.9, 0.2],
  /** 1 = shadows get no sunlight at all; lower = lighter shadows. */
  shadowIntensity: 0.8,
  /** Blur radius of shadow edges, in shadow-map texels. */
  shadowSoftness: 4,
}

/* ---------------------------------------------------------------------------
 * Villain Evolution additions. Picked to sit alongside the template palette above:
 * the same saturated, slightly warm toy look, no muddy mid-tones.
 * ------------------------------------------------------------------------- */

/** The running path from spawn down every stage: red studs with yellow borders. */
export const PATH = {
  base: '#e8352b',
  alt: '#d92e25',
  border: '#ffd21a',
  borderAlt: '#f2c200',
}

/** Stage colour (stage arch, wall tint), cycling by stage number. */
export const STAGE_COLORS = ['#ff5a4d', '#ffc83d', '#b84dff', '#3fd0f2', '#41e05a', '#ff7ac8']

/** WINS pads in the stages. */
export const PADS = {
  ready: '#ffc21a',
  claimed: '#7d8796',
}

/** Voxel trees outside the walls. */
export const TREES = {
  trunk: '#8a5a32',
  leaves: ['#41c22a', '#5cee30', '#37a823'],
}

/** The villain accent used across UI and effects. */
export const VILLAIN = {
  purple: '#8a2be2',
  deep: '#3a0f80',
  glow: '#d17bff',
}
