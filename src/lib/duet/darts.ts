/** Dartboard in math space: +x right, +y up, radius 1 at the outer double wire. */

export const WEDGES = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

const R_BULL_I = 0.037;
const R_BULL_O = 0.094;
const R_TRIP_I = 0.582;
const R_TRIP_O = 0.629;
const R_DOUB_I = 0.953;
const R_DOUB_O = 1;

export interface Hit {
  score: number;
  ring: "miss" | "inner" | "outer" | "single" | "double" | "triple";
  wedge: number | null;
  label: string;
  mult: number;
}

export function scoreAt(nx: number, ny: number): Hit {
  const r = Math.hypot(nx, ny);
  if (r > R_DOUB_O) return { score: 0, ring: "miss", wedge: null, label: "Miss", mult: 0 };
  if (r <= R_BULL_I) return { score: 50, ring: "inner", wedge: 25, label: "Bullseye", mult: 2 };
  if (r <= R_BULL_O) return { score: 25, ring: "outer", wedge: 25, label: "Outer bull", mult: 1 };
  let ang = Math.atan2(nx, ny);
  if (ang < 0) ang += Math.PI * 2;
  const sector = Math.floor((ang / (Math.PI * 2)) * 20) % 20;
  const wedge = WEDGES[sector] ?? 20;
  let mult = 1;
  let ring: Hit["ring"] = "single";
  if (r >= R_TRIP_I && r <= R_TRIP_O) {
    mult = 3;
    ring = "triple";
  } else if (r >= R_DOUB_I && r <= R_DOUB_O) {
    mult = 2;
    ring = "double";
  }
  const prefix = ring === "triple" ? "T" : ring === "double" ? "D" : "S";
  return { score: wedge * mult, ring, wedge, label: `${prefix}${wedge}`, mult };
}

export function isDouble(hit: Hit): boolean {
  return hit.ring === "double" || hit.ring === "inner";
}

const DARTS = (() => {
  const out: { label: string; score: number; dbl: boolean }[] = [];
  for (let i = 1; i <= 20; i++) {
    out.push({ label: `S${i}`, score: i, dbl: false });
    out.push({ label: `D${i}`, score: i * 2, dbl: true });
    out.push({ label: `T${i}`, score: i * 3, dbl: false });
  }
  out.push({ label: "25", score: 25, dbl: false });
  out.push({ label: "Bull", score: 50, dbl: true });
  return out;
})();

const checkoutMemo = new Map<string, string | null>();

export function checkoutRoute(score: number, doubleOut: boolean): string | null {
  const key = `${score}:${doubleOut ? 1 : 0}`;
  if (checkoutMemo.has(key)) return checkoutMemo.get(key) ?? null;
  let found: string | null = null;
  const finishes = (left: number, d: { score: number; dbl: boolean; label: string }) =>
    doubleOut ? d.dbl && d.score === left : d.score === left;
  if (score > 0 && score <= 180) {
    outer: for (let n = 1; n <= 3; n++) {
      const walk = (left: number, depth: number, path: string[]) => {
        if (found) return;
        for (const d of DARTS) {
          if (d.score > left) continue;
          if (depth === n) {
            if (finishes(left, d)) {
              found = [...path, d.label].join(" · ");
              return;
            }
          } else if (d.score < left) {
            walk(left - d.score, depth + 1, [...path, d.label]);
            if (found) return;
          }
        }
      };
      walk(score, 1, []);
      if (found) break outer;
    }
  }
  checkoutMemo.set(key, found);
  return found;
}

export function apply501(
  remaining: number,
  hit: Hit,
  doubleOut: boolean,
): { next: number; bust: boolean; won: boolean } {
  const next = remaining - hit.score;
  if (next < 0) return { next: remaining, bust: true, won: false };
  if (doubleOut && next === 1) return { next: remaining, bust: true, won: false };
  if (next === 0) {
    if (doubleOut && !isDouble(hit)) return { next: remaining, bust: true, won: false };
    return { next: 0, bust: false, won: true };
  }
  return { next, bust: false, won: false };
}

export const CRICKET_NUMS = [20, 19, 18, 17, 16, 15, 25] as const;

export function cricketMarks(hit: Hit): { num: number; marks: number } | null {
  if (!hit.wedge || !CRICKET_NUMS.includes(hit.wedge as (typeof CRICKET_NUMS)[number])) return null;
  const marks = hit.wedge === 25 ? (hit.ring === "inner" ? 2 : 1) : hit.mult;
  if (!marks) return null;
  return { num: hit.wedge, marks };
}

export function closed(marks: number): boolean {
  return marks >= 3;
}
