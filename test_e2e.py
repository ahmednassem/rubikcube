"""End-to-end WebSocket protocol test.

Starts nothing itself :  expects the server already running on 127.0.0.1:8000.
Acts like the GUI: acks every "play" message so syn can advance.

Checks:
  1. initial handshake messages (config / robot_ports / robot_status / cube_state)
  2. per-visitor session isolation (scrambling client A leaves client B solved)
  3. scramble -> do_scramble -> all four solvers preview -> do_solve -> solved
  4. fake robot connect + calibrate + move in robot mode
  5. reset returns the cube to solved
  6. demo mode: camera_start is refused, only FAKE port listed
"""
import asyncio
import json
import sys

import websockets

URI = "ws://127.0.0.1:8000/ws"
DEMO = "--demo" in sys.argv

PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"  ({detail})" if detail and not cond else ""))


class Client:
    """Minimal GUI stand-in: acks plays, collects messages by type."""

    def __init__(self, name):
        self.name = name
        self.ws = None
        self.inbox = asyncio.Queue()
        self.cube_state = None
        self._task = None

    async def connect(self):
        self.ws = await websockets.connect(URI)
        self._task = asyncio.create_task(self._pump())

    async def _pump(self):
        try:
            async for raw in self.ws:
                msg = json.loads(raw)
                if msg["type"] == "play":
                    # act like the GUI: instantly ack the animation
                    await self.ws.send(json.dumps({"type": "ack", "move": msg["move"]}))
                    continue
                if msg["type"] == "cube_state":
                    self.cube_state = msg
                await self.inbox.put(msg)
        except websockets.ConnectionClosed:
            pass

    async def send(self, payload):
        await self.ws.send(json.dumps(payload))

    async def expect(self, mtype, timeout=30):
        """Wait for the next message of the given type, skipping others."""
        while True:
            msg = await asyncio.wait_for(self.inbox.get(), timeout)
            if msg["type"] == mtype:
                return msg

    async def drain(self, seconds=0.3):
        try:
            while True:
                await asyncio.wait_for(self.inbox.get(), seconds)
        except asyncio.TimeoutError:
            return

    async def close(self):
        await self.ws.close()
        if self._task:
            self._task.cancel()


async def main():
    a, b = Client("A"), Client("B")
    await a.connect()
    await b.connect()

    # -- 1. handshake ------------------------------------------------------
    cfg = await a.expect("config")
    check("config message received", True)
    check(f"demo flag is {DEMO}", cfg["demo"] == DEMO, str(cfg))
    ports = await a.expect("robot_ports")
    if DEMO:
        check("demo: only FAKE port listed",
              [p["port"] for p in ports["ports"]] == ["FAKE"], str(ports))
    else:
        check("FAKE port present", any(p["port"] == "FAKE" for p in ports["ports"]))
    await a.expect("robot_status")
    st = await a.expect("cube_state")
    check("A starts solved", st["solved"])
    await b.expect("cube_state")
    await a.drain(); await b.drain()

    # -- 2+3. scramble on A, B stays solved --------------------------------
    await a.send({"type": "action", "action": "get_scramble"})
    scr = await a.expect("scramble")
    check("scramble generated", len(scr["moves"]) >= 15, str(len(scr["moves"])))
    await a.drain()

    await a.send({"type": "action", "action": "do_scramble"})
    # wait for the cube_state that marks scramble_done
    for _ in range(200):
        st = await a.expect("cube_state")
        if st.get("scramble_done"):
            break
    check("A scrambled (not solved, scramble_done)", (not st["solved"]) and st.get("scramble_done"))

    await b.send({"type": "action", "action": "get_scramble"})  # b does nothing else
    await b.drain(0.5)
    check("B still solved (session isolation)", b.cube_state["solved"], str(b.cube_state))

    # -- all four solvers give a preview (mode=scramble on scrambled cube) --
    solutions = {}
    for method in ["kociemba", "cfop", "roux", "zz"]:
        await a.send({"type": "action", "action": "get_solve", "method": method, "mode": "scramble"})
        prev = await a.expect("solve_preview")
        solutions[method] = prev["moves"]
        check(f"solver {method} returned moves", prev["method"] == method and len(prev["moves"]) > 0)

    # -- do_solve (uses last computed = zz) --------------------------------
    await a.send({"type": "action", "action": "do_solve"})
    await a.expect("solve_done", timeout=120)
    st = await a.expect("cube_state")
    check("A solved after do_solve", st["solved"])
    await a.drain()

    # -- 4. fake robot mode -------------------------------------------------
    await a.send({"type": "action", "action": "robot_connect", "port": "FAKE"})
    rst = await a.expect("robot_status")
    check("fake robot connected", rst["state"] == "connected" and rst["port"] == "FAKE", str(rst))
    await a.send({"type": "action", "action": "robot_calibrate", "on": True})
    rst = await a.expect("robot_status")
    check("robot mode on after calibrate", rst["state"] == "robot", str(rst))
    await a.drain()
    await a.send({"type": "move", "move": "R", "id": 1})
    done = await a.expect("move_done")
    check("move in robot mode ok", done["ok"] and done["move"] == "R", str(done))
    await a.send({"type": "action", "action": "robot_disconnect"})
    rst = await a.expect("robot_status")
    check("robot disconnected -> stub", rst["state"] == "stub", str(rst))
    await a.drain()

    # -- robot_config ---------------------------------------------------------
    await a.send({"type": "action", "action": "robot_config",
                  "fake_delay": 0.05, "baud": 57600, "timeout": 15, "fake_mode": "auto"})
    cfg = await a.expect("robot_config")
    check("robot_config applied",
          cfg["fake_delay"] == 0.05 and cfg["baud"] == 57600
          and cfg["timeout"] == 15 and cfg["fake_mode"] == "auto", str(cfg))
    # read-only query echoes the same settings back
    await a.send({"type": "action", "action": "robot_config"})
    cfg = await a.expect("robot_config")
    check("robot_config read-back", cfg["baud"] == 57600, str(cfg))
    await a.drain()

    # -- 5. reset ------------------------------------------------------------
    await a.send({"type": "action", "action": "reset"})
    await a.expect("reset_done")
    st = await a.expect("cube_state")
    check("reset -> solved", st["solved"])

    # -- 6. camera in demo mode ----------------------------------------------
    if DEMO:
        await a.send({"type": "action", "action": "camera_start"})
        err = await a.expect("camera_error")
        check("demo: camera refused", "not available" in err["error"], str(err))

    await a.close(); await b.close()

    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        print("FAILED:", ", ".join(FAIL))
        sys.exit(1)


asyncio.run(main())
