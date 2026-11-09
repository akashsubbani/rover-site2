// Rover firmware: ESP32 + L298N, controlled over Bluetooth Low Energy
// No extra libraries needed (BLE ships with the ESP32 board package).
// Messages (short text): "J,x,y" joystick  |  "C,forward,1200" timed move  |  "S" stop

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>

#define SERVICE_UUID "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define RX_UUID      "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"

// L298N pins: one shared direction pair, one PWM enable per motor
const int IN1 = 13, IN2 = 26;   // shared direction (both motors)
const int ENA = 14;             // left motor speed
const int ENB = 27;             // right motor speed

const int PWM_FREQ = 1000, PWM_BITS = 8;
const int VOICE_SPEED = 150;              // 0-255
const unsigned long JOY_TIMEOUT = 500;    // ms without joystick data -> stop

volatile unsigned long lastJoy = 0, voiceUntil = 0;
volatile bool joyActive = false, voiceActive = false;

void pwmWrite(int pin, int duty) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(pin, duty);
#else
  ledcWrite(pin == ENA ? 0 : 1, duty);
#endif
}

// l, r in -255..255. Direction is shared, so it follows the overall
// trend (l + r). A wheel that would need the opposite direction stops,
// which makes the rover pivot instead of spinning in place.
void drive(int l, int r) {
  l = constrain(l, -255, 255);
  r = constrain(r, -255, 255);

  bool fwd = (l + r) >= 0;
  int dir = fwd ? 1 : -1;
  int ls = max(0, l * dir);
  int rs = max(0, r * dir);
  bool moving = (ls > 0 || rs > 0);

  digitalWrite(IN1, moving && fwd);
  digitalWrite(IN2, moving && !fwd);
  pwmWrite(ENA, ls);
  pwmWrite(ENB, rs);
}

void stopAll() {
  joyActive = voiceActive = false;
  drive(0, 0);
}

void handle(String v) {
  v.trim();
  if (v.length() == 0) return;

  if (v[0] == 'J') {                        // joystick wins over voice
    float x = 0, y = 0;
    if (sscanf(v.c_str(), "J,%f,%f", &x, &y) == 2) {
      voiceActive = false;
      joyActive = true;
      lastJoy = millis();
      drive((int)((y + x) * 255), (int)((y - x) * 255));
    }
  } else if (v[0] == 'C') {
    char cmd[12] = "";
    int ms = 0;
    if (sscanf(v.c_str(), "C,%11[^,],%d", cmd, &ms) < 1) return;
    ms = constrain(ms, 0, 3000);
    joyActive = false;
    int s = VOICE_SPEED;
    if      (!strcmp(cmd, "stop"))    { stopAll(); return; }
    else if (!strcmp(cmd, "forward")) drive(s, s);
    else if (!strcmp(cmd, "back"))    drive(-s, -s);
    else if (!strcmp(cmd, "left"))    drive(-s, s);   // pivots: only right wheel drives
    else if (!strcmp(cmd, "right"))   drive(s, -s);   // pivots: only left wheel drives
    else return;
    voiceActive = true;
    voiceUntil = millis() + ms;
  } else if (v[0] == 'S') {
    stopAll();
  }
}

class ServerCB : public BLEServerCallbacks {
  void onDisconnect(BLEServer*) override {
    stopAll();                               // never keep driving if the link drops
    BLEDevice::startAdvertising();
  }
};

class RxCB : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    handle(String(c->getValue().c_str()));
  }
};

void setup() {
  Serial.begin(115200);
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(ENA, PWM_FREQ, PWM_BITS);
  ledcAttach(ENB, PWM_FREQ, PWM_BITS);
#else
  ledcSetup(0, PWM_FREQ, PWM_BITS); ledcAttachPin(ENA, 0);
  ledcSetup(1, PWM_FREQ, PWM_BITS); ledcAttachPin(ENB, 1);
#endif
  stopAll();

  BLEDevice::init("Rover-ESP32");
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCB());
  BLEService* service = server->createService(SERVICE_UUID);
  BLECharacteristic* rx = service->createCharacteristic(
      RX_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rx->setCallbacks(new RxCB());
  service->start();

  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.println("Advertising as Rover-ESP32");
}

void loop() {
  unsigned long now = millis();
  if (joyActive && now - lastJoy > JOY_TIMEOUT) stopAll();
  if (voiceActive && now > voiceUntil) stopAll();
  delay(10);
}
