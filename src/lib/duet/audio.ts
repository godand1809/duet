export type SoundName =
  | "tap"
  | "throw"
  | "hit"
  | "bust"
  | "card"
  | "chip"
  | "pocket"
  | "splash"
  | "boom"
  | "win"
  | "lose"
  | "connect";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let muted = false;

function context(): AudioContext | null {
  const w = window as Window & { webkitAudioContext?: typeof AudioContext };
  const AC = window.AudioContext ?? w.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    ctx = new AC({ latencyHint: "interactive" });
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.22;
    master.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 0.4);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  return ctx;
}

export function unlockAudio() {
  const c = context();
  if (c && c.state === "suspended") void c.resume();
}

export function bindAudioUnlock() {
  const go = () => unlockAudio();
  window.addEventListener("pointerdown", go, { passive: true });
  window.addEventListener("keydown", go);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") unlockAudio();
  });
}

export function setAudioMuted(next: boolean) {
  muted = next;
  if (master && ctx) master.gain.setTargetAtTime(next ? 0 : 0.22, ctx.currentTime, 0.02);
}

function tone(freq: number, dur: number, type: OscillatorType, gain = 0.4, slide = 0) {
  const c = context();
  if (!c || !master || muted) return;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function burst(dur: number, gain = 0.3, freq = 800) {
  const c = context();
  if (!c || !master || !noise || muted) return;
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noise;
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

export function playSound(name: SoundName) {
  unlockAudio();
  if (muted) return;
  const rate = 0.96 + Math.random() * 0.08;
  switch (name) {
    case "tap":
      tone(640 * rate, 0.05, "square", 0.12);
      break;
    case "throw":
      burst(0.12, 0.2, 1400);
      tone(420, 0.09, "triangle", 0.18, -180);
      break;
    case "hit":
      tone(180, 0.12, "sine", 0.4, -80);
      burst(0.08, 0.18, 300);
      break;
    case "bust":
      tone(140, 0.2, "sawtooth", 0.12, -60);
      tone(90, 0.24, "square", 0.08);
      break;
    case "card":
      burst(0.06, 0.16, 1800);
      tone(520 * rate, 0.05, "triangle", 0.1);
      break;
    case "chip":
      tone(880 * rate, 0.07, "sine", 0.16);
      tone(1320 * rate, 0.09, "sine", 0.08);
      break;
    case "pocket":
      tone(220, 0.14, "sine", 0.3, -120);
      burst(0.1, 0.2, 200);
      break;
    case "splash":
      burst(0.18, 0.22, 900);
      tone(300, 0.12, "sine", 0.1, 80);
      break;
    case "boom":
      tone(90, 0.28, "sine", 0.45, -40);
      burst(0.2, 0.28, 180);
      break;
    case "win":
      [523, 659, 784, 1046].forEach((f, i) => {
        const c = context();
        if (!c || !master) return;
        const t = c.currentTime + i * 0.09;
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = "triangle";
        osc.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        osc.connect(g);
        g.connect(master);
        osc.start(t);
        osc.stop(t + 0.24);
      });
      break;
    case "lose":
      tone(392, 0.16, "triangle", 0.16, -40);
      tone(311, 0.22, "triangle", 0.14, -30);
      break;
    case "connect":
      tone(660, 0.08, "sine", 0.14);
      tone(880, 0.12, "sine", 0.12);
      break;
    default:
      break;
  }
}
