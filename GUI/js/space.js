import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createCube, settings, setGap, setTransparent, setLabels, setShowHidden, updateHidden, resetCube } from "./cube.js";
import { applyMove, tokenizeMoves } from "./moves.js";
import { initDrag } from "./drag.js";
import { initNet } from "./net.js";
import { initStateEditor } from "./state-editor.js";
import { initMovePlayer } from "./move-player.js";

const canvas = document.getElementById("scene");
const container = canvas.parentElement;

// ── Theme (dark / light) ──────────────────────────────────────────────────
// The <html data-theme> attribute is set by an inline script in index.html
// before CSS paints; here we keep the 3D scene background and the toggle
// checkbox in sync with it.
function currentTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function sceneBgColor() {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--scene-bg").trim();
  return new THREE.Color(v || "#1a1a1a");
}

const scene = new THREE.Scene();
scene.background = sceneBgColor();

const camera = new THREE.PerspectiveCamera(
  50,
  container.clientWidth / container.clientHeight,
  0.1,
  100
);
camera.position.set(6, 5, 7);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(container.clientWidth, container.clientHeight, false);

const ambient = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambient);

const key = new THREE.DirectionalLight(0xffffff, 0.8);
key.position.set(5, 10, 7);
scene.add(key);

const fill = new THREE.DirectionalLight(0xffffff, 0.4);
fill.position.set(-5, -3, -5);
scene.add(fill);

const cube = createCube();
scene.add(cube);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0, 0);

function resize() {
  // Measure the canvas itself, not the container: in the responsive layout
  // the canvas is a fixed-height flow item and no longer fills the stage.
  const w = canvas.clientWidth || container.clientWidth;
  const h = canvas.clientHeight || container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

window.addEventListener("resize", resize);
new ResizeObserver(resize).observe(canvas);

const updateNet = initNet(document.getElementById("net"), cube);

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  updateHidden(cube, camera);
  updateNet();
  renderer.render(scene, camera);
}

animate();

// Build the WS URL from the current location so the app works both served
// at the root (local: http://127.0.0.1:8000/) and behind a reverse-proxy
// subpath over HTTPS (hosted: https://host/projects/rubikcube/app/).
const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
const wsBase = location.pathname.replace(/[^/]*$/, ""); // strip trailing filename, keep dir
const ws = new WebSocket(`${wsProto}//${location.host}${wsBase}ws`);
ws.addEventListener("open",  () => console.log("[ws] open"));
ws.addEventListener("close", () => console.log("[ws] close"));
ws.addEventListener("error", e => console.log("[ws] error", e));
const scrambleEl = document.getElementById("scramble-text");
scrambleEl.classList.add("empty");
const scramblePlayer = initMovePlayer({
  cube, scene,
  textEl: scrambleEl,
  barEl:    document.getElementById("scramble-bar"),
  prevBtn:  document.getElementById("s-prev"),
  playBtn:  document.getElementById("s-play"),
  nextBtn:  document.getElementById("s-next"),
  copyBtn:  document.getElementById("s-copy"),
  speedEl:  document.getElementById("s-speed"),
  posEl:    document.getElementById("s-pos"),
  runMove: runMoveThroughSyn,
  onMoveApplied: () => updateNet(),
  emptyHint:
    '<span class="hint-key">S</span> scramble · ' +
    '<span class="hint-key">Space</span> play · ' +
    '<span class="hint-key">←</span> <span class="hint-key">→</span> step · ' +
    '<span class="hint-key">U</span>…<span class="hint-key">B</span> turn face ' +
    '(<span class="hint-key">Shift</span> = prime) · ' +
    '<span class="hint-key">⌫</span> reset',
  onStepEnd(forward, finalStep) {
    // The last forward step of a scramble puts the cube into "scramble
    // state" :  notify the backend so solver-mode rules can gate properly.
    if (finalStep && forward) {
      send({ type: "action", action: "scramble_completed" });
    }
  },
});
// Backwards-compatible aliases so the rest of the code keeps working.
scramblePlayer.setScramble = scramblePlayer.setMoves;

const robotBadge   = document.getElementById("robot-badge");
const robotStatus  = document.getElementById("robot-status");
const robotToggle  = document.getElementById("robot-toggle");
const robotPort    = document.getElementById("robot-port");
const robotRefresh = document.getElementById("robot-refresh");
let robotState = "stub";

// ── Fake robot test bench ─────────────────────────────────────────────────
const fakePanel = document.getElementById("fake-panel");
const fakeAckBtn = document.getElementById("fake-ack");
const fakeErrBtn = document.getElementById("fake-error");
const fakeAutoBtn = document.getElementById("fake-auto");
const fakeLog = document.getElementById("fake-log");
let fakeAuto = true;

function setFakeAuto(on) {
  fakeAuto = !!on;
  fakeAutoBtn.classList.toggle("on", fakeAuto);
  // In auto mode, manual ack/error are meaningless.
  fakeAckBtn.disabled = fakeAuto;
  fakeErrBtn.disabled = fakeAuto;
}

function setFakeVisible(on) {
  fakePanel.hidden = !on;
  if (!on) fakeLog.innerHTML = "";
}

fakeAckBtn.addEventListener("click", () => {
  send({ type: "action", action: "fake_ack" });
  markLastLog("done");
});
fakeErrBtn.addEventListener("click", () => {
  send({ type: "action", action: "fake_error" });
  markLastLog("error");
});
fakeAutoBtn.addEventListener("click", () => {
  send({ type: "action", action: "fake_mode", mode: fakeAuto ? "manual" : "auto" });
});

function appendFakeLog(move) {
  const entry = document.createElement("div");
  entry.className = "entry pending";
  entry.textContent = move;
  fakeLog.appendChild(entry);
  // In auto mode, each entry is effectively done as soon as the 200ms delay
  // elapses on the backend :  optimistically mark it so the log reads clean.
  if (fakeAuto) {
    setTimeout(() => { entry.classList.remove("pending"); entry.classList.add("done"); }, 220);
  }
  while (fakeLog.childElementCount > 30) fakeLog.removeChild(fakeLog.firstChild);
  fakeLog.scrollTop = fakeLog.scrollHeight;
}

function markLastLog(cls) {
  const entries = fakeLog.querySelectorAll(".entry.pending");
  if (!entries.length) return;
  const el = entries[0];
  el.classList.remove("pending");
  el.classList.add(cls);
}

function setPortOptions(ports) {
  const prev = robotPort.value;
  robotPort.innerHTML = "";
  if (!ports.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "(no ports found)";
    opt.disabled = true;
    opt.selected = true;
    robotPort.appendChild(opt);
    robotToggle.disabled = true;
    return;
  }
  for (const p of ports) {
    const opt = document.createElement("option");
    opt.value = p.port;
    opt.textContent = p.label ? `${p.port} (${p.label})` : p.port;
    robotPort.appendChild(opt);
  }
  if ([...robotPort.options].some(o => o.value === prev)) robotPort.value = prev;
  robotToggle.disabled = false;
}
setPortOptions([]);

const modeIndicator = document.getElementById("mode-indicator");
const modeLabel     = document.getElementById("mode-label");

function setMode(mode) {
  modeIndicator.classList.remove("normal", "robot");
  modeIndicator.classList.add(mode);
  modeLabel.textContent = mode === "robot" ? "Robot" : "Normal";
}

const robotCalibrateBtn = document.getElementById("robot-calibrate");
const robotConfigBtn    = document.getElementById("robot-config");

function setRobotUI(state, port, message) {
  robotState = state;
  robotBadge.classList.remove("stub", "connected", "error", "robot");
  robotStatus.classList.remove("error");
  if (state === "robot") {
    // Connected AND calibrated :  full robot mode.
    robotBadge.textContent = "ROBOT";
    robotBadge.classList.add("connected");
    robotStatus.textContent = `Calibrated on ${port}`;
    robotToggle.textContent = "Disconnect";
    robotToggle.classList.add("disconnect");
    robotPort.disabled = true;
    robotCalibrateBtn.disabled = false;
    robotCalibrateBtn.textContent = "Exit Robot Mode";
    robotCalibrateBtn.classList.add("active");
    setMode("robot");
  } else if (state === "connected") {
    // Link open but NOT calibrated :  still GUI-only.
    robotBadge.textContent = "CONNECTED";
    robotBadge.classList.add("connected");
      robotStatus.textContent = `Connected on ${port}. Click Calibrate to enter robot mode`;
    robotToggle.textContent = "Disconnect";
    robotToggle.classList.add("disconnect");
    robotPort.disabled = true;
    robotCalibrateBtn.disabled = false;
    robotCalibrateBtn.textContent = "Calibrate";
    robotCalibrateBtn.classList.remove("active");
    setMode("normal");
  } else if (state === "error") {
    robotBadge.textContent = "DISCONNECTED";
    robotBadge.classList.add("error");
    robotStatus.textContent = `Error: ${message || "connection failed"}`;
    robotStatus.classList.add("error");
    robotToggle.textContent = "Connect";
    robotToggle.classList.remove("disconnect");
    robotPort.disabled = false;
    robotCalibrateBtn.disabled = true;
    robotCalibrateBtn.textContent = "Calibrate";
    robotCalibrateBtn.classList.remove("active");
    setMode("normal");
  } else {
    robotBadge.textContent = "DISCONNECTED";
    robotBadge.classList.add("stub");
      robotStatus.textContent = "Normal mode: GUI only";
    robotToggle.textContent = "Connect";
    robotToggle.classList.remove("disconnect");
    robotPort.disabled = false;
    robotCalibrateBtn.disabled = true;
    robotCalibrateBtn.textContent = "Calibrate";
    robotCalibrateBtn.classList.remove("active");
    setMode("normal");
  }
}
setRobotUI("stub");

ws.addEventListener("message", async e => {
  const msg = JSON.parse(e.data);
  if (msg.type === "config") {
    // Hosted demo flag :  currently informational only (the camera scanner
    // runs in the browser, so it works in the demo too).
  } else if (msg.type === "scramble") {
    console.log("[main→gui] scramble:", msg.moves.join(" "));
    scramblePlayer.setScramble(msg.moves);
  } else if (msg.type === "play") {
    await applyMove(cube, scene, msg.move);
    updateNet();
    scramblePlayer.onBackendPlay(msg.move);
    solvePlayer.onBackendPlay(msg.move);
    send({ type: "ack", move: msg.move });
  } else if (msg.type === "robot_status") {
    setRobotUI(msg.state, msg.port, msg.message);
  } else if (msg.type === "robot_ports") {
    setPortOptions(msg.ports);
  } else if (msg.type === "fake_status") {
    setFakeVisible(!!msg.active);
    setFakeAuto(msg.mode === "auto");
  } else if (msg.type === "fake_move") {
    appendFakeLog(msg.move);
  } else if (msg.type === "state_check") {
    stateEditor.onCheckResult(msg);
  } else if (msg.type === "robot_config") {
    applyRobotConfig(msg);
  } else if (msg.type === "scramble_blocked") {
    showToast(msg.reason || "Action blocked");
  } else if (msg.type === "cube_state") {
    setCubeSolved(msg.solved);
    if (msg.matrix) applyCubestateMatrix(msg.matrix);
    setScrambleStateInfo({
      done: !!msg.scramble_done,
      inState: !!msg.scramble_state,
      postCount: msg.post_scramble_count || 0,
    });
  } else if (msg.type === "syn_status") {
    applySynStatus(msg);
  } else if (msg.type === "move_done") {
    onMoveDone(msg);
  } else if (msg.type === "solve_preview") {
    onSolvePreview(msg);
  } else if (msg.type === "solve_done") {
    onSolveDone();
  } else if (msg.type === "reset_done") {
    resetCube(cube);
    updateNet();
    scramblePlayer.rewind();
  }
});

function send(payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

// Single correlated request/response channel for single-move submissions.
// Every path that wants to apply a move (drag release, scramble-player step,
// autoplay tick) goes through here. The backend resolves each one only
// after syn.play() finishes the move (GUI ack + robot ack in robot mode),
// so multiple callers queue naturally :  no two moves overlap.
let _moveReqCounter = 0;
const _pendingMoveReqs = new Map();   // id -> { resolve, reject }

function runMoveThroughSyn(move) {
  const id = ++_moveReqCounter;
  return new Promise((resolve, reject) => {
    _pendingMoveReqs.set(id, { resolve, reject });
    send({ type: "move", move, id });
  });
}

function onMoveDone(msg) {
  const pending = _pendingMoveReqs.get(msg.id);
  if (!pending) return;
  _pendingMoveReqs.delete(msg.id);
  if (msg.ok) pending.resolve(msg.move);
  else pending.reject(new Error(msg.error || "move failed"));
}

function sendMoveToBackend(move, opts = {}) {
  if (opts.local) {
    // Normal-mode drag: GUI already committed the rotation as part of the
    // gesture. Tell the backend to sync its matrix without re-animating.
    send({ type: "move", move, local: true });
  } else {
    // Robot-mode drag (or scramble-player step): go through syn so GUI +
    // cubestate + robot all advance in lockstep.
    runMoveThroughSyn(move).catch(() => {});
  }
  updateNet();
}

function canDragMove(faceName) {
  if (robotState === "robot" && !/^[UDRLFB]$/.test(faceName)) {
    showToast(`Robot mode: "${faceName}" not allowed (basic moves only)`);
    return false;
  }
  return true;
}

function sendAction(action) {
  console.log("[gui→main] action:", action);
  send({ type: "action", action });
}

initDrag({
  canvas, camera, cube, scene, controls,
  onMove: sendMoveToBackend,
  canMove: canDragMove,
  isRobotMode: () => robotState === "robot",
});

// Cube "solved" state from the backend: gates scramble + go-to-state.
let cubeSolved = true;

const goToStateBtn = document.getElementById("a-go-to-state");
const stateEditor = initStateEditor({
  cube,
  send,
  onSavedStateChange: () => { updateGoToStateBtn(); },
});
goToStateBtn.addEventListener("click", () => {
  const s = stateEditor.getSavedState();
  if (!s) {
      showToast("Set a state first: open Set State and save one");
    return;
  }
  if (!cubeSolved) {
    showToast("Cube must be solved before Go to State");
    return;
  }
  send({ type: "action", action: "go_to_state", state: s });
});

function updateGoToStateBtn() {
  // Always clickable so the user actually sees the rule when they click.
  goToStateBtn.disabled = false;
  if (!cubeSolved) {
    goToStateBtn.title = "Cube must be solved; reset first";
  } else if (!stateEditor.getSavedState()) {
    goToStateBtn.title = "Set a state first";
  } else {
    goToStateBtn.title = "";
  }
}

document.getElementById("c-gap").addEventListener("input", e => setGap(cube, parseFloat(e.target.value)));
document.getElementById("c-speed").addEventListener("input", e => {
  const speed = parseInt(e.target.value, 10);   // 1 = slow, 10 = fast
  settings.duration = 550 - speed * 50;         // 500ms..50ms
});
document.getElementById("c-labels").addEventListener("change", e => setLabels(cube, e.target.checked));
document.getElementById("c-transparent").addEventListener("change", e => setTransparent(cube, e.target.checked));
document.getElementById("c-hidden").addEventListener("change", e => setShowHidden(cube, e.target.checked));

// Theme controls :  the ☾/☀ button in the scramble header and the checkbox
// in General Control stay in sync; both persist to localStorage and update
// the 3D scene background.
const lightToggle = document.getElementById("c-light");
const themeBtn = document.getElementById("theme-btn");

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("rubik-theme", theme);
  scene.background = sceneBgColor();
  lightToggle.checked = theme === "light";
  themeBtn.textContent = theme === "light" ? "☀" : "☾";
}

lightToggle.checked = currentTheme() === "light";
themeBtn.textContent = currentTheme() === "light" ? "☀" : "☾";
lightToggle.addEventListener("change", e => setTheme(e.target.checked ? "light" : "dark"));
themeBtn.addEventListener("click", () =>
  setTheme(currentTheme() === "light" ? "dark" : "light"));

// Back-to-project-page link :  only shown when hosted under a subpath
// (e.g. ahmednassem.com/projects/rubikcube/app/), not when running locally at /.
if (location.pathname !== "/") {
  document.getElementById("back-btn").style.display = "";
}

// ── Floating inspector windows (Cube State + Syn) ────────────────────────
const FACE_HEX = {
  U: "#ffffff", R: "#c41e3a", F: "#00a651",
  D: "#ffd500", L: "#ff5800", B: "#0051ba",
};
const NET_GAP = 0.5;
const NET_FACES = {
  U: { offR: 0,             offC: 3 + NET_GAP     },
  L: { offR: 3 + NET_GAP,   offC: 0               },
  F: { offR: 3 + NET_GAP,   offC: 3 + NET_GAP     },
  R: { offR: 3 + NET_GAP,   offC: 6 + 2*NET_GAP   },
  B: { offR: 3 + NET_GAP,   offC: 9 + 3*NET_GAP   },
  D: { offR: 6 + 2*NET_GAP, offC: 3 + NET_GAP     },
};
const SVG_NS = "http://www.w3.org/2000/svg";

const csNet      = document.getElementById("float-cubestate-net");
const csCaption  = document.getElementById("float-cubestate-caption");
const csRects    = {};

(function buildCubestateNet() {
  for (const [face, info] of Object.entries(NET_FACES)) {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("x", info.offC + c + 0.06);
        rect.setAttribute("y", info.offR + r + 0.06);
        rect.setAttribute("width", 0.88);
        rect.setAttribute("height", 0.88);
        rect.setAttribute("rx", 0.1);
        rect.setAttribute("fill", "#222");
        rect.classList.add("sticker");
        csRects[`${face},${r},${c}`] = rect;
        csNet.appendChild(rect);
      }
    }
  }
})();

function applyCubestateMatrix(kociembaStr) {
  if (!kociembaStr || kociembaStr.length !== 54) return;
  const faces = ["U", "R", "F", "D", "L", "B"];
  for (let f = 0; f < 6; f++) {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const letter = kociembaStr[f * 9 + r * 3 + c];
        const rect = csRects[`${faces[f]},${r},${c}`];
        if (rect) rect.setAttribute("fill", FACE_HEX[letter] || "#222");
      }
    }
  }
  csCaption.textContent = kociembaStr;
}

const synPlayingEl = document.getElementById("syn-playing");
const synModeEl    = document.getElementById("syn-mode");
const synCurrentEl = document.getElementById("syn-current");
const synQueueEl   = document.getElementById("syn-queue");
const synDoneEl    = document.getElementById("syn-done");
const synLastEl    = document.getElementById("syn-last");
const synErrorEl   = document.getElementById("syn-error");

function applySynStatus(s) {
  synPlayingEl.textContent = s.playing ? "playing" : "idle";
  synModeEl.textContent    = s.mode || ": ";
  synCurrentEl.textContent = s.current || ": ";
  synQueueEl.textContent   = String(s.queue_len ?? 0);
  synDoneEl.textContent    = String(s.done ?? 0);
  synLastEl.textContent    = s.last || ": ";
  synErrorEl.textContent   = s.error || ": ";
}

// Open/close buttons in P1
const openCubestateBtn = document.getElementById("open-cubestate");
const openSynBtn       = document.getElementById("open-syn");
const csFloat  = document.getElementById("float-cubestate");
const synFloat = document.getElementById("float-syn");

function toggleFloating(el, btn) {
  const show = el.hidden;
  el.hidden = !show;
  btn.classList.toggle("on", show);
}
openCubestateBtn.addEventListener("click", () => toggleFloating(csFloat, openCubestateBtn));
openSynBtn.addEventListener("click", () => toggleFloating(synFloat, openSynBtn));

// Close buttons inside each floating window
for (const btn of document.querySelectorAll(".float-close")) {
  btn.addEventListener("click", () => {
    const target = document.getElementById(btn.dataset.target);
    target.hidden = true;
    if (btn.dataset.target === "float-cubestate") openCubestateBtn.classList.remove("on");
    if (btn.dataset.target === "float-syn")       openSynBtn.classList.remove("on");
  });
}

// Drag-to-move by the header. Positions are clamped so a window can never
// be dragged (or resized) out of the viewport.
function clampFloat(win, left, top) {
  const w = win.offsetWidth;
  const h = win.offsetHeight;
  const maxLeft = Math.max(0, window.innerWidth - w - 4);
  const maxTop  = Math.max(0, window.innerHeight - h - 4);
  win.style.left = `${Math.min(Math.max(left, 4), maxLeft)}px`;
  win.style.top  = `${Math.min(Math.max(top, 4), maxTop)}px`;
}

for (const head of document.querySelectorAll(".float-head[data-drag]")) {
  const win = head.parentElement;
  let dragging = false;
  let startX, startY, startLeft, startTop;
  head.addEventListener("pointerdown", e => {
    if (e.target.classList.contains("float-close")) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = win.getBoundingClientRect();
    startLeft = rect.left;
    startTop  = rect.top;
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener("pointermove", e => {
    if (!dragging) return;
    clampFloat(win, startLeft + (e.clientX - startX), startTop + (e.clientY - startY));
  });
  head.addEventListener("pointerup", e => {
    dragging = false;
    try { head.releasePointerCapture(e.pointerId); } catch {}
  });
}

// If the window shrinks, pull any visible floating window back into view.
window.addEventListener("resize", () => {
  for (const win of document.querySelectorAll(".floating:not([hidden])")) {
    const rect = win.getBoundingClientRect();
    clampFloat(win, rect.left, rect.top);
  }
});

document.getElementById("a-get-scramble").addEventListener("click", () => sendAction("get_scramble"));
// Do Scramble is the same trigger as the ▶/⏸ in the Scramble bar: toggles
// the scramble player's autoplay. Click once to play, click again (or the
// bar's ⏸) to pause, click again to resume.
const doScrambleBtn = document.getElementById("a-do-scramble");
doScrambleBtn.addEventListener("click", () => {
  if (scramblePlayer.getMoves().length === 0) {
      showToast("No scramble to apply; click Get Scramble first");
    return;
  }
  // Starting fresh (position 0, not currently playing) requires a solved cube.
  // Pausing or resuming a partially-played scramble is always allowed.
  const startingFresh =
    !scramblePlayer.isPlaying() && scramblePlayer.getPosition() === 0;
  if (startingFresh && !cubeSolved) {
    showToast("Cube must be solved before running scramble");
    return;
  }
  scramblePlayer.togglePlay();
});

document.getElementById("a-reset").addEventListener("click", () => sendAction("reset"));

function setCubeSolved(solved) {
  cubeSolved = !!solved;
  // Leave the button enabled so the click actually reaches the backend,
  // which replies with a toast explaining the rule.
    doScrambleBtn.title = cubeSolved ? "" : "Cube must be solved; reset first";
  updateGoToStateBtn();
}

// ── Solver + scramble-state UI ────────────────────────────────────────────
const resetToScrambleBtn = document.getElementById("a-reset-scramble");
const solverBtns = document.querySelectorAll(".solver-btn");
let scrambleStateInfo = { done: false, inState: false, postCount: 0 };

function setScrambleStateInfo(info) {
  scrambleStateInfo = info;
  resetToScrambleBtn.disabled = !(info.done && info.postCount > 0);
  resetToScrambleBtn.title = !info.done
    ? "Run Do Scramble first"
    : (info.postCount === 0
        ? "Already in the scramble state"
        : `Undo ${info.postCount} post-scramble move${info.postCount > 1 ? "s" : ""}`);
  updateSolverButtons();
}

function currentSolverMode() {
  const on = document.querySelector(".mode-btn.on");
  return on ? on.dataset.mode : "scramble";
}

for (const btn of document.querySelectorAll(".mode-btn")) {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("on"));
    btn.classList.add("on");
    updateSolverButtons();
  });
}

function updateSolverButtons() {
  const mode = currentSolverMode();
  for (const btn of solverBtns) {
    if (mode === "current") {
      btn.title = "Solve from the current cube state";
    } else if (!scrambleStateInfo.done) {
      btn.title = "Run Do Scramble first";
    } else if (!scrambleStateInfo.inState) {
      btn.title = "Cube is not at the scramble state; Reset to Scramble first";
    } else {
      btn.title = "";
    }
  }
}

resetToScrambleBtn.addEventListener("click", () => {
  sendAction("reset_to_scramble");
});

for (const btn of solverBtns) {
  btn.addEventListener("click", () => {
    send({
      type: "action",
      action: "get_solve",
      method: btn.dataset.method,
      mode: currentSolverMode(),
    });
  });
}


// ── Solve preview player + timer + analytics ────────────────────────────
const solveLabelEl   = document.getElementById("solve-label");
const solveTextEl    = document.getElementById("solve-text");
const solveTimerEl   = document.getElementById("solve-timer");
const doSolveBtn     = document.getElementById("a-do-solve");
const solveCountEl   = document.getElementById("solve-count");
const solveMeanEl    = document.getElementById("solve-mean");
const solveStatsBody = document.getElementById("solve-stats-body");
const solveStatsResetBtn = document.getElementById("solve-stats-reset");

// ── Solve timer (forward-only stopwatch, CSTimer-style) ───────────────────
// Runs ONLY while the cube is moving forward. Pauses between steps (user
// stopped), pauses during backward movement, finalizes when the solve ends.
const timer = {
  state: "idle",       // "idle" | "running" | "paused" | "done"
  totalMs: 0,          // accumulated forward-move time
  runStartMs: 0,       // performance.now() when current run started
  raf: 0,
};

function formatTime(ms) {
  const totalSec = ms / 1000;
  if (totalSec < 60) return totalSec.toFixed(2);
  const m = Math.floor(totalSec / 60);
  const s = (totalSec - m * 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}

function timerRender() {
  let ms = timer.totalMs;
  if (timer.state === "running") ms += performance.now() - timer.runStartMs;
  solveTimerEl.textContent = formatTime(ms);
}

function timerApplyClass() {
  solveTimerEl.classList.remove("running", "paused", "done");
  if (timer.state !== "idle") solveTimerEl.classList.add(timer.state);
}

function timerTick() {
  timerRender();
  if (timer.state === "running") timer.raf = requestAnimationFrame(timerTick);
}

function timerReset() {
  timer.state = "idle";
  timer.totalMs = 0;
  cancelAnimationFrame(timer.raf);
  timerApplyClass();
  timerRender();
}

function timerRunForward() {
  // Only meaningful while we still have time to accumulate.
  if (timer.state === "running" || timer.state === "done") return;
  timer.state = "running";
  timer.runStartMs = performance.now();
  timerApplyClass();
  cancelAnimationFrame(timer.raf);
  timer.raf = requestAnimationFrame(timerTick);
}

function timerPause() {
  if (timer.state !== "running") return;
  timer.totalMs += performance.now() - timer.runStartMs;
  timer.state = "paused";
  cancelAnimationFrame(timer.raf);
  timerApplyClass();
  timerRender();
}

function timerFinalize() {
  if (timer.state === "running") {
    timer.totalMs += performance.now() - timer.runStartMs;
    cancelAnimationFrame(timer.raf);
  }
  timer.state = "done";
  timerApplyClass();
  timerRender();
  recordSolve(timer.totalMs);
}

timerReset();

// ── Solve history / analytics ─────────────────────────────────────────────
// Trimmed mean ao5 / ao12 (drop best and worst), matches CSTimer convention.
const solveHistory = [];   // ms per solve, in chronological order

function formatSec(ms) { return (ms / 1000).toFixed(2); }

function averageOfTrimmed(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const middle = sorted.slice(1, sorted.length - 1);
  return middle.reduce((a, b) => a + b, 0) / middle.length;
}

function aoAt(idx, n) {
  if (idx + 1 < n) return null;
  const slice = solveHistory.slice(idx - n + 1, idx + 1);
  return averageOfTrimmed(slice);
}

function renderStats() {
  const n = solveHistory.length;
  solveCountEl.textContent = `${n}/${n}`;
  solveMeanEl.textContent = n === 0
    ? ": "
    : formatSec(solveHistory.reduce((a, b) => a + b, 0) / n);

  const best = n ? Math.min(...solveHistory) : null;
  const worst = n ? Math.max(...solveHistory) : null;

  solveStatsBody.innerHTML = "";
  for (let i = n - 1; i >= 0; i--) {   // newest first
    const ms = solveHistory[i];
    const ao5  = aoAt(i, 5);
    const ao12 = aoAt(i, 12);
    const tr = document.createElement("tr");
    const timeCls = ms === best ? "best" : ms === worst ? "worst" : "time";
    tr.innerHTML =
      `<td>${i + 1}</td>` +
      `<td class="${timeCls}">${formatSec(ms)}</td>` +
      `<td class="${ao5  === null ? "empty" : ""}">${ao5  === null ? "-" : formatSec(ao5)}</td>` +
      `<td class="${ao12 === null ? "empty" : ""}">${ao12 === null ? "-" : formatSec(ao12)}</td>`;
    solveStatsBody.appendChild(tr);
  }
}

function recordSolve(ms) {
  if (ms <= 0) return;
  solveHistory.push(ms);
  renderStats();
}

solveStatsResetBtn.addEventListener("click", () => {
  solveHistory.length = 0;
  renderStats();
  timerReset();
});

renderStats();

// ── Solve player (forward-only timer, two modes) ──────────────────────────
// Timer rules:
//   • In AUTOPLAY (Do Solve / ▶ in the bar): runs continuously from the
//     first forward step until the user pauses, the solve ends, or a
//     backward step happens. Doesn't stop between moves.
//   • In MANUAL stepping (‹ / › click-by-click): runs only during each
//     move's execution, pauses between moves (only counts the time the
//     system takes to switch from one move to the next).
//   • Backward steps always pause; finalize on the last forward step.
const solvePlayer = initMovePlayer({
  cube, scene,
  textEl:   solveTextEl,
  barEl:    document.getElementById("solve-bar"),
  prevBtn:  document.getElementById("sv-prev"),
  playBtn:  document.getElementById("sv-play"),
  nextBtn:  document.getElementById("sv-next"),
  copyBtn:  document.getElementById("sv-copy"),
  speedEl:  document.getElementById("sv-speed"),
  posEl:    document.getElementById("sv-pos"),
  runMove: runMoveThroughSyn,
  onMoveApplied: () => updateNet(),
  emptyHint: "Pick a solver to preview a solution",
  onStepStart(forward) {
    if (forward) timerRunForward();
    else timerPause();
  },
  onStepEnd(forward, finalStep, isAutoplay) {
    if (finalStep) timerFinalize();
    else if (forward && !isAutoplay) timerPause();   // manual only: pause between moves
    // autoplay forward (not final): leave the timer running through the gap
  },
});

function onSolvePreview(msg) {
  solveLabelEl.textContent = msg.method
    ? `${msg.method.toUpperCase()} · ${msg.moves.length} moves`
    : "";
  solvePlayer.setMoves(msg.moves || []);
  doSolveBtn.disabled = !(msg.moves && msg.moves.length);
  timerReset();
}

// Preview stays on screen after the solve finishes :  the backend's
// `solve_done` message just finalizes the timer. It gets replaced only
// when the user picks a solver method again.
function onSolveDone() {
  if (timer.state === "running") timerFinalize();
}

// Do Solve is the same trigger as the ▶/⏸ in the Solve bar: toggles the
// solve player's autoplay. Pause resumes from the same position.
doSolveBtn.addEventListener("click", () => {
  if (solvePlayer.getMoves().length === 0) return;
  solvePlayer.togglePlay();
});

robotToggle.addEventListener("click", () => {
  if (robotState === "connected" || robotState === "robot") {
    send({ type: "action", action: "robot_disconnect" });
  } else {
    const port = robotPort.value;
    if (!port) { robotPort.focus(); return; }
    robotStatus.textContent = `Connecting to ${port}…`;
    send({ type: "action", action: "robot_connect", port });
  }
});

robotRefresh.addEventListener("click", () => {
  send({ type: "action", action: "refresh_ports" });
});

// Calibrate :  toggles robot mode (must be connected). Fires the backend
// action; UI updates when robot_status comes back.
robotCalibrateBtn.addEventListener("click", () => {
  if (robotState !== "connected" && robotState !== "robot") {
    showToast("Connect to the robot first");
    return;
  }
  send({ type: "action", action: "robot_calibrate" });
});

// ── Robot Configuration panel ─────────────────────────────────────────────
// Baud rate + move timeout apply on the next connect; fake delay and ack
// mode apply immediately. Every change is sent to the backend, which echoes
// the effective settings back as a robot_config message.
const robotConfigFloat = document.getElementById("float-robot-config");
robotConfigBtn.addEventListener("click", () => {
  robotConfigFloat.hidden = false;
  send({ type: "action", action: "robot_config" });   // no fields = just read
});

const rcBaud       = document.getElementById("rc-baud");
const rcTimeout    = document.getElementById("rc-timeout");
const rcFakeDelay  = document.getElementById("rc-fake-delay");
const rcFakeDelayVal = document.getElementById("rc-fake-delay-val");
const rcModeAuto   = document.getElementById("rc-mode-auto");
const rcModeManual = document.getElementById("rc-mode-manual");

function applyRobotConfig(cfg) {
  if (cfg.baud !== undefined) rcBaud.value = String(cfg.baud);
  if (cfg.timeout !== undefined) rcTimeout.value = String(cfg.timeout);
  if (cfg.fake_delay !== undefined) {
    rcFakeDelay.value = String(cfg.fake_delay);
    rcFakeDelayVal.textContent = `${Number(cfg.fake_delay).toFixed(2)}s`;
  }
  if (cfg.fake_mode !== undefined) {
    rcModeAuto.classList.toggle("on", cfg.fake_mode === "auto");
    rcModeManual.classList.toggle("on", cfg.fake_mode === "manual");
    setFakeAuto(cfg.fake_mode === "auto");
  }
}

function sendRobotConfig(fields) {
  send({ type: "action", action: "robot_config", ...fields });
}

rcBaud.addEventListener("change", () => sendRobotConfig({ baud: parseInt(rcBaud.value, 10) }));
rcTimeout.addEventListener("change", () => {
  const v = Math.min(120, Math.max(1, parseInt(rcTimeout.value, 10) || 30));
  rcTimeout.value = String(v);
  sendRobotConfig({ timeout: v });
});
rcFakeDelay.addEventListener("input", () => {
  rcFakeDelayVal.textContent = `${Number(rcFakeDelay.value).toFixed(2)}s`;
});
rcFakeDelay.addEventListener("change", () =>
  sendRobotConfig({ fake_delay: parseFloat(rcFakeDelay.value) }));
rcModeAuto.addEventListener("click", () => sendRobotConfig({ fake_mode: "auto" }));
rcModeManual.addEventListener("click", () => sendRobotConfig({ fake_mode: "manual" }));

// Clean Screen :  fades every panel except the toggle itself. Click again
// to bring them back. Lives at the bottom of P1; in clean mode, P1's chrome
// disappears too so the button reads as a lone control.
const cleanToggleBtn = document.getElementById("clean-toggle");
cleanToggleBtn.addEventListener("click", () => {
  const on = !document.body.classList.contains("clean-mode");
  document.body.classList.toggle("clean-mode", on);
  cleanToggleBtn.textContent = on ? "Show Panels" : "Clean Screen";
  cleanToggleBtn.title = on ? "Restore all panels" : "Hide all panels";
});

const inputEl = document.getElementById("c-input");
const toastEl = document.getElementById("p2-toast");
let toastTimer;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2000);
}
function flashInputError(msg) {
  inputEl.classList.add("error");
  setTimeout(() => inputEl.classList.remove("error"), 1200);
  showToast(msg);
}
const BASIC_RE = /^[UDRLFB]('|2)?$/;
function executeInput() {
  const raw = inputEl.value.trim();
  if (!raw) return;
  const { moves, valid } = tokenizeMoves(raw);
  if (!valid || moves.length === 0) {
    console.warn("[gui] invalid move input:", raw);
    flashInputError("Invalid move in input");
    return;
  }
  if (robotState === "robot") {
    const bad = moves.find(m => !BASIC_RE.test(m));
    if (bad) {
      console.warn("[gui] blocked in robot mode:", bad);
      flashInputError(`Robot mode: "${bad}" not allowed (basic moves only)`);
      return;
    }
  }
  console.log("[gui→main] execute:", moves.join(" "));
  send({ type: "action", action: "execute", moves });
}
document.getElementById("a-execute").addEventListener("click", executeInput);
inputEl.addEventListener("keydown", e => { if (e.key === "Enter") executeInput(); });
inputEl.addEventListener("input", () => inputEl.classList.remove("error"));

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

// Face-turn keys: U D L R F B turn that face clockwise, Shift+key turns it
// counterclockwise (prime). The move goes through the normal syn pipeline so
// the 3D view, backend state, and robot stay in lockstep.
const FACE_KEYS = new Set(["U", "D", "L", "R", "F", "B"]);

document.addEventListener("keydown", e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (isTypingTarget(e.target)) return;
  const k = e.key;
  const upper = k.toUpperCase();
  if (k === " ") {
    e.preventDefault();
    scramblePlayer.togglePlay();
  } else if (k === "ArrowLeft") {
    e.preventDefault();
    scramblePlayer.stepBack();
  } else if (k === "ArrowRight") {
    e.preventDefault();
    scramblePlayer.stepForward();
  } else if (k === "Backspace") {
    e.preventDefault();
    document.getElementById("a-reset").click();
  } else if (upper === "S") {
    document.getElementById("a-get-scramble").click();
  } else if (FACE_KEYS.has(upper)) {
    const move = e.shiftKey ? `${upper}'` : upper;
    runMoveThroughSyn(move).catch(() => {});
  }
});

window.cube = cube;
window.scene = scene;
window.move = (m) => applyMove(cube, scene, m);

export { scene, camera, renderer, cube };

