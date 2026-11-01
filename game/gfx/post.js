// After the scene: a miniature's tilt-shift (sharp band through the middle, soft above and below), bloom for lamps,
// neon and gold, a tone curve that keeps toy colours bright, each town's grade and a vignette.

import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const DOWN = /* glsl */ `
uniform sampler2D tMap;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tMap, vUv + uTexel * vec2(-0.5, -0.5)).rgb;
  c += texture2D(tMap, vUv + uTexel * vec2(0.5, -0.5)).rgb;
  c += texture2D(tMap, vUv + uTexel * vec2(-0.5, 0.5)).rgb;
  c += texture2D(tMap, vUv + uTexel * vec2(0.5, 0.5)).rgb;
  gl_FragColor = vec4(c * 0.25, 1.0);
}
`;

const BRIGHT = /* glsl */ `
uniform sampler2D tMap;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tMap, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(uThreshold, uThreshold + 0.6, l);
  gl_FragColor = vec4(min(c * k, vec3(24.0)), 1.0);
}
`;

const BLUR = /* glsl */ `
uniform sampler2D tMap;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tMap, vUv).rgb * 0.2270270270;
  c += texture2D(tMap, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tMap, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tMap, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(tMap, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}
`;

const FINAL = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBlur;
uniform sampler2D tBloomA;
uniform sampler2D tBloomB;
uniform float uTilt;
uniform float uFocus;
uniform float uBand;
uniform float uBloom;
uniform float uExposure;
uniform float uSat;
uniform float uContrast;
uniform float uVignette;
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uFade; // 0 normal .. 1 dimmed and grey (paused)
uniform vec3 uFlash; // a full-screen flash colour (added), for hits
uniform float uTime;
varying vec2 vUv;

vec3 neutral(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec3 sharp = texture2D(tScene, vUv).rgb;
  vec3 soft = texture2D(tBlur, vUv).rgb;
  float d = abs(vUv.y - uFocus);
  float m = smoothstep(uBand, uBand + 0.32, d) * uTilt;
  vec3 c = mix(sharp, soft, m);
  c += (texture2D(tBloomA, vUv).rgb * 0.6 + texture2D(tBloomB, vUv).rgb * 0.9) * uBloom;
  c *= uExposure;
  c = neutral(max(c, vec3(0.0)));
  c = toSRGB(clamp(c, 0.0, 1.0));
  // Grade: lift and gain, contrast round the middle, saturation.
  c = uLift + c * (uGain - uLift);
  c = (c - 0.5) * uContrast + 0.5;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, uSat);
  c = mix(c, vec3(luma * 0.55 + 0.04), uFade);
  vec2 v = vUv - 0.5;
  c *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(v, v) * 2.2);
  c += uFlash;
  c += (hash(vUv * 731.0 + uTime) - 0.5) / 255.0;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

export function createPost(renderer) {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const quad = new THREE.Mesh(geo);
  quad.frustumCulled = false;
  scene.add(quad);
  const mat = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false });
  const down = mat(DOWN, { tMap: { value: null }, uTexel: { value: new THREE.Vector2() } });
  const bright = mat(BRIGHT, { tMap: { value: null }, uThreshold: { value: 1.0 } });
  const blur = mat(BLUR, { tMap: { value: null }, uDir: { value: new THREE.Vector2() } });
  const final = mat(FINAL, {
    tScene: { value: null },
    tBlur: { value: null },
    tBloomA: { value: null },
    tBloomB: { value: null },
    uTilt: { value: 1 },
    uFocus: { value: 0.48 },
    uBand: { value: 0.16 },
    uBloom: { value: 0.3 },
    uExposure: { value: 1 },
    uSat: { value: 1.1 },
    uContrast: { value: 1.05 },
    uVignette: { value: 0.3 },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uFade: { value: 0 },
    uFlash: { value: new THREE.Vector3(0, 0, 0) },
    uTime: { value: 0 },
  });
  const rt = (w, h, samples = 0) => new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), { type: THREE.HalfFloatType, samples, depthBuffer: samples >= 0, colorSpace: THREE.LinearSRGBColorSpace });
  const post = {
    final,
    targets: null,
    w: 0,
    h: 0,
    samples: 4,
  };

  post.resize = (w, h, samples) => {
    if (post.targets && post.w === w && post.h === h && post.samples === samples) return;
    if (post.targets) for (const t of Object.values(post.targets)) t.dispose();
    post.w = w;
    post.h = h;
    post.samples = samples;
    const hw = Math.ceil(w / 2);
    const hh = Math.ceil(h / 2);
    post.targets = {
      scene: rt(w, h, samples),
      halfA: rt(hw, hh),
      halfB: rt(hw, hh),
      qA: rt(Math.ceil(hw / 2), Math.ceil(hh / 2)),
      qB: rt(Math.ceil(hw / 2), Math.ceil(hh / 2)),
      eA: rt(Math.ceil(hw / 4), Math.ceil(hh / 4)),
      eB: rt(Math.ceil(hw / 4), Math.ceil(hh / 4)),
    };
    for (const t of Object.values(post.targets)) {
      t.texture.minFilter = THREE.LinearFilter;
      t.texture.magFilter = THREE.LinearFilter;
      t.texture.generateMipmaps = false;
    }
  };

  const pass = (material, target) => {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(scene, cam);
  };

  /**
   * Build one of the chain's shader programs not built yet (see the renderer's warm-up): true when one was, false when all are.
   * `done` holds what is built.
   */
  post.warmOne = (done) => {
    for (const [m, toScreen] of [[down, false], [bright, false], [blur, false], [final, true]]) {
      const key = `post${m.id}.${m.version}`;
      if (done.has(key)) continue;
      done.add(key);
      quad.material = m;
      renderer.setRenderTarget(toScreen ? null : post.targets.halfA);
      for (const mat of renderer.compile(scene, cam)) {
        const program = renderer.properties.get(mat).currentProgram;
        if (program) program.getUniforms();
      }
      return true;
    }
    return false;
  };

  /** Render `world` with `camera` through the chain to the screen. o: { tilt, bloom, threshold } */
  post.render = (world, camera, o) => {
    const T = post.targets;
    renderer.setRenderTarget(T.scene);
    renderer.render(world, camera);
    // Half resolution copy, then the tilt-shift blur on it.
    down.uniforms.tMap.value = T.scene.texture;
    down.uniforms.uTexel.value.set(1 / post.w, 1 / post.h);
    pass(down, T.halfA);
    const hw = T.halfA.width;
    const hh = T.halfA.height;
    const r = o.blurRadius || 1.6;
    blur.uniforms.tMap.value = T.halfA.texture;
    blur.uniforms.uDir.value.set(r / hw, 0);
    pass(blur, T.halfB);
    blur.uniforms.tMap.value = T.halfB.texture;
    blur.uniforms.uDir.value.set(0, r / hh);
    pass(blur, T.halfA);
    blur.uniforms.tMap.value = T.halfA.texture;
    blur.uniforms.uDir.value.set(r * 1.8 / hw, 0);
    pass(blur, T.halfB);
    blur.uniforms.tMap.value = T.halfB.texture;
    blur.uniforms.uDir.value.set(0, r * 1.8 / hh);
    pass(blur, T.halfA);
    // Bloom from the bright parts at a quarter and an eighth.
    bright.uniforms.tMap.value = T.scene.texture;
    bright.uniforms.uThreshold.value = o.threshold ?? 1.0;
    pass(bright, T.qA);
    for (let i = 0; i < 2; i++) {
      blur.uniforms.tMap.value = T.qA.texture;
      blur.uniforms.uDir.value.set(1.2 / T.qA.width, 0);
      pass(blur, T.qB);
      blur.uniforms.tMap.value = T.qB.texture;
      blur.uniforms.uDir.value.set(0, 1.2 / T.qA.height);
      pass(blur, T.qA);
    }
    down.uniforms.tMap.value = T.qA.texture;
    down.uniforms.uTexel.value.set(1 / T.qA.width, 1 / T.qA.height);
    pass(down, T.eA);
    for (let i = 0; i < 2; i++) {
      blur.uniforms.tMap.value = T.eA.texture;
      blur.uniforms.uDir.value.set(1.4 / T.eA.width, 0);
      pass(blur, T.eB);
      blur.uniforms.tMap.value = T.eB.texture;
      blur.uniforms.uDir.value.set(0, 1.4 / T.eA.height);
      pass(blur, T.eA);
    }
    final.uniforms.tScene.value = T.scene.texture;
    final.uniforms.tBlur.value = T.halfA.texture;
    final.uniforms.tBloomA.value = T.qA.texture;
    final.uniforms.tBloomB.value = T.eA.texture;
    pass(final, null);
  };

  return post;
}
