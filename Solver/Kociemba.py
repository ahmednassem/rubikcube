"""Kociemba two-phase solver."""

import kociemba as _kociemba

from standard import COLOR_TO_FACE


def _state_to_kociemba(state):
    out = []
    for face in state:
        for row in face:
            for c in row:
                out.append(COLOR_TO_FACE[c])
    return "".join(out)


class Kociemba:
    name = "Kociemba"

    def solve(self, state, scramble=None):
        s = _state_to_kociemba(state)
        solution = _kociemba.solve(s)
        return solution.split() if solution else []