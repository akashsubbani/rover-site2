"use client";
import { useEffect, useRef, useState } from "react";

const NUS = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";

type Msg = { role: "user" | "assistant"; content: string };
type Mode = "J" | "V";

// Order matters: "go back" must match back before forward
const COMMANDS: [string, RegExp][] = [
  ["S", /\b(stop|halt|wait|freeze|brake)\b/],
  ["B", /\b(back|backward|backwards|reverse)\b/],
  ["L", /\bleft\b/],
  ["R", /\bright\b/],
  ["F", /\b(forward|forwards|ahead|straight|go)\b/],
];
const clamp = (n: number) => Math.max(-100, Math.min(100, n));
const NAMES: Record<string, string> = { F: "Forward", B: "Back", L: "Left", R: "Right", S: "Stopped" };
const parseCommand = (t: string) => {
  const s = t.toLowerCase();
  for (const [c, re] of COMMANDS) if (re.test(s)) return c;
  return null;
};

function Joystick({ onChange }: { onChange: (x: number, y: number) => void }) {
  const pad = useRef<HTMLDivElement>(null);
  const [k, setK] = useState({ x: 0, y: 0 });
  const [on, setOn] = useState(false);
  const move = (e: React.PointerEvent) => {
    const r = pad.current!.getBoundingClientRect();
    const R = r.width / 2;
    let dx = e.clientX - (r.left + R);
    let dy = e.clientY - (r.top + R);
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
    setK({ x: dx, y: dy });
    onChange(Math.round((dx / R) * 100), Math.round((-dy / R) * 100));
  };
  const end = () => { setK({ x: 0, y: 0 }); setOn(false); onChange(0, 0); };
  return (
    <div
      ref={pad}
      className={`pad ${on ? "on" : ""}`}
      role="application"
      aria-label="Drive joystick"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setOn(true); move(e); }}
      onPointerMove={(e) => { if (e.buttons) move(e); }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div className={`knob ${on ? "on" : ""}`} style={{ transform: `translate(calc(-50% + ${k.x}px), calc(-50% + ${k.y}px))` }} />
    </div>
  );
}

function Meter({ label, v }: { label: string; v: number }) {
  return (
    <div className="meter">
      <span>{label}</span>
      <div className="track">
        <i className={v < 0 ? "rev" : ""} style={{ left: v < 0 ? `${50 + v / 2}%` : "50%", width: `${Math.abs(v) / 2}%` }} />
      </div>
      <b>{v}</b>
    </div>
  );
}

export default function Page() {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("Not connected");
  const [mode, setMode] = useState<Mode>("J");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [drive, setDrive] = useState({ l: 0, r: 0 });
  const [lastVoice, setLastVoice] = useState("S");

  const charRef = useRef<any>(null);
  const joy = useRef({ x: 0, y: 0 });
  const modeRef = useRef<Mode>("J");
  const msgsRef = useRef<Msg[]>([]);
  const recRef = useRef<any>(null);
  const listenRef = useRef(false);
  const speakingRef = useRef(false);
  const handleRef = useRef<(t: string) => void>(() => {});
  const logRef = useRef<HTMLDivElement>(null);

  const send = async (s: string) => {
    const c = charRef.current;
    if (!c) return;
    try { await c.writeValueWithoutResponse(new TextEncoder().encode(s + "\n")); } catch {}
  };

  // Keep-alive: joystick values in joystick mode, ping in voice mode
  useEffect(() => {
    if (!connected) return;
    const id = setInterval(() => {
      if (modeRef.current === "J") send(`J,${joy.current.x},${joy.current.y}`);
      else send("P");
    }, 300);
    return () => clearInterval(id);
  }, [connected]);

  useEffect(() => { logRef.current?.scrollTo({ top: 99999 }); }, [msgs, busy]);
  useEffect(() => () => stopMic(), []);

  const connect = async () => {
    const nav: any = navigator;
    if (!nav.bluetooth) { setStatus("Web Bluetooth needs Chrome on Android or desktop"); return; }
    try {
      setStatus("Searching...");
      const dev = await nav.bluetooth.requestDevice({ filters: [{ services: [NUS] }] });
      dev.addEventListener("gattserverdisconnected", () => {
        charRef.current = null; setConnected(false); setStatus("Disconnected");
      });
      const server = await dev.gatt.connect();
      const svc = await server.getPrimaryService(NUS);
      charRef.current = await svc.getCharacteristic(RX);
      setConnected(true);
      setStatus(`Connected to ${dev.name || "rover"}`);
      send("M:" + modeRef.current);
    } catch {
      setStatus("Connection cancelled or failed");
    }
  };

  const changeMode = (m: Mode) => {
    if (m === modeRef.current) return;
    modeRef.current = m;
    setMode(m);
    joy.current = { x: 0, y: 0 };
    setDrive({ l: 0, r: 0 });
    setLastVoice("S");
    if (m === "J") stopMic();
    send("M:" + m);
  };

  const speak = (text: string) => {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.onstart = () => { speakingRef.current = true; };
    u.onend = u.onerror = () => { speakingRef.current = false; };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  };

  const setAll = (m: Msg[]) => { msgsRef.current = m; setMsgs(m); };

  const ask = async (text: string) => {
    const next: Msg[] = [...msgsRef.current, { role: "user", content: text }];
    setAll(next);
    setBusy(true);
    let reply = "";
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.slice(-12) }),
      });
      const d = await r.json();
      reply = d.reply || d.error || "No reply.";
    } catch {
      reply = "I can't reach the chat service right now.";
    }
    setAll([...msgsRef.current, { role: "assistant", content: reply }]);
    setBusy(false);
    speak(reply);
  };

  // Local command matching first, so driving never waits on the network
  handleRef.current = (text: string) => {
    const cmd = modeRef.current === "V" ? parseCommand(text) : null;
    if (cmd) { send(cmd); setLastVoice(cmd); }
    ask(text);
  };

  const startMic = () => {
    const w: any = window;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) { setStatus("Speech recognition needs Chrome"); return; }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = "en-IN";
    rec.onresult = (e: any) => {
      if (speakingRef.current) return;
      const t = e.results[e.results.length - 1][0].transcript.trim();
      if (t) { setHeard(t); handleRef.current(t); }
    };
    rec.onerror = (e: any) => {
      if (e.error === "not-allowed") { listenRef.current = false; setListening(false); setStatus("Microphone permission denied"); }
    };
    rec.onend = () => { if (listenRef.current) { try { rec.start(); } catch {} } };
    listenRef.current = true;
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  function stopMic() {
    listenRef.current = false;
    try { recRef.current?.stop(); } catch {}
    setListening(false);
  }

  const emergencyStop = () => { joy.current = { x: 0, y: 0 }; setDrive({ l: 0, r: 0 }); setLastVoice("S"); send("S"); };
  const quick = (c: string) => { send(c); setLastVoice(c); };
  const submit = () => { if (input.trim() && !busy) { handleRef.current(input.trim()); setInput(""); } };

  return (
    <main className="wrap">
      <header className="top">
        <div className="brand">
          <span className={`dot ${connected ? "live" : ""}`} aria-hidden="true" />
          <div>
            <h1>Rover control</h1>
            <p className="status" aria-live="polite">{status}</p>
          </div>
        </div>
        <button className="btn primary" onClick={connect} disabled={connected}>
          {connected ? "Connected" : "Connect rover"}
        </button>
      </header>

      <section className="panel drive" aria-label="Drive">
        <div className="seg" role="group" aria-label="Control mode">
          <button aria-pressed={mode === "J"} onClick={() => changeMode("J")}>Joystick</button>
          <button aria-pressed={mode === "V"} onClick={() => changeMode("V")}>Voice</button>
        </div>

        {mode === "J" ? (
          <>
            <Joystick onChange={(x, y) => { joy.current = { x, y }; setDrive({ l: clamp(y + x), r: clamp(y - x) }); }} />
            <div className="meters">
              <Meter label="Left motor" v={drive.l} />
              <Meter label="Right motor" v={drive.r} />
            </div>
          </>
        ) : (
          <div className="mic">
            <button className={`orb ${listening ? "live" : ""}`} onClick={listening ? stopMic : startMic} aria-pressed={listening}>
              <span className="ring" /><span className="ring r2" />
              <span className="orb-label">{listening ? "Listening" : "Tap to talk"}</span>
            </button>
            <p className="heard" aria-live="polite">{heard ? `Heard: "${heard}"` : "Say forward, back, left, right or stop"}</p>
            <div className="dpad" role="group" aria-label={`Voice shortcuts, now: ${NAMES[lastVoice]}`}>
              {[["F", "▲", "Forward"], ["L", "◀", "Left"], ["S", "■", "Stop"], ["R", "▶", "Right"], ["B", "▼", "Back"]].map(([c, icon, label]) => (
                <button key={c} data-k={c} className={`key ${lastVoice === c ? "on" : ""}`} aria-label={label} onClick={() => quick(c)}>{icon}</button>
              ))}
            </div>
          </div>
        )}

        <button className="btn stop" onClick={emergencyStop}>Stop</button>
      </section>

      <section className="panel" aria-label="Chat">
        <div className="log" ref={logRef}>
          {msgs.length === 0 && (
            <>
              <p className="empty">Ask the rover anything.</p>
              <div className="chips">
                {["What can you do?", "Tell me a fun fact"].map((t) => (
                  <button key={t} className="chip" onClick={() => handleRef.current(t)}>{t}</button>
                ))}
              </div>
            </>
          )}
          {msgs.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.content}</div>)}
          {busy && <div className="msg assistant typing" aria-label="Thinking"><i /><i /><i /></div>}
        </div>
        <div className="row">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="Type a message"
            aria-label="Message"
          />
          <button className="btn" disabled={busy || !input.trim()} onClick={submit}>Send</button>
        </div>
      </section>
    </main>
  );
}
