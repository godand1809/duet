import { useEffect, useRef, useState } from "react";
import {
  BALL_R,
  TABLE_H,
  TABLE_W,
  applySimulation,
  ballColor,
  groupOf,
  newMatch,
  placeCue,
  simulate,
  type Ball,
  type PoolMatch,
  type ShotInput,
} from "@/lib/duet/pool";
import type { PoolSnap, Seat } from "@/lib/duet/types";
import type { TableApi } from "./api";

export function PoolGame({ api }: { api: TableApi }) {
  const match = useRef<PoolMatch>(newMatch());
  const [, bump] = useState(0);
  const paint = () => bump((n) => n + 1);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const gaugeRef = useRef<HTMLSpanElement | null>(null);
  const powerRef = useRef(0);
  const frames = useRef<PoolSnap[][] | null>(null);
  const frameIdx = useRef(0);
  const aiming = useRef({ on: false, x: 0, y: 0, sx: 0, sy: 0 });
  const english = useRef({ x: 0, y: 0 });
  const apiRef = useRef(api);
  apiRef.current = api;
  const busy = useRef(false);

  function myTurn() {
    const m = match.current;
    if (m.winner !== null || busy.current) return false;
    if (apiRef.current.mode === "link") return apiRef.current.seat === m.turn;
    return true;
  }

  function apply(next: PoolMatch, sound: boolean) {
    const prev = match.current.winner;
    match.current = next;
    if (sound) {
      if (next.winner !== null && prev === null) {
        apiRef.current.sound(next.winner === (apiRef.current.mode === "link" ? apiRef.current.seat : next.winner) ? "win" : "lose");
        apiRef.current.finish(next.winner);
      } else if (next.message.startsWith("Scratch") || next.message.startsWith("No")) apiRef.current.sound("tap");
      else apiRef.current.sound("pocket");
    }
    paint();
  }

  function play(input: ShotInput, remote: boolean, end?: PoolSnap[]) {
    busy.current = true;
    const sim = simulate(match.current.balls, input);
    frames.current = sim.frames;
    frameIdx.current = 0;
    const next = applySimulation(match.current, sim);
    if (end && end.length) {
      next.balls = next.balls.map((ball) => {
        const snap = end.find((s) => s.id === ball.id);
        return snap ? { ...ball, x: snap.x, y: snap.y, pocketed: snap.pocketed, vx: 0, vy: 0 } : ball;
      });
    }
    const step = () => {
      if (!frames.current) return;
      frameIdx.current += 1;
      if (frameIdx.current >= frames.current.length) {
        frames.current = null;
        busy.current = false;
        apply(next, true);
        return;
      }
      paint();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    if (!remote && apiRef.current.mode === "link") {
      apiRef.current.send({
        g: "pool",
        t: "shot",
        ax: input.ax,
        ay: input.ay,
        power: input.power,
        ex: input.ex,
        ey: input.ey,
        cue: input.cue,
        end: sim.balls.map((b) => ({ id: b.id, x: b.x, y: b.y, pocketed: b.pocketed })),
      });
    }
  }

  useEffect(() => {
    return api.subscribe((evt) => {
      if (evt.g !== "pool") return;
      if (evt.t === "place") {
        const balls = match.current.balls.map((b) => (b.id === 0 ? { ...b, x: evt.x, y: evt.y, pocketed: false } : b));
        match.current = { ...match.current, balls, ballInHand: false, message: "Cue placed." };
        paint();
      }
      if (evt.t === "shot") {
        play({ ax: evt.ax, ay: evt.ay, power: evt.power, ex: evt.ex, ey: evt.ey, cue: evt.cue }, true, evt.end);
      }
    });
  }, [api]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let raf = 0;
    const draw = () => {
      const cssW = wrap.clientWidth;
      const cssH = Math.max(220, Math.min(cssW * 0.56, window.innerHeight * 0.62));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const pad = 18;
      const scale = Math.min((cssW - pad * 2) / TABLE_W, (cssH - pad * 2) / TABLE_H);
      const ox = (cssW - TABLE_W * scale) / 2;
      const oy = (cssH - TABLE_H * scale) / 2;
      const tx = (x: number) => ox + x * scale;
      const ty = (y: number) => oy + y * scale;
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = "#6a3b24";
      round(ctx, ox - 16, oy - 16, TABLE_W * scale + 32, TABLE_H * scale + 32, 18);
      ctx.fill();
      ctx.fillStyle = "#1d6b45";
      round(ctx, ox, oy, TABLE_W * scale, TABLE_H * scale, 8);
      ctx.fill();
      const pockets = [
        [70, 70],
        [TABLE_W - 70, 70],
        [70, TABLE_H - 70],
        [TABLE_W - 70, TABLE_H - 70],
        [TABLE_W / 2, 36],
        [TABLE_W / 2, TABLE_H - 36],
      ];
      ctx.fillStyle = "#0b0e0c";
      for (const [x, y] of pockets) {
        ctx.beginPath();
        ctx.arc(tx(x), ty(y), 250 * scale, 0, Math.PI * 2);
        ctx.fill();
      }
      const live = frames.current?.[frameIdx.current];
      const balls: Ball[] = match.current.balls.map((ball) => {
        const snap = live?.find((s) => s.id === ball.id);
        return snap ? { ...ball, x: snap.x, y: snap.y, pocketed: snap.pocketed } : ball;
      });
      for (const ball of balls) {
        if (ball.pocketed) continue;
        const stripe = ball.id > 8;
        ctx.beginPath();
        ctx.arc(tx(ball.x), ty(ball.y), BALL_R * scale, 0, Math.PI * 2);
        ctx.fillStyle = stripe ? "#f4f0e6" : ballColor(ball.id);
        ctx.fill();
        if (stripe) {
          ctx.fillStyle = ballColor(ball.id);
          ctx.fillRect(tx(ball.x) - BALL_R * scale, ty(ball.y) - BALL_R * scale * 0.38, BALL_R * 2 * scale, BALL_R * 0.76 * scale);
        }
        if (ball.id !== 0) {
          ctx.fillStyle = ball.id === 8 ? "#f4f0e6" : "#1c1915";
          ctx.font = `${Math.max(8, BALL_R * scale * 0.9)}px Outfit, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(ball.id), tx(ball.x), ty(ball.y));
        }
      }
      const cue = balls.find((b) => b.id === 0 && !b.pocketed);
      if (cue && aiming.current.on && !live) {
        const dx = cue.x - aiming.current.x;
        const dy = cue.y - aiming.current.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        ctx.strokeStyle = "rgba(243,236,223,0.85)";
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(tx(cue.x), ty(cue.y));
        ctx.lineTo(tx(cue.x + ux * 1400), ty(cue.y + uy * 1400));
        ctx.stroke();
        ctx.setLineDash([]);
        const pull = Math.hypot(aiming.current.sx - aiming.current.x, aiming.current.sy - aiming.current.y);
        ctx.strokeStyle = "#e2b15a";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(tx(cue.x - ux * (BALL_R + 8)), ty(cue.y - uy * (BALL_R + 8)));
        ctx.lineTo(
          tx(cue.x - ux * (BALL_R + 30 + Math.min(220, pull))),
          ty(cue.y - uy * (BALL_R + 30 + Math.min(220, pull))),
        );
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      if (gaugeRef.current) gaugeRef.current.style.transform = `scaleX(${aiming.current.on ? powerRef.current : 0})`;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  function boardPoint(ev: React.PointerEvent) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;
    const pad = 18;
    const scale = Math.min((cssW - pad * 2) / TABLE_W, (cssH - pad * 2) / TABLE_H);
    const ox = (cssW - TABLE_W * scale) / 2;
    const oy = (cssH - TABLE_H * scale) / 2;
    return { x: (ev.clientX - rect.left - ox) / scale, y: (ev.clientY - rect.top - oy) / scale };
  }

  function onDown(ev: React.PointerEvent) {
    if (!myTurn()) return;
    const p = boardPoint(ev);
    if (!p) return;
    if (match.current.ballInHand) {
      const spot = placeCue(match.current.balls, p.x, p.y);
      if (!spot) return;
      const balls = match.current.balls.map((b) => (b.id === 0 ? { ...b, x: spot.x, y: spot.y, pocketed: false } : b));
      match.current = { ...match.current, balls, ballInHand: false, message: "Cue placed. Drag back to shoot." };
      if (api.mode === "link") api.send({ g: "pool", t: "place", x: spot.x, y: spot.y });
      api.sound("tap");
      paint();
      return;
    }
    canvasRef.current?.setPointerCapture(ev.pointerId);
    aiming.current = { on: true, x: p.x, y: p.y, sx: p.x, sy: p.y };
  }
  function onMove(ev: React.PointerEvent) {
    if (!aiming.current.on) return;
    const p = boardPoint(ev);
    if (!p) return;
    aiming.current.x = p.x;
    aiming.current.y = p.y;
    const cue = match.current.balls.find((b) => b.id === 0 && !b.pocketed);
    powerRef.current = cue ? Math.max(0, Math.min(1, Math.hypot(cue.x - p.x, cue.y - p.y) / 700)) : 0;
  }
  function onUp() {
    if (!aiming.current.on) return;
    const cue = match.current.balls.find((b) => b.id === 0 && !b.pocketed);
    aiming.current.on = false;
    if (!cue || !myTurn()) return;
    const dx = cue.x - aiming.current.x;
    const dy = cue.y - aiming.current.y;
    const pull = Math.hypot(dx, dy);
    if (pull < 40) return;
    const power = Math.max(80, Math.min(1000, pull / 1.6));
    api.sound("throw");
    play(
      { ax: dx, ay: dy, power, ex: english.current.x, ey: english.current.y, cue: match.current.ballInHand ? { x: cue.x, y: cue.y } : null },
      false,
    );
  }

  const m = match.current;
  const seat: Seat = api.mode === "link" ? api.seat : m.turn;
  const group = m.groups[m.turn];
  return (
    <div className="landscape-split">
      <div ref={wrapRef}>
        <canvas ref={canvasRef} className="board w-full" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
        <div className="gauge mt-2" aria-hidden="true">
          <span ref={gaugeRef} />
        </div>
      </div>
      <div className="mt-3 space-y-3">
        <div className="panel p-3">
          <p className="text-sm text-muted">{m.winner !== null ? "Game" : `${api.names[m.turn]} to shoot`}</p>
          <p className="mt-1 font-semibold">{m.message}</p>
          <p className="mt-1 text-sm text-muted">
            {m.groups[0] ? `${api.names[0]} ${m.groups[0]} · ${api.names[1]} ${m.groups[1]}` : "Open table"}
            {group ? ` · shooting ${group}` : ""}
          </p>
          <p className="text-xs text-muted">You are {api.names[seat]}. Drag back from the cue ball, then release.</p>
        </div>
        <English
          onChange={(x, y) => {
            english.current = { x, y };
          }}
        />
      </div>
    </div>
  );
}

function English({ onChange }: { onChange: (x: number, y: number) => void }) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  function setFrom(ev: React.PointerEvent) {
    const rect = (ev.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, ((ev.clientX - rect.left) / rect.width) * 2 - 1));
    const y = Math.max(-1, Math.min(1, ((ev.clientY - rect.top) / rect.height) * 2 - 1));
    setPos({ x, y });
    onChange(Math.round(x * 100), Math.round(y * 100));
  }
  return (
    <div className="panel flex items-center gap-3 p-3">
      <div
        className="board relative h-16 w-16 rounded-full border border-border bg-elevated"
        onPointerDown={(ev) => {
          (ev.currentTarget as HTMLDivElement).setPointerCapture(ev.pointerId);
          setFrom(ev);
        }}
        onPointerMove={(ev) => {
          if (ev.currentTarget.hasPointerCapture(ev.pointerId)) setFrom(ev);
        }}
      >
        <span
          className="absolute h-3 w-3 rounded-full bg-primary"
          style={{ left: `${50 + pos.x * 38}%`, top: `${50 + pos.y * 38}%`, transform: "translate(-50%, -50%)" }}
        />
      </div>
      <div>
        <p className="text-sm font-semibold">Cue spin</p>
        <p className="text-xs text-muted">Drag the dot for english. Center is a clean hit.</p>
      </div>
    </div>
  );
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

void groupOf;
