# ═══════════════════════════════════════════════════════════════════════════════
# RUBIK'S CUBE :  KOCIEMBA STANDARD
# ═══════════════════════════════════════════════════════════════════════════════
# Everything in this project follows Kociemba's standard exactly.
# No conversion needed :  state → kociemba string is a direct mapping.
# ═══════════════════════════════════════════════════════════════════════════════


# ── Orientation ───────────────────────────────────────────────────────────────
#
#            White (U)
#               │
#  Orange (L) ──┼── Red (R)
#               │
#            Green (F)  ← facing you
#               │
#            Blue (B)   ← behind
#               │
#           Yellow (D)
#
#   U = White   top
#   D = Yellow  bottom
#   F = Green   front (facing you)
#   B = Blue    back
#   R = Red     right
#   L = Orange  left
# which way each face points in 3D
# U face normal → +Y
# D face normal → -Y
# R face normal → +X
# L face normal → -X
# F face normal → +Z
# B face normal → -Z

# ── Colors ────────────────────────────────────────────────────────────────────

COLORS = {
    "W": "White",    # U face
    "Y": "Yellow",   # D face
    "G": "Green",    # F face
    "B": "Blue",     # B face
    "R": "Red",      # R face
    "O": "Orange",   # L face
}

# center piece of each face :  never moves, defines face identity
FACE_COLORS = {
    "U": "W",   # Up    = White
    "D": "Y",   # Down  = Yellow
    "F": "G",   # Front = Green
    "B": "B",   # Back  = Blue
    "R": "R",   # Right = Red
    "L": "O",   # Left  = Orange
}

# color → face letter (same as Kociemba :  no conversion needed)
COLOR_TO_FACE = {
    "W": "U",
    "Y": "D",
    "G": "F",
    "B": "B",
    "R": "R",
    "O": "L",
}

# Kociemba face order for the 54-char string
KOCIEMBA_ORDER = ["U", "R", "F", "D", "L", "B"]

# solved Kociemba string :  used to check if cube is already solved
SOLVED_STRING = "UUUUUUUUURRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB"


# ── Solved State ──────────────────────────────────────────────────────────────
#
# list of 6 faces in Kociemba order: U R F D L B
# state[face][row][col]
#   face 0=U  1=R  2=F  3=D  4=L  5=B
#   row  0=top          2=bottom
#   col  0=left         2=right
#   center = state[face][1][1] :  never changes

U, R, F, D, L, B = 0, 1, 2, 3, 4, 5

SOLVED_STATE = [
    [["W", "W", "W"],    # 0 = U
     ["W", "W", "W"],
     ["W", "W", "W"]],

    [["R", "R", "R"],    # 1 = R
     ["R", "R", "R"],
     ["R", "R", "R"]],

    [["G", "G", "G"],    # 2 = F
     ["G", "G", "G"],
     ["G", "G", "G"]],

    [["Y", "Y", "Y"],    # 3 = D
     ["Y", "Y", "Y"],
     ["Y", "Y", "Y"]],

    [["O", "O", "O"],    # 4 = L
     ["O", "O", "O"],
     ["O", "O", "O"]],

    [["B", "B", "B"],    # 5 = B
     ["B", "B", "B"],
     ["B", "B", "B"]],
]

# ── Move Notation ─────────────────────────────────────────────────────────────
#
# Format: {layers}{face}{turns}{modifier}
#
#   modifier → none = 90° clockwise
#              '    = 90° counter-clockwise
#              2    = 180°
#
#   layers   → prefix number (e.g. 2R = 2 layers from R side)
#              default = 1

BASIC          = ["U", "D", "F", "B", "R", "L"]
INVERSE        = ["U'", "D'", "F'", "B'", "R'", "L'"]
DOUBLE         = ["U2", "D2", "F2", "B2", "R2", "L2"]

WIDE           = ["u", "d", "f", "b", "r", "l"]
WIDE_INVERSE   = ["u'", "d'", "f'", "b'", "r'", "l'"]
WIDE_DOUBLE    = ["u2", "d2", "f2", "b2", "r2", "l2"]

# M → same direction as L
# E → same direction as D (counter-clockwise vs U)
# S → same direction as F
SLICES         = ["M", "E", "S"]
SLICES_INVERSE = ["M'", "E'", "S'"]
SLICES_DOUBLE  = ["M2", "E2", "S2"]

# X → around R axis
# Y → around U axis
# Z → around F axis
ROTATIONS         = ["X", "Y", "Z"]
ROTATIONS_INVERSE = ["X'", "Y'", "Z'"]
ROTATIONS_DOUBLE  = ["X2", "Y2", "Z2"]

# which direction is X, Y, Z in 3D space
# X → right (R face direction)
# Y → up    (U face direction)
# Z → toward you (F face direction)

ALL_MOVES = (
    BASIC + INVERSE + DOUBLE +
    WIDE  + WIDE_INVERSE + WIDE_DOUBLE +
    SLICES + SLICES_INVERSE + SLICES_DOUBLE +
    ROTATIONS + ROTATIONS_INVERSE + ROTATIONS_DOUBLE
)


# ── Data Types ────────────────────────────────────────────────────────────────
#
# state           : list[list[list[str]]]
#                   6 faces in Kociemba order: U R F D L B
#                   each face = 3x3 nested list of "W","Y","G","B","R","O"
#                   access: state[face][row][col]
#                   face: U=0, R=1, F=2, D=3, L=4, B=5
#
# move            : str       → "R", "U'", "F2", "2L"
# move_list       : list[str] → ["R", "U", "R'", "U'"]
# scramble        : list       → ["R U R' F2 L D'"]
# kociemba_string : str       → 54 chars, order U R F D L B
# face            : int       → U=0, R=1, F=2, D=3, L=4, B=5
# color           : str       → "W" "Y" "G" "B" "R" "O"
# row             : int       → 0 (top) to 2 (bottom)
# col             : int       → 0 (left) to 2 (right)
# one move        : chr       > "U" ,"R"