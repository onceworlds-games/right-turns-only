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
    sun: { color: '#9DB4FF', intensity: 0.95, azimuth: 2.0, elevation: 1.0 },
    sky: '#4A5C9A',
    ground: '#23283E',
    hemi: 1.0,
    fog: '#161D42',
    fogNear: 80,
    fogFar: 320,
    night: 1,
    bloom: 1,
    exposure: 1.2,
    walls: ['#5A5677', '#626A88', '#76607A', '#56787A', '#7A7058', '#454E66', '#8A6A55'],
    leaf: ['#3A6A50', '#356048', '#43745A'],
    grade: { sat: 1.15, contrast: 1.08, lift: [0.0, 0.01, 0.04], gain: [1.02, 0.99, 1.05], vignette: 0.4 },
  },
  8: {
    sun: { color: '#FFEBCB', intensity: 2.9, azimuth: 2.4, elevation: 0.85 },
    sky: '#DCE3EA',
    ground: '#B59A74',
    fog: '#E6D3B4',
    fogNear: 120,
    fogFar: 380,
    trees: 'palm',
    leaf: ['#7F9A4E', '#8FA85A', '#6E8A44'],
    walls: ['#EFE6D2', '#E2CBA8', '#EDD7B8', '#D9BC96', '#F4EADA', '#C8643C', '#4F8FA8'],
    flowers: ['#E07A2F', '#D9A441', '#C8643C', '#F2D06B'],
    grade: { sat: 1.0, contrast: 1.06, lift: [0.0, 0.0, 0.02], gain: [1.02, 1.0, 0.97], vignette: 0.32 },
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
    sun: { color: '#FFB27A', intensity: 2.5, azimuth: 2.9, elevation: 0.42 },
    sky: '#E4BBA6',
    ground: '#5E5270',
    hemi: 1.0,
    fog: '#C99EA0',
    fogNear: 90,
    fogFar: 340,
    night: 0.3,
    bloom: 0.6,
    grade: { sat: 1.1, contrast: 1.06, lift: [0.01, 0.0, 0.03], gain: [1.06, 0.98, 0.96], vignette: 0.38 },
  },
};

/** The full style of a town (by id). */
export function styleFor(town) {
  const o = TOWN_STYLE[town.id] || {};
  const s = { ...BASE, ...o, sun: { ...BASE.sun, ...(o.sun || {}) }, grade: { ...BASE.grade, ...(o.grade || {}) } };
  s.palette = town.palette;
  return s;
}
