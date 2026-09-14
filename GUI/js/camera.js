// Browser-based cube face scanner.
//
// Port of cubecam.py to the browser: reads the user's webcam via
// getUserMedia, classifies a 3×3 grid at the center of the frame with the
// same HSV thresholds, and auto-captures a face when its classification is
// stable for a few frames AND that center color hasn't been captured yet.
// When all 6 faces are captured, onDone(results) fires with
// { U: "UUUUUUUUU", R: "...", ... } :  the same shape the old backend
// camera_all_done message used.
//
// Everything runs client-side: no video ever leaves the machine, and it
// works both locally and on the hosted demo (getUserMedia needs HTTPS or
// localhost).

const FACE_ORDER = ["U", "R", "F", "D", "L", "B"];
const STABLE_FRAMES = 10;

const DRAW_HEX = {
  U: "#e6e6e6",
  R: "#c41e3a",
  F: "#00a651",
  D: "#ffd500",
  L: "#ff5800",
  B: "#0051ba",
};

// Same thresholds as cubecam._classify_hsv. OpenCV hue is 0–179, so the
// JS 0–360 hue is halved; s and v are scaled to 0–255.
function classifyHsv(h, s, v) {
  if (s < 55 && v > 140) return "U"; // white
  if (v < 40) return "U";
  if (h < 8 || h >= 170) return "R"; // red
  if (h < 22) return "L";            // orange
  if (h < 38) return "D";            // yellow
  if (h < 85) return "F";            // green
  if (h < 130) return "B";           // blue
  return "R";
}

function rgbToCvHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : d / max;
  return [h / 2, s * 255, max]; // max is already 0–255 (v)
}

export function createCameraScanner({ video, canvas, onDone, onError, onCapture }) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let stream = null;
  let raf = 0;
  let running = false;
  let results = {};
  let lastLetters = null;
  let stableCount = 0;

  function samplePatch(x, y, half) {
    const img = ctx.getImageData(x - half, y - half, half * 2, half * 2).data;
    let r = 0, g = 0, b = 0;
    const n = img.length / 4;
    for (let i = 0; i < img.length; i += 4) {
      r += img[i]; g += img[i + 1]; b += img[i + 2];
    }
    return rgbToCvHsv(r / n, g / n, b / n);
  }

  function drawMiniNet() {
    const cell = 10, gap = 3;
    const facePx = 3 * cell;
    const netW = 4 * facePx + 3 * gap;
    const netH = 3 * facePx + 2 * gap;
    const margin = 12;
    const nx = canvas.width - netW - margin;
    const ny = margin;
    ctx.fillStyle = "#181818";
    ctx.fillRect(nx - 6, ny - 6, netW + 12, netH + 12);
    const layout = { U: [1, 0], L: [0, 1], F: [1, 1], R: [2, 1], B: [3, 1], D: [1, 2] };
    for (const [face, [fc, fr]] of Object.entries(layout)) {
      const fx = nx + fc * (facePx + gap);
      const fy = ny + fr * (facePx + gap);
      const stickers = results[face];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          ctx.fillStyle = stickers ? (DRAW_HEX[stickers[r * 3 + c]] || "#505050") : "#3c3c3c";
          ctx.fillRect(fx + c * cell, fy + r * cell, cell, cell);
          ctx.strokeStyle = "#000";
          ctx.lineWidth = 1;
          ctx.strokeRect(fx + c * cell, fy + r * cell, cell, cell);
        }
      }
    }
  }

  function frame() {
    if (!running) return;
    if (video.readyState >= 2 && video.videoWidth > 0) {
      // Cap processing width for performance; keep the aspect ratio.
      const w = Math.min(video.videoWidth, 640);
      const h = Math.round(video.videoHeight * (w / video.videoWidth));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.drawImage(video, 0, 0, w, h);

      const grid = Math.floor(Math.min(w, h) * 0.55);
      const gx = Math.floor((w - grid) / 2);
      const gy = Math.floor((h - grid) / 2);
      const cell = Math.floor(grid / 3);
      const half = Math.max(5, Math.floor(cell / 8));

      // Classify the 9 sample points.
      const letters = [];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const cx = gx + c * cell + Math.floor(cell / 2);
          const cy = gy + r * cell + Math.floor(cell / 2);
          const [hh, ss, vv] = samplePatch(cx, cy, half);
          letters.push(classifyHsv(hh, ss, vv));
        }
      }

      // Stability tracking (same rule as the backend scanner).
      if (lastLetters && letters.join("") === lastLetters) {
        stableCount += 1;
      } else {
        lastLetters = letters.join("");
        stableCount = 1;
      }

      const center = letters[4];
      if (stableCount >= STABLE_FRAMES && FACE_ORDER.includes(center) && !results[center]) {
        const pinned = [...letters];
        pinned[4] = center;
        results[center] = pinned.join("");
        stableCount = 0;
        if (onCapture) onCapture(center, Object.keys(results).length);
      }

      // ── Overlay ──
      ctx.lineWidth = 2;
      ctx.font = `${Math.max(14, Math.floor(cell / 3))}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const x1 = gx + c * cell;
          const y1 = gy + r * cell;
          const letter = letters[r * 3 + c];
          ctx.strokeStyle = DRAW_HEX[letter];
          ctx.strokeRect(x1, y1, cell, cell);
          ctx.fillStyle = DRAW_HEX[letter];
          ctx.fillText(letter, x1 + cell / 2, y1 + cell / 2);
        }
      }
      ctx.lineWidth = 3;
      ctx.strokeStyle = stableCount >= STABLE_FRAMES / 2 ? "#00ff00" : "#ffa500";
      ctx.strokeRect(gx, gy, grid, grid);

      drawMiniNet();

      const remaining = FACE_ORDER.filter((f) => !results[f]);
      ctx.font = "16px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = "#00ff00";
      ctx.fillText(
        remaining.length
          ? `Captured ${Object.keys(results).length}/6. Show: ${remaining.join(" ")}`
          : "All 6 captured!",
        10, 24,
      );

      if (remaining.length === 0) {
        const done = { ...results };
        stop();
        if (onDone) onDone(done);
        return;
      }
    }
    raf = requestAnimationFrame(frame);
  }

  async function start() {
    results = {};
    lastLetters = null;
    stableCount = 0;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 } },
        audio: false,
      });
    } catch (e) {
      if (onError) onError(e.name === "NotAllowedError"
        ? "Camera permission denied"
        : `Could not open camera (${e.message || e.name})`);
      return false;
    }
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      /* autoplay quirks :  the rAF loop tolerates a not-yet-ready video */
    }
    running = true;
    raf = requestAnimationFrame(frame);
    return true;
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    if (stream) {
      for (const t of stream.getTracks()) t.stop();
      stream = null;
    }
    video.srcObject = null;
  }

  return { start, stop, isRunning: () => running };
}
