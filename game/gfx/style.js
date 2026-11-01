// How each town looks and is lit: the sun, the sky light, fog, grading, walls, doors, trees and weather. Data only.

export const S = 0.1; // metres per world px (a tile, 120 px, is 12 m)

const BASE = {
  sun: { color: '#FFF1DC', intensity: 2.6, azimuth: 2.25, elevation: 0.95 }, // azimuth: radians from +x toward +z
  sky: '#BFD7F2',
  ground: '#6F7F5A',
  hemi: 1.05,
  fog: '#C8D8E6',
  fogNear: 140,
  fogFar: 420,
  exposure: 1.0,
  grade: { sat: 1.12, contrast: 1.06, lift: [0.0, 0.0, 0.02], gain: [1.03, 1.0, 0.96], vignette: 0.32 },
  walls: ['#F1E8D8', '#E8DCC6', '#DCE6E8', '#E9D3C4', '#D7E1CF', '#F4EFE6', '#C8775E'],
  doors: ['#2F5D8C', '#B8442F', '#2F6E4F', '#E0A13A', '#5B3F73', '#24323F'],
  trim: '#F7F3EA',
  trees: 'round', // round | pine | palm | snowpine | cactus
  leaf: ['#5E9B4C', '#6FAE55', '#4F8C44', '#7DB860'],
  flowers: ['#F2B544', '#E98FA4', '#F4F1E8', '#D9573B', '#A983E0'],
  night: 0,
  wet: 0,
  snow: 0,
  bloom: 0,
};

const TOWN_STYLE = {
  0: {},
  1: { sun: { color: '#FFEFD6', intensity: 2.7, azimuth: 2.3, elevation: 0.9 } },
  2: { leaf: ['#4E9A44', '#62AE4E', '#3F8A3C', '#7CBF5A'], sun: { color: '#FFF6E6', intensity: 2.8, azimuth: 2.0, elevation: 1.05 } },
  3: { sun: { color: '#FFD9A6', intensity: 2.6, azimuth: 2.6, elevation: 0.7 }, grade: { sat: 1.15, contrast: 1.07, lift: [0.01, 0.0, 0.02], gain: [1.06, 0.99, 0.92], vignette: 0.34 } },
  4: {
    sky: '#C9D6E6',
    fog: '#C9D2DC',
    walls: ['#C9C3B8', '#B9B2A6', '#D6CFC3', '#A9B4BF', '#C4A88E', '#9AA3AD', '#B5776A'],
    grade: { sat: 1.02, contrast: 1.08, lift: [0.0, 0.01, 0.03], gain: [1.0, 1.0, 1.0], vignette: 0.36 },
  },
  5: { sky: '#B9DCF5', fog: '#CFE4F2', walls: ['#F4F1E8', '#DCE9F2', '#F2E3C9', '#E7EEF0', '#F6E9DA', '#D8E3EA', '#2F6FA8'], doors: ['#2F6FA8', '#D9573B', '#F2B544', '#1E3D5C', '#5BA7A0', '#24323F'] },
  6: {
    sun: { color: '#EAF2FF', intensity: 1.7, azimuth: 2.2, elevation: 0.75 },
    sky: '#D7E4F0',
    ground: '#B8C4CF',
    hemi: 1.4,
    fog: '#DCE6EF',
    fogNear: 90,
    fogFar: 330,
    trees: 'snowpine',
    leaf: ['#3F6B57', '#4F7A62', '#36604E'],
    snow: 1,
    grade: { sat: 0.95, contrast: 1.04, lift: [0.0, 0.01, 0.04], gain: [0.98, 1.0, 1.05], vignette: 0.3 },
  },
  7: {
    sun: { color: '#8FA8FF', intensity: 0.42, azimuth: 2.0, elevation: 1.0 },
    sky: '#2A3566',
    ground: '#141826',
    hemi: 0.42,
    fog: '#0E1230',
    fogNear: 70,
    fogFar: 300,
    night: 1,
    bloom: 1,
    exposure: 1.05,
    walls: ['#3E3A55', '#4A4F66', '#5A4658', '#3F5A5A', '#56503F', '#2E3446', '#6B4F3F'],
    leaf: ['#2E5440', '#2A4A3A', '#35604A'],
    grade: { sat: 1.18, contrast: 1.1, lift: [0.0, 0.0, 0.03], gain: [1.0, 0.98, 1.06], vignette: 0.45 },
  },
  8: {
    sun: { color: '#FFE0B0', intensity: 3.0, azimuth: 2.4, elevation: 0.85 },
    sky: '#E8D2A8',
    ground: '#C9A877',
    fog: '#E2C79A',
    fogNear: 120,
    fogFar: 380,
    trees: 'palm',
    leaf: ['#7F9A4E', '#8FA85A', '#6E8A44'],
    walls: ['#E8DCC0', '#D9B98E', '#E9C9A0', '#CFA77A', '#F0E2C8', '#C8643C', '#B9874E'],
    flowers: ['#E07A2F', '#D9A441', '#C8643C', '#F2D06B'],
    grade: { sat: 1.08, contrast: 1.07, lift: [0.02, 0.01, 0.0], gain: [1.06, 1.0, 0.9], vignette: 0.34 },
  },
  9: {
    sun: { color: '#D8E2EC', intensity: 1.05, azimuth: 2.2, elevation: 1.1 },
    sky: '#9AA8B6',
    ground: '#4A5058',
    hemi: 1.25,
    fog: '#8D99A6',
    fogNear: 70,
    fogFar: 280,
    wet: 1,
    grade: { sat: 0.92, contrast: 1.08, lift: [0.0, 0.01, 0.03], gain: [0.97, 1.0, 1.04], vignette: 0.42 },
  },
  10: { sun: { color: '#FFE4BE', intensity: 2.4, azimuth: 2.5, elevation: 0.8 }, fog: '#D8D2C2', grade: { sat: 1.06, contrast: 1.06, lift: [0.01, 0.01, 0.0], gain: [1.04, 1.0, 0.94], vignette: 0.34 } },
  11: { sun: { color: '#FFD3A0', intensity: 2.3, azimuth: 2.7, elevation: 0.55 }, grade: { sat: 1.12, contrast: 1.07, lift: [0.01, 0.0, 0.02], gain: [1.07, 0.98, 0.9], vignette: 0.36 } },
  12: {
    sun: { color: '#FF9D6B', intensity: 1.6, azimuth: 2.9, elevation: 0.32 },
    sky: '#B9A0C8',
    ground: '#4E4560',
    hemi: 0.85,
    fog: '#A88AA8',
    fogNear: 80,
    fogFar: 330,
    night: 0.55,
    bloom: 0.7,
    grade: { sat: 1.12, contrast: 1.08, lift: [0.02, 0.0, 0.04], gain: [1.08, 0.95, 0.98], vignette: 0.42 },
  },
};

/** The full style of a town (by id). */
export function styleFor(town) {
  const o = TOWN_STYLE[town.id] || {};
  const s = { ...BASE, ...o, sun: { ...BASE.sun, ...(o.sun || {}) }, grade: { ...BASE.grade, ...(o.grade || {}) } };
  s.palette = town.palette;
  return s;
}
