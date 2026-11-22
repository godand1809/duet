import type { SoundName } from "@/lib/duet/audio";
import type { GameOptions, Mode, Seat, WireEvt } from "@/lib/duet/types";

export interface TableApi {
  mode: Mode;
  seat: Seat;
  names: [string, string];
  options: GameOptions;
  /** Seat 0 deals, shuffles, and starts the next hand on a link. */
  authority: boolean;
  send: (evt: WireEvt) => void;
  subscribe: (fn: (evt: WireEvt) => void) => () => void;
  requestHandoff: (to: Seat) => Promise<void>;
  sound: (name: SoundName) => void;
  finish: (winner: Seat) => void;
  exit: () => void;
  status: string;
}
