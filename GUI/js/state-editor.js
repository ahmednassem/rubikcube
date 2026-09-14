import { applyState } from "./cube.js";
import { createCameraScanner } from "./camera.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const PALETTE = [
  { face: "U", hex: "#ffffff", label: "White (U)" },
  { face: "R", hex: "#c41e3a", label: "Red (R)"   },
  { face: "F", hex: "#00a651", label: "Green (F)" },
  { face: "D", hex: "#ffd500", label: "Yellow (D)" },
  { face: "L", hex: "#ff5800", label: "Orange (L)" },
  { face: "B", hex: "#0051ba", label: "Blue (B)"  },
];

const MULTI_KEY = "__multi__";
const FACE_HEX = Object.fromEntries(PALETTE.map(p => [p.face, p.hex]));
const EMPTY_HEX = "#222";

const GAP = 0.5;
const FACE_LAYOUT = {
  U: { offR: 0,           offC: 3 + GAP     },
  L: { offR: 3 + GAP,     offC: 0           },
  F: { offR: 3 + GAP,     offC: 3 + GAP     },
  R: { offR: 3 + GAP,     offC: 6 + 2*GAP   },
  B: { offR: 3 + GAP,     offC: 9 + 3*GAP   },
  D: { offR: 6 + 2*GAP,   offC: 3 + GAP     },
};

export function initStateEditor({ cube, send, onSavedStateChange }) {
  const modal      = document.getElementById("state-modal");
  const openBtn    = document.getElementById("a-set-state");
  const closeBtn   = document.getElementById("state-close");
  const cancelBtn  = document.getElementById("state-cancel");
  const saveBtn    = document.getElementById("state-save");
  const checkBtn   = document.getElementById("state-check");
  const cameraBtn  = document.getElementById("state-camera");
  const paletteEl  = document.getElementById("state-palette");
  const msgEl      = document.getElementById("state-message");
  const netSvg     = document.getElementById("state-net");
  const popupEl    = document.getElementById("color-popup");

  let state;
  let selected = MULTI_KEY;
  let lastChecked = null;
  let savedState = null;
  const rects = {};

  function resetState() {
    state = {};
    for (const f of ["U", "R", "F", "D", "L", "B"]) {
      state[f] = [[null, null, null], [null, null, null], [null, null, null]];
      state[f][1][1] = f;
    }
    lastChecked = null;
    saveBtn.disabled = true;
    setMessage("", "");
    hidePopup();
  }

  function loadStateFrom(k) {
    const faces = ["U", "R", "F", "D", "L", "B"];
    for (let f = 0; f < 6; f++) {
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          state[faces[f]][r][c] = k[f * 9 + r * 3 + c];
        }
      }
    }
  }

  function setMessage(text, cls) {
    msgEl.textContent = text;
    msgEl.className = "state-message" + (cls ? " " + cls : "");
  }

  function renderPalette() {
    paletteEl.innerHTML = "";

    const multi = document.createElement("button");
    multi.className = "palette-swatch multi";
    multi.title = "Multi: click a square to pick its color";
    multi.dataset.face = MULTI_KEY;
    multi.textContent = "?";
    if (selected === MULTI_KEY) multi.classList.add("selected");
    multi.addEventListener("click", () => selectPalette(MULTI_KEY));
    paletteEl.appendChild(multi);

    for (const p of PALETTE) {
      const btn = document.createElement("button");
      btn.className = "palette-swatch";
      btn.title = p.label;
      btn.style.background = p.hex;
      btn.dataset.face = p.face;
      if (p.face === selected) btn.classList.add("selected");
      btn.addEventListener("click", () => selectPalette(p.face));
      paletteEl.appendChild(btn);
    }
  }

  function selectPalette(key) {
    selected = key;
    paletteEl.querySelectorAll(".palette-swatch")
      .forEach(el => el.classList.toggle("selected", el.dataset.face === selected));
    hidePopup();
  }

  function renderNet() {
    netSvg.innerHTML = "";
    for (const [face, info] of Object.entries(FACE_LAYOUT)) {
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const rect = document.createElementNS(SVG_NS, "rect");
          rect.setAttribute("x", info.offC + c + 0.06);
          rect.setAttribute("y", info.offR + r + 0.06);
          rect.setAttribute("width", 0.88);
          rect.setAttribute("height", 0.88);
          rect.setAttribute("rx", 0.12);
          rect.classList.add("sticker");
          const key = `${face},${r},${c}`;
          rects[key] = rect;
          const isCenter = r === 1 && c === 1;
          if (!isCenter) {
            rect.classList.add("editable");
            rect.addEventListener("click", (e) => onStickerClick(e, face, r, c));
          }
          repaint(face, r, c);
          netSvg.appendChild(rect);
        }
      }
    }
  }

  function repaint(face, r, c) {
    const letter = state[face][r][c];
    const fill = letter ? FACE_HEX[letter] : EMPTY_HEX;
    rects[`${face},${r},${c}`].setAttribute("fill", fill);
  }

  function onStickerClick(e, face, r, c) {
    if (selected === MULTI_KEY) {
      showPopup(e, face, r, c);
    } else {
      paintSquare(face, r, c, selected);
    }
  }

  function paintSquare(face, r, c, letter) {
    state[face][r][c] = letter;
    repaint(face, r, c);
    saveBtn.disabled = true;
    lastChecked = null;
    setMessage("", "");
  }

  function showPopup(e, face, r, c) {
    popupEl.innerHTML = "";
    for (const p of PALETTE) {
      const btn = document.createElement("button");
      btn.className = "popup-swatch";
      btn.title = p.label;
      btn.style.background = p.hex;
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        paintSquare(face, r, c, p.face);
        hidePopup();
      });
      popupEl.appendChild(btn);
    }

    const wrap = popupEl.parentElement;
    const wrapRect = wrap.getBoundingClientRect();
    const rectBox = rects[`${face},${r},${c}`].getBoundingClientRect();
    const x = rectBox.left - wrapRect.left + rectBox.width / 2;
    const y = rectBox.top  - wrapRect.top;
    popupEl.style.left = `${x}px`;
    popupEl.style.top  = `${y}px`;
    popupEl.hidden = false;
    e.stopPropagation();
  }

  function hidePopup() {
    popupEl.hidden = true;
  }

  function buildKociemba() {
    let s = "";
    for (const f of ["U", "R", "F", "D", "L", "B"]) {
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const letter = state[f][r][c];
          if (!letter) return null;
          s += letter;
        }
      }
    }
    return s;
  }

  function open() {
    resetState();
    if (savedState) {
      loadStateFrom(savedState);
      lastChecked = savedState;
      saveBtn.disabled = false;
      setMessage("Showing saved state; edit or save again", "info");
    }
    renderPalette();
    renderNet();
    modal.hidden = false;
  }

  function close() {
    hidePopup();
    cancelCameraIfActive();
    modal.hidden = true;
  }

  openBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", () => {
    // When the camera is open, Cancel only exits camera mode and keeps the
    // Set State modal up. Outside camera mode it closes the modal as usual.
    if (!cameraView.hidden) {
      closeCameraView();
    } else {
      close();
    }
  });

  document.addEventListener("click", (e) => {
    if (popupEl.hidden) return;
    if (popupEl.contains(e.target)) return;
    if (e.target.classList && e.target.classList.contains("sticker")) return;
    hidePopup();
  });

  checkBtn.addEventListener("click", () => {
    const k = buildKociemba();
    if (!k) {
      setMessage("Fill every sticker first", "error");
      saveBtn.disabled = true;
      return;
    }
    lastChecked = k;
    setMessage("Checking…", "info");
    send({ type: "action", action: "check_state", state: k });
  });

  saveBtn.addEventListener("click", () => {
    if (!lastChecked) return;
    applyState(cube, lastChecked);
    savedState = lastChecked;
    if (onSavedStateChange) onSavedStateChange(savedState);
    close();
  });

  // ── Camera capture (browser webcam) ──────────────────────────────────────
  // The scanner runs entirely in the browser (camera.js): getUserMedia video,
  // HSV classification, auto-capture per face when stable. Works locally and
  // on the hosted demo :  no video ever leaves the machine.
  const editorView  = document.getElementById("state-editor-view");
  const cameraView  = document.getElementById("state-camera-view");
  const cameraVideo = document.getElementById("state-camera-video");
  const cameraCanvas = document.getElementById("state-camera-canvas");

  const scanner = createCameraScanner({
    video: cameraVideo,
    canvas: cameraCanvas,
    onDone(faces) {
      for (const [face, stickers] of Object.entries(faces)) {
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            state[face][r][c] = stickers[r * 3 + c];
          }
        }
        state[face][1][1] = face;
      }
      renderNet();
      saveBtn.disabled = true;
      lastChecked = null;
      closeCameraView();
      setMessage("All 6 faces captured: review, then Check / Save", "ok");
    },
    onError(err) {
      closeCameraView();
      setMessage(`Camera: ${err}`, "error");
    },
  });

  function openCameraView() {
    editorView.hidden = true;
    cameraView.hidden = false;
  }

  function closeCameraView() {
    scanner.stop();
    cameraView.hidden = true;
    editorView.hidden = false;
  }

  function cancelCameraIfActive() {
    if (!cameraView.hidden) closeCameraView();
  }

  cameraBtn.addEventListener("click", async () => {
    openCameraView();
    const ok = await scanner.start();
    if (!ok) closeCameraView();
  });

  return {
    onCheckResult({ valid, reason }) {
      if (modal.hidden) return;
      if (valid) {
        saveBtn.disabled = false;
        setMessage(`✓ ${reason}`, "ok");
      } else {
        saveBtn.disabled = true;
        setMessage(`✗ ${reason}`, "error");
      }
    },
    getSavedState() { return savedState; },
    clearSavedState() { savedState = null; },
  };
}
