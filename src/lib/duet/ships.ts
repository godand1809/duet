import { sha256 } from "./cards";
import type { ShipPlacement } from "./types";

export const FLEET = [
  { id: "carrier", name: "Carrier", len: 5 },
  { id: "battleship", name: "Battleship", len: 4 },
  { id: "cruiser", name: "Cruiser", len: 3 },
  { id: "submarine", name: "Submarine", len: 3 },
  { id: "destroyer", name: "Destroyer", len: 2 },
] as const;

export type FleetId = (typeof FLEET)[number]["id"];

export function shipLen(id: string): number {
  return FLEET.find((s) => s.id === id)?.len ?? 0;
}

export function cellsOf(p: ShipPlacement): { x: number; y: number }[] {
  const len = shipLen(p.id);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < len; i++) {
    out.push(p.dir === "h" ? { x: p.x + i, y: p.y } : { x: p.x, y: p.y + i });
  }
  return out;
}

export function fleetValid(fleet: ShipPlacement[]): boolean {
  if (fleet.length !== FLEET.length) return false;
  const ids = new Set(fleet.map((s) => s.id));
  if (ids.size !== FLEET.length) return false;
  const seen = new Set<string>();
  for (const ship of fleet) {
    if (!FLEET.some((s) => s.id === ship.id)) return false;
    for (const c of cellsOf(ship)) {
      if (c.x < 0 || c.y < 0 || c.x > 9 || c.y > 9) return false;
      const k = `${c.x},${c.y}`;
      if (seen.has(k)) return false;
      seen.add(k);
    }
  }
  return true;
}

function rand(n: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! % n;
}

export function randomFleet(): ShipPlacement[] {
  for (let attempt = 0; attempt < 40; attempt++) {
    const fleet: ShipPlacement[] = [];
    let ok = true;
    for (const spec of FLEET) {
      let placed = false;
      for (let t = 0; t < 80; t++) {
        const dir: "h" | "v" = rand(2) === 0 ? "h" : "v";
        const x = dir === "h" ? rand(11 - spec.len) : rand(10);
        const y = dir === "v" ? rand(11 - spec.len) : rand(10);
        const ship: ShipPlacement = { id: spec.id, x, y, dir };
        if (fleetValidPartial([...fleet, ship])) {
          fleet.push(ship);
          placed = true;
          break;
        }
      }
      if (!placed) {
        ok = false;
        break;
      }
    }
    if (ok && fleetValid(fleet)) return fleet;
  }
  return [
    { id: "carrier", x: 0, y: 0, dir: "h" },
    { id: "battleship", x: 0, y: 2, dir: "h" },
    { id: "cruiser", x: 0, y: 4, dir: "h" },
    { id: "submarine", x: 0, y: 6, dir: "h" },
    { id: "destroyer", x: 0, y: 8, dir: "h" },
  ];
}

function fleetValidPartial(fleet: ShipPlacement[]): boolean {
  const seen = new Set<string>();
  for (const ship of fleet) {
    for (const c of cellsOf(ship)) {
      if (c.x < 0 || c.y < 0 || c.x > 9 || c.y > 9) return false;
      const k = `${c.x},${c.y}`;
      if (seen.has(k)) return false;
      seen.add(k);
    }
  }
  return true;
}

export function randomNonce(): string {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function commitFleet(fleet: ShipPlacement[], nonce: string): Promise<string> {
  return sha256(JSON.stringify({ fleet, nonce }));
}

export function shotOn(
  fleet: ShipPlacement[],
  x: number,
  y: number,
  previousHits: { x: number; y: number }[],
): { hit: boolean; sunk?: { id: string; cells: { x: number; y: number }[] } } {
  for (const ship of fleet) {
    const cells = cellsOf(ship);
    if (!cells.some((c) => c.x === x && c.y === y)) continue;
    const sunk = cells.every(
      (c) => (c.x === x && c.y === y) || previousHits.some((h) => h.x === c.x && h.y === c.y),
    );
    return sunk ? { hit: true, sunk: { id: ship.id, cells } } : { hit: true };
  }
  return { hit: false };
}

export function afloat(fleet: ShipPlacement[], hits: { x: number; y: number }[]): number {
  return fleet.filter((ship) => cellsOf(ship).some((c) => !hits.some((h) => h.x === c.x && h.y === c.y))).length;
}
