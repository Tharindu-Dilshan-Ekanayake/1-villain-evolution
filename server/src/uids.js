const fs = require('fs')
const path = require('path')

/**
 * Player numbers (UIDs). The first time a player ever joins - keyed by their Bloxity
 * user id, or their browser's guest id - they get the next number: the first player
 * is UID 1, the next UID 2, and so on. The same player always gets the same number
 * back.
 *
 * Storage:
 *  - MONGODB_URI set (Bloxity Legion injects one per game + channel): a shared Mongo
 *    collection, so every pod hands out numbers from one counter.
 *  - otherwise (local development): in memory, saved to a JSON file.
 */

const MAX_KEY = 80

const validKey = (key) => typeof key === 'string' && key.length > 0 && key.length <= MAX_KEY

/* --- Mongo (hosted) ------------------------------------------------------------------- */

function createMongoStore(uri) {
  const { MongoClient } = require('mongodb')
  const client = new MongoClient(uri, { maxPoolSize: 5 })
  const ready = client
    .connect()
    .then(() => {
      const db = client.db()
      console.log('[uids] using Mongo')
      return { uids: db.collection('uids'), counters: db.collection('counters') }
    })
    .catch((err) => {
      console.error('[uids] Mongo unavailable:', err.message)
      return null
    })

  return {
    async assign(key) {
      const db = await ready
      if (!db) return 0
      const existing = await db.uids.findOne({ _id: key })
      if (existing) return existing.n
      const counter = await db.counters.findOneAndUpdate(
        { _id: 'uid' },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: 'after' },
      )
      const n = counter?.seq ?? counter?.value?.seq
      // Two tabs joining at once: whichever insert lands first keeps its number.
      await db.uids.updateOne({ _id: key }, { $setOnInsert: { n, at: Date.now() } }, { upsert: true })
      const doc = await db.uids.findOne({ _id: key })
      return doc?.n || 0
    },
  }
}

/* --- JSON file (local development) ------------------------------------------------------ */

const SAVE_EVERY_MS = 5000

function createFileStore(file) {
  /** key -> number */
  const numbers = new Map()
  let seq = 0
  let dirty = false

  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const [key, n] of Object.entries(data.numbers || {})) {
      if (validKey(key) && Number.isInteger(n) && n > 0) numbers.set(key, n)
    }
    seq = Math.max(Number(data.seq) || 0, ...numbers.values(), 0)
    console.log(`[uids] loaded ${numbers.size} players (next UID ${seq + 1})`)
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[uids] could not read', file, err.message)
  }

  const serialise = () => JSON.stringify({ seq, numbers: Object.fromEntries(numbers) })

  function save() {
    if (!dirty) return
    dirty = false
    const data = serialise()
    fs.mkdir(path.dirname(file), { recursive: true }, (mkErr) => {
      if (mkErr) return console.warn('[uids] save failed', mkErr.message)
      // Write then rename, so a crash mid-write never leaves a broken file.
      const tmp = `${file}.tmp`
      fs.writeFile(tmp, data, (err) => {
        if (err) return console.warn('[uids] save failed', err.message)
        fs.rename(tmp, file, (renameErr) => renameErr && console.warn('[uids] save failed', renameErr.message))
      })
    })
  }

  /** Last-chance save on shutdown (exit handlers must be synchronous). */
  function saveNow() {
    if (!dirty) return
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, serialise())
      dirty = false
    } catch (err) {
      console.warn('[uids] save failed', err.message)
    }
  }

  setInterval(save, SAVE_EVERY_MS).unref()
  process.on('exit', saveNow)

  return {
    async assign(key) {
      if (numbers.has(key)) return numbers.get(key)
      seq += 1
      numbers.set(key, seq)
      dirty = true
      return seq
    },
  }
}

const store = process.env.MONGODB_URI
  ? createMongoStore(process.env.MONGODB_URI)
  : createFileStore(process.env.UID_FILE || path.join(__dirname, '..', 'data', 'uids.json'))

/** The UID for a player identity, assigning the next one on their first join. 0 on failure. */
async function assignUid(key) {
  if (!validKey(key)) return 0
  try {
    return await store.assign(key)
  } catch (err) {
    console.warn('[uids] assign failed', err.message)
    return 0
  }
}

module.exports = { assignUid }
