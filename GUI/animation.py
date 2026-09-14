"""Manim animation of a 3x3 Rubik's Cube.

Run:
    manim -pqh animation.py RubiksCubeScene

Requires Manim Community (manim>=0.18) with OpenGL/Cairo 3D support.
"""

from __future__ import annotations

import numpy as np
from manim import (
    BLACK,
    BLUE,
    DEGREES,
    GREEN,
    ORANGE,
    OUT,
    RED,
    RIGHT,
    UP,
    WHITE,
    YELLOW,
    Cube,
    Group,
    LEFT,
    DOWN,
    IN,
    Rotate,
    Square,
    ThreeDScene,
    VGroup,
)


FACE_COLORS = {
    "U": WHITE,
    "D": YELLOW,
    "F": GREEN,
    "B": BLUE,
    "L": ORANGE,
    "R": RED,
}

# Axis aligned normals for each face of a cubie.
FACE_NORMALS = {
    "U": np.array([0, 0, 1]),
    "D": np.array([0, 0, -1]),
    "F": np.array([0, -1, 0]),
    "B": np.array([0, 1, 0]),
    "R": np.array([1, 0, 0]),
    "L": np.array([-1, 0, 0]),
}


def make_cubie(position: np.ndarray, size: float = 1.0) -> VGroup:
    """Build a single cubie: a black cube with colored sticker squares on outer faces."""
    body = Cube(side_length=size, fill_color=BLACK, fill_opacity=1, stroke_width=0)
    body.move_to(position)

    stickers = VGroup()
    sticker_size = size * 0.9
    offset = size / 2 + 0.001  # nudge sticker slightly outside the cubie face

    for face, normal in FACE_NORMALS.items():
        # Only place a sticker when this cubie lies on that outer face layer.
        coord = position[np.argmax(np.abs(normal))]
        if np.sign(coord) != np.sign(normal[np.argmax(np.abs(normal))]):
            continue
        if abs(coord) < 0.5:
            continue

        sticker = Square(
            side_length=sticker_size,
            fill_color=FACE_COLORS[face],
            fill_opacity=1,
            stroke_color=BLACK,
            stroke_width=2,
        )

        # Orient the sticker so its normal matches the face normal.
        if face in ("U", "D"):
            pass  # default square lies in XY plane, normal = +Z
            if face == "D":
                sticker.rotate(180 * DEGREES, axis=RIGHT)
        elif face in ("F", "B"):
            sticker.rotate(90 * DEGREES, axis=RIGHT)
            if face == "B":
                sticker.rotate(180 * DEGREES, axis=UP)
        elif face in ("R", "L"):
            sticker.rotate(90 * DEGREES, axis=UP)
            if face == "L":
                sticker.rotate(180 * DEGREES, axis=UP)

        sticker.move_to(position + normal * offset)
        stickers.add(sticker)

    cubie = VGroup(body, stickers)
    return cubie


def build_cube(size: float = 1.0) -> VGroup:
    """Build the full 3x3x3 Rubik's cube from 27 cubies."""
    cube = VGroup()
    for x in (-1, 0, 1):
        for y in (-1, 0, 1):
            for z in (-1, 0, 1):
                pos = np.array([x, y, z]) * size
                cube.add(make_cubie(pos, size=size))
    return cube


def layer_cubies(cube: VGroup, axis: str, layer: int, size: float = 1.0) -> Group:
    """Return the 9 cubies whose center lies on the given axis layer (-1, 0, 1)."""
    axis_index = {"x": 0, "y": 1, "z": 2}[axis]
    selected = Group()
    for cubie in cube:
        center = cubie.get_center()
        if np.isclose(center[axis_index], layer * size, atol=0.2):
            selected.add(cubie)
    return selected


class RubiksCubeScene(ThreeDScene):
    def construct(self):
        self.set_camera_orientation(phi=65 * DEGREES, theta=-45 * DEGREES, distance=10)

        cube = build_cube(size=1.0)
        self.add(cube)
        self.wait(0.5)

        # Gentle ambient rotation so the cube is easy to read.
        self.begin_ambient_camera_rotation(rate=0.15)

        # Sequence of moves: (axis, layer, angle_degrees).
        moves = [
            ("x", 1, -90),   # R
            ("z", 1, -90),   # U
            ("x", 1, 90),    # R'
            ("z", 1, 90),    # U'
            ("y", -1, -90),  # F
            ("z", 1, -90),   # U
            ("y", -1, 90),   # F'
        ]

        axes = {"x": RIGHT, "y": UP * 0 + np.array([0, 1, 0]), "z": OUT}

        for axis, layer, angle in moves:
            group = layer_cubies(cube, axis, layer)
            self.play(
                Rotate(group, angle=angle * DEGREES, axis=axes[axis]),
                run_time=0.8,
            )
            self.wait(0.1)

        self.wait(1.0)
        self.stop_ambient_camera_rotation()
        self.wait(0.5)
