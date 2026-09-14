import * as THREE from "three";
import { STEP } from "./cube.js";

const FACE_MAP = {
  X: { "1": "R", "-1": "L", "0": "M" },
  Y: { "1": "U", "-1": "D", "0": "E" },
  Z: { "1": "F", "-1": "B", "0": "S" },
};
const BASE_SIGN = { R:-1, L:+1, U:-1, D:+1, F:-1, B:+1, M:+1, E:+1, S:-1 };

function resolveMove(axisIdx, layer, angleSign) {
  const name = FACE_MAP[["X","Y","Z"][axisIdx]][String(layer)];
  return angleSign === BASE_SIGN[name] ? name : name + "'";
}

export function initDrag({ canvas, camera, cube, scene, controls, onMove, canMove = () => true, isRobotMode = () => false }) {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let drag = null;

  function setNdc(e) {
    const r = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  function pick(e) {
    setNdc(e);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(cube.children, false);
    if (!hits.length) return null;
    const hit = hits[0];
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const abs = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)];
    const i = abs.indexOf(Math.max(...abs));
    const snapped = new THREE.Vector3();
    snapped.setComponent(i, Math.sign(normal.getComponent(i)));
    return { cubie: hit.object, normal: snapped, normalIdx: i };
  }

  function coord(cubie, idx) {
    return Math.round(cubie.position.getComponent(idx) / STEP);
  }

  function screenDir(worldVec) {
    const o = new THREE.Vector3(0, 0, 0).project(camera);
    const t = worldVec.clone().project(camera);
    return new THREE.Vector2(t.x - o.x, -(t.y - o.y));
  }

  function chooseAxis(face, dragPx) {
    const tangents = [];
    for (let i = 0; i < 3; i++) {
      if (i === face.normalIdx) continue;
      const w = new THREE.Vector3(); w.setComponent(i, 1);
      tangents.push({ idx: i, world: w, screen: screenDir(w) });
    }
    let best = null, bestDot = 0;
    for (const t of tangents) {
      const d = t.screen.x * dragPx.x + t.screen.y * dragPx.y;
      if (Math.abs(d) > Math.abs(bestDot)) { best = t; bestDot = d; }
    }
    const rot = new THREE.Vector3().crossVectors(face.normal, best.world);
    const rotIdx = [0,1,2].find(i => Math.abs(rot.getComponent(i)) > 0.5);
    const rotSign = Math.sign(rot.getComponent(rotIdx));
    return { tangent: best, rotIdx, rotSign };
  }

  function onDown(e) {
    if (e.target !== canvas || e.button !== 0) return;
    const face = pick(e);
    if (!face) return;
    e.stopPropagation();
    controls.enabled = false;
    drag = { face, startX: e.clientX, startY: e.clientY, started: false, angle: 0 };
  }

  function onMove_(e) {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const px = new THREE.Vector2(dx, dy);

    if (!drag.started) {
      if (px.length() < 6) return;
      const info = chooseAxis(drag.face, px);
      const axis = new THREE.Vector3(); axis.setComponent(info.rotIdx, 1);
      const layer = coord(drag.face.cubie, info.rotIdx);
      const faceName = FACE_MAP[["X","Y","Z"][info.rotIdx]][String(layer)];
      if (!canMove(faceName)) {
        controls.enabled = true;
        drag = null;
        return;
      }
      const pivot = new THREE.Group();
      scene.add(pivot);
      const selected = cube.children.filter(c => coord(c, info.rotIdx) === layer);
      for (const c of selected) pivot.attach(c);
      Object.assign(drag, { info, axis, layer, pivot, selected, started: true });
    }

    const t = drag.info.tangent.screen;
    const tLen = Math.max(t.length(), 0.0001);
    const proj = (px.x * t.x + px.y * t.y) / tLen;
    drag.angle = (proj / 140) * (Math.PI / 2) * drag.info.rotSign;
    drag.pivot.setRotationFromAxisAngle(drag.axis, drag.angle);
  }

  function onUp() {
    if (!drag) return;
    if (!drag.started) { controls.enabled = true; drag = null; return; }
    const commit = Math.abs(drag.angle) >= Math.PI / 4;
    const angleSign = Math.sign(drag.angle);
    const startAngle = drag.angle;
    const { axis, pivot, selected, info, layer } = drag;
    drag = null;

    function release() {
      for (const c of [...pivot.children]) cube.attach(c);
      for (const c of selected) {
        c.position.x = Math.round(c.position.x / STEP) * STEP;
        c.position.y = Math.round(c.position.y / STEP) * STEP;
        c.position.z = Math.round(c.position.z / STEP) * STEP;
      }
      scene.remove(pivot);
      controls.enabled = true;
    }

    if (commit) {
      if (isRobotMode()) {
        // Robot mode: snap the preview back to 0 and let syn drive the real
        // animation :  the GUI stays behind-or-at the physical robot.
        pivot.setRotationFromAxisAngle(axis, 0);
        release();
        onMove(resolveMove(info.rotIdx, layer, angleSign));
      } else {
        // Normal mode: no robot to sync with, so just complete the gesture
        // locally (animate to ±90°) and tell the backend it was a local
        // drag. The backend only syncs its matrix :  no re-animation.
        const endAngle = angleSign * Math.PI / 2;
        const t0 = performance.now();
        const dur = 140;
        (function tick() {
          const t = Math.min(1, (performance.now() - t0) / dur);
          const eased = 0.5 - Math.cos(Math.PI * t) / 2;
          pivot.setRotationFromAxisAngle(axis, startAngle + (endAngle - startAngle) * eased);
          if (t < 1) { requestAnimationFrame(tick); return; }
          release();
          onMove(resolveMove(info.rotIdx, layer, angleSign), { local: true });
        })();
      }
    } else {
      // Below threshold :  just cancel the preview tween back to 0.
      const t0 = performance.now();
      const dur = 140;
      (function tick() {
        const t = Math.min(1, (performance.now() - t0) / dur);
        const eased = 0.5 - Math.cos(Math.PI * t) / 2;
        pivot.setRotationFromAxisAngle(axis, startAngle * (1 - eased));
        if (t < 1) { requestAnimationFrame(tick); return; }
        release();
      })();
    }
  }

  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointermove", onMove_);
  window.addEventListener("pointerup", onUp);
}
