import * as THREE from "three";
import { STEP, settings } from "./cube.js";

const AXIS = {
  X: new THREE.Vector3(1, 0, 0),
  Y: new THREE.Vector3(0, 1, 0),
  Z: new THREE.Vector3(0, 0, 1),
};

const MOVE_RE = /[UDLRFBudlrfbMESXYZ](?:'|2)?/g;

export function tokenizeMoves(raw) {
  const stripped = raw.replace(/\s+/g, "");
  if (!stripped) return { moves: [], valid: true };
  const moves = stripped.match(MOVE_RE) || [];
  return { moves, valid: moves.join("") === stripped };
}

export function invertMove(m) {
  if (m.endsWith("2")) return m;
  if (m.endsWith("'")) return m.slice(0, -1);
  return m + "'";
}

// For each move: [axis, layerFilter(coords), signOfBaseAngle]
// Base angle is -π/2 for CW-from-outside faces (U, R, F) and +π/2 for opposite (D, L, B).
const MOVES = {
  U: ["Y", c => c.y ===  1, -1],
  D: ["Y", c => c.y === -1, +1],
  R: ["X", c => c.x ===  1, -1],
  L: ["X", c => c.x === -1, +1],
  F: ["Z", c => c.z ===  1, -1],
  B: ["Z", c => c.z === -1, +1],

  u: ["Y", c => c.y >=  0, -1],
  d: ["Y", c => c.y <=  0, +1],
  r: ["X", c => c.x >=  0, -1],
  l: ["X", c => c.x <=  0, +1],
  f: ["Z", c => c.z >=  0, -1],
  b: ["Z", c => c.z <=  0, +1],

  M: ["X", c => c.x === 0, +1],
  E: ["Y", c => c.y === 0, +1],
  S: ["Z", c => c.z === 0, -1],

  X: ["X", _ => true, -1],
  Y: ["Y", _ => true, -1],
  Z: ["Z", _ => true, -1],
};

function parseMove(m) {
  const name = m[0];
  const mod = m.slice(1);
  const def = MOVES[name];
  if (!def) throw new Error(`Unknown move: ${m}`);
  const [axisKey, layerFn, sign] = def;
  let turns = 1;
  if (mod === "'") turns = -1;
  else if (mod === "2") turns = 2;
  else if (mod !== "") throw new Error(`Bad modifier in: ${m}`);
  return { axis: AXIS[axisKey], layerFn, angle: (Math.PI / 2) * sign * turns };
}

function coords(cubie) {
  return {
    x: Math.round(cubie.position.x / STEP),
    y: Math.round(cubie.position.y / STEP),
    z: Math.round(cubie.position.z / STEP),
  };
}

const queue = [];
let running = false;

export function applyMove(cube, scene, moveStr, duration = settings.duration) {
  return new Promise(resolve => {
    queue.push({ cube, scene, moveStr, duration, resolve });
    if (!running) next();
  });
}

export async function applyMoves(cube, scene, list, duration = settings.duration) {
  for (const m of list) await applyMove(cube, scene, m, duration);
}

function next() {
  const job = queue.shift();
  if (!job) { running = false; return; }
  running = true;
  run(job).then(() => { job.resolve(); next(); });
}

function run({ cube, scene, moveStr, duration }) {
  return new Promise(resolve => {
    const { axis, layerFn, angle } = parseMove(moveStr);
    const selected = cube.children.filter(c => layerFn(coords(c)));

    const pivot = new THREE.Group();
    scene.add(pivot);
    for (const c of selected) pivot.attach(c);

    const start = performance.now();
    function tick() {
      const t = Math.min(1, (performance.now() - start) / duration);
      const eased = 0.5 - Math.cos(Math.PI * t) / 2;
      pivot.setRotationFromAxisAngle(axis, angle * eased);

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        for (const c of [...pivot.children]) cube.attach(c);
        for (const c of selected) {
          c.position.x = Math.round(c.position.x / STEP) * STEP;
          c.position.y = Math.round(c.position.y / STEP) * STEP;
          c.position.z = Math.round(c.position.z / STEP) * STEP;
        }
        scene.remove(pivot);
        resolve();
      }
    }
    requestAnimationFrame(tick);
  });
}
