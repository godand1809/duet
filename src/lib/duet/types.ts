export type GameId = "darts" | "spades" | "poker" | "pool" | "battleship";
export type Seat = 0 | 1;
export type Mode = "hotseat" | "link";
export type Suit = "s" | "h" | "d" | "c";

export interface Card {
  s: Suit;
  r: number;
}

export interface GameOptions {
  darts: { variant: "501" | "cricket"; doubleOut: boolean };
  poker: { stack: number; sb: number; bb: number; timerMin: number | null };
}

export const DEFAULT_OPTIONS: GameOptions = {
  darts: { variant: "501", doubleOut: true },
  poker: { stack: 1000, sb: 10, bb: 20, timerMin: null },
};

export interface MatchResult {
  game: GameId;
  names: [string, string];
  winner: Seat;
}

export type LinkPhase =
  | "idle"
  | "creating"
  | "waiting"
  | "connecting"
  | "open"
  | "reconnecting"
  | "failed"
  | "closed";

export type WireEvt =
  | { g: "meta"; t: "ready" }
  | { g: "darts"; t: "throw"; id: string; nx: number; ny: number }
  | { g: "spades"; t: "blind"; seat: Seat; blind: boolean }
  | { g: "spades"; t: "offer"; id: string; card: Card; chooser: Seat }
  | { g: "spades"; t: "decide"; id: string; take: boolean }
  | { g: "spades"; t: "assign"; card: Card; to: Seat }
  | { g: "spades"; t: "bid"; seat: Seat; bid: number }
  | { g: "spades"; t: "play"; seat: Seat; card: Card }
  | { g: "spades"; t: "next" }
  | { g: "poker"; t: "mp"; step: string; data: string[] }
  | { g: "poker"; t: "commit"; seat: Seat; hash: string }
  | { g: "poker"; t: "go"; handNo: number; dealer: Seat; stacks: [number, number]; sb: number; bb: number }
  | { g: "poker"; t: "act"; seat: Seat; kind: "fold" | "check" | "call" | "raise"; to?: number }
  | { g: "poker"; t: "board"; cards: Card[] }
  | { g: "poker"; t: "reveal"; seat: Seat; cards: Card[]; nonce: string }
  | { g: "pool"; t: "place"; x: number; y: number }
  | {
      g: "pool";
      t: "shot";
      ax: number;
      ay: number;
      power: number;
      ex: number;
      ey: number;
      cue: { x: number; y: number } | null;
      end: PoolSnap[];
    }
  | { g: "battleship"; t: "ready"; commit: string }
  | { g: "battleship"; t: "fire"; x: number; y: number; by: Seat }
  | {
      g: "battleship";
      t: "answer";
      x: number;
      y: number;
      hit: boolean;
      sunk?: { id: string; cells: { x: number; y: number }[] };
    }
  | { g: "battleship"; t: "audit"; fleet: ShipPlacement[]; nonce: string };

export interface PoolSnap {
  id: number;
  x: number;
  y: number;
  pocketed: boolean;
}

export interface ShipPlacement {
  id: string;
  x: number;
  y: number;
  dir: "h" | "v";
}

export const GAMES: { id: GameId; name: string; blurb: string; hint: string }[] = [
  {
    id: "darts",
    name: "Darts",
    blurb: "501 or Cricket",
    hint: "Drag to aim. Release to throw. Three darts a visit.",
  },
  {
    id: "spades",
    name: "Spades",
    blurb: "Two-handed duel",
    hint: "Draft thirteen cards, bid, and take tricks. Spades are trump.",
  },
  {
    id: "poker",
    name: "Hold'em",
    blurb: "Heads-up no-limit",
    hint: "Two hole cards. Fold, call, or raise. Best five at showdown.",
  },
  {
    id: "pool",
    name: "8-Ball",
    blurb: "Solids and stripes",
    hint: "Drag back from the cue ball. Pocket your group, then the 8.",
  },
  {
    id: "battleship",
    name: "Battleship",
    blurb: "Fleet in the fog",
    hint: "Place five ships. Coordinates stay on your phone until they sink.",
  },
];
