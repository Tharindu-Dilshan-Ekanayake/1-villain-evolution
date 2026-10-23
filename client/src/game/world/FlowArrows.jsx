import { useEffect, useMemo } from 'react'
import { PlaneGeometry, ShaderMaterial } from 'three'

import { STAGE_END_Z } from '../layout'

/** Where the arrows run (z): from just past spawn, through the gate, to the end of the line. */
const Z_START = 34
const Z_END = STAGE_END_Z + 2
const WIDTH = 2.6
/** Metres between arrows. */
const SPACING = 3.2
/** Stud pitch of the template's floor texture (4 studs per 2 m tile). */
const STUD = 0.5
/** Just above the red path (0.015), under pads and plates. */
const Y = 0.022

const vertex = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const fragment = /* glsl */ `
  varying vec2 vPos;
  void main() {
    float across = abs(vPos.x) / ${(WIDTH / 2).toFixed(2)};
    // Chevrons pointing down the line (-Z), with crisp edges like inlaid tiles.
    float s = fract(vPos.y / ${SPACING.toFixed(1)} - across * 0.32);
    float arrow = smoothstep(0.0, 0.012, s) * (1.0 - smoothstep(0.188, 0.2, s));
    float edge = 1.0 - smoothstep(0.96, 1.0, across);
    float fadeIn = 1.0 - smoothstep(${(Z_START - 3).toFixed(1)}, ${Z_START.toFixed(1)}, vPos.y);
    float a = arrow * edge * fadeIn;
    if (a < 0.02) discard;
    // White floor studs, like the red path's: a soft ring round each one.
    vec2 cell = fract(vPos / ${STUD.toFixed(1)}) - 0.5;
    float d = length(cell);
    float ring = smoothstep(0.24, 0.29, d) * (1.0 - smoothstep(0.29, 0.36, d));
    float top = 1.0 - smoothstep(0.0, 0.26, length(cell + vec2(0.06, 0.06)));
    vec3 c = vec3(0.9) * (1.0 - ring * 0.16) + top * 0.04;
    gl_FragColor = vec4(c, a);
  }
`

/**
 * White arrows inlaid down the middle of the red path, from the lobby through the
 * STAGES gate and on down the stage line, so the way to go is never in doubt. They're
 * part of the floor - still, studded like the rest of it - not a moving overlay.
 * One long strip (2 triangles, one draw call); shown on every preset.
 */
export function FlowArrows() {
  const geometry = useMemo(() => {
    const g = new PlaneGeometry(WIDTH, Z_START - Z_END)
    g.rotateX(-Math.PI / 2)
    g.translate(0, Y, (Z_START + Z_END) / 2)
    return g
  }, [])
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
      }),
    [],
  )
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  return <mesh geometry={geometry} material={material} renderOrder={1} frustumCulled={false} />
}

export default FlowArrows
