// Every number the game plays by, in one place. Pure: no page, no platform.
// Headings are radians with y pointing down: 0 is east, PI/2 south, -PI/2 north. A right turn adds to the heading.

export const T = 120; // a tile, in world px
export const DT = 1 / 60; // the fixed simulation step

export const DIRS = 4; // 0 north, 1 east, 2 south, 3 west (a right turn is +1)
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];
export const DIR_HEADING = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];

export const DEG = Math.PI / 180;

export const VAN = {
  len: 48,
  wid: 28,
  r: 13, // collision circles along its length
  offs: [-15, 0, 15],
};

export const DRIVE = {
  straight: 260,
  turning: 170,
  grass: 0.8, // speed factor on park grass
  iceStraight: 240,
  accLow: 420, // px/s² below the turning speed
  accHigh: 150, // px/s² from turning speed to full
  decTurn: 450, // px/s² while turning, down to the turning speed
  decOver: 300, // px/s² when over the target for any other reason
  decFollow: 700, // px/s² tucking in behind a car
  followGap: 46, // px of gap at which the van starts following a car ahead
  yaw: 150 * DEG, // rad/s while held
  yawRamp: 0.06, // s to reach full yaw
  // Heading snap: released near a road's direction, the van eases onto it.
  snapBack: 22 * DEG, // window back toward a road the van just turned onto and slightly past
  snapForward: 32 * DEG, // window ahead, after a held turn of at least `snapHeld`
  snapTap: 20 * DEG, // window either way after a short tap (feathering)
  snapHeld: 45 * DEG, // a hold that turned at least this far was a real turn
  snapRate: 170 * DEG, // rad/s at most
  snapEase: 9, // 1/s: rate = min(snapRate, |error| * snapEase)
  // Loop zones (roundabouts and cul-de-sac bulbs): holding orbits the zone's centre.
  loopSpeed: 115,
  loopRadius: 30, // the same as the traffic lane: in on the left lane, round, out on the left lane
  loopYawMax: 260 * DEG,
  // Walls
  crashAngle: 40 * DEG,
  crashSpeed: 110,
  carCrash: 150, // a car has to hit (or be hit) harder than a wall to stall the van
  stallWall: 0.7,
  stallCar: 0.5,
  bounceWall: 18,
  bounceCar: 14,
  scrapeDecay: 0.6, // fraction of speed kept per second while scraping
  scrapeTurn: 110 * DEG, // rad/s the heading eases toward the wall's line while scraping
  softKeep: 0.55, // speed kept on hitting a soft wall (hedge, snowbank)
  // Weather
  iceGrip: 170 * DEG, // rad/s the slide direction follows the heading in snow
  puddleSkid: 0.45, // s of no turning after a puddle
};

export const DELIVERY = {
  ring: 74, // ring radius round the drop point
  dropOff: 24, // the drop point is this far into the road from the kerb
  mat: 28, // closest pass for a doormat
  matSpeed: 210, // and at most this fast
  matBonus: 2, // seconds off in solo
  perLoad: 3,
  depotZone: 56, // half-size of the depot's load box
};

export const LOOP = {
  plaza: 84, // a mini-roundabout: the junction, with a painted dome in the middle
  bulb: 96, // a turning circle: a little rounder than the tile
  carRing: 30, // cars circle the painted dome at this radius
};

export const TRAFFIC = {
  step: 1 / 30,
  lane: 30, // lane centre from the road centre (traffic keeps left)
  gap: 58, // a car stops when something is this close in front
  cone: 0.62, // cos of the half-angle it looks in
  light: { green: 6, amber: 1.5, allRed: 0.5 }, // seconds; a cycle is 2 × the sum
  stopLine: 66, // distance from a junction's centre where cars wait
};

export const SCRAMBLE = {
  seats: 6,
  shifts: 3,
  shiftOptions: [120, 180],
  intro: 3,
  roundEnd: 7,
  results: 15,
  spawnClear: 480, // a new address is at least this far from every van
  lastCall: 20, // seconds left when the golden address appears
  goldPoints: 3,
  claimReach: 150, // host's check: the sender was this close to the ring
};

export const openAddresses = (seats) => (seats <= 2 ? 3 : seats <= 4 ? 4 : 5);

export const STARS = { two: 1.3, three: 1.06 }; // within these multiples of the expert time

export const VAN_BODIES = [
  { id: 'box', name: 'Box Van', stars: 0 },
  { id: 'bread', name: 'Bread Van', stars: 6 },
  { id: 'pickup', name: 'Pickup', stars: 12 },
  { id: 'mail', name: 'Mail Truck', stars: 18 },
  { id: 'tuk', name: 'Tuk-tuk', stars: 24 },
  { id: 'icecream', name: 'Ice-Cream Van', stars: 30 },
  { id: 'gold', name: 'Golden Van', stars: 36 },
];

export const PALETTE = {
  asphalt: '#34383F',
  paint: '#F4F1E8',
  yellow: '#FFC22E',
  blue: '#1E5BC6',
  lawn: '#6FAE5B',
  red: '#D9573B',
  ink: '#141A22',
};

// Seat colours and symbols for the scramble (a colour always comes with a shape).
export const SEATS = [
  { color: '#FFC22E', symbol: 'circle' },
  { color: '#F0573C', symbol: 'triangle' },
  { color: '#3EA6F0', symbol: 'square' },
  { color: '#37C98A', symbol: 'diamond' },
  { color: '#A174F2', symbol: 'star' },
  { color: '#F4F1E8', symbol: 'hexagon' },
];

// Bots: a name, a style and a skill. Styles change how they drive, not what they may do.
export const BOTS = [
  { name: 'Rosa', style: 'careful', skill: 0.7 },
  { name: 'Dex', style: 'rusher', skill: 0.55 },
  { name: 'Mo', style: 'veteran', skill: 0.82 },
  { name: 'Juno', style: 'rookie', skill: 0.3 },
  { name: 'Pip', style: 'shortcut', skill: 0.6 },
  { name: 'Vik', style: 'steady', skill: 0.65 },
];

export const BADGES = ['first-drop', 'three-rights', 'doormat', 'roundabout-regular', 'rush-hour', 'twelve-towns', 'no-scratches', 'daily-driver', 'all-stars'];

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
/** The smallest signed angle from a to b. */
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export const wrapAngle = (a) => angleDiff(0, a);
/** The direction (0-3) nearest a heading. */
export const dirOf = (h) => ((Math.round((wrapAngle(h) + Math.PI / 2) / (Math.PI / 2)) % 4) + 4) % 4;
