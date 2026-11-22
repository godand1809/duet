import type { GameId } from "./types";

const KEY = "duet.v1";

export interface HistoryRow {
  game: GameId;
  names: [string, string];
  winner: string;
  at: number;
}

export interface Save {
  version: 1;
  nickname: string;
  muted: boolean;
  theme: "felt" | "linen";
  history: HistoryRow[];
}

const DEFAULT: Save = {
  version: 1,
  nickname: "",
  muted: false,
  theme: "felt",
  history: [],
};

export function loadSave(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT, history: [] };
    const parsed = JSON.parse(raw) as Partial<Save>;
    return {
      version: 1,
      nickname: typeof parsed.nickname === "string" ? parsed.nickname.slice(0, 16) : "",
      muted: Boolean(parsed.muted),
      theme: parsed.theme === "linen" ? "linen" : "felt",
      history: Array.isArray(parsed.history) ? parsed.history.slice(0, 40) : [],
    };
  } catch {
    return { ...DEFAULT, history: [] };
  }
}

export function writeSave(save: Save) {
  localStorage.setItem(KEY, JSON.stringify(save));
}

export function resetSave() {
  localStorage.removeItem(KEY);
}
