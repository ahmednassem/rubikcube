import * as THREE from "three";

const COLORS = {
  W: 0xffffff,
  Y: 0xffd500,
  G: 0x00a651,
  B: 0x0051ba,
  R: 0xc41e3a,
  O: 0xff5800,
  K: 0x111111,
};

const CUBIE_SIZE = 0.95;
export const settings = { gap: 0.05, duration: 250 };
export let STEP = CUBIE_SIZE + settings.gap;

function faceColor(x, y, z) {
  return {
    right: x ===  1 ? COLORS.R : COLORS.K,
    left:  x === -1 ? COLORS.O : COLORS.K,
    up:    y ===  1 ? COLORS.W : COLORS.K,
    down:  y === -1 ? COLORS.Y : COLORS.K,
    front: z ===  1 ? COLORS.G : COLORS.K,
    back:  z === -1 ? COLORS.B : COLORS.K,
  };
}

function makeCubie(x, y, z) {
  const geometry = new THREE.BoxGeometry(CUBIE_SIZE, CUBIE_SIZE, CUBIE_SIZE);
  const c = faceColor(x, y, z);
  const materials = [
    new THREE.MeshStandardMaterial({ color: c.right }),
    new THREE.MeshStandardMaterial({ color: c.left }),
    new THREE.MeshStandardMaterial({ color: c.up }),
    new THREE.MeshStandardMaterial({ color: c.down }),
    new THREE.MeshStandardMaterial({ color: c.front }),
    new THREE.MeshStandardMaterial({ color: c.back }),
  ];
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.position.set(x * STEP, y * STEP, z * STEP);
  mesh.userData.coords = { x, y, z };
  return mesh;
}

export function createCube() {
  const group = new THREE.Group();
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        group.add(makeCubie(x, y, z));
      }
    }
  }
  return group;
}

export function setGap(cube, newGap) {
  const oldStep = STEP;
  settings.gap = newGap;
  STEP = CUBIE_SIZE + newGap;
  for (const c of cube.children) {
    const cx = Math.round(c.position.x / oldStep);
    const cy = Math.round(c.position.y / oldStep);
    const cz = Math.round(c.position.z / oldStep);
    c.position.set(cx * STEP, cy * STEP, cz * STEP);
  }
}

export function setTransparent(cube, on) {
  for (const c of cube.children) {
    if (!Array.isArray(c.material)) continue;
    for (const m of c.material) {
      m.transparent = on;
      m.opacity = on ? 0.55 : 1;
      m.needsUpdate = true;
    }
  }
}

const LABEL_MAP = {
  "1,0,0":   { faceIdx: 0, letter: "R", color: COLORS.R },
  "-1,0,0":  { faceIdx: 1, letter: "L", color: COLORS.O },
  "0,1,0":   { faceIdx: 2, letter: "U", color: COLORS.W },
  "0,-1,0":  { faceIdx: 3, letter: "D", color: COLORS.Y },
  "0,0,1":   { faceIdx: 4, letter: "F", color: COLORS.G },
  "0,0,-1":  { faceIdx: 5, letter: "B", color: COLORS.B },
};

function makeLabelTexture(letter) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = "#000000";
  ctx.font = "bold 84px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(letter, 64, 68);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  return tex;
}

export function setLabels(cube, on) {
  for (const c of cube.children) {
    const { x, y, z } = c.userData.coords;
    const info = LABEL_MAP[`${x},${y},${z}`];
    if (!info) continue;
    const mat = c.material[info.faceIdx];
    if (on) {
      if (!c.userData.labelTex) c.userData.labelTex = makeLabelTexture(info.letter);
      mat.map = c.userData.labelTex;
    } else {
      mat.map = null;
    }
    mat.needsUpdate = true;
  }
}

const GHOST_OFFSET = 3;

function makeGhosts(cubie) {
  const { x, y, z } = cubie.userData.coords;
  const group = new THREE.Group();
  group.name = "ghosts";
  const spec = [
    { dir: [ 1, 0, 0], color: x ===  1 ? COLORS.R : null },
    { dir: [-1, 0, 0], color: x === -1 ? COLORS.O : null },
    { dir: [ 0, 1, 0], color: y ===  1 ? COLORS.W : null },
    { dir: [ 0,-1, 0], color: y === -1 ? COLORS.Y : null },
    { dir: [ 0, 0, 1], color: z ===  1 ? COLORS.G : null },
    { dir: [ 0, 0,-1], color: z === -1 ? COLORS.B : null },
  ];
  for (const { dir, color } of spec) {
    if (color === null) continue;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.85, 0.85),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
    );
    plane.position.set(dir[0] * GHOST_OFFSET, dir[1] * GHOST_OFFSET, dir[2] * GHOST_OFFSET);
    plane.lookAt(dir[0] * 10, dir[1] * 10, dir[2] * 10);
    plane.userData.normal = new THREE.Vector3(dir[0], dir[1], dir[2]);
    group.add(plane);
  }
  return group;
}

export function setShowHidden(cube, on) {
  for (const c of cube.children) {
    let g = c.getObjectByName("ghosts");
    if (on && !g) {
      g = makeGhosts(c);
      c.add(g);
    }
    if (g) g.visible = on;
  }
}

const _worldPos = new THREE.Vector3();
const _worldNormal = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _worldQuat = new THREE.Quaternion();

// Map face letter → material index on the cubie's BoxGeometry ([+X,-X,+Y,-Y,+Z,-Z])
const FACE_MAT_IDX = { R: 0, L: 1, U: 2, D: 3, F: 4, B: 5 };

// Kociemba face letter → color hex for that face's stickers
const FACE_HEX = {
  U: COLORS.W, R: COLORS.R, F: COLORS.G,
  D: COLORS.Y, L: COLORS.O, B: COLORS.B,
};

// Inverse of net.js FACE_LAYOUT: given face + (row, col), return cubie coords
const STATE_LAYOUT = {
  U: (r, c) => [c - 1,  1,    r - 1 ],
  L: (r, c) => [-1,     1-r,  c - 1 ],
  F: (r, c) => [c - 1,  1-r,  1     ],
  R: (r, c) => [ 1,     1-r,  1 - c ],
  B: (r, c) => [1 - c,  1-r, -1     ],
  D: (r, c) => [c - 1, -1,    1 - r ],
};

const SOLVED_STATE =
  "UUUUUUUUU" + "RRRRRRRRR" + "FFFFFFFFF" +
  "DDDDDDDDD" + "LLLLLLLLL" + "BBBBBBBBB";

export function resetCube(cube) {
  applyState(cube, SOLVED_STATE);
}

export function applyState(cube, kociemba) {
  // kociemba: 54 chars, order URFDLB, row-major, each char ∈ URFDLB
  // Reset every cubie to its solved pose and blacken all stickers
  for (const c of cube.children) {
    const { x, y, z } = c.userData.coords;
    c.position.set(x * STEP, y * STEP, z * STEP);
    c.quaternion.identity();
    if (!Array.isArray(c.material)) continue;
    for (const m of c.material) {
      m.color.setHex(COLORS.K);
      m.needsUpdate = true;
    }
  }
  // Paint outward stickers from the kociemba string
  const faces = ["U", "R", "F", "D", "L", "B"];
  const byCoord = new Map();
  for (const c of cube.children) {
    const { x, y, z } = c.userData.coords;
    byCoord.set(`${x},${y},${z}`, c);
  }
  for (let f = 0; f < 6; f++) {
    const face = faces[f];
    const matIdx = FACE_MAT_IDX[face];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const letter = kociemba[f * 9 + r * 3 + c];
        const hex = FACE_HEX[letter];
        if (hex === undefined) continue;
        const [cx, cy, cz] = STATE_LAYOUT[face](r, c);
        const cubie = byCoord.get(`${cx},${cy},${cz}`);
        if (!cubie) continue;
        cubie.material[matIdx].color.setHex(hex);
        cubie.material[matIdx].needsUpdate = true;
      }
    }
  }
}

export function updateHidden(cube, camera) {
  for (const c of cube.children) {
    const g = c.getObjectByName("ghosts");
    if (!g || !g.visible) continue;
    c.getWorldQuaternion(_worldQuat);
    for (const plane of g.children) {
      _worldNormal.copy(plane.userData.normal).applyQuaternion(_worldQuat);
      plane.getWorldPosition(_worldPos);
      _toCam.subVectors(camera.position, _worldPos).normalize();
      plane.visible = _worldNormal.dot(_toCam) < 0;
    }
  }
}
