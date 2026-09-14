"""Apply cube moves to a state (nested-list format from standard.py).

State format: list[6] of list[3] of list[3] :  faces ordered U R F D L B,
each face a 3x3 of color chars. See standard.py for the convention.

Primitives: U D F B R L (face + 4-strip cycle) and M E S (4-strip cycle only).
Composites: lowercase wide moves (u d f b r l) and rotations (X Y Z) decompose
into commuting primitives that act on disjoint layers.

Modifiers: "" = CW, "'" = CCW, "2" = 180°. Each move may be applied to a
layer from outside its own face (CW from outside view).

Strips are pre-ordered so the cycle is a direct element-wise copy
(no index reversals at apply time).
"""

from standard import U, R, F, D, L, B


def _rotate_cw(face):
    return [[face[2 - j][i] for j in range(3)] for i in range(3)]


def _rotate_ccw(face):
    return [[face[j][2 - i] for j in range(3)] for i in range(3)]


# Each primitive: (face_index_or_None, [strip_A, strip_B, strip_C, strip_D])
# CW move cycles: strip_A → strip_B → strip_C → strip_D → strip_A.
# For slices (M E S) there is no face to rotate :  face_index is None.
_PRIMS = {
    "U": (U, [
        [(F, 0, 0), (F, 0, 1), (F, 0, 2)],
        [(L, 0, 0), (L, 0, 1), (L, 0, 2)],
        [(B, 0, 0), (B, 0, 1), (B, 0, 2)],
        [(R, 0, 0), (R, 0, 1), (R, 0, 2)],
    ]),
    "D": (D, [
        [(F, 2, 0), (F, 2, 1), (F, 2, 2)],
        [(R, 2, 0), (R, 2, 1), (R, 2, 2)],
        [(B, 2, 0), (B, 2, 1), (B, 2, 2)],
        [(L, 2, 0), (L, 2, 1), (L, 2, 2)],
    ]),
    "R": (R, [
        [(F, 0, 2), (F, 1, 2), (F, 2, 2)],
        [(U, 0, 2), (U, 1, 2), (U, 2, 2)],
        [(B, 2, 0), (B, 1, 0), (B, 0, 0)],
        [(D, 0, 2), (D, 1, 2), (D, 2, 2)],
    ]),
    "L": (L, [
        [(F, 0, 0), (F, 1, 0), (F, 2, 0)],
        [(D, 0, 0), (D, 1, 0), (D, 2, 0)],
        [(B, 2, 2), (B, 1, 2), (B, 0, 2)],
        [(U, 0, 0), (U, 1, 0), (U, 2, 0)],
    ]),
    "F": (F, [
        [(U, 2, 0), (U, 2, 1), (U, 2, 2)],
        [(R, 0, 0), (R, 1, 0), (R, 2, 0)],
        [(D, 0, 2), (D, 0, 1), (D, 0, 0)],
        [(L, 2, 2), (L, 1, 2), (L, 0, 2)],
    ]),
    "B": (B, [
        [(U, 0, 0), (U, 0, 1), (U, 0, 2)],
        [(L, 2, 0), (L, 1, 0), (L, 0, 0)],
        [(D, 2, 2), (D, 2, 1), (D, 2, 0)],
        [(R, 0, 2), (R, 1, 2), (R, 2, 2)],
    ]),

    # M: middle x-layer, same direction as L (+90° around +X).
    "M": (None, [
        [(U, 0, 1), (U, 1, 1), (U, 2, 1)],
        [(F, 0, 1), (F, 1, 1), (F, 2, 1)],
        [(D, 0, 1), (D, 1, 1), (D, 2, 1)],
        [(B, 2, 1), (B, 1, 1), (B, 0, 1)],
    ]),
    # E: middle y-layer, same direction as D (+90° around +Y).
    "E": (None, [
        [(F, 1, 0), (F, 1, 1), (F, 1, 2)],
        [(R, 1, 0), (R, 1, 1), (R, 1, 2)],
        [(B, 1, 0), (B, 1, 1), (B, 1, 2)],
        [(L, 1, 0), (L, 1, 1), (L, 1, 2)],
    ]),
    # S: middle z-layer, same direction as F (-90° around +Z).
    "S": (None, [
        [(U, 1, 0), (U, 1, 1), (U, 1, 2)],
        [(R, 0, 1), (R, 1, 1), (R, 2, 1)],
        [(D, 1, 2), (D, 1, 1), (D, 1, 0)],
        [(L, 2, 1), (L, 1, 1), (L, 0, 1)],
    ]),
}


# Composite moves: list of (primitive_name, direction) where direction is +1 or -1.
# All primitives in a composite act on disjoint layers, so they commute.
_COMPOSITES = {
    # Wide moves :  base face + middle slice in the same direction.
    "u": [("U",  1), ("E", -1)],
    "d": [("D",  1), ("E",  1)],
    "r": [("R",  1), ("M", -1)],
    "l": [("L",  1), ("M",  1)],
    "f": [("F",  1), ("S",  1)],
    "b": [("B",  1), ("S", -1)],
    # Whole-cube rotations :  all three layers of the axis in the same direction.
    "X": [("R",  1), ("M", -1), ("L", -1)],
    "Y": [("U",  1), ("E", -1), ("D", -1)],
    "Z": [("F",  1), ("S",  1), ("B", -1)],
}


def _cycle_forward(state, strips):
    """Cycle A→B→C→D→A: save D, shift C→D, B→C, A→B, saved→A."""
    saved = [state[f][r][c] for (f, r, c) in strips[3]]
    for k in (3, 2, 1):
        for i, (f, r, c) in enumerate(strips[k]):
            sf, sr, sc = strips[k - 1][i]
            state[f][r][c] = state[sf][sr][sc]
    for i, (f, r, c) in enumerate(strips[0]):
        state[f][r][c] = saved[i]


def _cycle_backward(state, strips):
    """Cycle A←B←C←D←A (inverse of forward)."""
    saved = [state[f][r][c] for (f, r, c) in strips[0]]
    for k in (0, 1, 2):
        for i, (f, r, c) in enumerate(strips[k]):
            sf, sr, sc = strips[k + 1][i]
            state[f][r][c] = state[sf][sr][sc]
    for i, (f, r, c) in enumerate(strips[3]):
        state[f][r][c] = saved[i]


def _apply_prim(state, name, direction):
    face_idx, strips = _PRIMS[name]
    if direction > 0:
        if face_idx is not None:
            state[face_idx] = _rotate_cw(state[face_idx])
        _cycle_forward(state, strips)
    else:
        if face_idx is not None:
            state[face_idx] = _rotate_ccw(state[face_idx])
        _cycle_backward(state, strips)


def apply_move(state, move: str):
    base = move[0]
    mod = move[1:]

    if base in _PRIMS:
        sequence = [(base, 1)]
    elif base in _COMPOSITES:
        sequence = _COMPOSITES[base]
    else:
        raise ValueError(f"Unknown move: {move!r}")

    if mod == "":
        times, sign = 1, 1
    elif mod == "'":
        times, sign = 1, -1
    elif mod == "2":
        times, sign = 2, 1
    else:
        raise ValueError(f"Bad modifier in move {move!r}")

    for _ in range(times):
        for name, prim_dir in sequence:
            _apply_prim(state, name, prim_dir * sign)


def apply_moves(state, moves):
    for m in moves:
        apply_move(state, m)
