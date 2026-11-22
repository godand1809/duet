import { shuffleCards } from "./cards";
import type { Card, Seat } from "./types";

export function freshDeck(): Card[] {
  const cards: Card[] = [];
  for (const s of ["s", "h", "d", "c"] as const) for (let r = 2; r <= 14; r++) cards.push({ s, r });
  return shuffleCards(cards);
}

export function trickWinner(trick: { seat: Seat; card: Card }[]): Seat {
  const lead = trick[0]!.card.s;
  let win = 0;
  const beats = (a: Card, b: Card) => {
    const aT = a.s === "s";
    const bT = b.s === "s";
    if (bT && !aT) return true;
    if (aT && bT) return b.r > a.r;
    if (!aT && !bT && b.s === lead && a.s !== lead) return true;
    if (!aT && !bT && a.s === lead && b.s === lead) return b.r > a.r;
    return false;
  };
  for (let i = 1; i < trick.length; i++) {
    if (beats(trick[win]!.card, trick[i]!.card)) win = i;
  }
  return trick[win]!.seat;
}

export function legalCards(hand: Card[], lead: Card | null, spadesBroken: boolean, leading: boolean): Card[] {
  if (!leading && lead) {
    const follow = hand.filter((c) => c.s === lead.s);
    if (follow.length) return follow;
    return hand;
  }
  if (leading && !spadesBroken && hand.some((c) => c.s !== "s")) return hand.filter((c) => c.s !== "s");
  return hand;
}

export function scoreHand(bid: number, tricks: number, blind: boolean, bags: number): {
  delta: number;
  bags: number;
  note: string;
} {
  let delta = 0;
  let b = bags;
  let note = "";
  if (bid === 0) {
    const bonus = blind ? 200 : 100;
    if (tricks === 0) {
      delta += bonus;
      note = blind ? "Blind nil made" : "Nil made";
    } else {
      delta -= bonus;
      b += tricks;
      note = blind ? "Blind nil failed" : "Nil failed";
    }
  } else if (tricks >= bid) {
    const over = tricks - bid;
    delta += bid * 10 + over;
    b += over;
    note = over ? `Made ${bid} + ${over} bag${over === 1 ? "" : "s"}` : `Made ${bid}`;
  } else {
    delta -= bid * 10;
    note = `Set (${tricks}/${bid})`;
  }
  if (b >= 10) {
    const pens = Math.floor(b / 10);
    delta -= pens * 100;
    b -= pens * 10;
    note += ` · ${pens * 10}-bag penalty`;
  }
  return { delta, bags: b, note };
}

export const SPADE_TARGET = 500;
