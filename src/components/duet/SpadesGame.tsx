import { useEffect, useRef, useState } from "react";
import { CardFace } from "@/components/duet/CardFace";
import type { TableApi } from "@/components/duet/api";
import { cardKey, sameCard } from "@/lib/duet/cards";
import { freshDeck, legalCards, scoreHand, SPADE_TARGET, trickWinner } from "@/lib/duet/spades";
import type { Card, Seat } from "@/lib/duet/types";

interface Model {
  phase: "blind" | "draft" | "bid" | "play" | "score";
  hands: [Card[], Card[]];
  counts: [number, number];
  scores: [number, number];
  bags: [number, number];
  bids: [number | null, number | null];
  blind: [boolean, boolean];
  chosen: [boolean, boolean];
  tricksWon: [number, number];
  trick: { seat: Seat; card: Card }[];
  dealer: Seat;
  turn: Seat;
  chooser: Seat;
  offer: Card | null;
  offerId: string;
  spadesBroken: boolean;
  resolving: Seat | null;
  notes: [string, string];
  handNo: number;
  winner: Seat | null;
  deck: Card[];
}

function blank(): Model {
  return {
    phase: "blind",
    hands: [[], []],
    counts: [0, 0],
    scores: [0, 0],
    bags: [0, 0],
    bids: [null, null],
    blind: [false, false],
    chosen: [false, false],
    tricksWon: [0, 0],
    trick: [],
    dealer: 1,
    turn: 0,
    chooser: 0,
    offer: null,
    offerId: "",
    spadesBroken: false,
    resolving: null,
    notes: ["", ""],
    handNo: 1,
    winner: null,
    deck: [],
  };
}

function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

const SUIT_ORDER: Record<Card["s"], number> = { s: 0, h: 1, d: 2, c: 3 };

function sortHand(hand: Card[]): Card[] {
  return hand.slice().sort((a, b) => SUIT_ORDER[a.s] - SUIT_ORDER[b.s] || b.r - a.r);
}

export function SpadesGame({ api }: { api: TableApi }) {
  const model = useRef<Model>(blank());
  const [, bump] = useState(0);
  const paint = () => bump((n) => n + 1);
  const apiRef = useRef(api);
  apiRef.current = api;
  const timer = useRef(0);
  const [gate, setGate] = useState<Seat | null>(api.mode === "hotseat" ? null : api.seat);
  const started = useRef(false);

  function give(card: Card, to: Seat) {
    const m = model.current;
    m.counts[to] += 1;
    if (apiRef.current.mode === "hotseat" || to === apiRef.current.seat) m.hands[to].push(card);
  }

  function beginDraft() {
    const m = model.current;
    if (m.phase !== "blind" || started.current) return;
    if (!m.chosen[0] || !m.chosen[1]) return;
    started.current = true;
    m.phase = "draft";
    m.deck = freshDeck();
    m.chooser = 0;
    offerNext();
  }

  function offerNext() {
    const m = model.current;
    if (m.counts[0] >= 13 && m.counts[1] >= 13) {
      m.phase = "bid";
      m.offer = null;
      autoBlindBids();
      paint();
      return;
    }
    const card = m.deck.pop();
    if (!card) return;
    const chooser = m.chooser;
    const opp = other(chooser);
    if (m.counts[chooser] >= 13) {
      assign(card, opp);
      return;
    }
    if (m.counts[opp] >= 13) {
      assign(card, chooser);
      return;
    }
    const id = crypto.randomUUID();
    m.offer = card;
    m.offerId = id;
    if (apiRef.current.mode === "link") {
      apiRef.current.send({ g: "spades", t: "offer", id, card, chooser });
    }
    paint();
  }

  function assign(card: Card, to: Seat) {
    const m = model.current;
    give(card, to);
    m.offer = null;
    m.offerId = "";
    if (apiRef.current.mode === "link" && apiRef.current.authority) {
      apiRef.current.send({ g: "spades", t: "assign", card, to });
    }
    m.chooser = other(m.chooser);
    if (m.counts[0] >= 13 && m.counts[1] >= 13) {
      m.phase = "bid";
      autoBlindBids();
      paint();
      return;
    }
    offerNext();
  }

  function choose(take: boolean) {
    const m = model.current;
    if (m.phase !== "draft" || !m.offer) return;
    const me = apiRef.current.mode === "link" ? apiRef.current.seat : m.chooser;
    if (m.chooser !== me) return;
    apiRef.current.sound("card");
    if (apiRef.current.mode === "link" && !apiRef.current.authority) {
      apiRef.current.send({ g: "spades", t: "decide", id: m.offerId, take });
      m.offer = null;
      paint();
      return;
    }
    assign(m.offer, take ? m.chooser : other(m.chooser));
  }

  function autoBlindBids() {
    const m = model.current;
    if (m.phase !== "bid") return;
    for (const seat of [0, 1] as Seat[]) {
      if (!m.blind[seat] || m.bids[seat] !== null) continue;
      if (apiRef.current.mode === "link" && seat !== apiRef.current.seat) continue;
      placeBid(seat, 0);
    }
  }

  function placeBid(seat: Seat, bid: number, silent?: boolean) {
    const m = model.current;
    if (m.bids[seat] !== null) return;
    m.bids[seat] = bid;
    if (!silent && apiRef.current.mode === "link") {
      apiRef.current.send({ g: "spades", t: "bid", seat, bid });
    }
    if (m.bids[0] !== null && m.bids[1] !== null) {
      m.phase = "play";
      m.turn = other(m.dealer);
      m.trick = [];
      m.tricksWon = [0, 0];
      m.spadesBroken = false;
      m.resolving = null;
    }
    apiRef.current.sound("tap");
    paint();
  }

  function scoreRound() {
    const m = model.current;
    if (m.winner !== null) return;
    for (const seat of [0, 1] as Seat[]) {
      const bid = m.bids[seat] ?? 0;
      const result = scoreHand(bid, m.tricksWon[seat], m.blind[seat], m.bags[seat]);
      m.scores[seat] += result.delta;
      m.bags[seat] = result.bags;
      m.notes[seat] = result.note;
    }
    const top = Math.max(m.scores[0], m.scores[1]);
    if (top >= SPADE_TARGET && m.scores[0] !== m.scores[1]) {
      m.winner = m.scores[0] > m.scores[1] ? 0 : 1;
      m.phase = "score";
      apiRef.current.sound("win");
      apiRef.current.finish(m.winner);
    } else {
      m.phase = "score";
      apiRef.current.sound("card");
    }
    paint();
  }

  function applyPlay(seat: Seat, card: Card) {
    const m = model.current;
    if (m.phase !== "play" || m.resolving !== null || m.turn !== seat) return;
    const hand = m.hands[seat];
    const lead = m.trick[0]?.card ?? null;
    const legal = legalCards(hand, lead, m.spadesBroken, m.trick.length === 0);
    if (apiRef.current.mode === "hotseat" || seat === apiRef.current.seat) {
      if (!legal.some((c) => sameCard(c, card))) return;
      m.hands[seat] = hand.filter((c) => !sameCard(c, card));
    }
    if (card.s === "s") m.spadesBroken = true;
    m.trick = [...m.trick, { seat, card }];
    apiRef.current.sound("card");
    if (m.trick.length === 2) {
      const winner = trickWinner(m.trick);
      m.tricksWon[winner] += 1;
      m.resolving = winner;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        const now = model.current;
        now.trick = [];
        now.resolving = null;
        now.turn = winner;
        if (now.tricksWon[0] + now.tricksWon[1] >= 13) scoreRound();
        else paint();
      }, 720);
    } else {
      m.turn = other(seat);
    }
    paint();
  }

  function playCard(card: Card) {
    const m = model.current;
    const seat: Seat = apiRef.current.mode === "link" ? apiRef.current.seat : m.turn;
    if (m.turn !== seat || m.resolving) return;
    applyPlay(seat, card);
    if (apiRef.current.mode === "link") apiRef.current.send({ g: "spades", t: "play", seat, card });
  }

  function declareBlind(blind: boolean) {
    const m = model.current;
    const seat: Seat = apiRef.current.mode === "link" ? apiRef.current.seat : m.chosen[0] ? 1 : 0;
    if (m.chosen[seat]) return;
    m.blind[seat] = blind;
    m.chosen[seat] = true;
    apiRef.current.sound("tap");
    if (apiRef.current.mode === "link") apiRef.current.send({ g: "spades", t: "blind", seat, blind });
    if (m.chosen[0] && m.chosen[1] && (apiRef.current.mode === "hotseat" || apiRef.current.authority)) beginDraft();
    else paint();
  }

  function nextHand() {
    const m = model.current;
    if (m.phase !== "score" || m.winner !== null) return;
    if (apiRef.current.mode === "link" && !apiRef.current.authority) {
      apiRef.current.send({ g: "spades", t: "next" });
      return;
    }
    const scores = m.scores;
    const bags = m.bags;
    const dealer = other(m.dealer);
    const handNo = m.handNo + 1;
    const notes = m.notes;
    model.current = {
      ...blank(),
      scores,
      bags,
      dealer,
      handNo,
      notes,
      chooser: 0,
    };
    started.current = false;
    if (apiRef.current.mode === "link") apiRef.current.send({ g: "spades", t: "next" });
    paint();
  }

  function resetFromNext() {
    const m = model.current;
    model.current = {
      ...blank(),
      scores: m.scores,
      bags: m.bags,
      dealer: other(m.dealer),
      handNo: m.handNo + 1,
      notes: m.notes,
    };
    started.current = false;
    paint();
  }

  useEffect(() => {
    return api.subscribe((evt) => {
      if (evt.g !== "spades") return;
      const m = model.current;
      if (evt.t === "blind") {
        m.blind[evt.seat] = evt.blind;
        m.chosen[evt.seat] = true;
        if (m.chosen[0] && m.chosen[1] && apiRef.current.authority) beginDraft();
        else paint();
      } else if (evt.t === "offer") {
        m.phase = "draft";
        m.offer = evt.card;
        m.offerId = evt.id;
        m.chooser = evt.chooser;
        paint();
      } else if (evt.t === "decide") {
        if (!apiRef.current.authority || evt.id !== m.offerId || !m.offer) return;
        assign(m.offer, evt.take ? m.chooser : other(m.chooser));
      } else if (evt.t === "assign") {
        if (apiRef.current.authority) return;
        give(evt.card, evt.to);
        m.offer = null;
        m.chooser = other(m.chooser);
        if (m.counts[0] >= 13 && m.counts[1] >= 13) {
          m.phase = "bid";
          autoBlindBids();
        }
        paint();
      } else if (evt.t === "bid") {
        if (evt.seat === apiRef.current.seat && m.bids[evt.seat] !== null) return;
        placeBid(evt.seat, evt.bid, true);
      } else if (evt.t === "play") {
        if (evt.seat === apiRef.current.seat) return;
        applyPlay(evt.seat, evt.card);
      } else if (evt.t === "next") {
        if (apiRef.current.authority) {
          nextHand();
        } else resetFromNext();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const m = model.current;
  const actor: Seat | null =
    m.phase === "blind"
      ? !m.chosen[0]
        ? 0
        : !m.chosen[1]
          ? 1
          : null
      : m.phase === "draft"
        ? m.offer
          ? m.chooser
          : null
        : m.phase === "bid"
          ? m.bids[0] === null && !m.blind[0]
            ? 0
            : m.bids[1] === null && !m.blind[1]
              ? 1
              : null
          : m.phase === "play" && m.resolving === null
            ? m.turn
            : null;

  useEffect(() => {
    if (api.mode !== "hotseat") return;
    if (actor === null) return;
    let cancel = false;
    setGate(null);
    void api.requestHandoff(actor).then(() => {
      if (!cancel) setGate(actor);
    });
    return () => {
      cancel = true;
    };
  }, [api, actor, m.handNo, m.phase]);

  const you: Seat = api.mode === "link" ? api.seat : (actor ?? gate ?? 0);
  const seeHand = api.mode === "link" || gate === you;
  const hand = sortHand(m.hands[you] ?? []);
  const lead = m.trick[0]?.card ?? null;
  const legal =
    m.phase === "play" && seeHand
      ? legalCards(hand, lead, m.spadesBroken, m.trick.length === 0)
      : [];
  const legalKeys = new Set(legal.map(cardKey));
  const myGo =
    api.mode === "link" ? actor === api.seat : actor !== null && gate === actor;

  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-2">
        {[0, 1].map((seat) => {
          const s = seat as Seat;
          const live = (m.phase === "play" ? m.turn : actor) === s && m.winner === null;
          return (
            <div key={s} className={`panel p-3 ${live ? "is-live" : ""}`}>
              <p className="text-sm text-muted">{api.names[s]}</p>
              <p className="display text-3xl">{m.scores[s]}</p>
              <p className="text-xs text-muted">
                {m.bags[s]} bag{m.bags[s] === 1 ? "" : "s"}
                {m.bids[s] !== null ? ` · bid ${m.bids[s] === 0 ? (m.blind[s] ? "blind nil" : "nil") : m.bids[s]}` : ""}
                {m.phase === "play" ? ` · ${m.tricksWon[s]} tricks` : ""}
              </p>
            </div>
          );
        })}
      </div>

      <div className="trick-row panel mb-3 px-3 py-3">
        {m.trick.length === 0 ? (
          <p className="text-sm text-muted">
            {m.phase === "play"
              ? m.spadesBroken
                ? "Spades are broken."
                : "Spades are not broken. Lead a side suit."
              : m.phase === "score"
                ? "Hand scored."
                : "Tricks land here."}
          </p>
        ) : (
          m.trick.map((play) => (
            <div key={cardKey(play.card)} className="text-center">
              <CardFace card={play.card} lift={m.resolving === play.seat} />
              <p className="mt-1 text-xs text-muted">{api.names[play.seat]}</p>
            </div>
          ))
        )}
      </div>

      {m.phase === "blind" ? (
        <div className="panel mb-3 p-3">
          <p className="font-semibold">
            {api.mode === "link" ? api.names[api.seat] : api.names[you]}, call it before the cards.
          </p>
          <p className="mt-1 text-sm text-muted">Blind nil pays 200 and costs 200. You will not see a card first.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-ghost" disabled={!myGo && api.mode === "hotseat" || (api.mode === "link" && m.chosen[api.seat])} onClick={() => declareBlind(false)}>
              Look, then bid
            </button>
            <button type="button" className="btn btn-primary" disabled={!myGo && api.mode === "hotseat" || (api.mode === "link" && m.chosen[api.seat])} onClick={() => declareBlind(true)}>
              Blind nil
            </button>
          </div>
        </div>
      ) : null}

      {m.phase === "draft" && m.offer && (api.mode === "hotseat" ? myGo : m.chooser === api.seat) ? (
        <div className="panel mb-3 p-3 text-center">
          <p className="text-sm text-muted">Take this card or pass it across.</p>
          <div className="my-3 flex justify-center">
            <CardFace card={m.offer} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-primary" onClick={() => choose(true)}>
              Take
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => choose(false)}>
              Pass
            </button>
          </div>
        </div>
      ) : null}

      {m.phase === "draft" && !(m.offer && (api.mode === "hotseat" ? myGo : m.chooser === api.seat)) ? (
        <p className="mb-3 text-sm text-muted">
          Draft in progress. {m.counts[0]} / {m.counts[1]} cards taken.
        </p>
      ) : null}

      {m.phase === "bid" && myGo ? (
        <div className="panel mb-3 p-3">
          <p className="font-semibold">{api.names[you]}, bid your tricks.</p>
          <p className="mt-1 text-sm text-muted">Nil is zero. Each bag is one point, and every tenth bag costs 100.</p>
          <div className="mt-3 grid grid-cols-7 gap-1">
            {Array.from({ length: 14 }, (_, n) => (
              <button key={n} type="button" className="btn btn-ghost px-0" onClick={() => placeBid(you, n)}>
                {n === 0 ? "Nil" : n}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {m.phase === "score" ? (
        <div className="panel mb-3 p-3">
          <p className="font-semibold">{m.winner !== null ? `${api.names[m.winner]} reached ${SPADE_TARGET}` : `Hand ${m.handNo}`}</p>
          <p className="mt-1 text-sm text-muted">
            {api.names[0]}: {m.notes[0] || "—"}. {api.names[1]}: {m.notes[1] || "—"}.
          </p>
          {m.winner === null ? (
            <button type="button" className="btn btn-primary mt-3" onClick={nextHand} disabled={api.mode === "link" && !api.authority && false}>
              {api.mode === "link" && !api.authority ? "Ask for the next hand" : "Next hand"}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="hand-fan">
        {seeHand
          ? hand.map((card) => {
              const key = cardKey(card);
              const allowed = m.phase === "play" && myGo && legalKeys.has(key);
              return (
                <button key={key} type="button" className="card-hit" disabled={!allowed} onClick={() => playCard(card)}>
                  <CardFace card={card} lift={allowed} />
                </button>
              );
            })
          : Array.from({ length: Math.max(m.counts[you], 1) }, (_, i) => (
              <div key={i} className="card-hit">
                <CardFace faceDown />
              </div>
            ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        {m.phase === "play"
          ? myGo
            ? "Play a highlighted card. Follow suit when you can."
            : `${api.names[m.turn]} to play.`
          : "Two-handed spades. Thirteen cards each, the rest stay out of play."}{" "}
        You are {api.names[api.mode === "link" ? api.seat : you]}.
      </p>
    </div>
  );
}
