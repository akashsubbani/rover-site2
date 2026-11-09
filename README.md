# Rover app (ESP32 BLE + Next.js on Vercel)

## 1. Flash the ESP32
1. Arduino IDE: install **ESP32 core 3.x** and the **NimBLE-Arduino 2.x** library.
2. Open `firmware/rover_ble/rover_ble.ino`, pick your ESP32 board, upload.
3. Pins: A_IN=13, B_IN=26, ENA=14, ENB=27 (direction pin + PWM pin per motor driver).

## 2. Run the web app locally
```
npm install
cp .env.example .env.local   # add your ANTHROPIC_API_KEY
npm run dev
```
Web Bluetooth needs HTTPS or localhost, and Chrome (Android or desktop).

## 3. Deploy to Vercel
1. Push this folder to GitHub, import it at vercel.com/new.
2. Add `ANTHROPIC_API_KEY` under Settings > Environment Variables.
3. Deploy, then open the URL in Chrome on your phone and tap "Connect rover".

## Protocol (newline-terminated)
`M:J` / `M:V` mode, `J,x,y` joystick (-100..100), `F B L R` voice drive, `S` stop, `P` keep-alive.
The rover stops if nothing arrives for 1 second.
