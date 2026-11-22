import type { PoolSnap, Seat } from "./types";

export const TABLE_W = 10000;
export const TABLE_H = 5000;
export const BALL_R = 118;

export interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  sx: number;
  sy: number;
  pocketed: boolean;
}

export type Group = "solids" | "stripes";

export interface PoolMatch {
  balls: Ball[];
  turn: Seat;
  groups: [Group | null, Group | null];
  ballInHand: boolean;
  shotCount: number;
  winner: Seat | null;
  message: string;
  cueScratch: boolean;
}

interface SimInfo {
  first: number | null;
  railAfter: boolean;
}

const POCKETS = [
  { x: 70, y: 70, r: 300 },
  { x: TABLE_W - 70, y: 70, r: 300 },
  { x: 70, y: TABLE_H - 70, r: 300 },
  { x: TABLE_W - 70, y: TABLE_H - 70, r: 300 },
  { x: TABLE_W / 2, y: 36, r: 250 },
  { x: TABLE_W / 2, y: TABLE_H - 36, r: 250 },
];

function isqrt(n: number): number {
  if (n <= 0) return 0;
  const r = Math.floor(Math.sqrt(n));
  return (r + 1) * (r + 1) <= n ? r + 1 : r;
}

function damp(v: number): number {
  if (v === 0) return 0;
  const n = Math.trunc((v * 993) / 1000);
  return Math.abs(n) < 5 ? 0 : n;
}

export function groupOf(id: number): Group | "eight" | "cue" {
  if (id === 0) return "cue";
  if (id === 8) return "eight";
  return id < 8 ? "solids" : "stripes";
}

export function opponentGroup(g: Group): Group {
  return g === "solids" ? "stripes" : "solids";
}

function rack(): Ball[] {
  const order = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
  const spacing = BALL_R * 2 + 6;
  const balls: Ball[] = [];
  let k = 0;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col <= row; col++) {
      const id = order[k++]!;
      balls.push({
        id,
        x: 7300 + Math.round(row * spacing * 0.866),
        y: 2500 + Math.round((col - row / 2) * spacing),
        vx: 0,
        vy: 0,
        sx: 0,
        sy: 0,
        pocketed: false,
      });
    }
  }
  balls.unshift({ id: 0, x: 2500, y: 2500, vx: 0, vy: 0, sx: 0, sy: 0, pocketed: false });
  return balls;
}

export function newMatch(): PoolMatch {
  return {
    balls: rack(),
    turn: 0,
    groups: [null, null],
    ballInHand: false,
    shotCount: 0,
    winner: null,
    message: "Break to open the table.",
    cueScratch: false,
  };
}

export function snapshot(balls: Ball[]): PoolSnap[] {
  return balls.map((b) => ({ id: b.id, x: b.x, y: b.y, pocketed: b.pocketed }));
}

function cloneBalls(balls: Ball[]): Ball[] {
  return balls.map((b) => ({ ...b }));
}

function tryPocket(b: Ball): boolean {
  for (const p of POCKETS) {
    const dx = b.x - p.x;
    const dy = b.y - p.y;
    if (dx * dx + dy * dy <= p.r * p.r) {
      b.pocketed = true;
      b.vx = 0;
      b.vy = 0;
      b.sx = 0;
      b.sy = 0;
      return true;
    }
  }
  return false;
}

function cushions(b: Ball, info: SimInfo) {
  let hit = false;
  if (b.x < BALL_R) {
    b.x = BALL_R;
    b.vx = -Math.trunc((b.vx * 84) / 100);
    b.vy += Math.trunc(b.sx / 5);
    b.sx = Math.trunc(-b.sx / 2);
    hit = true;
  } else if (b.x > TABLE_W - BALL_R) {
    b.x = TABLE_W - BALL_R;
    b.vx = -Math.trunc((b.vx * 84) / 100);
    b.vy += Math.trunc(b.sx / 5);
    b.sx = Math.trunc(-b.sx / 2);
    hit = true;
  }
  if (b.y < BALL_R) {
    b.y = BALL_R;
    b.vy = -Math.trunc((b.vy * 84) / 100);
    b.vx += Math.trunc(b.sy / 5);
    b.sy = Math.trunc(-b.sy / 2);
    hit = true;
  } else if (b.y > TABLE_H - BALL_R) {
    b.y = TABLE_H - BALL_R;
    b.vy = -Math.trunc((b.vy * 84) / 100);
    b.vx += Math.trunc(b.sy / 5);
    b.sy = Math.trunc(-b.sy / 2);
    hit = true;
  }
  if (hit && info.first !== null) info.railAfter = true;
}

function collide(a: Ball, b: Ball, info: SimInfo) {
  if (a.pocketed || b.pocketed) return;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist2 = dx * dx + dy * dy;
  const min = BALL_R * 2;
  if (dist2 === 0 || dist2 >= min * min) return;
  const dist = Math.max(1, isqrt(dist2));
  const nx = Math.round((dx * 1000) / dist);
  const ny = Math.round((dy * 1000) / dist);
  const overlap = min - dist + 1;
  const half = Math.ceil(overlap / 2);
  a.x -= Math.round((nx * half) / 1000);
  a.y -= Math.round((ny * half) / 1000);
  b.x += Math.round((nx * half) / 1000);
  b.y += Math.round((ny * half) / 1000);
  const dot = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (dot > 0) {
    const dvx = Math.trunc((980 * dot * nx) / 1_000_000_000);
    const dvy = Math.trunc((980 * dot * ny) / 1_000_000_000);
    a.vx -= dvx;
    a.vy -= dvy;
    b.vx += dvx;
    b.vy += dvy;
    if (info.first === null && (a.id === 0 || b.id === 0)) info.first = a.id === 0 ? b.id : a.id;
    if (a.id === 0 && a.sy) {
      b.vx += Math.trunc((a.sy * nx) / 4000);
      b.vy += Math.trunc((a.sy * ny) / 4000);
      a.sy = Math.trunc(a.sy / 5);
    }
  }
}

function stepFrame(balls: Ball[], info: SimInfo) {
  let maxSpeed = 1;
  for (const b of balls) {
    if (b.pocketed) continue;
    maxSpeed = Math.max(maxSpeed, Math.abs(b.vx), Math.abs(b.vy));
  }
  const sub = Math.min(8, Math.max(1, Math.ceil(maxSpeed / (BALL_R * 0.8))));
  for (let s = 0; s < sub; s++) {
    for (const b of balls) {
      if (b.pocketed) continue;
      b.x += Math.trunc(b.vx / sub);
      b.y += Math.trunc(b.vy / sub);
      tryPocket(b);
    }
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) collide(balls[i]!, balls[j]!, info);
    }
    for (const b of balls) if (!b.pocketed) cushions(b, info);
  }
  for (const b of balls) {
    if (b.pocketed) continue;
    b.vx = damp(b.vx);
    b.vy = damp(b.vy);
    b.sx = Math.abs(b.sx) < 3 ? 0 : Math.trunc((b.sx * 90) / 100);
    b.sy = Math.abs(b.sy) < 3 ? 0 : Math.trunc((b.sy * 90) / 100);
  }
}

function moving(balls: Ball[]): boolean {
  return balls.some((b) => !b.pocketed && (b.vx !== 0 || b.vy !== 0));
}

export interface ShotInput {
  ax: number;
  ay: number;
  power: number;
  ex: number;
  ey: number;
  cue: { x: number; y: number } | null;
}

export interface SimResult {
  frames: PoolSnap[][];
  balls: Ball[];
  first: number | null;
  railAfter: boolean;
}

export function simulate(start: Ball[], shot: ShotInput): SimResult {
  const balls = cloneBalls(start);
  const cue = balls.find((b) => b.id === 0);
  if (!cue || cue.pocketed) return { frames: [snapshot(balls)], balls, first: null, railAfter: false };
  if (shot.cue) {
    cue.x = shot.cue.x;
    cue.y = shot.cue.y;
    cue.pocketed = false;
  }
  const len = Math.max(1, isqrt(shot.ax * shot.ax + shot.ay * shot.ay));
  const ax = Math.round((shot.ax * 1000) / len);
  const ay = Math.round((shot.ay * 1000) / len);
  const p = Math.max(0, Math.min(1000, Math.round(shot.power)));
  cue.vx = Math.trunc((ax * p) / 2500);
  cue.vy = Math.trunc((ay * p) / 2500);
  cue.sx = Math.max(-100, Math.min(100, Math.round(shot.ex)));
  cue.sy = Math.max(-100, Math.min(100, Math.round(shot.ey)));
  cue.vx += Math.trunc((-ay * cue.sx) / 25000);
  cue.vy += Math.trunc((ax * cue.sx) / 25000);
  const info: SimInfo = { first: null, railAfter: false };
  const frames: PoolSnap[][] = [];
  let steps = 0;
  while (steps < 1400 && moving(balls)) {
    stepFrame(balls, info);
    steps++;
    if (steps % 2 === 0) frames.push(snapshot(balls));
  }
  for (const b of balls) {
    b.vx = 0;
    b.vy = 0;
    b.sx = 0;
    b.sy = 0;
  }
  frames.push(snapshot(balls));
  return { frames, balls, first: info.first, railAfter: info.railAfter };
}

function respotEight(balls: Ball[]) {
  const eight = balls.find((b) => b.id === 8);
  if (!eight) return;
  const spots = [
    { x: 7300, y: 2500 },
    { x: 2500, y: 2500 },
    { x: 5000, y: 2500 },
  ];
  for (const spot of spots) {
    if (!balls.some((b) => !b.pocketed && b.id !== 8 && (b.x - spot.x) ** 2 + (b.y - spot.y) ** 2 < (BALL_R * 2) ** 2)) {
      eight.x = spot.x;
      eight.y = spot.y;
      eight.pocketed = false;
      return;
    }
  }
  eight.x = 5000;
  eight.y = 1400;
  eight.pocketed = false;
}

export function placeCue(balls: Ball[], x: number, y: number): { x: number; y: number } | null {
  const cx = Math.max(BALL_R + 10, Math.min(TABLE_W - BALL_R - 10, Math.round(x)));
  const cy = Math.max(BALL_R + 10, Math.min(TABLE_H - BALL_R - 10, Math.round(y)));
  for (const p of POCKETS) {
    const dx = cx - p.x;
    const dy = cy - p.y;
    if (dx * dx + dy * dy < (p.r + BALL_R) * (p.r + BALL_R)) return null;
  }
  for (const b of balls) {
    if (b.id === 0 || b.pocketed) continue;
    const dx = cx - b.x;
    const dy = cy - b.y;
    if (dx * dx + dy * dy < (BALL_R * 2 + 4) ** 2) return null;
  }
  return { x: cx, y: cy };
}

export function cleared(balls: Ball[], group: Group): boolean {
  return balls.filter((b) => !b.pocketed && groupOf(b.id) === group).length === 0;
}

export function applySimulation(match: PoolMatch, sim: SimResult): PoolMatch {
  const before = new Set(match.balls.filter((b) => b.pocketed).map((b) => b.id));
  const pocketedNow = sim.balls.filter((b) => b.pocketed && !before.has(b.id)).map((b) => b.id);
  const isBreak = match.shotCount === 0;
  const shooter = match.turn;
  const next: PoolMatch = {
    ...match,
    balls: sim.balls,
    groups: [...match.groups],
    shotCount: match.shotCount + 1,
    cueScratch: false,
  };
  const eightDown = pocketedNow.includes(8);
  const scratch = pocketedNow.includes(0);
  const objectPocketed = pocketedNow.filter((id) => id !== 0 && id !== 8);
  const myGroup = next.groups[shooter];
  const fouls: string[] = [];

  if (eightDown && isBreak) {
    respotEight(next.balls);
    fouls.push("8 on the break — respotted");
  }

  if (sim.first === null && !(isBreak && objectPocketed.length + (eightDown ? 1 : 0) > 0)) {
    fouls.push("No ball hit");
  } else if (!isBreak && myGroup && sim.first !== null) {
    const onlyEight = myGroup ? cleared(match.balls, myGroup) : false;
    if (onlyEight) {
      if (sim.first !== 8) fouls.push("Hit the 8 first");
    } else if (groupOf(sim.first) !== myGroup) {
      fouls.push("Wrong ball first");
    }
  }

  if (sim.first !== null && objectPocketed.length === 0 && !eightDown && !sim.railAfter) {
    fouls.push("No rail");
  }

  if (scratch) fouls.push("Scratch");

  const foul = fouls.length > 0;
  const stillEight = eightDown && !isBreak;

  if (stillEight) {
    const legal =
      !foul &&
      myGroup !== null &&
      cleared(
        sim.balls.map((b) => (b.id === 8 ? { ...b, pocketed: false } : b)),
        myGroup,
      );
    // cleared() on a copy where 8 is unpocketed still checks the group. Group balls that were already down stay down.
    const groupClear = myGroup !== null && cleared(match.balls, myGroup);
    if (legal && groupClear && !scratch) {
      next.winner = shooter;
      next.ballInHand = false;
      next.message = "8-ball. That's the game.";
      return next;
    }
    next.winner = shooter === 0 ? 1 : 0;
    next.ballInHand = false;
    next.message = scratch ? "Scratched on the 8. Loss." : "8-ball too early. Loss.";
    return next;
  }

  if (!isBreak && next.groups[0] === null && !foul) {
    const solids = objectPocketed.some((id) => id < 8);
    const stripes = objectPocketed.some((id) => id > 8);
    if (solids !== stripes) {
      const mine: Group = solids ? "solids" : "stripes";
      next.groups[shooter] = mine;
      next.groups[shooter === 0 ? 1 : 0] = opponentGroup(mine);
    }
  }

  const mine = next.groups[shooter];
  const pocketedOwn =
    mine === null
      ? objectPocketed.length > 0 && !foul
      : objectPocketed.some((id) => groupOf(id) === mine) && !foul;

  if (foul) {
    next.turn = shooter === 0 ? 1 : 0;
    next.ballInHand = true;
    const cue = next.balls.find((b) => b.id === 0);
    if (cue) cue.pocketed = true;
    next.cueScratch = scratch || true;
    next.message = `${fouls[0]}. Ball in hand.`;
    return next;
  }

  if (pocketedOwn) {
    next.turn = shooter;
    next.ballInHand = false;
    const named = mine ?? "open table";
    next.message = mine ? `Pocket. ${named} continue.` : "Table still open. Shoot again.";
    return next;
  }

  next.turn = shooter === 0 ? 1 : 0;
  next.ballInHand = false;
  next.message = objectPocketed.length ? "Their ball drops. Other shooter." : "No pocket. Other shooter.";
  return next;
}

export function ballColor(id: number): string {
  const map = ["#f4f0e6", "#e2b15a", "#2f6fdb", "#d24b45", "#6d4bb5", "#e07a32", "#2f8f55", "#8d2f32", "#1a1a1a", "#e2b15a", "#2f6fdb", "#d24b45", "#6d4bb5", "#e07a32", "#2f8f55", "#8d2f32"];
  return map[id] ?? "#f4f0e6";
}
