"""Tracks the current state of the cube on the backend.

Backed by the nested-list state format from standard.py. Updated move-by-move
as the GUI or the backend plays moves. Used to gate scrambles (must be solved)
and to compute solutions for robot-mode reset.

Also keeps a stack of moves applied since the cube was last in SOLVED_STATE.
The stack auto-clears every time the matrix returns to SOLVED_STATE, so at
any point `moves` is exactly the sequence needed to reach the current state
from solved. Reversing + inverting that stack gives the undo sequence used
by the robot-mode reset.
"""

import copy

from standard import SOLVED_STATE, COLOR_TO_FACE
from domoves import apply_move as _apply_move


def _invert(move: str) -> str:
    if move.endswith("2"):
        return move
    if move.endswith("'"):
        return move[:-1]
    return move + "'"


class CubeState:
    def __init__(self):
        self.state = copy.deepcopy(SOLVED_STATE)
        self.moves = []          # stack of moves since last solved (empty when solved)
        # Optional callback invoked after each successful apply(move).
        self.on_apply = None

    def reset(self):
        self.state = copy.deepcopy(SOLVED_STATE)
        self.moves = []

    def apply(self, move: str):
        _apply_move(self.state, move)
        self.moves.append(move)
        # If we happen to be back at solved, the stack has served its purpose.
        if self.state == SOLVED_STATE:
            self.moves = []
        if self.on_apply is not None:
            try:
                self.on_apply(move)
            except Exception as e:
                print(f"[cubestate] on_apply error: {e}", flush=True)

    def apply_moves(self, moves):
        for m in moves:
            self.apply(m)

    def is_solved(self) -> bool:
        """True only when the matrix matches SOLVED_STATE exactly."""
        return self.state == SOLVED_STATE

    def undo_sequence(self):
        """Return moves that (when played) undo the current stack."""
        return [_invert(m) for m in reversed(self.moves)]

    def kociemba(self) -> str:
        """54-char kociemba string: faces in U R F D L B order, row-major."""
        out = []
        for face in self.state:
            for row in face:
                for c in row:
                    out.append(COLOR_TO_FACE[c])
        return "".join(out)
