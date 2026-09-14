import random
from standard import BASIC, INVERSE, DOUBLE

# WCA-style scramble generator.
#
# Rules to avoid redundant moves:
#   1. Never repeat the same face back-to-back  (e.g. R R', R R2)
#   2. Never do face-axis-face when both neighbors share an axis
#      (e.g. R L R is equivalent to a shorter sequence and is excluded)
#
# Each entry (U, U', U2, ...) counts as one move.

FACES = ["U", "D", "R", "L", "F", "B"]
AXIS  = {"U": 0, "D": 0, "R": 1, "L": 1, "F": 2, "B": 2}
MODIFIERS = ["", "'", "2"]

# sanity: the pool we draw from is exactly BASIC + INVERSE + DOUBLE
_POOL = set(BASIC) | set(INVERSE) | set(DOUBLE)


def generate(length=21):
    moves = []
    prev = None
    prev_prev = None
    while len(moves) < length:
        face = random.choice(FACES)
        if face == prev:
            continue
        if prev is not None and prev_prev is not None:
            if AXIS[face] == AXIS[prev] == AXIS[prev_prev]:
                continue
        move = face + random.choice(MODIFIERS)
        assert move in _POOL
        moves.append(move)
        prev_prev = prev
        prev = face
    return moves


if __name__ == "__main__":
    s = generate()
    print(len(s), "moves:", " ".join(s))
