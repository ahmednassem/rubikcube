/*
 * RubikCube robot :  Arduino firmware (production)
 *
 * Robot/robot.py talks to this sketch over USB serial:
 *
 *     "<move>\n"   (e.g. "R\n", "U'\n", "F2\n")  →  perform the move
 *     "done\n"     ←  reply when finished
 *
 * Accepted commands (all 18 basic moves):
 *     U  D  F  B  R  L
 *     U' D' F' B' R' L'
 *     U2 D2 F2 B2 R2 L2
 *
 * Pin map (Arduino Uno):
 *     Face | STEP | DIR
 *     -----+------+----
 *      U   |  D2  | D3
 *      D   |  D4  | D5
 *      F   |  D6  | D7
 *      B   |  D8  | D9
 *      R   |  D10 | D11
 *      L   |  D12 | D13
 *     EN (shared) → A0
 */

const uint8_t EN_PIN = A0;

// Per face: STEP pin, DIR pin, default DIR level for the no-modifier move.
// All faces verified at LOW for clockwise-from-outside.
const uint8_t STEP_PINS[6]   = { 2, 4, 6, 8, 10, 12 };       // U D F B R L
const uint8_t DIR_PINS[6]    = { 3, 5, 7, 9, 11, 13 };
const uint8_t DIR_DEFAULT[6] = { LOW, LOW, LOW, LOW, LOW, LOW };

// 1.8°/step × 8 microsteps → 1600 microsteps/rev → 400 = 90°.
const int STEPS_PER_90 = 400;

// Step pulse half-period. Bigger = slower / more torque.
const unsigned int PULSE_US = 2500;

// Pause BEFORE each move (after receiving the command, before turning the
// motor). Short rest so the cube isn't slammed move-to-move. Done is sent
// immediately after the motor stops :  syn doesn't wait extra.
const unsigned int SETTLE_MS = 220;

int faceIndex(char c) {
  if (c == 'U') return 0;
  if (c == 'D') return 1;
  if (c == 'F') return 2;
  if (c == 'B') return 3;
  if (c == 'R') return 4;
  if (c == 'L') return 5;
  return -1;
}

void rotate(int idx, int steps, uint8_t dir) {
  digitalWrite(DIR_PINS[idx], dir);
  delayMicroseconds(50);
  for (int i = 0; i < steps; i++) {
    digitalWrite(STEP_PINS[idx], HIGH);
    delayMicroseconds(PULSE_US);
    digitalWrite(STEP_PINS[idx], LOW);
    delayMicroseconds(PULSE_US);
  }
}

// Returns true if the command was a valid move and was executed.
bool runMove(const String& cmd) {
  if (cmd.length() < 1 || cmd.length() > 2) return false;
  int idx = faceIndex(cmd[0]);
  if (idx < 0) return false;

  int     steps = STEPS_PER_90;
  uint8_t dir   = DIR_DEFAULT[idx];

  if (cmd.length() == 2) {
    char mod = cmd[1];
    if (mod == '\'') {
      dir = (dir == HIGH) ? LOW : HIGH;          // reverse
    } else if (mod == '2') {
      steps = STEPS_PER_90 * 2;                   // 180°
    } else {
      return false;
    }
  }

  delay(SETTLE_MS);                               // brief rest before turning
  rotate(idx, steps, dir);
  return true;                                    // "done" is sent immediately after
}

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < 6; i++) {
    pinMode(STEP_PINS[i], OUTPUT);
    pinMode(DIR_PINS[i],  OUTPUT);
    digitalWrite(STEP_PINS[i], LOW);
    digitalWrite(DIR_PINS[i],  DIR_DEFAULT[i]);
  }
  pinMode(EN_PIN, OUTPUT);
  digitalWrite(EN_PIN, LOW);                      // enable all drivers
}

String inbuf = "";

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      inbuf.trim();
      inbuf.toUpperCase();
      if (inbuf.length() > 0) {
        runMove(inbuf);            // unknown commands are silently no-ops
        Serial.println("done");    // always reply so the host never hangs
        Serial.flush();
      }
      inbuf = "";
    } else {
      inbuf += c;
    }
  }
}
