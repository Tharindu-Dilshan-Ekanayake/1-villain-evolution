const fs = require('fs')
const path = require('path')

/**
 * Lobby leaderboards: best Speed, Wins earned, Rebirths and Play time.
 *
 * Players report their records through the lobby room; each player's best values are
 * kept and the top ten of every board is served over REST.
 *
 * Storage:
 *  - MONGODB_URI set (Bloxity Legion injects one per game + channel): a shared Mongo
 *    collection, so every pod sees the same boards. Writes are atomic `$max` upserts.
 *  - otherwise (local development): in memory, saved to a JSON file.
 *
 * NOTE: values are reported by the client, like the rest of the game's progress.
 * Once progress moves server-side, feed these from there instead.
 */

const BOARDS = ['speed', 'wins', 'rebirths', 'time']
const TOP = 10
/** Highest value accepted for any record (Speed grows exponentially). */
const MAX_VALUE = 1e300

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(MAX_VALUE, Math.max(0, v)) : 0)

/** Validated record values from a client report, or null if the report is unusable. */
function clean(uid, name, stats) {
  if (typeof uid !== 'string' || !uid || uid.length > 80 || !stats) return null
  return {
    name: String(name || 'Player').slice(0, 24),
    speed: finite(stats.speed),
    wins: finite(stats.wins),
    rebirths: Math.floor(finite(stats.rebirths)),
    time: Math.floor(finite(stats.time)),
  }
}

/* --- Mongo (hosted) ------------------------------------------------------------------- */

/** Top lists are cached briefly: every player polls, the boards change slowly. */
const TOP_CACHE_MS = 10000

function createMongoStore(uri) {
  const { MongoClient } = require('mongodb')
  const client = new MongoClient(uri, { maxPoolSize: 5 })
  const ready = client
    .connect()
    .then(async () => {
      // The URI names the game's own database.
      const col = client.db().collection('leaderboard')
      await col.createIndexes(BOARDS.map((b) => ({ key: { [b]: -1 } })))
      console.log('[leaderboard] using Mongo')
      return col
    })
    .catch((err) => {
      console.error('[leaderboard] Mongo unavailable:', err.message)
      return null
    })

  let topCache = null
  let topAt = 0

  async function tops(col) {
    if (topCache && Date.now() - topAt < TOP_CACHE_MS) return topCache
    const lists = await Promise.all(
      BOARDS.map((b) =>
        col
          .find({ [b]: { $gt: 0 } }, { projection: { name: 1, [b]: 1 } })
          .sort({ [b]: -1 })
          .limit(TOP)
          .toArray(),
      ),
    )
    topCache = Object.fromEntries(BOARDS.map((b, i) => [b, lists[i]]))
    topAt = Date.now()
    return topCache
  }

  return {
    async report(uid, name, stats) {
      const rec = clean(uid, name, stats)
      const col = await ready
      if (!rec || !col) return
      await col.updateOne(
        { _id: uid },
        {
          $max: { speed: rec.speed, wins: rec.wins, rebirths: rec.rebirths, time: rec.time },
          $set: { name: rec.name, at: Date.now() },
        },
        { upsert: true },
      )
    },

    async snapshot(uid) {
      const col = await ready
      if (!col) throw new Error('leaderboard storage unavailable')
      const lists = await tops(col)
      const boards = {}
      for (const b of BOARDS) {
        boards[b] = lists[b].map((e) => ({ id: e._id === uid ? 'you' : undefined, name: e.name, value: e[b] }))
      }
      const you = {}
      if (uid) {
        const mine = await col.findOne({ _id: uid })
        if (mine) {
          const ahead = await Promise.all(BOARDS.map((b) => (mine[b] > 0 ? col.countDocuments({ [b]: { $gt: mine[b] } }) : -1)))
          BOARDS.forEach((b, i) => {
            if (ahead[i] >= 0) you[b] = ahead[i] + 1
          })
        }
      }
      return { boards, you }
    },
  }
}

/* --- JSON file (local development) ------------------------------------------------------ */

const SAVE_EVERY_MS = 15000
/** Records kept; the least relevant are dropped beyond this. */
const MAX_ENTRIES = 5000

function createFileStore(file) {
  /** uid -> { name, speed, wins, rebirths, time, at } */
  const entries = new Map()
  let dirty = false
  let cache = null

  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const [uid, e] of Object.entries(data.entries || {})) {
      const rec = clean(uid, e.name, e)
      if (rec) entries.set(uid, { ...rec, at: finite(e.at) })
    }
    console.log(`[leaderboard] loaded ${entries.size} records`)
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[leaderboard] could not read', file, err.message)
  }

  const sorted = (board) => [...entries].filter(([, e]) => e[board] > 0).sort((a, b) => b[1][board] - a[1][board])

  function save() {
    if (!dirty) return
    dirty = false
    const data = JSON.stringify({ entries: Object.fromEntries(entries) })
    fs.mkdir(path.dirname(file), { recursive: true }, (mkErr) => {
      if (mkErr) return console.warn('[leaderboard] save failed', mkErr.message)
      // Write then rename, so a crash mid-write never leaves a broken file.
      const tmp = `${file}.tmp`
      fs.writeFile(tmp, data, (err) => {
        if (err) return console.warn('[leaderboard] save failed', err.message)
        fs.rename(tmp, file, (renameErr) => renameErr && console.warn('[leaderboard] save failed', renameErr.message))
      })
    })
  }

  /** Last-chance save on shutdown (exit handlers must be synchronous). */
  function saveNow() {
    if (!dirty) return
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify({ entries: Object.fromEntries(entries) }))
      dirty = false
    } catch (err) {
      console.warn('[leaderboard] save failed', err.message)
    }
  }

  function prune() {
    if (entries.size <= MAX_ENTRIES) return
    // Keep everyone near a board; drop the longest-idle of the rest.
    const keep = new Set(BOARDS.flatMap((b) => sorted(b).slice(0, TOP * 10).map(([uid]) => uid)))
    const idle = [...entries].filter(([uid]) => !keep.has(uid)).sort((a, b) => a[1].at - b[1].at)
    for (const [uid] of idle.slice(0, entries.size - MAX_ENTRIES)) entries.delete(uid)
  }

  setInterval(save, SAVE_EVERY_MS).unref()
  process.on('exit', saveNow)

  return {
    async report(uid, name, stats) {
      const rec = clean(uid, name, stats)
      if (!rec) return
      const prev = entries.get(uid)
      const next = { name: rec.name, at: Date.now() }
      for (const b of BOARDS) next[b] = Math.max(prev?.[b] || 0, rec[b])
      const changed = !prev || BOARDS.some((b) => next[b] !== prev[b]) || next.name !== prev.name
      entries.set(uid, next)
      if (changed) {
        dirty = true
        cache = null
      }
      prune()
    },

    async snapshot(uid) {
      if (!cache) {
        cache = {}
        for (const b of BOARDS) cache[b] = sorted(b)
      }
      const boards = {}
      const you = {}
      for (const b of BOARDS) {
        const list = cache[b]
        boards[b] = list.slice(0, TOP).map(([id, e]) => ({ id: id === uid ? 'you' : undefined, name: e.name, value: e[b] }))
        if (uid) {
          const rank = list.findIndex(([id]) => id === uid)
          if (rank >= 0) you[b] = rank + 1
        }
      }
      return { boards, you }
    },
  }
}

const store = process.env.MONGODB_URI
  ? createMongoStore(process.env.MONGODB_URI)
  : createFileStore(process.env.LEADERBOARD_FILE || path.join(__dirname, '..', 'data', 'leaderboard.json'))

/** Records a player's current values; each board keeps their best. Never throws. */
function report(uid, name, stats) {
  store.report(uid, name, stats).catch((err) => console.warn('[leaderboard] report failed', err.message))
}

/** Top ten of every board, plus the asking player's rank on each. */
function snapshot(uid) {
  return store.snapshot(uid)
}

module.exports = { report, snapshot }
