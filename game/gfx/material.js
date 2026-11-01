// The town's materials: one standard material patched with surface patterns drawn in the shader (asphalt grain, roof
// tiles, brick, planks, paving, glass), street lamps and headlights at night (lit in the shader, no light objects), wind in
// the foliage and a wet look in the rain. Every patched material shares the same uniforms.

import * as THREE from 'three';

export const MAX_LAMPS = 20;

export const shared = {
  uTime: { value: 0 },
  uNight: { value: 0 }, // 0 day .. 1 night: windows and lamps glow
  uWet: { value: 0 },
  uSnow: { value: 0 },
  uLamps: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4(0, -999, 0, 1)) }, // view-space xyz, radius
  uLampCount: { value: 0 },
  uLampColor: { value: new THREE.Color(1.0, 0.72, 0.42) },
  uLampPower: { value: 0 },
  uHeadPos: { value: new THREE.Vector3(0, -999, 0) }, // view space
  uHeadDir: { value: new THREE.Vector3(0, 0, -1) },
  uHeadPower: { value: 0 },
  uWindowGlow: { value: new THREE.Color(1.0, 0.78, 0.45) },
  // The cutaway: town fragments nearer the camera than the van, over its spot on screen, dissolve so it is never hidden.
  uXray: { value: new THREE.Vector4(-9999, -9999, 0, 0) }, // screen px x, y (from the bottom), radius px, van view depth
};

const COMMON = /* glsl */ `
uniform float uTime;
uniform float uNight;
uniform float uWet;
uniform float uSnow;
uniform vec4 uLamps[${MAX_LAMPS}];
uniform int uLampCount;
uniform vec3 uLampColor;
uniform float uLampPower;
uniform vec3 uHeadPos;
uniform vec3 uHeadDir;
uniform float uHeadPower;
uniform vec3 uWindowGlow;
uniform vec4 uXray;
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(h12(i), h12(i + vec2(1., 0.)), u.x), mix(h12(i + vec2(0., 1.)), h12(i + vec2(1., 1.)), u.x), u.y); }
`;

const PATTERNS = /* glsl */ `
vec3 rtoPattern(vec3 col, vec2 uv, float s, float seed, inout float rough, inout vec3 glow) {
  if (s < 0.5) return col;
  if (s < 1.5) { // asphalt
    float n = vn(uv * 1.7) * 0.45 + vn(uv * 7.0) * 0.35 + h12(floor(uv * 38.0)) * 0.2;
    float patchy = smoothstep(0.62, 0.7, vn(uv * 0.35 + 7.0)) * 0.06;
    rough = mix(rough, 0.18, uWet * (0.55 + 0.45 * vn(uv * 0.6)));
    return col * (0.86 + n * 0.26 - patchy);
  }
  if (s < 2.5) { // grass
    float n = vn(uv * 0.7) * 0.55 + vn(uv * 3.1) * 0.3 + h12(floor(uv * 26.0)) * 0.15;
    vec3 c = col * (0.8 + n * 0.34);
    return mix(c, vec3(0.92, 0.95, 1.0), uSnow * smoothstep(0.25, 0.6, n));
  }
  if (s < 3.5) { // roof tiles: rows down the slope, staggered joints
    float row = floor(uv.y / 0.34);
    float fy = fract(uv.y / 0.34);
    float cx = uv.x / 0.42 + row * 0.5;
    float fx = fract(cx);
    float shadeRow = 0.74 + 0.26 * smoothstep(0.0, 0.16, fy);
    float joint = 0.9 + 0.1 * smoothstep(0.0, 0.05, fx) * smoothstep(1.0, 0.95, fx);
    float var = h12(vec2(floor(cx), row));
    vec3 c = col * shadeRow * joint * (0.92 + var * 0.16);
    return mix(c, vec3(0.93, 0.96, 1.0), uSnow * 0.85);
  }
  if (s < 4.5) { // brick
    float row = floor(uv.y / 0.16);
    float fy = fract(uv.y / 0.16);
    float cx = uv.x / 0.34 + row * 0.5;
    float fx = fract(cx);
    float mortar = smoothstep(0.0, 0.08, fy) * smoothstep(0.0, 0.04, fx);
    float var = h12(vec2(floor(cx), row));
    return mix(col * 1.25 + 0.06, col * (0.88 + var * 0.22), mortar);
  }
  if (s < 5.5) { // planks (horizontal siding)
    float fy = fract(uv.y / 0.22);
    float var = h12(vec2(floor(uv.y / 0.22), floor(uv.x / 2.3)));
    return col * (0.8 + 0.2 * smoothstep(0.0, 0.18, fy)) * (0.95 + var * 0.1);
  }
  if (s < 6.5) { // paving slabs
    vec2 f = fract(uv / 0.9);
    float joint = smoothstep(0.0, 0.04, f.x) * smoothstep(0.0, 0.04, f.y);
    float var = h12(floor(uv / 0.9));
    vec3 c = col * (0.86 + 0.14 * joint) * (0.95 + var * 0.1);
    return mix(c, vec3(0.9, 0.93, 0.97), uSnow * 0.6 * smoothstep(0.3, 0.7, vn(uv * 0.8)));
  }
  if (s < 7.5 || (s > 13.5 && s < 14.5)) { // glass: sky reflection by day, warm light at night in some windows
    float sky = 0.35 + 0.65 * smoothstep(0.0, 1.4, uv.y);
    float streak = smoothstep(0.08, 0.0, abs(fract((uv.x + uv.y * 0.6) * 0.8) - 0.3)) * 0.35;
    rough = 0.08;
    vec3 c = col * sky + streak * 0.25;
    if (s > 13.5) {
      float lit = step(0.38, h12(vec2(seed, floor(uv.x / 1.2) + floor(uv.y / 2.6) * 7.0)));
      glow += uWindowGlow * lit * uNight * (0.9 + 0.3 * h12(vec2(seed * 3.1, 1.0)));
      c = mix(c, c * 0.35, uNight * lit);
    }
    return c;
  }
  if (s < 8.5) { // corrugated metal
    float r = 0.85 + 0.15 * sin(uv.x * 26.0);
    rough = 0.45;
    return col * r;
  }
  if (s < 9.5) { // lamp / sign: lit
    glow += col * (0.35 + uNight * 2.2);
    return col;
  }
  if (s < 10.5) { // soil / sand
    float n = vn(uv * 2.2) * 0.6 + h12(floor(uv * 30.0)) * 0.4;
    return col * (0.85 + n * 0.25);
  }
  if (s < 11.5) { // shingle (flat roof gravel)
    float n = h12(floor(uv * 22.0)) * 0.6 + vn(uv * 3.0) * 0.4;
    return mix(col * (0.85 + n * 0.25), vec3(0.93, 0.96, 1.0), uSnow * 0.9);
  }
  if (s < 12.5) { // snow
    float n = vn(uv * 1.5);
    float sparkle = step(0.985, h12(floor(uv * 60.0)));
    glow += vec3(sparkle * 0.25);
    return col * (0.94 + n * 0.08);
  }
  if (s < 13.5) { // stucco
    float n = vn(uv * 6.0) * 0.5 + vn(uv * 1.2) * 0.5;
    return col * (0.93 + n * 0.1);
  }
  if (s < 15.5) { // a facade: a grid of windows on the wall (far buildings), lit at random at night
    vec2 cell = vec2(2.7, 3.2);
    vec2 f = fract(uv / cell);
    vec2 id = floor(uv / cell);
    float win = step(0.22, f.x) * step(f.x, 0.78) * step(0.3, f.y) * step(f.y, 0.82);
    float ledge = 1.0 - 0.18 * step(f.y, 0.06);
    float lit = step(0.5, h12(id + vec2(seed * 7.3, seed)));
    vec3 glass = vec3(0.13, 0.18, 0.25) * (0.75 + 0.7 * smoothstep(0.3, 0.82, f.y));
    glow += uWindowGlow * lit * uNight * win * 1.15;
    rough = mix(rough, 0.12, win);
    vec3 wall = col * (0.93 + 0.07 * vn(uv * 2.0)) * ledge;
    return mix(wall, mix(glass, glass * 0.4, uNight * lit), win);
  }
  if (s < 16.5) { // a puddle: dark and glassy, rippled in the rain
    rough = 0.04;
    float rip = uWet * 0.08 * sin(length(fract(uv * 0.5) - 0.5) * 40.0 - uTime * 6.0);
    return col * (0.9 + rip);
  }
  return col;
}
`;

const LIGHTS = /* glsl */ `
{
  vec3 P = -vViewPosition;
  vec3 lampSum = vec3(0.0);
  for (int i = 0; i < ${MAX_LAMPS}; i++) {
    if (i >= uLampCount) break;
    vec3 L = uLamps[i].xyz - P;
    float d = length(L);
    float a = clamp(1.0 - d / uLamps[i].w, 0.0, 1.0);
    a *= a;
    float ndl = clamp(dot(normal, L / max(d, 0.001)) * 0.7 + 0.3, 0.0, 1.0);
    lampSum += a * ndl;
  }
  vec3 add = lampSum * uLampColor * uLampPower;
  if (uHeadPower > 0.0) {
    vec3 L = P - uHeadPos;
    float d = length(L);
    vec3 dir = L / max(d, 0.001);
    float cone = smoothstep(0.80, 0.94, dot(dir, uHeadDir));
    float att = clamp(1.0 - d / 34.0, 0.0, 1.0);
    float ndl = clamp(dot(normal, -dir) * 0.7 + 0.3, 0.0, 1.0);
    add += vec3(1.0, 0.93, 0.78) * cone * att * att * ndl * uHeadPower * 2.2;
  }
  reflectedLight.directDiffuse += diffuseColor.rgb * add;
}
`;

// Dissolve (a 4×4 ordered dither) what stands between the camera and the van, over the van's spot on screen.
const XRAY = /* glsl */ `
if (uXray.z > 0.0 && vWorldY > 0.7) {
  float dpx = length(gl_FragCoord.xy - uXray.xy);
  float edge = smoothstep(uXray.z, uXray.z * 0.55, dpx);
  float nearer = smoothstep(uXray.w - 2.0, uXray.w - 6.0, -vViewPosition.z);
  float hide = edge * nearer * 0.82;
  if (hide > 0.0) {
    vec2 q = mod(floor(gl_FragCoord.xy), 4.0);
    int bx = int(q.x); int by = int(q.y);
    float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
    float thr = (m[by * 4 + bx] + 0.5) / 16.0;
    if (hide > thr) discard;
  }
}
`;

/**
 * Patch a standard material. opts: { patterns: true (vertex attributes surf/puv/seed), wind: false, lamps: true,
 * instanced: false }.
 */
export function patch(mat, opts = {}) {
  const patterns = opts.patterns !== false;
  const wind = !!opts.wind;
  const lamps = opts.lamps !== false;
  const xray = !!opts.xray;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
${COMMON}
${patterns ? 'attribute vec2 puv; attribute float surf; attribute float seed; varying vec2 vPuv; varying float vSurf; varying float vSeed;' : ''}
${xray ? 'varying float vWorldY;' : ''}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
${patterns ? 'vPuv = puv; vSurf = surf; vSeed = seed;' : ''}
${xray ? '{ vec4 xw = modelMatrix * vec4(transformed, 1.0); vWorldY = xw.y; }' : ''}
${
  wind
    ? `{ float hgt = max(0.0, transformed.y - 0.8);
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  float sway = sin(uTime * 1.6 + wp.x * 0.35 + wp.z * 0.21) + 0.5 * sin(uTime * 2.7 + wp.z * 0.5);
  transformed.x += sway * 0.035 * hgt;
  transformed.z += cos(uTime * 1.3 + wp.x * 0.27) * 0.025 * hgt; }`
    : ''
}`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${COMMON}
${patterns ? `varying vec2 vPuv; varying float vSurf; varying float vSeed;\n${PATTERNS}` : ''}
${xray ? 'varying float vWorldY;' : ''}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
${xray ? XRAY : ''}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec3 rtoGlow = vec3(0.0);
float rtoRough = -1.0;
${patterns ? '{ float rr = 0.86; diffuseColor.rgb = rtoPattern(diffuseColor.rgb, vPuv, vSurf, vSeed, rr, rtoGlow); if (rr != 0.86) rtoRough = rr; }' : ''}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
if (rtoRough >= 0.0) roughnessFactor = rtoRough;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += rtoGlow;`,
      )
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${lamps ? LIGHTS : ''}`);
  };
  mat.customProgramCacheKey = () => `rto:${patterns ? 1 : 0}${wind ? 1 : 0}${lamps ? 1 : 0}${xray ? 1 : 0}`;
  return mat;
}

/** The town's main material: vertex colours and patterns. */
export function townMaterial() {
  return patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.0 }), { xray: true });
}

/** Leaves: vertex colours, wind. */
export function foliageMaterial() {
  return patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.0 }), { wind: true, xray: true });
}

/** A plain coloured material that still takes the night lamps (vans, cars, props). */
export function litMaterial(params) {
  return patch(new THREE.MeshStandardMaterial(params), { patterns: false });
}
