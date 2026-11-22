import { useEffect, useRef, useState } from "react";
import { CardFace } from "@/components/duet/CardFace";
import type { TableApi } from "@/components/duet/api";
import { allCards, cardKey, idToCard, shuffleCards } from "@/lib/duet/cards";
import {
  cardInt,
  idsFromLocked,
  intCardId,
  lockInt,
  randomLock,
  shuffleBig,
  type Lock,
} from "@/lib/duet/mental";
import {
  addBoard,
  applyAction,
  award,
  dealHand,
  legal,
  potTotal,
  quickRaise,
  winningKeys,
  type PokerState,
} from "@/lib/duet/poker";
import type { Card, Seat } from "@/lib/duet/types";

function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

export function PokerGame({ api }: { api: TableApi }) {
  const stack0 = api.options.poker.stack;
  const [state, setState] = useState<PokerState | null>(null);
  const [raiseTo, setRaiseTo] = useState(api.options.poker.bb * 2);
  const [gate, setGate] = useState(api.mode !== "hotseat");
  const [status, setStatus] = useState(api.mode === "link" ? "Shuffling a locked deck…" : "");
  const [audit, setAudit] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const holes = useRef<[Card[] | null, Card[] | null]>([null, null]);
  const deck = useRef<Card[]>([]);
  const locked = useRef<bigint[]>([]);
  const guestLock = useRef<Lock | null>(null);
  const boardFrom = useRef(4);
  const waiters = useRef(new Map<string, (data: string[]) => void>());
  const apiRef = useRef(api);
  apiRef.current = api;
  const live = useRef(true);
  const startedAt = useRef(Date.now());
  const dealing = useRef(false);
  const revealed = useRef(false);
  const finished = useRef(false);
  const boardToken = useRef("");

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    if (!api.options.poker.timerMin) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [api.options.poker.timerMin]);

  function blinds() {
    const base = apiRef.current.options.poker;
    if (!base.timerMin) return { sb: base.sb, bb: base.bb, level: 1 };
    const level = Math.floor((Date.now() - startedAt.current) / (base.timerMin * 60000));
    const mul = 2 ** level;
    return { sb: base.sb * mul, bb: base.bb * mul, level: level + 1 };
  }

  function commit(updater: (s: PokerState) => PokerState) {
    setState((prev) => {
      if (!prev) return prev;
      let next = updater(prev);
      const known = holes.current;
      if (next.street === "showdown" && known[0] && known[1] && apiRef.current.mode === "hotseat") {
        next = award(next, [known[0], known[1]]);
      }
      if (next.street === "showdown" && known[0] && known[1] && apiRef.current.mode === "link") {
        next = award(next, [known[0]!, known[1]!]);
      }
      return next;
    });
  }

  function startLocal(handNo: number, dealer: Seat, stacks: [number, number]) {
    const cards = shuffleCards(allCards());
    holes.current = [cards.splice(0, 2), cards.splice(0, 2)];
    deck.current = cards;
    boardFrom.current = 0;
    revealed.current = false;
    boardToken.current = "";
    const b = blinds();
    setStatus("");
    setAudit("");
    setState(dealHand({ handNo, dealer, stacks, sb: b.sb, bb: b.bb }));
    apiRef.current.sound("card");
  }

  function waitStep(step: string) {
    return new Promise<string[]>((resolve) => {
      waiters.current.set(step, resolve);
    });
  }

  async function hostDeal(handNo: number, dealer: Seat, stacks: [number, number]) {
    if (dealing.current) return;
    dealing.current = true;
    setStatus("Shuffling a locked deck…");
    revealed.current = false;
    boardToken.current = "";
    boardFrom.current = 4;
    holes.current = [null, null];
    try {
      const lock = randomLock();
      let sealed = shuffleBig(Array.from({ length: 52 }, (_, i) => cardInt(i))).map((c) => lockInt(c, lock.e));
      apiRef.current.send({ g: "poker", t: "mp", step: "deck", data: sealed.map(String) });
      const shuffled = await waitStep("shuffle");
      sealed = shuffled.map((c) => lockInt(BigInt(c), lock.d));
      locked.current = sealed;
      apiRef.current.send({ g: "poker", t: "mp", step: "open", data: sealed.map(String) });
      const cover = randomLock();
      const blinded = [sealed[0]!, sealed[1]!].map((c) => lockInt(c, cover.e));
      apiRef.current.send({ g: "poker", t: "mp", step: "mine", data: blinded.map(String) });
      const opened = await waitStep("yours");
      const ids = opened.map((c) => intCardId(lockInt(BigInt(c), cover.d)));
      holes.current[0] = ids.map(idToCard);
      const b = blinds();
      const go = { handNo, dealer, stacks, sb: b.sb, bb: b.bb };
      apiRef.current.send({ g: "poker", t: "go", ...go });
      if (!live.current) return;
      setStatus("");
      setState(dealHand(go));
      apiRef.current.sound("card");
    } finally {
      dealing.current = false;
    }
  }

  useEffect(() => {
    if (api.mode === "hotseat") startLocal(1, 0, [stack0, stack0]);
    else if (api.authority) void hostDeal(1, 0, [stack0, stack0]);
    // mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return api.subscribe((evt) => {
      if (evt.g !== "poker") return;
      if (evt.t === "mp") {
        const waiter = waiters.current.get(evt.step);
        if (waiter) {
          waiters.current.delete(evt.step);
          waiter(evt.data);
          return;
        }
        if (apiRef.current.authority) {
          if (evt.step === "audit") {
            const ids = idsFromLocked(locked.current, BigInt(evt.data[0] ?? "0"));
            if (!ids || ids.length < 9) {
              setAudit("The locked deck did not open cleanly.");
              return;
            }
            const guest = [2, 3].map((i) => idToCard(ids[i]!));
            const board = [4, 5, 6, 7, 8].map((i) => idToCard(ids[i]!));
            holes.current[1] = guest;
            setAudit("Deck audited.");
            commit((s) => {
              const withBoard = s.board.length ? s : { ...s, board };
              return withBoard;
            });
          }
          if (evt.step === "next") {
            setState((s) => {
              if (!s || s.street !== "done") return s;
              if (s.stacks[0] === 0 || s.stacks[1] === 0) return s;
              void hostDeal(s.handNo + 1, other(s.dealer), [...s.stacks]);
              return s;
            });
          }
          return;
        }
        if (evt.step === "deck") {
          const lock = randomLock();
          guestLock.current = lock;
          const shuffled = shuffleBig(evt.data.map(BigInt).map((c) => lockInt(c, lock.e)));
          apiRef.current.send({ g: "poker", t: "mp", step: "shuffle", data: shuffled.map(String) });
        } else if (evt.step === "open") {
          const sealed = evt.data.map(BigInt);
          locked.current = sealed;
          const lock = guestLock.current;
          if (!lock) return;
          holes.current[1] = [2, 3].map((i) => idToCard(intCardId(lockInt(sealed[i]!, lock.d))));
          holes.current[0] = null;
          boardFrom.current = 4;
        } else if (evt.step === "mine") {
          const lock = guestLock.current;
          if (!lock) return;
          const opened = evt.data.map((c) => lockInt(BigInt(c), lock.d));
          apiRef.current.send({ g: "poker", t: "mp", step: "yours", data: opened.map(String) });
        }
        return;
      }
      if (evt.t === "go") {
        holes.current[0] = apiRef.current.seat === 0 ? holes.current[0] : null;
        if (apiRef.current.seat === 0) {
          /* host already started from hostDeal */
          return;
        }
        boardFrom.current = 4;
        boardToken.current = "";
        revealed.current = false;
        setStatus("");
        setState(
          dealHand({
            handNo: evt.handNo,
            dealer: evt.dealer,
            stacks: evt.stacks,
            sb: evt.sb,
            bb: evt.bb,
          }),
        );
        apiRef.current.sound("card");
      } else if (evt.t === "act") {
        if (evt.seat === apiRef.current.seat) return;
        apiRef.current.sound(evt.kind === "fold" ? "tap" : "chip");
        commit((s) => applyAction(s, evt.seat, { kind: evt.kind, to: evt.to }));
      } else if (evt.t === "board") {
        boardToken.current = "";
        commit((s) => (s.awaiting > 0 ? addBoard(s, evt.cards) : s));
        apiRef.current.sound("card");
      } else if (evt.t === "reveal") {
        holes.current[evt.seat] = evt.cards;
        commit((s) => s);
      }
    });
  }, [api]);

  useEffect(() => {
    if (!state || state.awaiting <= 0) return;
    const token = `${state.handNo}:${state.board.length}:${state.awaiting}`;
    if (boardToken.current === token) return;
    if (api.mode === "hotseat") {
      boardToken.current = token;
      const cards = deck.current.splice(0, state.awaiting);
      commit((s) => (s.awaiting > 0 ? addBoard(s, cards) : s));
      api.sound("card");
      return;
    }
    if (api.authority || !guestLock.current) return;
    const lock = guestLock.current;
    const count = state.awaiting;
    const start = boardFrom.current;
    const cards = Array.from({ length: count }, (_, i) =>
      idToCard(intCardId(lockInt(locked.current[start + i]!, lock.d))),
    );
    boardFrom.current = start + count;
    boardToken.current = token;
    api.send({ g: "poker", t: "board", cards });
    commit((s) => (s.awaiting > 0 ? addBoard(s, cards) : s));
    api.sound("card");
  }, [api, state]);

  useEffect(() => {
    if (!state || state.street !== "showdown" || revealed.current) return;
    const mine = holes.current[api.mode === "link" ? api.seat : 0];
    if (api.mode === "hotseat") return;
    if (!mine) return;
    revealed.current = true;
    api.send({ g: "poker", t: "reveal", seat: api.seat, cards: mine, nonce: "open" });
    if (!api.authority && guestLock.current) {
      api.send({ g: "poker", t: "mp", step: "audit", data: [guestLock.current.e.toString()] });
    }
  }, [api, state]);

  useEffect(() => {
    if (api.mode !== "hotseat" || !state || state.toAct === null) return;
    const seat = state.toAct;
    let cancel = false;
    setGate(false);
    void api.requestHandoff(seat).then(() => {
      if (!cancel) setGate(true);
    });
    return () => {
      cancel = true;
    };
  }, [api, state?.toAct, state?.handNo]);

  useEffect(() => {
    if (!state || state.street !== "done" || finished.current) return;
    if (state.stacks[0] === 0 || state.stacks[1] === 0) {
      finished.current = true;
      const winner: Seat = state.stacks[1] > state.stacks[0] ? 1 : 0;
      api.sound("win");
      api.finish(winner);
    }
  }, [api, state]);

  function act(kind: "fold" | "check" | "call" | "raise", to?: number) {
    if (!state || state.toAct === null) return;
    const seat = state.toAct;
    if (api.mode === "link" && seat !== api.seat) return;
    api.sound(kind === "fold" || kind === "check" ? "tap" : "chip");
    if (api.mode === "link") api.send({ g: "poker", t: "act", seat, kind, to });
    commit((s) => applyAction(s, seat, { kind, to }));
  }

  function nextHand() {
    if (!state || state.street !== "done") return;
    if (state.stacks[0] === 0 || state.stacks[1] === 0) return;
    if (api.mode === "hotseat") {
      startLocal(state.handNo + 1, other(state.dealer), [...state.stacks]);
      return;
    }
    if (api.authority) void hostDeal(state.handNo + 1, other(state.dealer), [...state.stacks]);
    else api.send({ g: "poker", t: "mp", step: "next", data: [] });
  }

  if (!state) {
    return (
      <div className="panel p-4">
        <p className="font-semibold">{status || "Waiting for the deal"}</p>
        <p className="mt-1 text-sm text-muted">
          Hole cards stay on this phone. The deal is locked so neither player can read the other's cards early.
        </p>
      </div>
    );
  }

  const you: Seat = api.mode === "link" ? api.seat : (state.toAct ?? 0);
  const showAll = state.street === "done" || state.street === "showdown";
  const canSee = (seat: Seat) => {
    if (showAll) return Boolean(holes.current[seat]);
    if (api.mode === "link") return seat === api.seat;
    return gate && state.toAct === seat;
  };
  const L = state.toAct !== null ? legal(state, state.toAct) : null;
  const myTurn = state.toAct !== null && (api.mode === "hotseat" ? gate : state.toAct === api.seat);
  const b = blinds();
  const win0 = new Set(winningKeys(state, 0));
  const win1 = new Set(winningKeys(state, 1));
  const wins = [win0, win1];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2 text-sm">
        <p className="text-muted">
          Hand {state.handNo}
          {api.options.poker.timerMin ? ` · blinds ${b.sb}/${b.bb} · level ${b.level}` : ` · blinds ${state.sb}/${state.bb}`}
        </p>
        <p className="pill">Pot {potTotal(state)}</p>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2">
        {[0, 1].map((seat) => {
          const s = seat as Seat;
          const cards = holes.current[s];
          const keys = wins[s]!;
          return (
            <div key={s} className={`panel p-3 ${state.toAct === s ? "is-live" : ""}`}>
              <p className="text-sm text-muted">
                {api.names[s]}
                {state.dealer === s ? " · dealer / small blind" : " · big blind"}
              </p>
              <p className="display text-3xl">{state.stacks[s]}</p>
              <p className="text-xs text-muted">
                {state.commit[s] ? `In ${state.commit[s]}` : "No chips in"}
                {state.folded[s] ? " · folded" : ""}
              </p>
              <div className="mt-2 flex">
                {canSee(s) && cards
                  ? cards.map((card) => <CardFace key={cardKey(card)} card={card} mini win={keys.has(cardKey(card))} />)
                  : [0, 1].map((i) => <CardFace key={i} mini faceDown />)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="panel mb-3 px-3 py-4">
        <p className="text-xs uppercase tracking-wide text-muted">{state.street}</p>
        <div className="mt-2 flex min-h-16">
          {state.board.length === 0 ? <p className="text-sm text-muted">Board coming.</p> : null}
          {state.board.map((card) => (
            <CardFace
              key={cardKey(card)}
              card={card}
              mini
              win={win0.has(cardKey(card)) || win1.has(cardKey(card))}
            />
          ))}
        </div>
        <p className="mt-2 text-sm">{state.street === "done" ? state.label || state.lastAction : state.lastAction}</p>
        {audit ? <p className="mt-1 text-xs text-muted">{audit}</p> : null}
      </div>

      {myTurn && L && state.street !== "done" && state.street !== "showdown" ? (
        <div className="panel space-y-3 p-3">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => act(L.fold ? "fold" : "check")}>
              {L.fold ? "Fold" : "Check"}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={L.call === 0 && !L.check}
              onClick={() => act(L.call > 0 ? "call" : "check")}
            >
              {L.call > 0 ? `Call ${L.call}` : "Check"}
            </button>
          </div>
          {L.canRaise ? (
            <>
              <div className="grid grid-cols-4 gap-1">
                {(
                  [
                    ["Min", "min"],
                    ["1/2", "half"],
                    ["Pot", "pot"],
                    ["All-in", "all"],
                  ] as const
                ).map(([label, kind]) => (
                  <button
                    key={kind}
                    type="button"
                    className="btn btn-ghost px-1"
                    onClick={() => act("raise", quickRaise(state, state.toAct!, kind))}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="block text-sm text-muted">
                Raise to {raiseTo}
                <input
                  className="slider mt-2"
                  type="range"
                  min={L.minTo}
                  max={L.maxTo}
                  value={Math.min(L.maxTo, Math.max(L.minTo, raiseTo))}
                  onChange={(ev) => setRaiseTo(Number(ev.target.value))}
                />
              </label>
              <button type="button" className="btn btn-primary btn-block" onClick={() => act("raise", raiseTo)}>
                {raiseTo >= L.maxTo ? "All-in" : `Raise to ${raiseTo}`}
              </button>
            </>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted">
          {state.street === "done"
            ? state.winners && state.winners.length === 2
              ? "Split pot."
              : state.winners
                ? `${api.names[state.winners[0]!]} wins the pot.`
                : "Hand over."
            : state.toAct !== null
              ? `${api.names[state.toAct]} to act.`
              : status || "Dealing the next street."}
        </p>
      )}

      {state.street === "done" && state.stacks[0] > 0 && state.stacks[1] > 0 ? (
        <button type="button" className="btn btn-primary mt-3" onClick={nextHand}>
          Next hand
        </button>
      ) : null}
      <p className="mt-3 text-xs text-muted">
        Heads-up no-limit. The dealer posts the small blind and acts first preflop. You are {api.names[you]}.
        {now ? "" : ""}
      </p>
    </div>
  );
}
