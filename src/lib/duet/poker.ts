import { cardKey } from "./cards";
import type { Card, Seat } from "./types";

export interface Ranked {
  cat: number;
  kick: number[];
  cards: Card[];
  name: string;
}

function rank5(cards: Card[]): Ranked {
  const rs = cards.map((c) => c.r).sort((a, b) => b - a);
  const flush = cards.every((c) => c.s === cards[0]!.s);
  const counts = new Map<number, number>();
  for (const r of rs) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const uniq = [...new Set(rs)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    const hi = uniq[0]!;
    const lo = uniq[4]!;
    if (hi - lo === 4) straightHigh = hi;
    if (uniq.join(",") === "14,5,4,3,2") straightHigh = 5;
  }
  const kickers = groups.map(([r]) => r);
  if (flush && straightHigh) {
    return {
      cat: 8,
      kick: [straightHigh],
      cards,
      name: straightHigh === 14 ? "Royal flush" : "Straight flush",
    };
  }
  if (groups[0]![1] === 4) return { cat: 7, kick: kickers, cards, name: "Four of a kind" };
  if (groups[0]![1] === 3 && groups[1]?.[1] === 2) return { cat: 6, kick: kickers, cards, name: "Full house" };
  if (flush) return { cat: 5, kick: rs, cards, name: "Flush" };
  if (straightHigh) return { cat: 4, kick: [straightHigh], cards, name: "Straight" };
  if (groups[0]![1] === 3) return { cat: 3, kick: kickers, cards, name: "Three of a kind" };
  if (groups[0]![1] === 2 && groups[1]?.[1] === 2) return { cat: 2, kick: kickers, cards, name: "Two pair" };
  if (groups[0]![1] === 2) return { cat: 1, kick: kickers, cards, name: "Pair" };
  return { cat: 0, kick: rs, cards, name: "High card" };
}

export function compareRank(a: Ranked, b: Ranked): number {
  if (a.cat !== b.cat) return a.cat - b.cat;
  const n = Math.max(a.kick.length, b.kick.length);
  for (let i = 0; i < n; i++) {
    const d = (a.kick[i] ?? 0) - (b.kick[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export function bestHand(cards: Card[]): Ranked {
  if (cards.length < 5) {
    const padded = rank5([...cards, ...Array.from({ length: 5 - cards.length }, () => ({ s: "s" as const, r: 2 }))]);
    return { ...padded, name: "Incomplete", cards };
  }
  let best: Ranked | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      for (let c = b + 1; c < n; c++) {
        for (let d = c + 1; d < n; d++) {
          for (let e = d + 1; e < n; e++) {
            const hand = [cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!];
            const ranked = rank5(hand);
            if (!best || compareRank(ranked, best) > 0) best = ranked;
          }
        }
      }
    }
  }
  return best!;
}

export function handName(cards: Card[]): string {
  return bestHand(cards).name;
}

export interface PokerState {
  handNo: number;
  dealer: Seat;
  street: "preflop" | "flop" | "turn" | "river" | "showdown" | "done";
  sb: number;
  bb: number;
  stacks: [number, number];
  commit: [number, number];
  pot: number;
  toAct: Seat | null;
  minRaiseTo: number;
  lastRaise: number;
  board: Card[];
  folded: [boolean, boolean];
  acted: [boolean, boolean];
  awaiting: number;
  lastAction: string;
  winners: Seat[] | null;
  award: [number, number] | null;
  best: [Card[] | null, Card[] | null];
  label: string;
}

export interface Legal {
  fold: boolean;
  check: boolean;
  call: number;
  minTo: number;
  maxTo: number;
  canRaise: boolean;
}

export function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

export function potTotal(s: PokerState): number {
  return s.pot + s.commit[0] + s.commit[1];
}

function clone(s: PokerState): PokerState {
  return {
    ...s,
    stacks: [...s.stacks],
    commit: [...s.commit],
    board: s.board.slice(),
    folded: [...s.folded],
    acted: [...s.acted],
    winners: s.winners ? [...s.winners] : null,
    award: s.award ? [...s.award] : null,
    best: [s.best[0] ? [...s.best[0]] : null, s.best[1] ? [...s.best[1]] : null],
  };
}

export function dealHand(args: {
  handNo: number;
  dealer: Seat;
  stacks: [number, number];
  sb: number;
  bb: number;
}): PokerState {
  const stacks: [number, number] = [...args.stacks];
  const commit: [number, number] = [0, 0];
  const folded: [boolean, boolean] = [false, false];
  const sbSeat = args.dealer;
  const bbSeat = other(args.dealer);
  const post = (seat: Seat, amt: number) => {
    const pay = Math.min(stacks[seat], amt);
    stacks[seat] -= pay;
    commit[seat] += pay;
  };
  post(sbSeat, args.sb);
  post(bbSeat, args.bb);
  const state: PokerState = {
    handNo: args.handNo,
    dealer: args.dealer,
    street: "preflop",
    sb: args.sb,
    bb: args.bb,
    stacks,
    commit,
    pot: 0,
    toAct: stacks[sbSeat] > 0 ? sbSeat : stacks[bbSeat] > 0 ? bbSeat : null,
    minRaiseTo: args.bb * 2,
    lastRaise: args.bb,
    board: [],
    folded,
    acted: [false, false],
    awaiting: 0,
    lastAction: "Blinds posted",
    winners: null,
    award: null,
    best: [null, null],
    label: "",
  };
  return closeIfNeeded(state);
}

export function legal(s: PokerState, seat: Seat): Legal {
  const maxC = Math.max(s.commit[0], s.commit[1]);
  const owe = maxC - s.commit[seat];
  const maxTo = s.commit[seat] + s.stacks[seat];
  const opp = other(seat);
  const canRaise = s.stacks[seat] > owe && s.stacks[opp] > 0 && maxTo > maxC;
  const minTo = Math.min(maxTo, Math.max(s.minRaiseTo, maxC + 1));
  return {
    fold: owe > 0,
    check: owe === 0 && s.stacks[seat] >= 0,
    call: owe > 0 ? Math.min(owe, s.stacks[seat]) : 0,
    minTo: canRaise ? minTo : maxTo,
    maxTo,
    canRaise,
  };
}

export type PokerAct = { kind: "fold" | "check" | "call" | "raise"; to?: number };

export function applyAction(input: PokerState, seat: Seat, act: PokerAct): PokerState {
  const s = clone(input);
  if (s.toAct !== seat || s.street === "done" || s.street === "showdown" || s.awaiting > 0) return s;
  const L = legal(s, seat);
  const opp = other(seat);
  if (act.kind === "fold") {
    if (!L.fold && L.check) {
      s.lastAction = "Check";
      s.acted[seat] = true;
    } else {
      s.folded[seat] = true;
      s.lastAction = "Fold";
      s.acted[seat] = true;
      return finishFold(s, opp);
    }
  } else if (act.kind === "check") {
    if (!L.check) return s;
    s.acted[seat] = true;
    s.lastAction = "Check";
  } else if (act.kind === "call") {
    const pay = Math.min(L.call, s.stacks[seat]);
    s.stacks[seat] -= pay;
    s.commit[seat] += pay;
    s.acted[seat] = true;
    s.lastAction = pay >= L.call && L.call > 0 ? `Call ${pay}` : `All-in ${pay}`;
  } else if (act.kind === "raise") {
    if (!L.canRaise) return s;
    let to = Math.round(act.to ?? L.minTo);
    to = Math.max(L.minTo, Math.min(L.maxTo, to));
    if (to > L.maxTo) to = L.maxTo;
    if (to < L.minTo && to < L.maxTo) to = L.minTo;
    const maxC = Math.max(s.commit[0], s.commit[1]);
    const pay = to - s.commit[seat];
    if (pay <= 0) return s;
    s.stacks[seat] -= pay;
    s.commit[seat] = to;
    const raiseBy = to - maxC;
    if (raiseBy >= s.lastRaise && s.stacks[opp] > 0) {
      s.lastRaise = raiseBy;
      s.minRaiseTo = to + raiseBy;
      s.acted = [false, false];
    }
    s.acted[seat] = true;
    s.lastAction = s.stacks[seat] === 0 ? `All-in ${to}` : maxC === 0 ? `Bet ${to}` : `Raise to ${to}`;
  }
  return advance(s);
}

function finishFold(s: PokerState, winner: Seat): PokerState {
  const total = potTotal(s);
  s.pot = total;
  s.commit = [0, 0];
  s.award = [0, 0];
  s.award[winner] = total;
  s.stacks[winner] += total;
  s.winners = [winner];
  s.street = "done";
  s.toAct = null;
  s.label = "Fold";
  s.lastAction = `${s.lastAction} — pot ${total}`;
  return s;
}

function bettingClosed(s: PokerState): boolean {
  if (s.folded[0] || s.folded[1]) return true;
  const maxC = Math.max(s.commit[0], s.commit[1]);
  const matched = (seat: Seat) => s.commit[seat] === maxC || s.stacks[seat] === 0;
  if (!matched(0) || !matched(1)) return false;
  if (s.stacks[0] === 0 && s.stacks[1] === 0) return true;
  if (s.stacks[0] === 0) return s.acted[1];
  if (s.stacks[1] === 0) return s.acted[0];
  return s.acted[0] && s.acted[1];
}

function closeIfNeeded(s: PokerState): PokerState {
  if (s.stacks[0] === 0 && s.stacks[1] === 0) return runOut(s);
  if (s.toAct === null) return runOut(s);
  return s;
}

function advance(s: PokerState): PokerState {
  if (s.folded[0] || s.folded[1]) return s;
  if (!bettingClosed(s)) {
    const opp = other(s.toAct!);
    if (s.stacks[opp] > 0 && !s.folded[opp]) s.toAct = opp;
    else if (bettingClosed(s)) return advance({ ...s, toAct: opp });
    else s.toAct = s.stacks[opp] === 0 ? s.toAct : opp;
    return s;
  }
  return nextStreet(s);
}

function nextStreet(s: PokerState): PokerState {
  s.pot += s.commit[0] + s.commit[1];
  s.commit = [0, 0];
  s.acted = [false, false];
  s.lastRaise = s.bb;
  s.minRaiseTo = s.bb;
  const order: Array<"preflop" | "flop" | "turn" | "river" | "showdown"> = [
    "preflop",
    "flop",
    "turn",
    "river",
    "showdown",
  ];
  const idx = order.indexOf(s.street as "preflop");
  const bothIn = !s.folded[0] && !s.folded[1];
  const someoneCant = s.stacks[0] === 0 || s.stacks[1] === 0;
  if (!bothIn) return s;
  if (s.street === "river" || (someoneCant && s.street !== "showdown" && idx >= 0)) {
    if (s.street === "river" || someoneCant) {
      const need = 5 - s.board.length;
      if (need > 0) {
        s.awaiting = need;
        s.toAct = null;
        s.street = s.street === "river" ? "river" : s.street;
        return s;
      }
      s.street = "showdown";
      s.toAct = null;
      return s;
    }
  }
  const next = order[idx + 1] ?? "showdown";
  if (next === "showdown") {
    s.street = "showdown";
    s.toAct = null;
    return s;
  }
  const need = next === "flop" ? 3 : 1;
  s.awaiting = need;
  s.street = next;
  s.toAct = null;
  return s;
}

function runOut(s: PokerState): PokerState {
  const need = 5 - s.board.length;
  if (need > 0) {
    s.awaiting = need;
    s.toAct = null;
    return s;
  }
  s.street = "showdown";
  s.toAct = null;
  return s;
}

export function addBoard(input: PokerState, cards: Card[]): PokerState {
  const s = clone(input);
  const room = Math.max(0, 5 - s.board.length);
  const take = cards.slice(0, s.awaiting > 0 ? Math.min(room, s.awaiting) : room);
  s.board.push(...take);
  s.awaiting = 0;
  const allIn = s.stacks[0] === 0 || s.stacks[1] === 0;
  if (!s.folded[0] && !s.folded[1] && allIn && s.board.length < 5) {
    s.awaiting = 5 - s.board.length;
    s.toAct = null;
    return s;
  }
  if (!s.folded[0] && !s.folded[1] && allIn && s.board.length >= 5) {
    s.street = "showdown";
    s.toAct = null;
    return s;
  }
  if (s.board.length >= 5 && s.street !== "river" && s.street !== "showdown" && s.street !== "done") {
    s.street = "showdown";
    s.toAct = null;
    return s;
  }
  const bb = other(s.dealer);
  if (s.stacks[bb] > 0 && !s.folded[bb]) s.toAct = bb;
  else if (s.stacks[s.dealer] > 0 && !s.folded[s.dealer]) s.toAct = s.dealer;
  else {
    s.street = s.board.length >= 5 ? "showdown" : s.street;
    s.toAct = null;
    if (s.board.length < 5) s.awaiting = 5 - s.board.length;
  }
  return s;
}

export function award(input: PokerState, holes: [Card[], Card[]]): PokerState {
  const s = clone(input);
  const total = potTotal(s);
  s.pot = 0;
  s.commit = [0, 0];
  if (s.folded[0] || s.folded[1]) {
    const w: Seat = s.folded[0] ? 1 : 0;
    s.winners = [w];
    s.award = [0, 0];
    s.award[w] = total;
    s.stacks[w] += total;
    s.street = "done";
    s.label = "Opponent folded";
    return s;
  }
  const a = bestHand([...holes[0], ...s.board]);
  const b = bestHand([...holes[1], ...s.board]);
  s.best = [a.cards, b.cards];
  const cmp = compareRank(a, b);
  s.award = [0, 0];
  if (cmp === 0) {
    const hi = Math.ceil(total / 2);
    const lo = total - hi;
    const bb = other(s.dealer);
    s.award[bb] = hi;
    s.award[s.dealer] = lo;
    s.stacks[0] += s.award[0];
    s.stacks[1] += s.award[1];
    s.winners = [0, 1];
    s.label = `Split pot · ${a.name}`;
  } else {
    const w: Seat = cmp > 0 ? 0 : 1;
    s.winners = [w];
    s.award[w] = total;
    s.stacks[w] += total;
    s.label = (w === 0 ? a : b).name;
  }
  s.street = "done";
  s.toAct = null;
  return s;
}

export function winningKeys(s: PokerState, seat: Seat): string[] {
  const cards = s.best[seat];
  if (!cards || !s.winners?.includes(seat)) return [];
  return cards.map(cardKey);
}

export function quickRaise(s: PokerState, seat: Seat, kind: "min" | "half" | "pot" | "all"): number {
  const L = legal(s, seat);
  if (kind === "all" || kind === "min") return kind === "all" ? L.maxTo : L.minTo;
  const maxC = Math.max(s.commit[0], s.commit[1]);
  const owe = maxC - s.commit[seat];
  const pot = potTotal(s) + owe;
  const size = kind === "half" ? Math.floor(pot / 2) : pot;
  const to = maxC + size;
  return Math.max(L.minTo, Math.min(L.maxTo, to));
}
