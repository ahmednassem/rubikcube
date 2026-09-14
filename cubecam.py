"""OpenCV-based cube face recognition (headless-compatible).

Auto-detects faces: reads webcam frames, classifies a 3×3 grid at the center
of the frame, and when the classification is stable for a few frames AND the
center color hasn't been captured yet, commits that snapshot as the face
matching its center color. Draws a mini-net overlay on the frame so the user
can watch progress live. When all 6 faces are captured the session is done.
"""

import cv2
import numpy as np


# HSV hue is 0-179 in OpenCV. Thresholds tuned for standard sticker colors.
def _classify_hsv(h, s, v):
    if s < 55 and v > 140:      return "U"   # white
    if v < 40:                  return "U"
    if h < 8 or h >= 170:       return "R"   # red
    if h < 22:                  return "L"   # orange
    if h < 38:                  return "D"   # yellow
    if h < 85:                  return "F"   # green
    if h < 130:                 return "B"   # blue
    return "R"


_DRAW_BGR = {
    "U": (230, 230, 230),
    "R": ( 58,  30, 196),
    "F": ( 81, 166,   0),
    "D": (  0, 213, 255),
    "L": (  0,  88, 255),
    "B": (186,  81,   0),
}

FACE_ORDER = ["U", "R", "F", "D", "L", "B"]

# How many consecutive frames of identical classification before auto-capture.
_STABLE_FRAMES = 10


def _sample_grid(frame, gx, gy, cell, sample):
    out = []
    for r in range(3):
        for c in range(3):
            cx = gx + c * cell + cell // 2
            cy = gy + r * cell + cell // 2
            s2 = sample // 2
            y0, y1 = max(0, cy - s2), cy + s2
            x0, x1 = max(0, cx - s2), cx + s2
            patch = frame[y0:y1, x0:x1]
            if patch.size == 0:
                out.append("U")
                continue
            mean_bgr = np.mean(patch.reshape(-1, 3), axis=0)
            hsv = cv2.cvtColor(np.uint8([[mean_bgr]]), cv2.COLOR_BGR2HSV)[0][0]
            out.append(_classify_hsv(int(hsv[0]), int(hsv[1]), int(hsv[2])))
    return out


def _draw_mini_net(frame, results):
    """Draw a small cross-layout net showing which faces are captured."""
    _, w = frame.shape[:2]
    cell = 10
    gap = 3
    face_px = 3 * cell
    net_w = 4 * face_px + 3 * gap
    net_h = 3 * face_px + 2 * gap
    margin = 12
    nx = w - net_w - margin
    ny = margin

    # Background plate
    cv2.rectangle(
        frame,
        (nx - 6, ny - 6),
        (nx + net_w + 6, ny + net_h + 6),
        (24, 24, 24), -1,
    )

    # Face position in the cross: (col, row) with col 0-3, row 0-2
    layout = {
        "U": (1, 0),
        "L": (0, 1), "F": (1, 1), "R": (2, 1), "B": (3, 1),
        "D": (1, 2),
    }
    for face, (fc, fr) in layout.items():
        fx = nx + fc * (face_px + gap)
        fy = ny + fr * (face_px + gap)
        stickers = results.get(face)
        for r in range(3):
            for c in range(3):
                sx = fx + c * cell
                sy = fy + r * cell
                if stickers is not None:
                    color = _DRAW_BGR.get(stickers[r * 3 + c], (80, 80, 80))
                else:
                    color = (60, 60, 60)
                cv2.rectangle(frame, (sx, sy), (sx + cell, sy + cell), color, -1)
                cv2.rectangle(frame, (sx, sy), (sx + cell, sy + cell), (0, 0, 0), 1)


class CubeCamera:
    """Auto-scans all 6 faces in one camera session."""

    def __init__(self):
        self.cap = None
        self.results = {}           # face_letter -> 9-char string
        self._last_letters = None
        self._stable_count = 0
        self._just_captured = None  # transiently set when a face is committed

    def open(self):
        cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
        if not cap.isOpened():
            cap = cv2.VideoCapture(0)
        if not cap.isOpened():
            raise RuntimeError("Could not open camera")
        self.cap = cap

    def close(self):
        if self.cap is not None:
            self.cap.release()
            self.cap = None

    def done(self):
        return len(self.results) >= len(FACE_ORDER)

    def next_frame_jpeg(self):
        """Read a frame, classify, auto-capture if stable, return JPEG bytes.

        Returns (jpeg_bytes, just_captured_face_or_None) or None on bad frame.
        """
        if self.cap is None:
            return None
        ok, frame = self.cap.read()
        if not ok:
            return None
        h, w = frame.shape[:2]
        grid = int(min(w, h) * 0.55)
        gx = (w - grid) // 2
        gy = (h - grid) // 2
        cell = grid // 3
        sample = max(10, cell // 4)

        letters = _sample_grid(frame, gx, gy, cell, sample)

        # Stability tracker.
        if letters == self._last_letters:
            self._stable_count += 1
        else:
            self._last_letters = letters
            self._stable_count = 1

        # Auto-capture: stable long enough AND this center color hasn't been
        # captured yet. Center pinned to its own letter by convention.
        just_captured = None
        center = letters[4]
        if (self._stable_count >= _STABLE_FRAMES
                and center in FACE_ORDER
                and center not in self.results):
            pinned = list(letters)
            pinned[4] = center
            self.results[center] = "".join(pinned)
            just_captured = center
            self._stable_count = 0

        # Overlay: cell-by-cell classification and bounding box.
        for r in range(3):
            for c in range(3):
                x1 = gx + c * cell
                y1 = gy + r * cell
                letter = letters[r * 3 + c]
                color = _DRAW_BGR[letter]
                cv2.rectangle(frame, (x1, y1), (x1 + cell, y1 + cell), color, 2)
                cv2.putText(
                    frame, letter,
                    (x1 + cell // 2 - 10, y1 + cell // 2 + 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, color, 2,
                )
        # Green when stable (near capture), orange otherwise.
        bound_color = (0, 255, 0) if self._stable_count >= _STABLE_FRAMES // 2 else (0, 165, 255)
        cv2.rectangle(frame, (gx, gy), (gx + grid, gy + grid), bound_color, 3)

        # Mini-net in the top-right corner.
        _draw_mini_net(frame, self.results)

        # Progress caption.
        remaining = [f for f in FACE_ORDER if f not in self.results]
        if remaining:
            caption = f"Captured {len(self.results)}/6 :  show any remaining: {' '.join(remaining)}"
        else:
            caption = "All 6 captured :  closing…"
        cv2.putText(
            frame, caption, (10, 30),
            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2,
        )

        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        if not ok:
            return None
        return buf.tobytes(), just_captured
