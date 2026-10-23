import { useBloxity } from '../bloxity/BloxityContext'
import { useNetStore } from '../net/netStore'
import { useGameStore } from '../state/gameStore'

/**
 * The player's name tag, in the HUD's top-right cell: Bloxity picture and name, with
 * the UID the server gave them on their first join. Signing in and out is the
 * Bloxity site's job, so the tag is just the picture, the name and the number.
 *
 * Uses the `getUser() || getGuest()` pattern (surfaced as `identity` on the context)
 * so there is always a name and picture to show, even before the player logs in.
 */
export function AuthHUD() {
  const { identity, status, error } = useBloxity()
  const uid = useGameStore((s) => s.uid)
  const online = useNetStore((s) => s.status === 'online')

  const name = identity?.displayName || identity?.username || 'Guest'
  const pfp = identity?.pfp

  return (
    <div className="auth-stack">
      <div
        className="auth-chip live"
        title={status === 'error' ? `Bloxity SDK failed to load. ${error?.message || ''}` : name}
      >
        {pfp ? (
          <img src={pfp} alt="" className="auth-pfp" />
        ) : (
          <div className="auth-pfp auth-initial">{name.charAt(0).toUpperCase()}</div>
        )}
        <div className="auth-text">
          <div className="auth-name">{name}</div>
          <div className="auth-uid">
            <span className={`net-dot ${online ? 'on' : ''}`} aria-hidden />
            UID {uid ? `#${uid.toLocaleString()}` : '…'}
          </div>
        </div>
      </div>
    </div>
  )
}

export default AuthHUD
