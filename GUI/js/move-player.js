import { invertMove } from "./moves.js";

// Generic "move list player": click-to-seek, step, autoplay with speed
// control, copy-to-clipboard, TPS readout. Used for both the Scramble panel
// and the Solve preview panel :  both have the same look/feel.
//
// Caller passes in DOM element references. No hardcoded IDs inside.

export function initMovePlayer({
  cube, scene,
  textEl,
  barEl,
  prevBtn,
  playBtn,
  nextBtn,
  copyBtn,
  speedEl,
  posEl,
  runMove,
  onMoveApplied,
  emptyHint = null,           // HTML string shown when moves = []
  hidePosWhenEmpty = false,   // hide counter when moves = []
  onStepStart = null,         // (forward: bool) :  before each step begins
  onStepEnd = null,           // (forward: bool, finalStep: bool) :  after each step
}) {
  let moves = [];
  let position = 0;
  let target = 0;
  let stepping = false;
  let autoplay = false;
  let pauseRequested = false;

  let sessionStart = 0;
  let sessionMoves = 0;
  let lastTPS = null;

  function recordMove() {
    if (sessionMoves === 0) sessionStart = performance.now();
    sessionMoves++;
    const elapsed = (performance.now() - sessionStart) / 1000;
    if (elapsed > 0) lastTPS = sessionMoves / elapsed;
  }

  function resetSession() {
    sessionMoves = 0;
    lastTPS = null;
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const gapMs = () => speedEl
    ? (11 - parseInt(speedEl.value, 10)) * 100
    : 250;

  function renderText() {
    if (!moves.length) {
      if (emptyHint) textEl.innerHTML = emptyHint;
      else textEl.textContent = ": ";
      textEl.classList.add("empty");
      return;
    }
    textEl.classList.remove("empty");
    textEl.innerHTML = "";

    const start = document.createElement("span");
    start.className = "mv start";
    start.dataset.idx = "-1";
    start.textContent = "●";
    start.title = "Solved (before any move)";
    if (position === 0) start.classList.add("current");
    else start.classList.add("done");
    textEl.appendChild(start);
    textEl.appendChild(document.createTextNode(" "));

    moves.forEach((mv, i) => {
      const span = document.createElement("span");
      span.className = "mv";
      span.dataset.idx = String(i);
      if (i < position - 1) span.classList.add("done");
      else if (i === position - 1) span.classList.add("current");
      span.textContent = mv;
      textEl.appendChild(span);
      if (i < moves.length - 1) textEl.appendChild(document.createTextNode(" "));
    });
  }

  function updateUI() {
    if (posEl) {
      if (hidePosWhenEmpty && !moves.length) {
        posEl.textContent = "";
      } else {
        let pos = `${position} / ${moves.length}`;
        if (lastTPS !== null) pos += ` <span class="tps">· ${lastTPS.toFixed(1)} TPS</span>`;
        posEl.innerHTML = pos;
      }
    }
    if (prevBtn) prevBtn.disabled = position <= 0;
    if (nextBtn) nextBtn.disabled = position >= moves.length;
    if (playBtn) {
      playBtn.textContent = autoplay ? "⏸" : "▶";
      playBtn.title = autoplay ? "Pause" : "Play";
      playBtn.disabled = moves.length === 0;
    }
    if (copyBtn) copyBtn.disabled = moves.length === 0;
    renderText();
  }

  async function stepLoop() {
    if (stepping) return;
    stepping = true;
    pauseRequested = false;
    while (position !== target && !pauseRequested) {
      const forward = target > position;
      const move = forward ? moves[position] : invertMove(moves[position - 1]);
      if (onStepStart) try { onStepStart(forward); } catch {}
      try {
        await runMove(move);
      } catch {
        if (onStepEnd) try { onStepEnd(forward, false, autoplay); } catch {}
        break;
      }
      if (forward) position++;
      else position--;
      const finalStep = forward && position >= moves.length;
      if (onStepEnd) try { onStepEnd(forward, finalStep, autoplay); } catch {}
      if (onMoveApplied) onMoveApplied();
      if (autoplay) recordMove();
      updateUI();
      if (autoplay && position !== target && !pauseRequested) await sleep(gapMs());
    }
    stepping = false;
    pauseRequested = false;
    if (autoplay && position >= moves.length) {
      autoplay = false;
      updateUI();
    }
  }

  function seekTo(t) {
    target = Math.max(0, Math.min(moves.length, t | 0));
    stepLoop();
  }

  function manualNav(t) {
    autoplay = false;
    resetSession();
    seekTo(t);
    updateUI();
  }

  textEl.addEventListener("click", e => {
    const el = e.target.closest(".mv");
    if (!el || !textEl.contains(el)) return;
    manualNav(parseInt(el.dataset.idx, 10) + 1);
  });

  if (prevBtn) prevBtn.addEventListener("click", () => manualNav(position - 1));
  if (nextBtn) nextBtn.addEventListener("click", () => manualNav(position + 1));

  if (playBtn) playBtn.addEventListener("click", () => {
    if (autoplay) {
      // Pause: let the in-flight move finish, then stop. Don't rewind.
      autoplay = false;
      pauseRequested = true;
    } else if (position < moves.length) {
      autoplay = true;
      pauseRequested = false;
      resetSession();
      seekTo(moves.length);
    }
    updateUI();
  });

  if (copyBtn) copyBtn.addEventListener("click", async () => {
    if (!moves.length) return;
    try {
      await navigator.clipboard.writeText(moves.join(" "));
      copyBtn.classList.add("ok");
      const prevText = copyBtn.textContent;
      copyBtn.textContent = "✓";
      setTimeout(() => {
        copyBtn.classList.remove("ok");
        copyBtn.textContent = prevText;
      }, 900);
    } catch (err) {
      console.warn("[player] copy failed:", err);
    }
  });

  function setMoves(newMoves) {
    moves = [...newMoves];
    position = 0;
    target = 0;
    autoplay = false;
    resetSession();
    if (barEl) barEl.hidden = moves.length === 0;
    updateUI();
  }

  function onBackendPlay(move) {
    if (stepping) return;
    if (position < moves.length && moves[position] === move) {
      position++;
      if (target < position) target = position;
      recordMove();
      updateUI();
    }
  }

  function clear() { setMoves([]); }

  function rewind() {
    if (!moves.length) return;
    position = 0;
    target = 0;
    autoplay = false;
    resetSession();
    updateUI();
  }

  function togglePlay() { if (playBtn) playBtn.click(); }
  function stepForward() { if (nextBtn && !nextBtn.disabled) nextBtn.click(); }
  function stepBack() { if (prevBtn && !prevBtn.disabled) prevBtn.click(); }
  function getMoves() { return [...moves]; }
  function getPosition() { return position; }
  function isPlaying() { return autoplay; }

  updateUI();

  return {
    setMoves, onBackendPlay, clear, rewind, togglePlay, stepForward, stepBack,
    getMoves, getPosition, isPlaying,
  };
}