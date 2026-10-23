import { waitForSDK } from '../bloxity/sdk'
import { useBloxityStore } from '../bloxity/store'

/**
 * Where the game's backend lives.
 *
 * Hosted on Bloxity Legion (the game's *.play.bloxity.io site, or your own domain):
 *  - multiplayer goes through the Legion matchmaker, which picks (or starts) a server
 *    pod with room and hands back a relay endpoint pinned to it;
 *  - HTTP (leaderboards) goes to the game's backend host, dev or prod to match the
 *    site.
 * Locally (localhost, a LAN address, or `?server=` in development): straight to the
 * local server on port 3000.
 */

const SLUG = import.meta.env.VITE_GAME_SLUG
/** The game's id on Bloxity. */
export const GAME_ID = SLUG && SLUG !== 'MY_GAME_SLUG' ? SLUG : '1-villain-evolution'

const loc = typeof window !== 'undefined' ? window.location : null
const host = loc?.hostname || ''

/** `?server=` in the URL overrides the endpoint in development (handy for testing). */
const DEV_OVERRIDE = import.meta.env.DEV && loc ? new URLSearchParams(loc.search).get('server') : null

const LOCAL =
  !host ||
  host === 'localhost' ||
  host === '127.0.0.1' ||
  host === '[::1]' ||
  /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(host) ||
  host.endsWith('.local')

/** True when hosted: join through the Legion matchmaker. */
export const USE_MATCHMAKER = !DEV_OVERRIDE && !import.meta.env.VITE_SERVER_URL && !LOCAL

/** The dev channel's site reaches the dev backend. */
const DEV_CHANNEL = host.endsWith('.dev.play.bloxity.io')

/** Base URL for the backend's HTTP API. */
export const API_URL =
  DEV_OVERRIDE ||
  import.meta.env.VITE_SERVER_URL ||
  (LOCAL ? `${loc?.protocol || 'http:'}//${host}:3000` : `https://${GAME_ID}.${DEV_CHANNEL ? 'dev.' : ''}host.bloxity.io`)

/**
 * The endpoint for a new Colyseus Client. Hosted, every call asks the matchmaker
 * again (an endpoint is pinned to one pod: never reuse an old one).
 */
export async function resolveGameEndpoint() {
  if (!USE_MATCHMAKER) return API_URL
  const sdk = await waitForSDK({ timeoutMs: 20000 })
  const userId = useBloxityStore.getState().user?._id
  const { endpoint } = await sdk.net.resolveEndpoint(GAME_ID, userId ? { userId } : {})
  return endpoint
}
