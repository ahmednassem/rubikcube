"""ZZ solver (EOLine → F2L → LL).

Stub: falls back to the Kociemba two-phase solver for now.
"""

from .Kociemba import Kociemba as _Kociemba


class ZZ:
    name = "ZZ"

    def __init__(self):
        self._fallback = _Kociemba()

    def solve(self, state, scramble=None):
        return self._fallback.solve(state, scramble)