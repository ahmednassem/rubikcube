import asyncio
import serial

# Python bridge to the Arduino running robotcontrol.ino.
#
# Two modes:
#   - stub      : no port open; play_move() sleeps and returns "done"
#   - connected : real serial port; play_move() sends "<move>\n" and waits
#                 for "done\n" from the Arduino
#
# Start in stub. Call connect(port) to go live; disconnect() to come back.


FAKE_PORT = "FAKE"  # virtual port: simulates a robot that always replies "done"


class Robot:
    def __init__(self, baud=115200, stub_delay=0.4, fake_delay=0.2, timeout=30):
        self.baud = baud
        self.stub_delay = stub_delay
        self.fake_delay = fake_delay
        self.timeout = timeout          # serial read timeout (s), applied on connect
        self.port = None
        self.ser = None
        self._fake = False

        # Fake-robot test-bench state.
        # Mode is "auto" (default, resolves after fake_delay) or "manual"
        # (waits for ack_fake() or error_fake() from the outside).
        self.fake_mode = "auto"
        self._fake_pending = None       # Future resolved by ack_fake / error_fake
        self._fake_listener = None      # callable(move) :  notified every play_move

        # "Calibrated" means: the app is in ROBOT mode :  syn awaits robot
        # acks, drag moves are restricted, etc. Being merely connected over
        # serial is not enough. Toggling calibration is how the user steps in
        # and out of robot mode without reconnecting every time.
        self.calibrated = False

    @property
    def connected(self):
        """True when a serial / fake link is open. Independent of calibration."""
        return self._fake or self.ser is not None

    @property
    def state(self):
        """'stub' | 'connected' | 'robot'.
        'connected' = link is open but app is NOT in robot mode.
        'robot'     = link is open AND user has calibrated (robot mode on).
        """
        if not self.connected:
            return "stub"
        return "robot" if self.calibrated else "connected"

    def set_calibrated(self, on: bool):
        if on and not self.connected:
            raise RuntimeError("cannot calibrate: robot not connected")
        self.calibrated = bool(on)

    def set_fake_mode(self, mode: str):
        if mode not in ("auto", "manual"):
            raise ValueError(f"unknown fake mode: {mode!r}")
        self.fake_mode = mode
        # Switching to auto while a manual play is pending :  resolve it.
        if mode == "auto" and self._fake_pending and not self._fake_pending.done():
            self._fake_pending.set_result("done")

    def set_fake_listener(self, listener):
        """Register callback(move_str) invoked when play_move is called in fake mode."""
        self._fake_listener = listener

    def ack_fake(self):
        f = self._fake_pending
        if f and not f.done():
            f.set_result("done")

    def error_fake(self, reason="fake robot error"):
        f = self._fake_pending
        if f and not f.done():
            f.set_exception(RuntimeError(reason))

    async def connect(self, port: str):
        await self.close()
        if port == FAKE_PORT:
            self._fake = True
            self.port = FAKE_PORT
            print(f"[robot] connected (fake) :  no hardware", flush=True)
            return
        self.ser = await asyncio.to_thread(
            serial.Serial, port, self.baud, timeout=self.timeout
        )
        self.port = port
        # give the board a moment to reset after opening the port
        await asyncio.sleep(2)
        # drop any bootloader noise sitting in the input buffer
        await asyncio.to_thread(self.ser.reset_input_buffer)
        await asyncio.to_thread(self.ser.reset_output_buffer)
        print(f"[robot] connected {port}@{self.baud}", flush=True)

    async def disconnect(self):
        await self.close()
        self.port = None
        self.calibrated = False
        print("[robot] disconnected -> stub mode", flush=True)

    async def close(self):
        self._fake = False
        if self.ser is not None:
            await asyncio.to_thread(self.ser.close)
            self.ser = None

    async def play_move(self, move: str):
        if self._fake:
            if self._fake_listener is not None:
                try:
                    self._fake_listener(move)
                except Exception as e:
                    print(f"[robot] fake listener error: {e}", flush=True)
            if self.fake_mode == "auto":
                await asyncio.sleep(self.fake_delay)
                return "done"
            # manual :  wait for ack_fake() / error_fake() to resolve
            loop = asyncio.get_event_loop()
            self._fake_pending = loop.create_future()
            try:
                return await self._fake_pending
            finally:
                self._fake_pending = None
        if self.ser is None:
            await asyncio.sleep(self.stub_delay)
            return "done"
        await asyncio.to_thread(self.ser.write, f"{move}\n".encode())
        await asyncio.to_thread(self.ser.flush)
        # skip any blank lines / stray newlines until we get a real response
        while True:
            line = await asyncio.to_thread(self.ser.readline)
            resp = line.decode(errors="replace").strip()
            if resp:
                break
            if not line:
                raise RuntimeError(f"[robot] timeout waiting for 'done' on {move}")
        if resp != "done":
            raise RuntimeError(f"[robot] expected 'done', got {resp!r}")
        return resp
