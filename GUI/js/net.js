import * as THREE from "three";
import { STEP } from "./cube.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const LOCAL_NORMALS = [
  new THREE.Vector3( 1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3( 0, 1, 0),
  new THREE.Vector3( 0,-1, 0),
  new THREE.Vector3( 0, 0, 1),
  new THREE.Vector3( 0, 0,-1),
];

const GAP = 0.5;
const FACE_LAYOUT = {
  U: { offR: 0,           offC: 3 + GAP,     rowOf: (x,y,z) => z + 1, colOf: (x,y,z) => x + 1 },
  L: { offR: 3 + GAP,     offC: 0,           rowOf: (x,y,z) => 1 - y, colOf: (x,y,z) => z + 1 },
  F: { offR: 3 + GAP,     offC: 3 + GAP,     rowOf: (x,y,z) => 1 - y, colOf: (x,y,z) => x + 1 },
  R: { offR: 3 + GAP,     offC: 6 + 2*GAP,   rowOf: (x,y,z) => 1 - y, colOf: (x,y,z) => 1 - z },
  B: { offR: 3 + GAP,     offC: 9 + 3*GAP,   rowOf: (x,y,z) => 1 - y, colOf: (x,y,z) => 1 - x },
  D: { offR: 6 + 2*GAP,   offC: 3 + GAP,     rowOf: (x,y,z) => 1 - z, colOf: (x,y,z) => x + 1 },
};

export function initNet(container, cube) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${12 + 3*GAP} ${9 + 2*GAP}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.classList.add("net-svg");

  const rects = {};
  for (const [face, info] of Object.entries(FACE_LAYOUT)) {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("x", info.offC + c + 0.06);
        rect.setAttribute("y", info.offR + r + 0.06);
        rect.setAttribute("width", 0.88);
        rect.setAttribute("height", 0.88);
        rect.setAttribute("rx", 0.12);
        rect.setAttribute("fill", "#222");
        svg.appendChild(rect);
        rects[`${face},${r},${c}`] = rect;
      }
    }
  }
  container.appendChild(svg);

  const quat = new THREE.Quaternion();
  const n = new THREE.Vector3();
  const last = {};

  return function update() {
    if (cube.children.length < 27) return;

    const desired = {};
    for (const c of cube.children) {
      const cx = Math.round(c.position.x / STEP);
      const cy = Math.round(c.position.y / STEP);
      const cz = Math.round(c.position.z / STEP);
      if (cx === 0 && cy === 0 && cz === 0) continue;
      c.getWorldQuaternion(quat);

      for (let i = 0; i < 6; i++) {
        n.copy(LOCAL_NORMALS[i]).applyQuaternion(quat);
        const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
        let face;
        if (ax > ay && ax > az) face = n.x > 0 ? "R" : "L";
        else if (ay > az) face = n.y > 0 ? "U" : "D";
        else face = n.z > 0 ? "F" : "B";

        const onFace =
          (face === "U" && cy === 1) || (face === "D" && cy === -1) ||
          (face === "F" && cz === 1) || (face === "B" && cz === -1) ||
          (face === "R" && cx === 1) || (face === "L" && cx === -1);
        if (!onFace) continue;

        const hex = c.material[i].color.getHexString();
        if (hex === "111111") continue;

        const layout = FACE_LAYOUT[face];
        const r = layout.rowOf(cx, cy, cz);
        const col = layout.colOf(cx, cy, cz);
        desired[`${face},${r},${col}`] = "#" + hex;
      }
    }

    for (const key in rects) {
      const color = desired[key] || "#222";
      if (last[key] !== color) {
        rects[key].setAttribute("fill", color);
        last[key] = color;
      }
    }
  };
}
