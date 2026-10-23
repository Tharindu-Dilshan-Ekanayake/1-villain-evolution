const cors = require('cors')
const express = require('express')
const { matchMaker, Server } = require('@colyseus/core')
const { WebSocketTransport } = require('@colyseus/ws-transport')

const { drain } = require('./drain')
const leaderboard = require('./leaderboard')
const { LobbyRoom } = require('./rooms/LobbyRoom')

/**
 * Hosted on Bloxity Legion, these come from the platform: PORT, CLIENT_ORIGIN (the
 * game site), MONGODB_URI (see leaderboard.js), BLOXITY_GAME_ID, NODE_ENV=production.
 * Locally they fall back to the Vite dev server setup.
 */
const PORT = Number(process.env.PORT) || 3000
const PRODUCTION = process.env.NODE_ENV === 'production'
const GAME_ID = process.env.BLOXITY_GAME_ID || '1-villain-evolution'

const ALLOWED_ORIGINS = [
  ...(process.env.ALLOWED_ORIGINS || (PRODUCTION ? '' : 'http://localhost:5173,http://127.0.0.1:5173')).split(','),
  process.env.CLIENT_ORIGIN,
  // The game's own sites on Bloxity (prod and dev channels).
  `https://${GAME_ID}.play.bloxity.io`,
  `https://${GAME_ID}.dev.play.bloxity.io`,
]
  .map((s) => s && s.trim())
  .filter(Boolean)

/** The Bloxity portal and play hosts, where the game runs embedded. */
const BLOXITY_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*bloxity\.io$/

const isAllowedOrigin = (origin) => ALLOWED_ORIGINS.includes(origin) || BLOXITY_ORIGIN.test(origin || '')

/**
 * Colyseus game server + the REST endpoints, on one port.
 *
 * Multiplayer: every client joins a "lobby" room. A lobby holds up to 8 players;
 * when all lobbies are full the matchmaker creates a new one for the next player.
 */
const gameServer = new Server({
  transport: new WebSocketTransport({ pingInterval: 5000 }),
  greet: false,
  express: (app) => {
    app.use(cors({ origin: (origin, done) => done(null, !origin || isAllowedOrigin(origin)), credentials: true }))
    app.use(express.json())

    // Legion's readiness / liveness probe: answer at once, never block.
    app.get('/health', (_req, res) => {
      res.status(200).send('ok')
    })
    app.get('/api/health', (_req, res) => {
      res.json({ ok: true })
    })

    /** Top ten of each lobby board; `?uid=` adds that player's own ranks. */
    app.get('/api/leaderboard', async (req, res) => {
      const uid = typeof req.query.uid === 'string' ? req.query.uid.slice(0, 80) : ''
      res.set('Cache-Control', 'no-store')
      try {
        res.json(await leaderboard.snapshot(uid))
      } catch (err) {
        res.status(503).json({ error: err.message })
      }
    })

    /**
     * Auth passthrough for the Bloxity SDK.
     *
     * The frontend will POST `{ token, user }` here from
     * `Legion.SDK.auth.authenticateWithServer('/api/legion-auth')`.
     *
     * NOTE: not wired up on the frontend yet. When you do wire it, call
     * `authenticateWithServer` from `client/src/bloxity/BloxityProvider.jsx` inside
     * the `onUserChanged` handler, right after a non-null user arrives, and stash the
     * returned accessToken for your own API calls.
     */
    app.post('/api/legion-auth', (req, res) => {
      // Never log the body: it carries the player's token.
      console.log('[legion-auth] user:', req.body?.user?._id)

      // TODO: verify the Bloxity JWT here before trusting req.body.user.
      // Until that happens `req.body.user` is attacker-controlled — anyone can POST any
      // legionId they like. Verify `req.body.token` against Bloxity's public key /
      // introspection endpoint and derive the user from the *verified* claims, not from
      // the body.

      res.json({
        accessToken: 'stub',
        user: { legionId: req.body.user?._id },
      })
    })

    /**
     * Webhook for future Bux purchases.
     * Responds 200 immediately — the platform will retry on anything else, so do the
     * real work asynchronously rather than holding the response open.
     */
    app.post('/api/legion-webhook', (req, res) => {
      console.log('[legion-webhook] transaction:', req.body?.transactionId)

      // TODO: verify x-legion-webhook-secret header, dedupe by transactionId, grant the item.

      res.sendStatus(200)
    })
  },
})

// The matchmaking routes (/matchmake/...) answer cross-origin requests from the game
// client; restrict them to the same origins as the REST API.
matchMaker.controller.getCorsHeaders = function getCorsHeaders(headers) {
  const origin = headers.get('origin')
  return {
    'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0] || '',
    Vary: 'Origin',
  }
}

gameServer.define('lobby', LobbyRoom)

// On SIGTERM (a deploy or scale-down) Colyseus shuts down gracefully, and first the
// drain moves every player to the fresh pod a few at a time (see drain.js).
gameServer.onBeforeShutdown(drain)

gameServer.listen(PORT).then(() => {
  console.log(`Server listening on port ${PORT} (REST + Colyseus lobbies of 8)${process.env.POD_NAME ? ` [${process.env.POD_NAME}]` : ''}`)
})
