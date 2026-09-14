import asyncio

# Fans one move out to the GUI, our cubestate matrix, and the robot, so
# all three stay in lockstep. syn.play awaits a mode-dependent ack:
#
#   - normal  : robot not connected → wait only for the GUI ack
#   - robot   : robot connected     → wait for GUI ack AND robot "done" in parallel
#
# cubestate is updated per-move (after the move is confirmed on GUI+robot),
# so at any point the matrix reflects what the physical/virtual cubes show.


class Syn:
    def __init__(self, robot, cubestate):
        self.robot = robot
        self.cubestate = cubestate
        self.socket = None
        self._gui_ack = None  # asyncio.Future, resolved when GUI acks
        self._lock = asyncio.Lock()   # serialize concurrent play() calls
        # Live status for the Syn inspector window.
        self.status = {
            "playing": False, "current": None, "mode": "normal",
            "queue_len": 0, "done": 0, "last": None, "error": None,
        }
        # Optional callback invoked whenever self.status changes.
        self._listener = None

    def set_listener(self, listener):
        """Register callback(status_dict) invoked on every status change."""
        self._listener = listener

    def _emit(self, **kwargs):
        self.status.update(kwargs)
        if self._listener is not None:
            try:
                self._listener(dict(self.status))
            except Exception as e:
                print(f"[syn] listener error: {e}", flush=True)

    def attach(self, socket):
        """Bind to the current WS client (called when GUI connects)."""
        self.socket = socket

    def detach(self):
        self.socket = None
        if self._gui_ack and not self._gui_ack.done():
            self._gui_ack.set_exception(ConnectionError("gui disconnected"))
        self._emit(playing=False, current=None)

    def on_gui_ack(self):
        """Called from the WS receive loop when the GUI finishes a move."""
        if self._gui_ack and not self._gui_ack.done():
            self._gui_ack.set_result(True)

    async def play(self, moves):
        if self.socket is None:
            raise RuntimeError("no GUI attached")
        # Lock serializes concurrent play() calls :  no move can start until
        # the previous play's final ack has been received (from GUI, and
        # from the robot when connected).
        async with self._lock:
            await self._play_locked(moves)

    async def _play_locked(self, moves):
        # Robot mode is now explicit: the user must have calibrated after
        # connecting. Merely connected doesn't count :  that's "normal" mode.
        robot_live = self.robot.state == "robot"
        mode = "robot" if robot_live else "normal"
        print(f"[syn] play {len(moves)} moves in {mode} mode", flush=True)
        self._emit(
            playing=True, mode=mode, current=None, queue_len=len(moves),
            done=0, last=None, error=None,
        )
        try:
            for idx, move in enumerate(moves):
                self._emit(current=move, queue_len=len(moves) - idx)

                # In robot mode, wait for the robot to physically finish the
                # move BEFORE telling the GUI to animate. Keeps the on-screen
                # cube strictly behind-or-at physical reality :  never ahead.
                if robot_live:
                    await self.robot.play_move(move)

                # Now the GUI animates. In normal mode this is the only step.
                self._gui_ack = asyncio.get_event_loop().create_future()
                await self.socket.send_json({"type": "play", "move": move})
                await self._gui_ack

                # All three advance together: robot confirmed (if any),
                # GUI confirmed, now the matrix.
                self.cubestate.apply(move)
                self._emit(last=move, done=idx + 1)
                await self.socket.send_json({
                    "type": "cube_state",
                    "solved": self.cubestate.is_solved(),
                    "matrix": _kociemba_of(self.cubestate),
                })
                print(f"[syn] {move} ok", flush=True)
        except Exception as e:
            print(f"[syn] ERROR: {e!r}", flush=True)
            self._emit(playing=False, current=None, error=repr(e))
            raise
        self._emit(playing=False, current=None, queue_len=0)


def _kociemba_of(cs):
    # Small helper so the syn module doesn't have to import anything new.
    return cs.kociemba()
