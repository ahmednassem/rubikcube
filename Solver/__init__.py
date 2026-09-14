"""Cube solver backends.

Each solver exposes the same interface:

    solver.solve(state, scramble=None) -> list[str]

`state` is the 6x3x3 nested-list matrix from cubestate.py (same format as
standard.SOLVED_STATE). `scramble` is the move list the scramble was built
from, passed in for solvers that want to use it as context (e.g. CFOP may
optimise its first step differently given the scramble). Solvers that don't
care can ignore it.

For now all four backends delegate to the `kociemba` package on the
state-serialized-to-54-chars string. Real implementations can replace the
bodies one at a time without touching the rest of the app.
"""