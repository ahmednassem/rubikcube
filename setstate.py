import kociemba


def check_state(s: str):
    """Validate a 54-char kociemba-order state string. Returns (ok, reason)."""
    if not isinstance(s, str) or len(s) != 54:
        return False, f"expected 54 chars, got {len(s) if isinstance(s, str) else type(s).__name__}"
    allowed = set("URFDLB")
    for ch in s:
        if ch not in allowed:
            return False, f"invalid sticker char {ch!r}"
    counts = {f: s.count(f) for f in "URFDLB"}
    for f, n in counts.items():
        if n != 9:
            return False, f"{f}: {n} stickers (expected 9)"
    for i, f in enumerate("URFDLB"):
        if s[i * 9 + 4] != f:
            return False, f"center of {f} face must be {f}"
    try:
        kociemba.solve(s)
    except Exception as e:
        return False, f"unsolvable: {e}"
    return True, "solvable"


def _invert(move: str) -> str:
    if move.endswith("2"):
        return move
    if move.endswith("'"):
        return move[:-1]
    return move + "'"


def scramble_to_state(s: str):
    """Return a move list that, applied to a solved cube, reaches state s.

    Found by solving s with kociemba, then reversing the solution and
    inverting each move.
    """
    solution = kociemba.solve(s).split()
    return [_invert(m) for m in reversed(solution)]
