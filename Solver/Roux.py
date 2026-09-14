"""Roux solver (blocks → CMLL → LSE).

Stub: falls back to the Kociemba two-phase solver for now.
"""

from .Kociemba import Kociemba as _Kociemba


class Roux:
    name = "Roux"

    def __init__(self):
        self._fallback = _Kociemba()

    def solve(self, state, scramble=None):
        return self._fallback.solve(state, scramble)