from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
import uvicorn
import asyncio
import base64
import copy
import os
import webbrowser


# Demo mode (hosted deployment): no webcam, no real serial ports, no
# auto-opening browser. Enable with RUBIK_DEMO=1.
DEMO_MODE = os.environ.get("RUBIK_DEMO") == "1"


class NoCacheStaticFiles(StaticFiles):
    """Serve GUI assets with no-store so edits always show up on refresh."""
    def file_response(self, *args, **kwargs):
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = "no-store, must-revalidate"
        return resp

from serial.tools import list_ports

import kociemba

import scramble
from Robot.robot import Robot, FAKE_PORT
from syn import Syn
from setstate import check_state, scramble_to_state
from standard import SOLVED_STATE
from cubestate import CubeState, _invert as _invert_move
from Solver.Kociemba import Kociemba
from Solver.CFOP import CFOP
from Solver.Roux import Roux
from Solver.ZZ import ZZ


def available_ports():
    fake = [{"port": FAKE_PORT, "label": "Fake robot (no hardware)"}]
    if DEMO_MODE:
        return fake
    real = [
        {"port": p.device, "label": p.description or p.device}
        for p in list_ports.comports()
    ]
    return fake + real


# Pluggable solvers :  all currently delegate to kociemba for the actual math.
# Stateless, so they're safely shared across sessions.
SOLVERS = {
    "kociemba": Kociemba(),
    "cfop": CFOP(),
    "roux": Roux(),
    "zz": ZZ(),
}


class Session:
    """Everything one connected visitor owns: cube state, robot link,
    move-sync engine, camera, and scramble/solve bookkeeping.

    One Session is created per WebSocket connection, so every visitor
    gets an independent cube.
    """

    def __init__(self):
        self.state = {
            "scramble": [],                 # last-generated scramble, used by do_scramble
            "scramble_done": False,         # True after Do Scramble has fully played
            "scramble_matrix": None,        # cubestate matrix right after the scramble finished
            "post_scramble_moves": [],      # moves applied since the scramble finished
            "suppress_tracking": 0,         # >0 while we're replaying a "system" sequence
            # Solve preview: moves computed by a solver, waiting for Do Solve.
            "solve": [],                    # last solver output (moves list)
            "solve_method": None,           # which solver produced it
            "solve_matrix": None,           # cubestate matrix at compute time
        }
        self.robot = Robot()                     # starts in stub mode
        self.cubestate = CubeState()             # backend-tracked cube state
        self.cubestate.on_apply = self._track_move
        self.syn = Syn(self.robot, self.cubestate)
        # Active OpenCV camera session + its streaming task (at most one).
        self.camera = {"session": None, "task": None}

    def _track_move(self, move):
        state = self.state
        if state["suppress_tracking"] > 0:
            return
        if state["scramble_done"]:
            state["post_scramble_moves"].append(move)
        # If this move landed the cube in its solved state, wipe the
        # scramble / solve flags :  the session is logically over.
        if self.cubestate.state == SOLVED_STATE:
            state["scramble_done"] = False
            state["scramble_matrix"] = None
            state["post_scramble_moves"] = []
            state["solve"] = []
            state["solve_method"] = None
            state["solve_matrix"] = None

    def close_camera(self):
        sess = self.camera["session"]
        task = self.camera["task"]
        self.camera["session"] = None
        self.camera["task"] = None
        if task is not None:
            task.cancel()
        if sess is not None:
            sess.close()

    def robot_status(self):
        return {
            "type": "robot_status",
            "state": self.robot.state,       # "stub" | "connected" | "robot"
            "port": self.robot.port,
            "connected": self.robot.connected,
            "calibrated": self.robot.calibrated,
        }

    def fake_status_msg(self):
        return {
            "type": "fake_status",
            "active": self.robot._fake,
            "mode": self.robot.fake_mode,
        }

    def cube_state_msg(self):
        state = self.state
        in_scramble = (
            state["scramble_done"]
            and state["scramble_matrix"] is not None
            and self.cubestate.state == state["scramble_matrix"]
        )
        return {
            "type": "cube_state",
            "solved": self.cubestate.is_solved(),
            "matrix": self.cubestate.kociemba(),        # 54 chars, URFDLB order
            "scramble_done": state["scramble_done"],
            "scramble_state": in_scramble,              # cube exactly at post-scramble matrix
            "post_scramble_count": len(state["post_scramble_moves"]),
        }


async def _camera_stream(sess: Session, socket):
    """Pump JPEG frames from the OpenCV camera to the GUI at ~20 FPS.

    The camera session auto-captures faces when their classification is
    stable; when all 6 are captured we send `camera_all_done` and close.
    """
    while sess.camera["session"] is not None:
        cam = sess.camera["session"]
        result = await asyncio.to_thread(cam.next_frame_jpeg)
        if result is None:
            await asyncio.sleep(0.05)
            continue
        jpeg_bytes, just_captured = result
        b64 = base64.b64encode(jpeg_bytes).decode("ascii")
        try:
            await socket.send_json({
                "type": "camera_frame",
                "image": b64,
                "progress": len(cam.results),
                "captured_face": just_captured,
            })
        except Exception:
            break
        if cam.done():
            faces = dict(cam.results)
            try:
                await socket.send_json({
                    "type": "camera_all_done", "faces": faces,
                })
            except Exception:
                pass
            sess.close_camera()
            return
        await asyncio.sleep(1 / 20)


@asynccontextmanager
async def lifespan(_app):
    if not DEMO_MODE:
        async def open_browser():
            await asyncio.sleep(0.6)
            webbrowser.open("http://127.0.0.1:8000")
        asyncio.create_task(open_browser())
    yield


app = FastAPI(lifespan=lifespan)


@app.websocket("/ws")
async def ws(socket: WebSocket):
    await socket.accept()
    sess = Session()
    state = sess.state
    robot = sess.robot
    cubestate = sess.cubestate
    syn = sess.syn
    syn.attach(socket)
    print("[gui->main] connected (new session)", flush=True)

    async def _safe_send(payload):
        try:
            await socket.send_json(payload)
        except Exception:
            pass

    def _fake_listener(move):
        # Called from Robot.play_move in fake mode. We can't await here, so
        # just schedule a send on the running loop.
        try:
            loop = asyncio.get_event_loop()
            loop.create_task(_safe_send({"type": "fake_move", "move": move}))
        except Exception:
            pass

    def _syn_listener(status):
        try:
            loop = asyncio.get_event_loop()
            loop.create_task(_safe_send({"type": "syn_status", **status}))
        except Exception:
            pass

    robot.set_fake_listener(_fake_listener)
    syn.set_listener(_syn_listener)

    await socket.send_json({"type": "config", "demo": DEMO_MODE})
    await socket.send_json({"type": "robot_ports", "ports": available_ports()})
    await socket.send_json(sess.robot_status())
    await socket.send_json(sess.cube_state_msg())
    await socket.send_json(sess.fake_status_msg())
    await socket.send_json({"type": "syn_status", **syn.status})
    try:
        while True:
            msg = await socket.receive_json()
            t = msg.get("type")

            if t == "move":
                move = msg["move"]
                local = bool(msg.get("local"))

                if local:
                    # Normal-mode drag: GUI already committed the rotation
                    # visually. Just sync our matrix :  no syn, no animation.
                    print(f"[gui->main] move (local): {move}", flush=True)
                    try:
                        cubestate.apply(move)
                    except ValueError as e:
                        print(f"[cubestate] {e}", flush=True)
                    await socket.send_json(sess.cube_state_msg())
                    continue

                # Otherwise go through syn so GUI + cubestate + robot all
                # advance in lockstep with ack gating.
                req_id = msg.get("id")
                print(f"[gui->main] move: {move} (id={req_id})", flush=True)

                async def _play_one(m, rid):
                    try:
                        await syn.play([m])
                        ok, err = True, None
                    except Exception as e:
                        ok, err = False, repr(e)
                    if rid is not None:
                        try:
                            await socket.send_json({
                                "type": "move_done", "id": rid,
                                "move": m, "ok": ok, "error": err,
                            })
                        except Exception:
                            pass
                asyncio.create_task(_play_one(move, req_id))

            elif t == "ack":
                syn.on_gui_ack()

            elif t == "action":
                action = msg["action"]
                print(f"[gui->main] action: {action}", flush=True)

                if action == "get_scramble":
                    state["scramble"] = scramble.generate()
                    state["scramble_done"] = False
                    state["scramble_matrix"] = None
                    state["post_scramble_moves"] = []
                    moves = state["scramble"]
                    print(f"[main->gui] scramble: {' '.join(moves)}", flush=True)
                    await socket.send_json({"type": "scramble", "moves": moves})
                    await socket.send_json(sess.cube_state_msg())

                elif action == "do_scramble":
                    if not state["scramble"]:
                        await socket.send_json({
                            "type": "scramble_blocked",
                            "reason": "No scramble to apply: click Get Scramble first",
                        })
                        continue
                    if not cubestate.is_solved():
                        await socket.send_json({
                            "type": "scramble_blocked",
                            "reason": "Cube must be solved before running scramble",
                        })
                        continue

                    async def _play_scramble_then_mark(moves_to_play):
                        state["suppress_tracking"] += 1
                        try:
                            await syn.play(moves_to_play)
                        finally:
                            state["suppress_tracking"] -= 1
                        # Finished :  cube is now "in scramble state".
                        state["scramble_done"] = True
                        state["scramble_matrix"] = copy.deepcopy(cubestate.state)
                        state["post_scramble_moves"] = []
                        try:
                            await socket.send_json(sess.cube_state_msg())
                        except Exception:
                            pass
                    asyncio.create_task(_play_scramble_then_mark(list(state["scramble"])))

                elif action == "execute":
                    moves = msg.get("moves", [])
                    if not moves:
                        print("[main] execute: empty moves", flush=True)
                        continue
                    print(f"[gui->main] execute: {' '.join(moves)}", flush=True)
                    asyncio.create_task(syn.play(moves))

                elif action == "robot_connect":
                    port = (msg.get("port") or "").strip()
                    if not port:
                        await socket.send_json({
                            "type": "robot_status", "state": "error",
                            "message": "port is required",
                        })
                        continue
                    if DEMO_MODE and port != FAKE_PORT:
                        await socket.send_json({
                            "type": "robot_status", "state": "error",
                            "message": "Only the fake robot is available in the hosted demo",
                        })
                        continue
                    try:
                        await robot.connect(port)
                        await socket.send_json(sess.robot_status())
                        await socket.send_json(sess.fake_status_msg())
                    except Exception as e:
                        print(f"[robot] connect failed: {e}", flush=True)
                        await socket.send_json({
                            "type": "robot_status", "state": "error",
                            "message": str(e),
                        })

                elif action == "robot_disconnect":
                    await robot.disconnect()
                    await socket.send_json(sess.robot_status())
                    await socket.send_json(sess.fake_status_msg())

                elif action == "refresh_ports":
                    await socket.send_json({"type": "robot_ports", "ports": available_ports()})

                elif action == "robot_calibrate":
                    # Toggle calibration (i.e., robot mode). Explicit on/off
                    # allowed via msg.on, otherwise just flip whatever it is.
                    target = msg.get("on")
                    if target is None:
                        target = not robot.calibrated
                    try:
                        robot.set_calibrated(bool(target))
                    except RuntimeError as e:
                        await socket.send_json({
                            "type": "robot_status", "state": robot.state,
                            "port": robot.port, "message": str(e),
                            "connected": robot.connected,
                            "calibrated": robot.calibrated,
                        })
                        continue
                    print(f"[robot] calibrated={robot.calibrated}", flush=True)
                    await socket.send_json(sess.robot_status())

                elif action == "fake_ack":
                    robot.ack_fake()

                elif action == "fake_error":
                    robot.error_fake(msg.get("reason") or "fake robot error")

                elif action == "robot_config":
                    # Read/update robot settings. Baud + timeout apply on the
                    # next connect; fake delay + ack mode apply immediately.
                    # A message with no fields is just a read.
                    if "baud" in msg:
                        try:
                            robot.baud = max(300, int(msg["baud"]))
                        except (TypeError, ValueError):
                            pass
                    if "timeout" in msg:
                        try:
                            robot.timeout = min(120, max(1, int(msg["timeout"])))
                        except (TypeError, ValueError):
                            pass
                    if "fake_delay" in msg:
                        try:
                            robot.fake_delay = min(5.0, max(0.0, float(msg["fake_delay"])))
                        except (TypeError, ValueError):
                            pass
                    if "fake_mode" in msg:
                        try:
                            robot.set_fake_mode(msg["fake_mode"])
                        except ValueError as e:
                            print(f"[robot_config] {e}", flush=True)
                    await socket.send_json({
                        "type": "robot_config",
                        "baud": robot.baud,
                        "timeout": robot.timeout,
                        "fake_delay": robot.fake_delay,
                        "fake_mode": robot.fake_mode,
                    })

                elif action == "fake_mode":
                    mode = msg.get("mode", "auto")
                    try:
                        robot.set_fake_mode(mode)
                    except ValueError as e:
                        print(f"[fake] {e}", flush=True)
                        continue
                    await socket.send_json(sess.fake_status_msg())

                elif action == "reset":
                    # Normal mode: instant reset (no moves).
                    # Robot mode: solve the current state in the background and
                    # play those moves so the physical cube ends up solved. The
                    # scramble panel keeps whatever scramble was there :  the
                    # solution is NOT exposed as a scramble; it's applied and
                    # forgotten.
                    if robot.state != "connected":
                        cubestate.reset()
                        state["scramble_done"] = False
                        state["scramble_matrix"] = None
                        state["post_scramble_moves"] = []
                        await socket.send_json({"type": "reset_done"})
                        await socket.send_json(sess.cube_state_msg())
                        continue
                    if cubestate.is_solved():
                        print("[main] reset: already solved", flush=True)
                        continue

                    # Prefer the saved move stack: reverse + invert to undo.
                    # This is only accurate if every state change went through
                    # cubestate.apply (which is how the invariant is kept).
                    # Fall back to kociemba.solve if the stack is empty (e.g.
                    # the state was edited directly via Set State).
                    if cubestate.moves:
                        solution = cubestate.undo_sequence()
                        print(f"[main] reset by undo stack: {' '.join(solution)}", flush=True)
                    else:
                        try:
                            solution = kociemba.solve(cubestate.kociemba()).split()
                        except Exception as e:
                            await socket.send_json({
                                "type": "scramble_blocked",
                                "reason": f"Can't solve current state: {e}",
                            })
                            continue
                        print(f"[main] reset by kociemba: {' '.join(solution)}", flush=True)

                    if not solution:
                        continue

                    async def _play_reset_then_signal(moves_to_play):
                        state["suppress_tracking"] += 1
                        try:
                            await syn.play(moves_to_play)
                        finally:
                            state["suppress_tracking"] -= 1
                        state["scramble_done"] = False
                        state["scramble_matrix"] = None
                        state["post_scramble_moves"] = []
                        try:
                            await socket.send_json({"type": "reset_done"})
                            await socket.send_json(sess.cube_state_msg())
                        except Exception:
                            pass
                    asyncio.create_task(_play_reset_then_signal(solution))

                elif action == "check_state":
                    ok, reason = check_state(msg.get("state", ""))
                    await socket.send_json({
                        "type": "state_check", "valid": ok, "reason": reason,
                    })

                elif action == "camera_start":
                    if DEMO_MODE:
                        await socket.send_json({
                            "type": "camera_error",
                            "error": "Camera is not available in the hosted demo",
                        })
                        continue
                    sess.close_camera()
                    # Lazy import: OpenCV is only needed when the webcam
                    # scanner is actually used (never in the hosted demo).
                    import cubecam
                    cam = cubecam.CubeCamera()
                    try:
                        await asyncio.to_thread(cam.open)
                    except Exception as e:
                        print(f"[cubecam] open failed: {e}", flush=True)
                        await socket.send_json({
                            "type": "camera_error", "error": str(e),
                        })
                        continue
                    sess.camera["session"] = cam
                    sess.camera["task"] = asyncio.create_task(_camera_stream(sess, socket))
                    await socket.send_json({"type": "camera_started"})

                elif action == "camera_cancel":
                    sess.close_camera()
                    await socket.send_json({"type": "camera_canceled"})

                elif action == "get_solve":
                    # Compute a solution with one of the four solver backends.
                    # Does NOT play the moves :  they're stored in state["solve"]
                    # and sent to the GUI for preview. The user reviews / steps
                    # through, then clicks Do Solve to apply them.
                    method = msg.get("method", "kociemba")
                    mode = msg.get("mode", "scramble")
                    solver = SOLVERS.get(method)
                    if solver is None:
                        await socket.send_json({
                            "type": "scramble_blocked",
                            "reason": f"Unknown solver: {method}",
                        })
                        continue
                    if cubestate.is_solved():
                        await socket.send_json({
                            "type": "scramble_blocked",
                            "reason": "Cube is already solved",
                        })
                        continue
                    if mode == "scramble":
                        if not state["scramble_done"]:
                            await socket.send_json({
                                "type": "scramble_blocked",
                                "reason": "Run Do Scramble to completion first",
                            })
                            continue
                        if state["scramble_matrix"] is None or cubestate.state != state["scramble_matrix"]:
                            await socket.send_json({
                                "type": "scramble_blocked",
                                "reason": "Cube is not in the scramble state: Reset to Scramble first",
                            })
                            continue
                    try:
                        solution = solver.solve(cubestate.state, list(state["scramble"]))
                    except Exception as e:
                        await socket.send_json({
                            "type": "scramble_blocked",
                            "reason": f"{method} solver error: {e}",
                        })
                        continue
                    state["solve"] = list(solution)
                    state["solve_method"] = method
                    state["solve_matrix"] = copy.deepcopy(cubestate.state)
                    print(f"[main] {method} solve ({mode}): {' '.join(solution) if solution else '(empty)'}", flush=True)
                    await socket.send_json({
                        "type": "solve_preview",
                        "method": method,
                        "moves": solution,
                    })

                elif action == "do_solve":
                    # Play whatever solution was last computed by get_solve.
                    if not state["solve"]:
                        await socket.send_json({
                            "type": "scramble_blocked",
                            "reason": "No solve to apply: pick a solver first",
                        })
                        continue
                    if state["solve_matrix"] is not None and cubestate.state != state["solve_matrix"]:
                        await socket.send_json({
                            "type": "scramble_blocked",
                            "reason": "Cube state changed since solve was computed: pick a solver again",
                        })
                        continue
                    moves_to_play = list(state["solve"])

                    async def _play_solve(ms):
                        state["suppress_tracking"] += 1
                        try:
                            await syn.play(ms)
                        finally:
                            state["suppress_tracking"] -= 1
                        # After a successful solve the cube is solved :  clear
                        # scramble flags so the next Do Scramble can run.
                        state["scramble_done"] = False
                        state["scramble_matrix"] = None
                        state["post_scramble_moves"] = []
                        state["solve"] = []
                        state["solve_method"] = None
                        state["solve_matrix"] = None
                        try:
                            await socket.send_json({"type": "solve_done"})
                            await socket.send_json(sess.cube_state_msg())
                        except Exception:
                            pass
                    asyncio.create_task(_play_solve(moves_to_play))

                elif action == "scramble_completed":
                    # Frontend-driven scramble playback finished (the scramble
                    # player's autoplay reached its last forward step). Mark
                    # the cube as being "in scramble state".
                    state["scramble_done"] = True
                    state["scramble_matrix"] = copy.deepcopy(cubestate.state)
                    state["post_scramble_moves"] = []
                    await socket.send_json(sess.cube_state_msg())

                elif action == "reset_to_scramble":
                    if not state["scramble_done"] or state["scramble_matrix"] is None:
                        await socket.send_json({
                            "type": "scramble_blocked",
                            "reason": "No scramble has been played yet",
                        })
                        continue
                    if not state["post_scramble_moves"]:
                        await socket.send_json({
                            "type": "scramble_blocked",
                            "reason": "Cube is already in the scramble state",
                        })
                        continue
                    undo = [_invert_move(m) for m in reversed(state["post_scramble_moves"])]
                    print(f"[main] reset-to-scramble: {' '.join(undo)}", flush=True)

                    async def _play_reset_to_scramble(moves_to_play):
                        state["suppress_tracking"] += 1
                        try:
                            await syn.play(moves_to_play)
                        finally:
                            state["suppress_tracking"] -= 1
                        state["post_scramble_moves"] = []
                        try:
                            await socket.send_json(sess.cube_state_msg())
                        except Exception:
                            pass
                    asyncio.create_task(_play_reset_to_scramble(undo))

                elif action == "go_to_state":
                    if not cubestate.is_solved():
                        await socket.send_json({
                            "type": "scramble_blocked",
                            "reason": "Cube must be solved before Go to State",
                        })
                        continue
                    s = msg.get("state", "")
                    ok, reason = check_state(s)
                    if not ok:
                        await socket.send_json({
                            "type": "state_check", "valid": False, "reason": reason,
                        })
                        continue
                    moves = scramble_to_state(s)
                    print(f"[main->gui] go_to_state: {' '.join(moves)}", flush=True)
                    await socket.send_json({"type": "scramble", "moves": moves})
                    asyncio.create_task(syn.play(moves))

    except WebSocketDisconnect:
        syn.detach()
        sess.close_camera()
        robot.set_fake_listener(None)
        syn.set_listener(None)
        await robot.close()
        print("[gui->main] disconnected (session closed)", flush=True)


app.mount("/", NoCacheStaticFiles(directory="GUI", html=True), name="gui")


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
