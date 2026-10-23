/**
 * Every tunable piece of content in one file: villains, training treadmills, eggs and
 * pets, boosts, daily and playtime rewards, and codes. The formulas that use these
 * numbers live in economy.js.
 *
 * Villain names are original archetypes, not licensed characters.
 */

/* --- Villains -------------------------------------------------------------- */

/**
 * Villains (morphs). `perStep` is the Speed one step gives before multipliers - the
 * best villain you own is the one that counts while equipped. Priced in Wins
 * (`cost.wins`) or in Rebirth Points (`cost.rp`, one is earned per rebirth).
 *
 * `look` drives the procedurally painted skin (characters/skins.js), `gear` lists
 * accessory meshes (characters/accessories.js), `pose` is the statue pose on the
 * pedestal. `anim` is how the villain moves (game/avatarRig.js): its standing
 * `stance` (menace | hips | brute | float), its `run` (sprint | ninja | brute | glide)
 * and the `taunt` it plays when idle (laugh | hairflip | flex). `aura` is the
 * villain's own aura (fx/VillainAura.jsx): colour, core and style (flame | electric |
 * swirl | smoke). `fx` colours its trail and slams. Half the roster are women.
 */
export const VILLAINS = [
  {
    id: 'bloxity',
    name: 'Your Bloxity Avatar',
    perStep: 1,
    cost: {},
    pose: 'guard',
    anim: { stance: 'menace', run: 'sprint', taunt: 'laugh' },
    fx: { color: '#a8ff8a', type: 'glow' },
    aura: null,
  },
  {
    id: 'jester',
    name: 'Prank Jester',
    gender: 'm',
    perStep: 3,
    cost: { wins: 3 },
    pose: 'laugh',
    anim: { stance: 'menace', run: 'sprint', taunt: 'laugh' },
    fx: { color: '#7dff5a', type: 'swirl' },
    aura: { color: '#3cff7a', core: '#3a0060', style: 'swirl' },
    look: {
      skin: '#f4f1ec',
      hair: '#2ecc40',
      hairTips: '#7dff5a',
      hairStyle: 'slick',
      face: 'jester',
      eyeColor: '#2ecc40',
      shirt: '#6b2fa8',
      trim: '#2ecc40',
      buttons: '#ffd23f',
      sleeves: 'long',
      cuffs: '#2ecc40',
      gloves: '#f4f1ec',
      pants: '#6b2fa8',
      stripes: '#7e3cc4',
      shoes: '#2a1a3a',
    },
    gear: ['jesterTufts', 'ruff', 'bowTie'],
  },
  {
    id: 'harlequin',
    name: 'Pigtail Mayhem',
    gender: 'f',
    perStep: 8,
    cost: { wins: 20 },
    pose: 'hips',
    anim: { stance: 'hips', run: 'sprint', taunt: 'hairflip' },
    fx: { color: '#ff4fa3', type: 'swirl' },
    aura: { color: '#ff3da8', core: '#1a2dff', style: 'swirl' },
    look: {
      skin: '#fbe3d3',
      hair: '#fff0b3',
      hairStyle: 'bangs',
      eyeColor: '#3f8cff',
      lips: '#e0103a',
      blush: true,
      beautyMark: true,
      shirt: '#d81b2a',
      diamonds: '#151515',
      sleeves: 'short',
      gloves: '#151515',
      skirt: '#151515',
      skirtTrim: '#d81b2a',
      pants: '#f2c9c0',
      boots: '#d81b2a',
      belt: '#ffd23f',
    },
    gear: ['pigtails', 'skirt', 'bat'],
  },
  {
    id: 'goblin',
    name: 'Toxic Goblin',
    gender: 'm',
    perStep: 22,
    cost: { wins: 80 },
    pose: 'ninja',
    anim: { stance: 'brute', run: 'ninja', taunt: 'laugh' },
    fx: { color: '#7dff2a', type: 'fire' },
    aura: { color: '#7dff2a', core: '#1c4000', style: 'flame' },
    look: {
      skin: '#5fbf3a',
      hair: '#3e8a2a',
      hairStyle: 'bald',
      eyeColor: '#ffe600',
      brows: 'angry',
      mouth: 'teeth',
      shirt: '#5b2a86',
      trim: '#3e8a2a',
      sleeves: 'long',
      gloves: '#3e8a2a',
      pants: '#5b2a86',
      boots: '#3e8a2a',
      belt: '#2b1440',
    },
    gear: ['goblinEars', 'goblinHood', 'bombBelt'],
  },
  {
    id: 'brute',
    name: 'Iron Brute',
    gender: 'm',
    perStep: 60,
    cost: { wins: 300 },
    pose: 'flex',
    anim: { stance: 'brute', run: 'brute', taunt: 'flex' },
    fx: { color: '#ff4b3b', type: 'electric' },
    aura: { color: '#ff3b30', core: '#330000', style: 'electric' },
    look: {
      skin: '#8a8f99',
      hair: '#5a5f6a',
      hairStyle: 'bald',
      face: 'visor',
      visor: '#ff2a2a',
      shirt: '#5a5f6a',
      emblem: { shape: 'circle', color: '#ff3b30' },
      sleeves: 'long',
      gloves: '#3a3d44',
      pants: '#4a4e57',
      boots: '#2a2c31',
      belt: '#c0392b',
    },
    gear: ['shoulderPlates', 'antenna'],
  },
  {
    id: 'venom',
    name: 'Venom Widow',
    gender: 'f',
    perStep: 160,
    cost: { wins: 1100 },
    pose: 'pounce',
    anim: { stance: 'hips', run: 'ninja', taunt: 'hairflip' },
    fx: { color: '#d0d0ff', type: 'swirl' },
    aura: { color: '#b388ff', core: '#05010f', style: 'smoke' },
    look: {
      skin: '#16161f',
      hair: '#101018',
      hairTips: '#e8e8ff',
      hairStyle: 'long',
      face: 'widow',
      lips: '#b0002a',
      shirt: '#16161f',
      emblem: { shape: 'spider', color: '#f5f5f5' },
      sleeves: 'long',
      pants: '#16161f',
      boots: '#0a0a10',
      veins: '#2c2c44',
    },
    gear: ['longHair', 'spiderLegs'],
  },
  {
    id: 'frost',
    name: 'Frost Witch',
    gender: 'f',
    perStep: 450,
    cost: { wins: 4000 },
    pose: 'float',
    anim: { stance: 'float', run: 'glide', taunt: 'hairflip' },
    fx: { color: '#9fe8ff', type: 'electric' },
    aura: { color: '#7fe3ff', core: '#003a66', style: 'swirl' },
    look: {
      skin: '#e3f5ff',
      hair: '#ffffff',
      hairTips: '#9fe8ff',
      hairStyle: 'long',
      eyeColor: '#38d0ff',
      eyeGlow: true,
      lips: '#4a9fd8',
      blush: true,
      shirt: '#3fa9f5',
      trim: '#ffffff',
      sparkle: '#ffffff',
      sleeves: 'long',
      cuffs: '#ffffff',
      skirt: '#2d7fc9',
      skirtTrim: '#ffffff',
      pants: '#e3f5ff',
      boots: '#cfefff',
      necklace: '#9fe8ff',
    },
    gear: ['longHair', 'iceCrown', 'skirtLong', 'iceCape'],
  },
  {
    id: 'inferno',
    name: 'Inferno Lord',
    gender: 'm',
    perStep: 1200,
    cost: { wins: 14000 },
    pose: 'flex',
    anim: { stance: 'brute', run: 'brute', taunt: 'laugh' },
    fx: { color: '#ff6a1f', type: 'fire' },
    aura: { color: '#ff5a1f', core: '#3a0000', style: 'flame' },
    look: {
      skin: '#c0392b',
      hair: '#ff8c1a',
      hairStyle: 'spiky',
      eyeColor: '#ffd23f',
      eyeGlow: true,
      brows: 'angry',
      mouth: 'snarl',
      shirt: '#2a0a0a',
      trim: '#ff6a1f',
      sleeves: 'none',
      lava: '#ff8a1f',
      pants: '#2a0a0a',
      boots: '#1a0505',
      belt: '#ffb300',
    },
    gear: ['hornsBig', 'flameHair'],
  },
  {
    id: 'scarecrow',
    name: 'Scarecrow Hex',
    gender: 'm',
    perStep: 3300,
    cost: { wins: 50000 },
    pose: 'armsBack',
    anim: { stance: 'menace', run: 'ninja', taunt: 'laugh' },
    fx: { color: '#ffb347', type: 'fire' },
    aura: { color: '#ff9f1c', core: '#2a1400', style: 'smoke' },
    look: {
      skin: '#c9a46a',
      hair: '#e8c35a',
      hairStyle: 'bald',
      face: 'stitch',
      eyeColor: '#ff9f1c',
      shirt: '#4b5d2e',
      patches: '#8a6a3a',
      sleeves: 'long',
      cuffs: '#e8c35a',
      pants: '#5a4630',
      boots: '#3a2a1a',
      belt: '#a07a3a',
    },
    gear: ['witchHat', 'strawTufts', 'scythe'],
  },
  {
    id: 'doom',
    name: 'Doom Monarch',
    gender: 'm',
    perStep: 9000,
    cost: { wins: 180000 },
    pose: 'fistUp',
    anim: { stance: 'menace', run: 'sprint', taunt: 'laugh' },
    fx: { color: '#5cff7a', type: 'electric' },
    aura: { color: '#58ff6a', core: '#002a06', style: 'electric' },
    look: {
      skin: '#a9b0b8',
      hair: '#2f7d32',
      hairStyle: 'bald',
      face: 'ironMask',
      eyeColor: '#58ff6a',
      shirt: '#2f7d32',
      trim: '#c9a227',
      sleeves: 'long',
      cuffs: '#6d7580',
      gloves: '#6d7580',
      pants: '#6d7580',
      boots: '#4a515a',
      belt: '#c9a227',
    },
    gear: ['hoodGreen', 'capeGreen'],
  },
  {
    id: 'raven',
    name: 'Storm Raven',
    gender: 'f',
    perStep: 25000,
    cost: { wins: 650000 },
    pose: 'superhero',
    anim: { stance: 'hips', run: 'glide', taunt: 'hairflip' },
    fx: { color: '#bfe9ff', type: 'electric' },
    aura: { color: '#9fd4ff', core: '#05010f', style: 'electric' },
    look: {
      skin: '#f0d9c8',
      hair: '#141420',
      hairTips: '#5ad8ff',
      hairStyle: 'long',
      face: 'mask',
      maskColor: '#141420',
      eyeColor: '#9fe8ff',
      eyeGlow: true,
      lips: '#6a2a8a',
      shirt: '#2a2240',
      trim: '#5ad8ff',
      sleeves: 'long',
      gloves: '#141420',
      pants: '#2a2240',
      boots: '#141420',
      belt: '#5ad8ff',
    },
    gear: ['longHair', 'ravenWings', 'featherCollar'],
  },
  {
    id: 'mecha',
    name: 'Mecha Overlord',
    gender: 'm',
    perStep: 70000,
    cost: { wins: 2.3e6 },
    pose: 'ready',
    anim: { stance: 'brute', run: 'brute', taunt: 'flex' },
    fx: { color: '#38f0ff', type: 'electric' },
    aura: { color: '#38f0ff', core: '#002a33', style: 'electric' },
    look: {
      skin: '#c7d0db',
      hair: '#c7d0db',
      hairStyle: 'bald',
      face: 'visor',
      visor: '#38f0ff',
      shirt: '#3a4a5a',
      stripes: '#38f0ff',
      emblem: { shape: 'diamond', color: '#38f0ff' },
      sleeves: 'long',
      gloves: '#1f2833',
      pants: '#3a4a5a',
      boots: '#1f2833',
    },
    gear: ['mechaHelmet', 'jetpack'],
  },
  {
    id: 'vampire',
    name: 'Crimson Countess',
    gender: 'f',
    perStep: 190000,
    cost: { wins: 8e6 },
    pose: 'hips',
    anim: { stance: 'float', run: 'glide', taunt: 'laugh' },
    fx: { color: '#ff2a4a', type: 'swirl' },
    aura: { color: '#ff1f3a', core: '#2a0008', style: 'swirl' },
    look: {
      skin: '#f3e9ee',
      hair: '#160812',
      hairTips: '#8a0a24',
      hairStyle: 'long',
      eyeColor: '#ff1f3a',
      eyeGlow: true,
      lips: '#8a0018',
      mouth: 'fangs',
      shirt: '#1a0a12',
      corset: '#b3001b',
      collar: '#f2f2f2',
      sleeves: 'long',
      cuffs: '#b3001b',
      skirt: '#8a0018',
      skirtTrim: '#1a0a12',
      pants: '#1a0a12',
      boots: '#111111',
      necklace: '#ff1f3a',
    },
    gear: ['longHair', 'tiara', 'skirtLong', 'vampireCape'],
  },
  {
    id: 'kraken',
    name: 'Abyss Siren',
    gender: 'f',
    perStep: 520000,
    cost: { wins: 2.8e7 },
    pose: 'fistUp',
    anim: { stance: 'hips', run: 'sprint', taunt: 'hairflip' },
    fx: { color: '#3df2ff', type: 'swirl' },
    aura: { color: '#3df2ff', core: '#002a66', style: 'swirl' },
    look: {
      skin: '#7fd6c8',
      hair: '#ff6f91',
      hairTips: '#ffd166',
      hairStyle: 'long',
      eyeColor: '#ffe066',
      lips: '#ff3d6e',
      blush: true,
      shirt: '#ffd166',
      shell: true,
      sleeves: 'none',
      pants: '#1f9e8f',
      scales: '#2fd6c0',
      boots: '#14786c',
      necklace: '#ffffff',
    },
    gear: ['longHair', 'finCrown', 'finSkirt', 'trident'],
  },
  {
    id: 'titan',
    name: 'Titan Conqueror',
    gender: 'm',
    perStep: 1.4e6,
    cost: { wins: 1e8 },
    pose: 'fistUp',
    anim: { stance: 'brute', run: 'brute', taunt: 'laugh' },
    fx: { color: '#d17bff', type: 'electric' },
    aura: { color: '#c27bff', core: '#1a0033', style: 'electric' },
    look: {
      skin: '#8e5fb8',
      hair: '#6d4392',
      hairStyle: 'bald',
      face: 'titan',
      eyeColor: '#3f8cff',
      brows: 'angry',
      mouth: 'flat',
      shirt: '#2a4bb8',
      trim: '#ffcc33',
      sleeves: 'long',
      cuffs: '#ffcc33',
      gloves: '#ffcc33',
      gems: true,
      pants: '#2a4bb8',
      boots: '#ffcc33',
      belt: '#ffcc33',
    },
    gear: ['titanHelm', 'titanShoulders'],
  },
  {
    id: 'void',
    name: 'Void Empress',
    gender: 'f',
    perStep: 4e6,
    cost: { wins: 3.5e8 },
    pose: 'float',
    anim: { stance: 'float', run: 'glide', taunt: 'laugh' },
    fx: { color: '#c27bff', type: 'swirl' },
    aura: { color: '#b84dff', core: '#05010f', style: 'swirl' },
    look: {
      skin: '#2a1652',
      hair: '#f0e0ff',
      hairTips: '#b84dff',
      hairStyle: 'long',
      eyeColor: '#e2a6ff',
      eyeGlow: true,
      lips: '#b84dff',
      shirt: '#1b0f33',
      stars: '#ffffff',
      trim: '#b84dff',
      sleeves: 'long',
      skirt: '#2a1252',
      skirtTrim: '#b84dff',
      pants: '#1b0f33',
      boots: '#2a1252',
      necklace: '#e2a6ff',
    },
    gear: ['longHair', 'voidCrown', 'skirtLong', 'voidCape'],
  },
  /* --- Rebirth villains: bought with Rebirth Points ------------------------- */
  {
    id: 'clockwork',
    name: 'Clockwork Doll',
    gender: 'f',
    perStep: 40,
    cost: { rp: 1 },
    rebirthVillain: true,
    pose: 'hips',
    anim: { stance: 'hips', run: 'sprint', taunt: 'hairflip' },
    fx: { color: '#ffd23f', type: 'electric' },
    aura: { color: '#ffd23f', core: '#3a2400', style: 'electric' },
    look: {
      skin: '#fff5ee',
      hair: '#7a3a1a',
      hairStyle: 'bangs',
      eyeColor: '#3f8cff',
      lips: '#ff6f91',
      blush: true,
      face: 'doll',
      shirt: '#ffe0ea',
      buttons: '#ffd23f',
      collar: '#ffffff',
      sleeves: 'short',
      gloves: '#ffffff',
      skirt: '#ff9cc0',
      skirtTrim: '#ffffff',
      pants: '#fff5ee',
      boots: '#5a2a1a',
    },
    gear: ['twinBuns', 'bowBig', 'skirt', 'windupKey'],
  },
  {
    id: 'plague',
    name: 'Plague Doctor',
    gender: 'm',
    perStep: 1500,
    cost: { rp: 3 },
    rebirthVillain: true,
    pose: 'armsBack',
    anim: { stance: 'menace', run: 'ninja', taunt: 'laugh' },
    fx: { color: '#7dff2a', type: 'swirl' },
    aura: { color: '#7dff2a', core: '#0a1a00', style: 'smoke' },
    look: {
      skin: '#2a2a2a',
      hair: '#1e1e1e',
      hairStyle: 'bald',
      eyeColor: '#7dff2a',
      eyeGlow: true,
      shirt: '#1e1e1e',
      trim: '#3a3a3a',
      buttons: '#7dff2a',
      sleeves: 'long',
      gloves: '#3a2a1a',
      pants: '#1e1e1e',
      boots: '#101010',
      belt: '#5a3a1a',
    },
    gear: ['plagueBeak', 'wideHat', 'capeDark'],
  },
  {
    id: 'hellfire',
    name: 'Hellfire Queen',
    gender: 'f',
    perStep: 60000,
    cost: { rp: 6 },
    rebirthVillain: true,
    pose: 'laugh',
    anim: { stance: 'float', run: 'glide', taunt: 'laugh' },
    fx: { color: '#ff3b00', type: 'fire' },
    aura: { color: '#ff3b00', core: '#2a0000', style: 'flame' },
    look: {
      skin: '#e05a4a',
      hair: '#ff3b00',
      hairTips: '#ffd23f',
      hairStyle: 'long',
      eyeColor: '#ffea00',
      eyeGlow: true,
      lips: '#2a0505',
      shirt: '#2a0505',
      corset: '#ff6a1f',
      sleeves: 'none',
      skirt: '#2a0505',
      skirtTrim: '#ff6a1f',
      pants: '#e05a4a',
      boots: '#1a0202',
      necklace: '#ffd23f',
    },
    gear: ['longHair', 'demonHorns', 'skirtLong', 'demonWings'],
  },
  {
    id: 'devourer',
    name: 'Galaxy Devourer',
    gender: 'm',
    perStep: 2.5e6,
    cost: { rp: 10 },
    rebirthVillain: true,
    pose: 'superhero',
    anim: { stance: 'brute', run: 'glide', taunt: 'laugh' },
    fx: { color: '#ff4fd8', type: 'swirl' },
    aura: { color: '#ff4fd8', core: '#0a0030', style: 'swirl' },
    look: {
      skin: '#2b1b6b',
      hair: '#2b1b6b',
      hairStyle: 'bald',
      eyeColor: '#ffffff',
      eyeGlow: true,
      brows: 'angry',
      mouth: 'teeth',
      shirt: '#120a3a',
      stars: '#ffd6fb',
      trim: '#ff4fd8',
      sleeves: 'long',
      pants: '#120a3a',
      boots: '#2b1b6b',
    },
    gear: ['planetHalo', 'cosmicCape'],
  },
  {
    id: 'omnipotent',
    name: 'Dark Omnipotent',
    gender: 'm',
    perStep: 2e7,
    cost: { rp: 15 },
    rebirthVillain: true,
    pose: 'float',
    anim: { stance: 'float', run: 'glide', taunt: 'laugh' },
    fx: { color: '#ffd23f', type: 'electric' },
    aura: { color: '#ffd23f', core: '#1a0000', style: 'flame', rainbow: true },
    look: {
      skin: '#0c0c12',
      hair: '#0c0c12',
      hairStyle: 'bald',
      eyeColor: '#ff2a2a',
      eyeGlow: true,
      brows: 'angry',
      mouth: 'flat',
      shirt: '#0c0c12',
      trim: '#ffd23f',
      emblem: { shape: 'diamond', color: '#ff2a2a' },
      sleeves: 'long',
      cuffs: '#ffd23f',
      pants: '#0c0c12',
      boots: '#ffd23f',
      belt: '#ffd23f',
    },
    gear: ['omniCrown', 'omniWings'],
  },
]

export const VILLAIN_BY_ID = Object.fromEntries(VILLAINS.map((v) => [v.id, v]))

/** Each villain runs a little faster than the one before it: +3% per step up. */
export const VILLAIN_SPEED = Object.fromEntries(VILLAINS.map((v, i) => [v.id, 1 + 0.03 * i]))

/**
 * Walking trail per villain (fx/trailPool.js styles), in the villain's fx colour.
 */
export const VILLAIN_TRAIL = {
  bloxity: 'glow',
  jester: 'sparkle',
  harlequin: 'star',
  goblin: 'bubbles',
  brute: 'bolt',
  venom: 'splash',
  frost: 'snow',
  inferno: 'flame',
  scarecrow: 'burst',
  doom: 'ripple',
  raven: 'bolt',
  mecha: 'ripple',
  vampire: 'slash',
  kraken: 'splash',
  titan: 'spiral',
  void: 'spiral',
  clockwork: 'star',
  plague: 'bubbles',
  hellfire: 'flame',
  devourer: 'burst',
  omnipotent: 'spiral',
}

/** The villain the tutorial walks you to: 3 Wins, right by spawn. */
export const FIRST_VILLAIN = 'jester'

/* --- Training treadmills ----------------------------------------------------- */

/**
 * Training pads. Stand on one and your villain runs in place: every step pays
 * `mult`x Speed. `req.rebirths` is a threshold you must have reached; `req.wins` a
 * one-off unlock price. `color` is the belt glow, `frame` the body.
 */
export const TREADMILLS = [
  { id: 't1', name: 'Rookie Treadmill', mult: 1, req: {}, color: '#7d8796', frame: '#4a4f5a' },
  { id: 't2', name: 'Bronze Treadmill', mult: 2, req: { wins: 40 }, color: '#d9884a', frame: '#7a4a24' },
  { id: 't3', name: 'Silver Treadmill', mult: 5, req: { rebirths: 1 }, color: '#d8e2ee', frame: '#7d8796' },
  { id: 't4', name: 'Golden Treadmill', mult: 12, req: { rebirths: 2 }, color: '#ffd23f', frame: '#a8791a' },
  { id: 't5', name: 'Emerald Treadmill', mult: 30, req: { rebirths: 4 }, color: '#41e05a', frame: '#1f7a32' },
  { id: 't6', name: 'Ruby Treadmill', mult: 80, req: { rebirths: 6 }, color: '#ff3b5c', frame: '#8a1028' },
  { id: 't7', name: 'Sapphire Treadmill', mult: 200, req: { rebirths: 9 }, color: '#3f8cff', frame: '#1a3f8a' },
  { id: 't8', name: 'Amethyst Treadmill', mult: 500, req: { rebirths: 12 }, color: '#b84dff', frame: '#5a1a8a' },
  { id: 't9', name: 'Neon Treadmill', mult: 1300, req: { rebirths: 15 }, color: '#38f0ff', frame: '#1a2a3a' },
  { id: 't10', name: 'Cosmic Treadmill', mult: 3500, req: { rebirths: 18 }, color: '#ff4fd8', frame: '#2a1252' },
  { id: 't11', name: 'Void Treadmill', mult: 10000, req: { rebirths: 22 }, color: '#ffffff', frame: '#0c0c12', rainbow: true },
]

export const TREADMILL_BY_ID = Object.fromEntries(TREADMILLS.map((t) => [t.id, t]))

/* --- Eggs & pets ------------------------------------------------------------- */

export const RARITIES = {
  common: { name: 'Common', color: '#c9d1dc' },
  uncommon: { name: 'Uncommon', color: '#41e05a' },
  rare: { name: 'Rare', color: '#3f8cff' },
  epic: { name: 'Epic', color: '#b84dff' },
  legendary: { name: 'Legendary', color: '#ffb300' },
  mythic: { name: 'Mythic', color: '#ff3d6e' },
}

/**
 * Pets. `boost` adds to the Speed multiplier while equipped (three slots), e.g. three
 * +0.5 pets make it 2.5x. `chance` is the weight inside its egg, in percent. `model`
 * drives the voxel model (game/pets/petModels.js) and the 2D icon.
 */
export const PETS = [
  // Starter Egg
  { id: 'slime', name: 'Green Slime', egg: 'starter', rarity: 'common', chance: 55, boost: 0.05, model: { kind: 'blob', body: '#5fe04a', belly: '#b6ff9a' } },
  { id: 'bat', name: 'Pink Bat', egg: 'starter', rarity: 'uncommon', chance: 30, boost: 0.1, model: { kind: 'winged', body: '#ff7ac8', belly: '#ffd1ea', wing: '#c23a8a', ears: true } },
  { id: 'pup', name: 'Lava Pup', egg: 'starter', rarity: 'rare', chance: 12, boost: 0.2, model: { kind: 'quad', body: '#ff6a1f', belly: '#ffd166', ears: 'flop', tail: '#ffd166' } },
  { id: 'cat', name: 'Shadow Cat', egg: 'starter', rarity: 'epic', chance: 3, boost: 0.4, model: { kind: 'quad', body: '#2a2a3a', belly: '#4a4a66', ears: 'pointy', tail: '#2a2a3a', eye: '#ffd23f' } },
  // Spooky Egg
  { id: 'iceslime', name: 'Ice Slime', egg: 'spooky', rarity: 'common', chance: 50, boost: 0.15, model: { kind: 'blob', body: '#7fe3ff', belly: '#e0f7ff', crown: '#ffffff' } },
  { id: 'bunny', name: 'Bone Bunny', egg: 'spooky', rarity: 'uncommon', chance: 30, boost: 0.3, model: { kind: 'quad', body: '#f2efe6', belly: '#ffffff', ears: 'long', tail: '#ffffff', eye: '#ff3b5c' } },
  { id: 'imp', name: 'Devil Imp', egg: 'spooky', rarity: 'rare', chance: 15, boost: 0.6, model: { kind: 'winged', body: '#d62828', belly: '#ff8a8a', wing: '#5a0a0a', horns: '#2a0a0a', tail: '#5a0a0a' } },
  { id: 'dragon', name: 'Neon Dragon', egg: 'spooky', rarity: 'epic', chance: 5, boost: 1.2, model: { kind: 'dragon', body: '#38f0ff', belly: '#d6fbff', wing: '#1a7a8a', horns: '#ffffff' } },
  // Toxic Egg
  { id: 'toxblob', name: 'Toxic Blob', egg: 'toxic', rarity: 'common', chance: 50, boost: 0.5, model: { kind: 'blob', body: '#a0ff2a', belly: '#e8ffb0', horns: '#5a9a10' } },
  { id: 'fox', name: 'Ghost Fox', egg: 'toxic', rarity: 'uncommon', chance: 30, boost: 1, model: { kind: 'quad', body: '#e8f4ff', belly: '#ffffff', ears: 'pointy', tail: '#9fd4ff', glow: true } },
  { id: 'golem', name: 'Gear Golem', egg: 'toxic', rarity: 'rare', chance: 15, boost: 2, model: { kind: 'quad', body: '#8a8f99', belly: '#c7d0db', ears: 'none', tail: null, eye: '#38f0ff', antenna: '#ff3b30' } },
  { id: 'phoenix', name: 'Phoenix', egg: 'toxic', rarity: 'legendary', chance: 5, boost: 4, model: { kind: 'winged', body: '#ff8a1f', belly: '#ffe066', wing: '#ff3b00', crest: '#ffd23f', glow: true } },
  // Cyber Egg
  { id: 'eye', name: 'Void Eye', egg: 'cyber', rarity: 'common', chance: 50, boost: 1.5, model: { kind: 'eye', body: '#3a1a6a', iris: '#b84dff' } },
  { id: 'owl', name: 'Storm Owl', egg: 'cyber', rarity: 'uncommon', chance: 30, boost: 3, model: { kind: 'winged', body: '#3a4a7a', belly: '#9fb4ff', wing: '#1a2a5a', ears: true, eye: '#ffe066' } },
  { id: 'hydra', name: 'Crystal Hydra', egg: 'cyber', rarity: 'epic', chance: 15, boost: 6, model: { kind: 'dragon', body: '#b84dff', belly: '#f0d6ff', wing: '#6a1a9a', horns: '#ffffff', glow: true } },
  { id: 'whale', name: 'Galaxy Whale', egg: 'cyber', rarity: 'legendary', chance: 5, boost: 12, model: { kind: 'whale', body: '#2a3a9a', belly: '#9fd4ff', fin: '#ff4fd8', glow: true } },
  // Omega Egg
  { id: 'cube', name: 'Chaos Cube', egg: 'omega', rarity: 'rare', chance: 50, boost: 5, model: { kind: 'cube', body: '#ff3d6e', iris: '#ffd23f' } },
  { id: 'seraph', name: 'Dark Seraph', egg: 'omega', rarity: 'epic', chance: 30, boost: 10, model: { kind: 'winged', body: '#1a1a26', belly: '#3a3a52', wing: '#ffd23f', halo: '#ffd23f', glow: true } },
  { id: 'kraken', name: 'Cosmic Kraken', egg: 'omega', rarity: 'legendary', chance: 15, boost: 20, model: { kind: 'whale', body: '#6a1a9a', belly: '#ff9cf4', fin: '#38f0ff', tentacles: true, glow: true } },
  { id: 'overlord', name: 'Omega Overlord', egg: 'omega', rarity: 'mythic', chance: 5, boost: 40, model: { kind: 'dragon', body: '#0c0c12', belly: '#ff3d6e', wing: '#ffd23f', horns: '#ffd23f', crown: '#ffd23f', glow: true } },
]

export const PET_BY_ID = Object.fromEntries(PETS.map((p) => [p.id, p]))

/** Eggs, priced in Wins. `color`/`spots` paint the egg on its stand. */
export const EGGS = [
  { id: 'starter', name: 'Starter Egg', cost: 50, color: '#fff3d6', spots: '#ffb347' },
  { id: 'spooky', name: 'Spooky Egg', cost: 2500, color: '#5a2a86', spots: '#ff9f1c' },
  { id: 'toxic', name: 'Toxic Egg', cost: 120000, color: '#7dff2a', spots: '#2a5a0a' },
  { id: 'cyber', name: 'Cyber Egg', cost: 6e6, color: '#38f0ff', spots: '#1a2a5a' },
  { id: 'omega', name: 'Omega Egg', cost: 3e8, color: '#1a1a26', spots: '#ffd23f', rainbow: true },
]

export const EGG_BY_ID = Object.fromEntries(EGGS.map((e) => [e.id, e]))

export const PETS_BY_EGG = Object.fromEntries(EGGS.map((e) => [e.id, PETS.filter((p) => p.egg === e.id)]))

/** Equipped pet slots and inventory size. */
export const PET_SLOTS = 3
export const PET_INVENTORY = 60

/* --- Boosts ------------------------------------------------------------------- */

/** Timed boosts bought with Wins (price scales with how far you have got). */
export const BOOSTS = [
  { id: 'speed', name: '2x Speed', icon: 'bolt', minutes: 15, mult: 2, desc: 'Double Speed from every step.' },
  { id: 'wins', name: '2x Wins', icon: 'trophy', minutes: 15, mult: 2, desc: 'Double Wins from every win pad.' },
  { id: 'luck', name: 'Lucky Hatch', icon: 'clover', minutes: 15, mult: 2, desc: 'Rarer pets twice as likely.' },
]

export const BOOST_BY_ID = Object.fromEntries(BOOSTS.map((b) => [b.id, b]))

/* --- Daily & playtime rewards ---------------------------------------------------- */

/**
 * The daily streak: one claim per day, the reward grows over seven days, then the
 * week starts again. `winsStages` is how many of your best stage's win pads it pays.
 */
export const DAILY_REWARDS = [
  { day: 1, winsPads: 2, boost: null },
  { day: 2, winsPads: 3, boost: 'speed' },
  { day: 3, winsPads: 4, boost: null },
  { day: 4, winsPads: 5, boost: 'wins' },
  { day: 5, winsPads: 6, boost: null },
  { day: 6, winsPads: 8, boost: 'luck' },
  { day: 7, winsPads: 12, boost: 'speed', bonusEgg: true },
]

/** Rewards for minutes played in one session. */
export const PLAYTIME_REWARDS = [
  { minutes: 2, winsPads: 1 },
  { minutes: 5, boost: 'speed', boostMinutes: 5 },
  { minutes: 10, winsPads: 3 },
  { minutes: 15, boost: 'wins', boostMinutes: 10 },
  { minutes: 25, winsPads: 6 },
  { minutes: 40, boost: 'luck', boostMinutes: 15 },
  { minutes: 60, winsPads: 12 },
]

/* --- Codes ------------------------------------------------------------------------ */

/** Redeemable codes. Each can be redeemed once per save. */
export const CODES = {
  VISITS500K: { winsPads: 4, boost: 'speed', boostMinutes: 15, label: '4 win pads of Wins + 15 min 2x Speed' },
  VILLAIN: { winsPads: 2, label: '2 win pads of Wins' },
  RELEASE: { boost: 'wins', boostMinutes: 15, label: '15 min 2x Wins' },
  BLOXITY: { boost: 'luck', boostMinutes: 15, label: '15 min Lucky Hatch' },
}

/* --- Events -------------------------------------------------------------------------- */

/**
 * "Treadmill OP": every 15 minutes, for 2 minutes, every treadmill pays double. Timed
 * from the wall clock, so every player in every lobby sees the same countdown.
 */
export const TREADMILL_OP = { periodMs: 15 * 60 * 1000, durationMs: 2 * 60 * 1000, mult: 2 }
