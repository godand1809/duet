import { useEffect, useRef, useState } from "react";
import {
  CRICKET_NUMS,
  apply501,
  checkoutRoute,
  closed,
  cricketMarks,
  scoreAt,
  WEDGES,
} from "@/lib/duet/darts";
import type { Seat } from "@/lib/duet/types";
import type { TableApi } from "./api";

interface Model {
  scores: [number, number];
  marks: [Record<number, number>, Record<number, number>];
  points: [number, number];
  turn: Seat;
  left: number;
  visit: number;
  winner: Seat | null;
  log: string[];
  bust: boolean;
}

function sway(now: number, power: number) {
  const amp = 0.007 + power * 0.012;
  return {
    x: Math.sin(now / 260) * amp + Math.sin(now / 90) * amp * 0.35,
    y: Math.cos(now / 310) * amp * 0.8,
  };
}

export function DartsGame({ api }: { api: TableApi }) {
  const variant = api.options.darts.variant;
  const doubleOut = api.options.darts.doubleOut;
  const model = useRef<Model>({
    scores: [501, 501],
    marks: [{}, {}],
    points: [0, 0],
    turn: 0,
    left: 3,
    visit: 501,
    winner: null,
    log: [],
    bust: false,
  });
  const [, bump] = useState(0);
  const paint = () => bump((n) => n + 1);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const gaugeRef = useRef<HTMLSpanElement | null>(null);
  const aim = useRef({ on: false, x: 0, y: 0.2, power: 0.2, lastX: 0, lastY: 0, lastT: 0 });
  const flight = useRef<{ nx: number; ny: number; t0: number; id: string; remote: boolean } | null>(null);
  const darts = useRef<{ nx: number; ny: number }[]>([]);
  const seen = useRef(new Set<string>());
  const apiRef = useRef(api);
  apiRef.current = api;

  const commit = (nx: number, ny: number, id: string, remote: boolean) => {
    if (seen.current.has(id)) return;
    const m = model.current;
    if (m.winner !== null) return;
    seen.current.add(id);
    const hit = scoreAt(nx, ny);
    const seat = m.turn;
    if (variant === "501") {
      const res = apply501(m.scores[seat], hit, doubleOut);
      if (res.bust) {
        m.scores[seat] = m.visit;
        m.left = 0;
        m.bust = true;
        m.log = [`${apiRef.current.names[seat]} busts on ${hit.label}`, ...m.log].slice(0, 6);
        apiRef.current.sound("bust");
      } else {
        m.scores[seat] = res.next;
        m.left -= 1;
        m.bust = false;
        m.log = [`${hit.label} · ${hit.score}`, ...m.log].slice(0, 6);
        apiRef.current.sound(hit.score ? "hit" : "tap");
        if (res.won) {
          m.winner = seat;
          apiRef.current.sound("win");
          apiRef.current.finish(seat);
        }
      }
    } else {
      m.left -= 1;
      m.bust = false;
      const mark = cricketMarks(hit);
      if (mark) {
        const mine = { ...m.marks[seat] };
        const opp = m.marks[seat === 0 ? 1 : 0];
        const before = mine[mark.num] ?? 0;
        const after = before + mark.marks;
        mine[mark.num] = after;
        m.marks[seat] = mine;
        const overflow = Math.max(0, after - 3) - Math.max(0, before - 3);
        if (overflow > 0 && (opp[mark.num] ?? 0) < 3) {
          const value = mark.num === 25 ? 25 : mark.num;
          m.points[seat] += overflow * value;
        }
      }
      m.log = [`${hit.label}`, ...m.log].slice(0, 6);
      apiRef.current.sound(hit.score ? "hit" : "tap");
      const done = CRICKET_NUMS.every((n) => closed(m.marks[seat][n] ?? 0));
      const ahead = m.points[seat] >= m.points[seat === 0 ? 1 : 0];
      if (done && ahead) {
        m.winner = seat;
        m.left = 0;
        apiRef.current.sound("win");
        apiRef.current.finish(seat);
      }
    }
    darts.current = [...darts.current, { nx, ny }].slice(-3);
    if (m.winner === null && m.left <= 0) {
      m.turn = m.turn === 0 ? 1 : 0;
      m.left = 3;
      m.visit = m.scores[m.turn];
      darts.current = [];
    }
    if (!remote && apiRef.current.mode === "link") {
      apiRef.current.send({ g: "darts", t: "throw", id, nx, ny });
    }
    paint();
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => {
    return api.subscribe((evt) => {
      if (evt.g !== "darts" || evt.t !== "throw") return;
      flight.current = { nx: evt.nx, ny: evt.ny, t0: performance.now(), id: evt.id, remote: true };
    });
  }, [api]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let raf = 0;
    const draw = (now: number) => {
      const width = wrap.clientWidth;
      const size = Math.max(280, Math.min(width, 560));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      canvas.width = Math.floor(size * dpr);
      canvas.height = Math.floor(size * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cx = size / 2;
      const cy = size / 2;
      const R = size * 0.46;
      ctx.clearRect(0, 0, size, size);
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.08, 0, Math.PI * 2);
      ctx.fillStyle = "#0c1410";
      ctx.fill();
      const rings: [number, number, "double" | "single" | "triple"][] = [
        [0.953, 1, "double"],
        [0.629, 0.953, "single"],
        [0.582, 0.629, "triple"],
        [0.094, 0.582, "single"],
      ];
      for (let sector = 0; sector < 20; sector++) {
        const black = sector % 2 === 0;
        for (const [r0, r1, kind] of rings) {
          const span = (Math.PI * 2) / 20;
          const a0 = -Math.PI / 2 - span / 2 + sector * span;
          const a1 = a0 + span;
          ctx.beginPath();
          ctx.arc(cx, cy, R * r1, a0, a1);
          ctx.arc(cx, cy, R * r0, a1, a0, true);
          ctx.closePath();
          if (kind === "single") ctx.fillStyle = black ? "#1c1c1c" : "#efe6cf";
          else ctx.fillStyle = black ? "#1f7a45" : "#c43737";
          ctx.fill();
        }
      }
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.094, 0, Math.PI * 2);
      ctx.fillStyle = "#1f7a45";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.037, 0, Math.PI * 2);
      ctx.fillStyle = "#c43737";
      ctx.fill();
      ctx.fillStyle = "#f3ecdf";
      ctx.font = `600 ${Math.max(11, size * 0.038)}px Fraunces, serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      WEDGES.forEach((n, sector) => {
        const ang = -Math.PI / 2 + (sector * Math.PI * 2) / 20;
        ctx.fillText(String(n), cx + Math.cos(ang) * R * 1.12, cy + Math.sin(ang) * R * 1.12);
      });
      for (const dart of darts.current) {
        const x = cx + dart.nx * R;
        const y = cy - dart.ny * R;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#e2b15a";
        ctx.fill();
      }
      const fly = flight.current;
      if (fly) {
        const p = Math.min(1, (now - fly.t0) / 420);
        const ease = 1 - (1 - p) ** 3;
        const x = cx + fly.nx * R * ease;
        const y = cy + (size * 0.48 - (size * 0.48 + fly.ny * R) * -1 * 0 + 0);
        const startY = size * 0.96;
        const endY = cy - fly.ny * R;
        const yNow = startY + (endY - startY) * ease;
        const xNow = cx + (cx + fly.nx * R - cx) * ease;
        ctx.beginPath();
        ctx.arc(xNow, yNow, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#f3ecdf";
        ctx.fill();
        void x;
        void y;
        if (p >= 1) {
          const done = fly;
          flight.current = null;
          commitRef.current(done.nx, done.ny, done.id, done.remote);
        }
      } else if (aim.current.on && canThrow()) {
        const s = sway(now, aim.current.power);
        const x = cx + (aim.current.x + s.x) * R;
        const y = cy - (aim.current.y + s.y) * R;
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.strokeStyle = "#e2b15a";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - 12, y);
        ctx.lineTo(x + 12, y);
        ctx.moveTo(x, y - 12);
        ctx.lineTo(x, y + 12);
        ctx.stroke();
      }
      if (gaugeRef.current) {
        const power = aim.current.on ? Math.max(0.08, Math.min(1, aim.current.power)) : 0;
        gaugeRef.current.style.transform = `scaleX(${power})`;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  function canThrow() {
    const m = model.current;
    if (m.winner !== null || flight.current) return false;
    if (api.mode === "link" && api.seat !== m.turn) return false;
    return true;
  }

  function toBoard(ev: React.PointerEvent) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width - 0.5) * 2,
      y: (0.5 - (ev.clientY - rect.top) / rect.height) * 2,
    };
  }

  function onDown(ev: React.PointerEvent) {
    if (!canThrow()) return;
    const p = toBoard(ev);
    if (!p) return;
    canvasRef.current?.setPointerCapture(ev.pointerId);
    aim.current = { on: true, x: p.x, y: p.y, power: 0.35, lastX: p.x, lastY: p.y, lastT: performance.now() };
    api.sound("tap");
  }
  function onMove(ev: React.PointerEvent) {
    if (!aim.current.on) return;
    const p = toBoard(ev);
    if (!p) return;
    const now = performance.now();
    const dt = Math.max(16, now - aim.current.lastT);
    const dist = Math.hypot(p.x - aim.current.lastX, p.y - aim.current.lastY);
    const power = Math.max(aim.current.power * 0.6, Math.min(1, dist / dt * 380));
    aim.current = { ...aim.current, x: p.x, y: p.y, power, lastX: p.x, lastY: p.y, lastT: now };
  }
  function onUp() {
    if (!aim.current.on || !canThrow()) {
      aim.current.on = false;
      return;
    }
    const now = performance.now();
    const power = aim.current.power;
    const s = sway(now, power);
    let nx = aim.current.x + s.x + (power - 0.55) * 0.04;
    let ny = aim.current.y + s.y + (power - 0.55) * 0.16;
    aim.current.on = false;
    api.sound("throw");
    flight.current = { nx, ny, t0: now, id: crypto.randomUUID(), remote: false };
  }

  const m = model.current;
  const mine = api.mode === "link" ? api.seat : m.turn;
  const hint = variant === "501" && doubleOut ? checkoutRoute(m.scores[m.turn], true) : null;
  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-2">
        {[0, 1].map((seat) => {
          const s = seat as Seat;
          const active = m.turn === s && m.winner === null;
          return (
            <div key={s} className={`panel p-3 ${active ? "ring-1 ring-primary" : ""}`}>
              <p className="text-sm text-muted">{api.names[s]}</p>
              {variant === "501" ? (
                <p className={`display text-4xl ${m.bust && active ? "text-danger" : ""}`}>{m.scores[s]}</p>
              ) : (
                <p className="display text-4xl">{m.points[s]}</p>
              )}
              <p className="text-xs text-muted">{active ? `${m.left} dart${m.left === 1 ? "" : "s"} left` : "Waiting"}</p>
            </div>
          );
        })}
      </div>
      {variant === "cricket" ? (
        <div className="panel mb-3 overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_1fr] gap-1 px-3 py-2 text-center text-xs text-muted">
            <span>{api.names[0]}</span>
            <span>Mark</span>
            <span>{api.names[1]}</span>
          </div>
          {CRICKET_NUMS.map((n) => (
            <div key={n} className="grid grid-cols-[1fr_auto_1fr] items-center px-3 py-1 text-center">
              <span>{marksLabel(m.marks[0][n] ?? 0)}</span>
              <span className="w-10 font-semibold">{n === 25 ? "Bull" : n}</span>
              <span>{marksLabel(m.marks[1][n] ?? 0)}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div ref={wrapRef} className="flex justify-center">
        <canvas
          ref={canvasRef}
          className="board"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
      </div>
      <div className="gauge mx-auto mt-3 max-w-xs" aria-hidden="true">
        <span ref={gaugeRef} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-sm">
        <p className="text-muted">
          {m.winner !== null
            ? `${api.names[m.winner]} wins`
            : api.mode === "link" && api.seat !== m.turn
              ? `${api.names[m.turn]} to throw`
              : "Drag to aim. Release to throw."}
        </p>
        {hint ? <p className="text-primary">Out: {hint}</p> : null}
      </div>
      <p className="mt-1 text-sm text-muted">{m.log[0]}</p>
      <p className="mt-2 text-xs text-muted">
        {variant === "501" ? (doubleOut ? "Double-out is on. Inner bull counts as a double." : "Any dart can check out.") : "Close 15–20 and bull. Points score only on a number you closed."}{" "}
        You are {api.names[mine]}.
      </p>
    </div>
  );
}

function marksLabel(n: number) {
  if (n <= 0) return "·";
  if (n === 1) return "/";
  if (n === 2) return "X";
  return "closed";
}
