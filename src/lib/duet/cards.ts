import type { Card, Suit } from "./types";

export const SUITS: Suit[] = ["s", "h", "d", "c"];
export const SUIT_LABEL: Record<Suit, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

export function rankLabel(r: number): string {
  if (r === 14) return "A";
  if (r === 13) return "K";
  if (r === 12) return "Q";
  if (r === 11) return "J";
  return String(r);
}

export function cardKey(c: Card): string {
  return `${c.s}${c.r}`;
}

export function isRed(c: Card): boolean {
  return c.s === "h" || c.s === "d";
}

export function allCards(): Card[] {
  const out: Card[] = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) out.push({ s, r });
  return out;
}

export function sameCard(a: Card, b: Card): boolean {
  return a.s === b.s && a.r === b.r;
}

export function shuffleCards<T>(list: T[]): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const j = buf[0]! % (i + 1);
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

export function cardId(c: Card): number {
  return SUITS.indexOf(c.s) * 13 + (c.r - 2);
}

export function idToCard(id: number): Card {
  const s = SUITS[Math.floor(id / 13)] ?? "s";
  return { s, r: (id % 13) + 2 };
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
