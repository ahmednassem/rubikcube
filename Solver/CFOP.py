"""CFOP solver (Cross → F2L → OLL → PLL).

Stub: falls back to the Kociemba two-phase solver for now. Real CFOP logic
can replace the body without touching the interface.
"""

from .Kociemba import Kociemba as _Kociemba


class CFOP:
    name = "CFOP"

    def __init__(self):
        self._fallback = _Kociemba()

    def solve(self, state, scramble=None):
        return self._fallback.solve(state, scramble)