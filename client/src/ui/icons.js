/**
 * Small chunky SVG icons for everything on screen in the first seconds of play: the
 * HUD, name tags, world labels and the welcome card.
 *
 * Emoji were used before, but the first time a page lays out an emoji the browser
 * hunts through system fonts for it and loads the (large) colour-emoji font - about
 * a second of layout on a mid-range phone, right as the game becomes playable. Inline
 * SVG costs nothing like that, and looks the same on every device.
 *
 * Each icon is a markup string (24 x 24 view box, ink outline) so it works both in
 * React (`<Icon name>`) and in the HTML strings of world labels (`icon(name)`).
 */

const INK = '#1b1130'
const S = `stroke="${INK}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"`

const PATHS = {
  trophy: `<path d="M7 3h10v4a5 5 0 0 1-10 0z" fill="#ffd23f" ${S}/><path d="M7 5H4v1.5A3.5 3.5 0 0 0 7.5 10M17 5h3v1.5A3.5 3.5 0 0 1 16.5 10" fill="none" ${S}/><path d="M10.5 12h3v4h-3z" fill="#f2b705" ${S}/><path d="M7.5 16h9v4h-9z" fill="#c8742e" ${S}/><path d="M9 5.2h2" stroke="#fff6c2" stroke-width="1.4" stroke-linecap="round"/>`,
  villain: `<path d="M4 21c0-5 3.5-8 8-8s8 3 8 8z" fill="#7a2fe0" ${S}/><path d="M6 11c0-4 2.6-7 6-7s6 3 6 7c0 2-1.5 3.5-6 3.5S6 13 6 11z" fill="#ffd9b8" ${S}/><path d="M5.5 9.5C6 5 8.5 3 12 3s6 2 6.5 6.5L16 8 12 9.5 8 8z" fill="#3a0f80" ${S}/><path d="M8.2 10.6l2.4.8M15.8 10.6l-2.4.8" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/><path d="M10.5 12.6c1 .6 2 .6 3 0" fill="none" stroke="#c0392b" stroke-width="1.3" stroke-linecap="round"/>`,
  paw: `<ellipse cx="12" cy="16" rx="5" ry="4.2" fill="#ff8a1f" ${S}/><circle cx="6" cy="10" r="2.2" fill="#ff8a1f" ${S}/><circle cx="18" cy="10" r="2.2" fill="#ff8a1f" ${S}/><circle cx="9.3" cy="6.3" r="2.2" fill="#ff8a1f" ${S}/><circle cx="14.7" cy="6.3" r="2.2" fill="#ff8a1f" ${S}/>`,
  calendar: `<rect x="3.5" y="5" width="17" height="15.5" rx="2.5" fill="#ffffff" ${S}/><path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h12a2.5 2.5 0 0 1 2.5 2.5V10h-17z" fill="#ff4d6d" ${S}/><path d="M8 3v4M16 3v4" ${S}/><path d="M7 13h2.5M11 13h2.5M15 13h2M7 16.5h2.5M11 16.5h2.5" stroke="#3f8cff" stroke-width="1.8" stroke-linecap="round"/>`,
  clock: `<circle cx="12" cy="13" r="8.5" fill="#ff4d6d" ${S}/><circle cx="12" cy="13" r="6.2" fill="#ffffff" ${S}/><path d="M12 9.2V13l2.8 1.8" fill="none" ${S}/><path d="M9 3.2h6" ${S}/>`,
  potion: `<path d="M9.5 3h5v5.2l4 6.3a4.5 4.5 0 0 1-3.8 6.9H9.3a4.5 4.5 0 0 1-3.8-6.9l4-6.3z" fill="#e8fbff" ${S}/><path d="M6.6 14h10.8l.9 1.4a3.4 3.4 0 0 1-2.9 5.1H8.6a3.4 3.4 0 0 1-2.9-5.1z" fill="#41e05a"/><path d="M9.5 3h5v5.2l4 6.3a4.5 4.5 0 0 1-3.8 6.9H9.3a4.5 4.5 0 0 1-3.8-6.9l4-6.3z" fill="none" ${S}/><path d="M8.5 3h7" ${S}/><circle cx="10.5" cy="17" r="1" fill="#ffffff"/>`,
  gear: `<path d="M10.3 2.8h3.4l.5 2.4 1.9.8 2-1.4 2.4 2.4-1.4 2 .8 1.9 2.4.5v3.4l-2.4.5-.8 1.9 1.4 2-2.4 2.4-2-1.4-1.9.8-.5 2.4h-3.4l-.5-2.4-1.9-.8-2 1.4-2.4-2.4 1.4-2-.8-1.9-2.4-.5v-3.4l2.4-.5.8-1.9-1.4-2 2.4-2.4 2 1.4 1.9-.8z" fill="#aab6c6" ${S}/><circle cx="12" cy="12" r="3.2" fill="#ffffff" ${S}/>`,
  bolt: `<path d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.2z" fill="#ffd23f" ${S}/>`,
  globe: `<circle cx="12" cy="12" r="9" fill="#3fd0f2" ${S}/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" fill="none" ${S}/>`,
  fire: `<path d="M12 2.5c1.2 3.6 6 5.6 6 11a6 6 0 0 1-12 0c0-2.6 1.3-4.4 2.6-5.6 0 2.2 1 3.3 2.2 3.3-1-3.5.2-6.4 1.2-8.7z" fill="#ff6a1f" ${S}/><path d="M12 13c1 1.4 2.8 2 2.8 4a2.8 2.8 0 0 1-5.6 0c0-1.4.9-2.1 1.7-2.9z" fill="#ffd23f"/>`,
  up: `<path d="M12 3 4.5 11h4.5v9h6v-9h4.5z" fill="#ffffff" ${S}/>`,
  shoe: `<path d="M3 15.5V12l4.5-3.5 2.5 2 3-1.5 2.3 3.2 4.7 1.3A2.6 2.6 0 0 1 22 16v1H3z" fill="#ff4d6d" ${S}/><path d="M3 17h19v1.5a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 18.5z" fill="#ffffff" ${S}/><path d="M9 11.5l1.5 1.2M11.4 10.6l1.4 1.3" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round"/>`,
  rebirth: `<path d="M19 8.5A8 8 0 0 0 5.2 7.4L4 5.8V11h5.2L7.5 9.2a5.5 5.5 0 0 1 9.3-.1z" fill="#41e05a" ${S}/><path d="M5 15.5a8 8 0 0 0 13.8 1.1L20 18.2V13h-5.2l1.7 1.8a5.5 5.5 0 0 1-9.3.1z" fill="#3fd0f2" ${S}/>`,
  lock: `<rect x="5" y="10.5" width="14" height="10.5" rx="2.4" fill="#ffd23f" ${S}/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" ${S}/><circle cx="12" cy="15.4" r="1.4" fill="${INK}"/>`,
  check: `<path d="M4 12.5 9.5 18 20 6.5" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 12.5 9.5 18 20 6.5" fill="none" stroke="#41e05a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  star: `<path d="m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" fill="#ffd23f" ${S}/>`,
  clover: `<circle cx="9" cy="9" r="3.6" fill="#41e05a" ${S}/><circle cx="15" cy="9" r="3.6" fill="#41e05a" ${S}/><circle cx="9" cy="15" r="3.6" fill="#41e05a" ${S}/><circle cx="15" cy="15" r="3.6" fill="#41e05a" ${S}/><path d="M14 14l5 7" ${S}/>`,
  egg: `<path d="M12 2.5c3.8 0 7 5.6 7 10.3A7 7 0 0 1 5 12.8C5 8.1 8.2 2.5 12 2.5z" fill="#fff3d6" ${S}/><circle cx="9.6" cy="11" r="1.6" fill="#ffb347"/><circle cx="14.4" cy="15" r="1.9" fill="#ffb347"/><circle cx="14" cy="8" r="1.1" fill="#ffb347"/>`,
  boom: `<path d="m12 2 2.2 5.3 5.6-2.1-2.6 5.3 5 2.9-5.7 1 .9 5.8-5.4-3.1-3.6 4.8-.9-5.9-5.9.3 4.1-4.3L2.1 7.6l5.9.4z" fill="#ff6a1f" ${S}/><path d="m12 7.5 1.2 2.9 3-.9-1.5 2.8 2.6 1.6-3 .5.5 3-2.8-1.6-2 2.4-.5-3-3 .2 2.1-2.3-2.4-2 3 .2z" fill="#ffd23f"/>`,
}

const cache = new Map()

/** An icon's SVG markup, sized to the surrounding text (1em). */
export function icon(name) {
  if (!cache.has(name)) {
    const body = PATHS[name] || ''
    cache.set(name, `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`)
  }
  return cache.get(name)
}

export const ICON_NAMES = Object.keys(PATHS)
