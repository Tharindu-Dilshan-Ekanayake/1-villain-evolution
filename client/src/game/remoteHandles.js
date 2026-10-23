/**
 * Other players' per-frame handles, by session id: smoothed position, facing,
 * visibility and equipped pets. Written by RemotePlayers' frame loop, read by the
 * pets renderer.
 */
export const remoteHandles = new Map()
