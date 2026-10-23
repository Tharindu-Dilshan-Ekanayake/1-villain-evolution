const { schema, t } = require('@colyseus/schema')

/**
 * Synchronised lobby state. Colyseus delta-encodes it, so a patch only carries the
 * fields that changed since the last one.
 *
 * Positions are float32 (plenty for a world a kilometre long); everything that
 * rarely changes - name, villain, pets - costs nothing between changes.
 */
const Player = schema(
  {
    name: t.string().default(''),
    /** The player's number in this game, given on their first ever join. */
    uid: t.uint32().default(0),
    /** Feet position on the ground plane, and height while jumping. */
    x: t.float32().default(0),
    z: t.float32().default(0),
    y: t.float32().default(0),
    /** Facing angle about the vertical axis. */
    yaw: t.float32().default(0),
    /** Running speed, for the run animation (also while running on a treadmill). */
    speed: t.float32().default(0),
    /** 1 while training on a treadmill. */
    train: t.uint8().default(0),
    /** Villain id ('bloxity' = the player's own avatar). */
    morph: t.string().default(''),
    /** Bloxity skin texture URL for the 'bloxity' look. */
    skin: t.string().default(''),
    /** Equipped pet ids, comma separated (at most three). */
    pets: t.string().default(''),
    level: t.uint16().default(0),
    rebirths: t.uint16().default(0),
    /** Current Speed (the wall-breaking power), for name tags. */
    power: t.float64().default(0),
    /** Incremented on every wall slam; `slamKind` 1 if the wall broke, 0 if it held. */
    slam: t.uint16().default(0),
    slamKind: t.uint8().default(0),
  },
  'Player',
)

const LobbyState = schema(
  {
    /** Human-friendly lobby number (1, 2, 3 ...), shown in the HUD. */
    lobby: t.uint16().default(0),
    players: t.map(Player),
  },
  'LobbyState',
)

module.exports = { Player, LobbyState }
