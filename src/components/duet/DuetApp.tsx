import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CircleDot,
  Coins,
  Copy,
  Settings,
  Ship,
  Spade,
  Target,
  Volume2,
  VolumeX,
} from "lucide-react";
import { BattleshipGame } from "@/components/duet/BattleshipGame";
import { DartsGame } from "@/components/duet/DartsGame";
import { PokerGame } from "@/components/duet/PokerGame";
import { PoolGame } from "@/components/duet/PoolGame";
import { SpadesGame } from "@/components/duet/SpadesGame";
import type { TableApi } from "@/components/duet/api";
import { bindAudioUnlock, playSound, setAudioMuted, unlockAudio } from "@/lib/duet/audio";
import { joinUrl, makeCode, NAT_COPY, TableLink } from "@/lib/duet/link";
import { loadSave, resetSave, writeSave, type Save } from "@/lib/duet/storage";
import { DEFAULT_OPTIONS, GAMES, type GameId, type GameOptions, type LinkPhase, type Mode, type Seat, type WireEvt } from "@/lib/duet/types";

const ICONS = {
  darts: Target,
  spades: Spade,
  poker: Coins,
  pool: CircleDot,
  battleship: Ship,
} as const;

type Screen = "home" | "lobby" | "table" | "settings";

export function DuetApp() {
  const [save, setSave] = useState<Save>(() => loadSave());
  const [screen, setScreen] = useState<Screen>("home");
  const [mode, setMode] = useState<Mode>("hotseat");
  const [game, setGame] = useState<GameId>("darts");
  const [options, setOptions] = useState<GameOptions>(DEFAULT_OPTIONS);
  const [names, setNames] = useState<[string, string]>([save.nickname || "Player 1", "Player 2"]);
  const [seat, setSeat] = useState<Seat>(0);
  const [code, setCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [linkPhase, setLinkPhase] = useState<LinkPhase>("idle");
  const [linkDetail, setLinkDetail] = useState("");
  const [rtt, setRtt] = useState<number | null>(null);
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState("");
  const [handoff, setHandoff] = useState<string | null>(null);
  const [matchKey, setMatchKey] = useState(0);
  const linkRef = useRef<TableLink | null>(null);
  const subs = useRef(new Set<(evt: WireEvt) => void>());
  const handoffRef = useRef<{ resolve: () => void } | null>(null);
  const gameRef = useRef(game);
  gameRef.current = game;
  const recorded = useRef(false);
  const saveRef = useRef(save);
  saveRef.current = save;
  const namesRef = useRef(names);
  namesRef.current = names;

  useEffect(() => {
    bindAudioUnlock();
    setAudioMuted(save.muted);
    if (save.theme === "linen") document.documentElement.dataset.theme = "linen";
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      const base = import.meta.env.BASE_URL || "./";
      void navigator.serviceWorker.register(`${base}sw.js`).catch(() => undefined);
    }
    const params = new URLSearchParams(window.location.search);
    const room = params.get("room");
    const asked = params.get("game");
    if (room && asked && GAMES.some((g) => g.id === asked)) {
      setGame(asked as GameId);
      setMode("link");
      setScreen("lobby");
      setSeat(1);
      openLink("guest", room.toUpperCase());
    }
    return () => {
      linkRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!code || screen !== "lobby") return;
    let cancel = false;
    void import("qrcode").then((mod) => {
      void mod.default
        .toDataURL(joinUrl(code, game), {
          margin: 1,
          width: 320,
          color: { dark: "#17211c", light: "#f4efe6" },
        })
        .then((url) => {
          if (!cancel) setQr(url);
        });
    });
    return () => {
      cancel = true;
    };
  }, [code, game, screen]);

  function persist(next: Save) {
    saveRef.current = next;
    setSave(next);
    writeSave(next);
  }

  function setNick(nickname: string) {
    const clean = nickname.slice(0, 16);
    persist({ ...saveRef.current, nickname: clean });
    setNames((current) => (seat === 0 ? [clean || "Player 1", current[1]] : [current[0], clean || "Player 2"]));
    linkRef.current?.rename(clean || "Player");
  }

  function openLink(role: "host" | "guest", room: string) {
    linkRef.current?.close();
    setLinkPhase(role === "host" ? "creating" : "connecting");
    setLinkDetail("");
    setRtt(null);
    const link = new TableLink(
      {
        onPhase: (phase, detail) => {
          setLinkPhase(phase);
          setLinkDetail(detail ?? "");
          if (phase === "open") playSound("connect");
        },
        onPeerName: (name) => {
          setNames((current) => (role === "host" ? [current[0], name] : [name, current[1]]));
        },
        onStart: (nextGame, nextOptions) => {
          setGame(nextGame);
          setOptions(nextOptions);
          setScreen("table");
          setMatchKey((n) => n + 1);
          recorded.current = false;
        },
        onEvent: (evt) => {
          for (const fn of subs.current) fn(evt);
        },
        onRtt: (ms) => setRtt(ms),
      },
      saveRef.current.nickname || (role === "host" ? "Player 1" : "Player 2"),
    );
    linkRef.current = link;
    if (role === "host") void link.host(room);
    else void link.join(room);
  }

  function hostTable() {
    unlockAudio();
    const next = makeCode();
    setCode(next);
    setSeat(0);
    setNames([save.nickname || "Player 1", "Partner"]);
    setScreen("lobby");
    openLink("host", next);
  }

  function joinTable() {
    unlockAudio();
    const next = joinCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
    if (next.length !== 5) return;
    setCode(next);
    setSeat(1);
    setNames(["Partner", save.nickname || "Player 2"]);
    setScreen("lobby");
    openLink("guest", next);
  }

  function startHotseat() {
    unlockAudio();
    linkRef.current?.close();
    linkRef.current = null;
    setSeat(0);
    setNames([save.nickname || "Player 1", "Player 2"]);
    setLinkPhase("idle");
    setLinkDetail("");
    recorded.current = false;
    setMatchKey((n) => n + 1);
    setScreen("table");
    playSound("tap");
  }

  function startLinkGame() {
    if (!linkRef.current || linkPhase !== "open") return;
    linkRef.current.send({ k: "start", game, options });
    recorded.current = false;
    setMatchKey((n) => n + 1);
    setScreen("table");
    playSound("tap");
  }

  function leave() {
    handoffRef.current?.resolve();
    handoffRef.current = null;
    setHandoff(null);
    linkRef.current?.close();
    linkRef.current = null;
    setLinkPhase("idle");
    setScreen("home");
    setQr("");
    setCode("");
  }

  const api = useMemo<TableApi>(() => {
    const value: TableApi = {
      mode: "hotseat",
      seat: 0,
      names: ["Player 1", "Player 2"],
      options: DEFAULT_OPTIONS,
      authority: true,
      status: "",
      send: (evt) => linkRef.current?.send({ k: "evt", evt }),
      subscribe: (fn) => {
        subs.current.add(fn);
        return () => subs.current.delete(fn);
      },
      requestHandoff: (to) => {
        if (value.mode !== "hotseat") return Promise.resolve();
        return new Promise((resolve) => {
          handoffRef.current = { resolve };
          setHandoff(value.names[to]);
        });
      },
      sound: (name) => playSound(name),
      finish: (winner) => {
        if (recorded.current) return;
        recorded.current = true;
        const row = {
          game: gameRef.current,
          names: namesRef.current,
          winner: namesRef.current[winner],
          at: Date.now(),
        };
        const next = { ...saveRef.current, history: [row, ...saveRef.current.history].slice(0, 40) };
        persist(next);
      },
      exit: () => leave(),
    };
    return value;
    // game id is read when a match finishes; identity stays stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  api.mode = screen === "table" && linkRef.current ? "link" : mode;
  api.seat = seat;
  api.names = names;
  api.options = options;
  api.authority = api.mode === "hotseat" || seat === 0;
  api.status =
    linkPhase === "open"
      ? rtt !== null
        ? `Connected · ${rtt} ms`
        : "Connected"
      : linkPhase === "reconnecting"
        ? "Reconnecting…"
        : linkPhase === "failed"
          ? "Link failed"
          : "";

  const phaseCopy =
    linkPhase === "creating"
      ? "Opening a private table…"
      : linkPhase === "waiting"
        ? "Waiting for your partner to join."
        : linkPhase === "connecting"
          ? "Looking for that table…"
          : linkPhase === "open"
            ? `Connected${rtt !== null ? ` · ${rtt} ms` : ""}.`
            : linkPhase === "reconnecting"
              ? "The link dropped. Reconnecting…"
              : linkPhase === "failed"
                ? linkDetail === "nat"
                  ? NAT_COPY
                  : linkDetail || NAT_COPY
                : "Idle";

  const tally = GAMES.map((item) => {
    const rows = save.history.filter((row) => row.game === item.id);
    return { ...item, played: rows.length };
  });

  return (
    <div className="safe-shell">
      <div className="app-frame">
        {screen === "home" ? (
          <Home
            save={save}
            mode={mode}
            game={game}
            options={options}
            joinCode={joinCode}
            tally={tally}
            onNick={setNick}
            onMode={(next) => {
              unlockAudio();
              setMode(next);
            }}
            onGame={setGame}
            onOptions={setOptions}
            onJoinCode={setJoinCode}
            onHost={hostTable}
            onJoin={joinTable}
            onHotseat={startHotseat}
            onSettings={() => setScreen("settings")}
            onMute={() => {
              const muted = !save.muted;
              persist({ ...save, muted });
              setAudioMuted(muted);
              if (!muted) {
                unlockAudio();
                playSound("tap");
              }
            }}
          />
        ) : null}

        {screen === "lobby" ? (
          <Lobby
            game={game}
            code={code}
            seat={seat}
            phaseCopy={phaseCopy}
            failed={linkPhase === "failed"}
            open={linkPhase === "open"}
            names={names}
            qr={qr}
            copied={copied}
            options={options}
            onOptions={setOptions}
            onCopy={() => {
              const url = joinUrl(code, game);
              void navigator.clipboard?.writeText(url).then(
                () => setCopied("Link copied"),
                () => setCopied(url),
              );
            }}
            onStart={startLinkGame}
            onLeave={leave}
          />
        ) : null}

        {screen === "table" ? (
          <section>
            <header className="mb-3 flex items-center justify-between gap-2">
              <button type="button" className="icon-btn" onClick={leave} aria-label="Leave table">
                <ArrowLeft size={18} />
              </button>
              <div className="min-w-0 text-center">
                <p className="truncate font-semibold">{GAMES.find((g) => g.id === game)?.name}</p>
                <p className="truncate text-xs text-muted">
                  {names[0]} · {names[1]}
                  {api.status ? ` · ${api.status}` : ""}
                </p>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label={save.muted ? "Unmute" : "Mute"}
                onClick={() => {
                  const muted = !save.muted;
                  persist({ ...save, muted });
                  setAudioMuted(muted);
                }}
              >
                {save.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
            </header>
            {linkPhase === "failed" ? <p className="panel mb-3 p-3 text-sm">{phaseCopy}</p> : null}
            {game === "darts" ? <DartsGame key={matchKey} api={api} /> : null}
            {game === "spades" ? <SpadesGame key={matchKey} api={api} /> : null}
            {game === "poker" ? <PokerGame key={matchKey} api={api} /> : null}
            {game === "pool" ? <PoolGame key={matchKey} api={api} /> : null}
            {game === "battleship" ? <BattleshipGame key={matchKey} api={api} /> : null}
          </section>
        ) : null}

        {screen === "settings" ? (
          <SettingsView
            save={save}
            onBack={() => setScreen("home")}
            onTheme={(theme) => {
              persist({ ...save, theme });
              if (theme === "linen") document.documentElement.dataset.theme = "linen";
              else delete document.documentElement.dataset.theme;
            }}
            onReset={() => {
              resetSave();
              const fresh = loadSave();
              persist(fresh);
              setAudioMuted(false);
              delete document.documentElement.dataset.theme;
              setNames(["Player 1", "Player 2"]);
            }}
          />
        ) : null}
      </div>
      {handoff ? (
        <button type="button" className="handoff" onClick={() => {
          setHandoff(null);
          const pending = handoffRef.current;
          handoffRef.current = null;
          pending?.resolve();
        }}>
          <p className="eyebrow">Private hand</p>
          <h2 className="display mt-2 text-4xl">Pass the phone to {handoff}</h2>
          <p className="mt-3 text-muted">Tap to reveal when they have it.</p>
        </button>
      ) : null}
    </div>
  );
}

function Home({
  save,
  mode,
  game,
  options,
  joinCode,
  tally,
  onNick,
  onMode,
  onGame,
  onOptions,
  onJoinCode,
  onHost,
  onJoin,
  onHotseat,
  onSettings,
  onMute,
}: {
  save: Save;
  mode: Mode;
  game: GameId;
  options: GameOptions;
  joinCode: string;
  tally: { id: GameId; name: string; blurb: string; hint: string; played: number }[];
  onNick: (value: string) => void;
  onMode: (mode: Mode) => void;
  onGame: (id: GameId) => void;
  onOptions: (options: GameOptions) => void;
  onJoinCode: (value: string) => void;
  onHost: () => void;
  onJoin: () => void;
  onHotseat: () => void;
  onSettings: () => void;
  onMute: () => void;
}) {
  const picked = GAMES.find((item) => item.id === game)!;
  return (
    <div>
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Two chairs</p>
          <h1 className="display mt-1 text-5xl">Duet</h1>
          <p className="mt-2 max-w-sm text-muted">A private table for two. One phone, or one Android and one iPhone.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="icon-btn" onClick={onMute} aria-label={save.muted ? "Unmute" : "Mute"}>
            {save.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <button type="button" className="icon-btn" onClick={onSettings} aria-label="Settings">
            <Settings size={18} />
          </button>
        </div>
      </header>

      <label className="mb-4 block text-sm text-muted">
        Your name
        <input className="field mt-1" value={save.nickname} maxLength={16} placeholder="Player 1" onChange={(ev) => onNick(ev.target.value)} />
      </label>

      <div className="seg mb-4" role="group" aria-label="How you are playing">
        <button type="button" aria-pressed={mode === "hotseat"} onClick={() => onMode("hotseat")}>
          Pass-and-play
        </button>
        <button type="button" aria-pressed={mode === "link"} onClick={() => onMode("link")}>
          Two phones
        </button>
      </div>

      <div>
        {tally.map((item) => {
          const Icon = ICONS[item.id];
          const on = item.id === game;
          return (
            <button key={item.id} type="button" className={`game-row ${on ? "is-live" : ""}`} onClick={() => onGame(item.id)}>
              <span className="game-mark">
                <Icon size={18} />
              </span>
              <span>
                <span className="block font-semibold">{item.name}</span>
                <span className="block text-sm text-muted">{item.blurb}</span>
              </span>
              <span className="text-xs text-muted">{item.played ? `${item.played} played` : ""}</span>
            </button>
          );
        })}
      </div>

      <div className="panel mt-4 p-3">
        <p className="font-semibold">{picked.name}</p>
        <p className="mt-1 text-sm text-muted">{picked.hint}</p>
        {game === "darts" ? (
          <div className="mt-3 space-y-2">
            <div className="seg">
              <button type="button" aria-pressed={options.darts.variant === "501"} onClick={() => onOptions({ ...options, darts: { ...options.darts, variant: "501" } })}>
                501
              </button>
              <button type="button" aria-pressed={options.darts.variant === "cricket"} onClick={() => onOptions({ ...options, darts: { ...options.darts, variant: "cricket" } })}>
                Cricket
              </button>
            </div>
            {options.darts.variant === "501" ? (
              <button
                type="button"
                className="btn btn-ghost btn-block"
                aria-pressed={options.darts.doubleOut}
                onClick={() => onOptions({ ...options, darts: { ...options.darts, doubleOut: !options.darts.doubleOut } })}
              >
                Double-out {options.darts.doubleOut ? "on" : "off"}
              </button>
            ) : null}
          </div>
        ) : null}
        {game === "poker" ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="text-sm text-muted">
              Stack
              <input
                className="field mt-1"
                inputMode="numeric"
                value={options.poker.stack}
                onChange={(ev) => onOptions({ ...options, poker: { ...options.poker, stack: clamp(Number(ev.target.value), 100, 100000) } })}
              />
            </label>
            <label className="text-sm text-muted">
              Blinds
              <input
                className="field mt-1"
                inputMode="numeric"
                value={options.poker.bb}
                onChange={(ev) => {
                  const bb = clamp(Number(ev.target.value), 2, 10000);
                  onOptions({ ...options, poker: { ...options.poker, bb, sb: Math.max(1, Math.floor(bb / 2)) } });
                }}
              />
            </label>
            <label className="col-span-2 text-sm text-muted">
              Blind timer
              <select
                className="field mt-1"
                value={options.poker.timerMin ?? ""}
                onChange={(ev) =>
                  onOptions({
                    ...options,
                    poker: { ...options.poker, timerMin: ev.target.value ? Number(ev.target.value) : null },
                  })
                }
              >
                <option value="">Stay put</option>
                <option value="2">Double every 2 min</option>
                <option value="5">Double every 5 min</option>
                <option value="10">Double every 10 min</option>
              </select>
            </label>
          </div>
        ) : null}
        {mode === "hotseat" ? (
          <button type="button" className="btn btn-primary btn-block mt-3" onClick={onHotseat}>
            Start on this phone
          </button>
        ) : (
          <div className="mt-3 space-y-2">
            <button type="button" className="btn btn-primary btn-block" onClick={onHost}>
              Create a room code
            </button>
            <div className="flex gap-2">
              <input
                className="field"
                value={joinCode}
                placeholder="Code"
                maxLength={5}
                autoCapitalize="characters"
                onChange={(ev) => onJoinCode(ev.target.value.toUpperCase())}
              />
              <button type="button" className="btn btn-ghost" onClick={onJoin} disabled={joinCode.replace(/[^A-Z0-9]/g, "").length !== 5}>
                Join
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Lobby({
  game,
  code,
  seat,
  phaseCopy,
  failed,
  open,
  names,
  qr,
  copied,
  options,
  onOptions,
  onCopy,
  onStart,
  onLeave,
}: {
  game: GameId;
  code: string;
  seat: Seat;
  phaseCopy: string;
  failed: boolean;
  open: boolean;
  names: [string, string];
  qr: string;
  copied: string;
  options: GameOptions;
  onOptions: (options: GameOptions) => void;
  onCopy: () => void;
  onStart: () => void;
  onLeave: () => void;
}) {
  const meta = GAMES.find((item) => item.id === game)!;
  return (
    <div>
      <header className="mb-4 flex items-center gap-2">
        <button type="button" className="icon-btn" onClick={onLeave} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div>
          <p className="eyebrow">{meta.name}</p>
          <h2 className="display text-3xl">Two phones</h2>
        </div>
      </header>
      <div className="panel p-4 text-center">
        <p className="text-sm text-muted">{seat === 0 ? "Room code" : "Joining"}</p>
        <p className="code">{code}</p>
        <p className="mt-2 flex items-center justify-center gap-2 text-sm">
          <span className={`dot ${open ? "on" : failed ? "warn" : ""}`} />
          {phaseCopy}
        </p>
        {seat === 0 && qr ? <img className="qr" src={qr} alt={`QR code for room ${code}`} /> : null}
        {seat === 0 ? (
          <button type="button" className="btn btn-ghost mt-2" onClick={onCopy}>
            <Copy size={16} /> Copy join link
          </button>
        ) : null}
        {copied ? <p className="mt-2 break-all text-xs text-muted">{copied}</p> : null}
      </div>
      {open ? (
        <p className="mt-3 text-sm text-muted">
          {names[0]} and {names[1]} are at the table.
        </p>
      ) : null}
      {seat === 0 && game === "darts" ? (
        <div className="mt-3">
          <div className="seg">
            <button type="button" aria-pressed={options.darts.variant === "501"} onClick={() => onOptions({ ...options, darts: { ...options.darts, variant: "501" } })}>
              501
            </button>
            <button type="button" aria-pressed={options.darts.variant === "cricket"} onClick={() => onOptions({ ...options, darts: { ...options.darts, variant: "cricket" } })}>
              Cricket
            </button>
          </div>
        </div>
      ) : null}
      {seat === 0 ? (
        <button type="button" className="btn btn-primary btn-block mt-4" disabled={!open} onClick={onStart}>
          Start {meta.name}
        </button>
      ) : (
        <p className="mt-4 text-sm text-muted">When the host starts, the game opens here. Your cards and ships stay on this phone.</p>
      )}
      {failed ? (
        <button type="button" className="btn btn-ghost btn-block mt-3" onClick={onLeave}>
          Use pass-and-play instead
        </button>
      ) : null}
    </div>
  );
}

function SettingsView({
  save,
  onBack,
  onTheme,
  onReset,
}: {
  save: Save;
  onBack: () => void;
  onTheme: (theme: Save["theme"]) => void;
  onReset: () => void;
}) {
  return (
    <div>
      <header className="mb-4 flex items-center gap-2">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <h2 className="display text-3xl">Settings</h2>
      </header>
      <div className="seg mb-4">
        <button type="button" aria-pressed={save.theme === "felt"} onClick={() => onTheme("felt")}>
          Felt
        </button>
        <button type="button" aria-pressed={save.theme === "linen"} onClick={() => onTheme("linen")}>
          Linen
        </button>
      </div>
      <div className="panel p-3">
        <p className="font-semibold">On this phone</p>
        <p className="mt-1 text-sm text-muted">Names, mute, theme, and results live in local storage. No account, no analytics.</p>
        {save.history.length === 0 ? <p className="mt-3 text-sm text-muted">No results yet.</p> : null}
        <ul className="mt-3 space-y-2">
          {save.history.slice(0, 8).map((row) => (
            <li key={row.at} className="flex items-center justify-between gap-3 text-sm">
              <span>{GAMES.find((g) => g.id === row.game)?.name}</span>
              <span className="text-muted">{row.winner} won</span>
            </li>
          ))}
        </ul>
      </div>
      <button type="button" className="btn btn-danger btn-block mt-4" onClick={onReset}>
        Reset all local data
      </button>
    </div>
  );
}

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}
