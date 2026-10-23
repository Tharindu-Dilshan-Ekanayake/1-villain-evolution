import { renderEffects, renderLoops, transferables } from './synth'

/**
 * Renders all game audio off the main thread. Effects are posted first so they are
 * ready as soon as possible; the longer music and ambience loops follow.
 */
self.onmessage = () => {
  const effects = renderEffects()
  self.postMessage({ kind: 'effects', set: effects }, transferables(effects))
  const loops = renderLoops()
  self.postMessage({ kind: 'loops', set: loops }, transferables(loops))
}
