// ESP32 rover firmware: BLE (Nordic UART Service) + 2 DC motors
// Libraries: NimBLE-Arduino 2.x, ESP32 Arduino core 3.x
#include <NimBLEDevice.h>

#define MOTOR_A_IN  13   // Motor A direction
#define MOTOR_B_IN  26   // Motor B direction
#define ENA         14   // Motor A speed (PWM)
#define ENB         27   // Motor B speed (PWM)

#define NUS_SERVICE "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_RX      "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"

char mode = 'J';                      // 'J' joystick, 'V' voice
volatile unsigned long lastCmd = 0;
String buf;

void drive(int l, int r) {            // -100..100
  digitalWrite(MOTOR_A_IN, l >= 0);   // HIGH = forward, LOW = reverse
  digitalWrite(MOTOR_B_IN, r >= 0);
  ledcWrite(ENA, map(abs(l), 0, 100, 0, 255));
  ledcWrite(ENB, map(abs(r), 0, 100, 0, 255));
}

void handleLine(String s) {
  s.trim();
  if (!s.length()) return;
  lastCmd = millis();
  if (s == "P") return;                                   // keep-alive ping
  if (s == "S") { drive(0, 0); return; }                  // stop in any mode
  if (s.startsWith("M:")) { mode = s[2]; drive(0, 0); return; }

  if (mode == 'J' && s.startsWith("J,")) {
    int c = s.indexOf(',', 2);
    if (c < 0) return;
    int x = s.substring(2, c).toInt();
    int y = s.substring(c + 1).toInt();
    drive(constrain(y + x, -100, 100), constrain(y - x, -100, 100));
  } else if (mode == 'V') {
    switch (s[0]) {
      case 'F': drive(70, 70);   break;
      case 'B': drive(-70, -70); break;
      case 'L': drive(-60, 60);  break;
      case 'R': drive(60, -60);  break;
    }
  }
}

class RxCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c, NimBLEConnInfo& info) override {
    std::string v = c->getValue();
    for (char ch : v) {
      if (ch == '\n') { handleLine(buf); buf = ""; }
      else if (buf.length() < 40) buf += ch;
    }
  }
};

class ServerCallbacks : public NimBLEServerCallbacks {
  void onDisconnect(NimBLEServer* s, NimBLEConnInfo& info, int reason) override {
    drive(0, 0);
    NimBLEDevice::startAdvertising();
  }
};

void setup() {
  pinMode(MOTOR_A_IN, OUTPUT);
  pinMode(MOTOR_B_IN, OUTPUT);
  ledcAttach(ENA, 1000, 8);           // core 3.x (core 2.x: ledcSetup + ledcAttachPin)
  ledcAttach(ENB, 1000, 8);
  drive(0, 0);

  NimBLEDevice::init("ESP_Rover");
  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  NimBLEService* svc = server->createService(NUS_SERVICE);
  NimBLECharacteristic* rx = svc->createCharacteristic(
      NUS_RX, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  rx->setCallbacks(new RxCallbacks());
  svc->start();

  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(NUS_SERVICE);
  adv->enableScanResponse(true);
  adv->start();
}

void loop() {
  if (millis() - lastCmd > 1000) drive(0, 0);   // failsafe: link lost
  delay(20);
}
