import { useEffect, useRef, useState } from "react";
import type { TableApi } from "@/components/duet/api";
import { FLEET, afloat, cellsOf, commitFleet, fleetValid, randomFleet, randomNonce, shotOn } from "@/lib/duet/ships";
import type { Seat, ShipPlacement } from "@/lib/duet/types";

interface Shot {
  x: number;
  y: number;
  hit: boolean;
  sunk: boolean;
}

function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

function tryPlace(id: string, x: number, y: number, dir: "h" | "v", base: ShipPlacement[]): ShipPlacement[] | null {
  const next = base.filter((s) => s.id !== id).concat([{ id, x, y, dir }]);
  const seen = new Set<string>();
  for (const ship of next) {
    for (const cell of cellsOf(ship)) {
      if (cell.x < 0 || cell.y < 0 || cell.x > 9 || cell.y > 9) return null;
      const key = `${cell.x},${cell.y}`;
      if (seen.has(key)) return null;
      seen.add(key);
    }
  }
  return next;
}

export function BattleshipGame({ api }: { api: TableApi }) {
  const link = api.mode === "link";
  const [phase, setPhase] = useState<"place" | "battle" | "over">("place");
  const [active, setActive] = useState<Seat>(link ? api.seat : 0);
  const [fleet, setFleet] = useState<ShipPlacement[]>([]);
  const [selected, setSelected] = useState<string>(FLEET[0]!.id);
  const [dir, setDir] = useState<"h" | "v">("h");
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [turn, setTurn] = useState<Seat>(0);
  const [logs, setLogs] = useState<[Shot[], Shot[]]>([[], []]);
  const [note, setNote] = useState("Place all five ships, then lock the fleet.");
  const [winner, setWinner] = useState<Seat | null>(null);
  const [audit, setAudit] = useState("");
  const [ready, setReady] = useState<[boolean, boolean]>([false, false]);
  const [gate, setGate] = useState(link);
  const fleets = useRef<[ShipPlacement[] | null, ShipPlacement[] | null]>([null, null]);
  const nonces = useRef<[string, string]>(["", ""]);
  const commits = useRef<[string, string]>(["", ""]);
  const logsRef = useRef(logs);
  logsRef.current = logs;
  const sentAudit = useRef(false);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef(api);
  apiRef.current = api;
  const drag = useRef<{ id: string; x: number; y: number } | null>(null);
  const over = useRef(false);

  const view: Seat = link ? api.seat : active;

  useEffect(() => {
    if (link || phase !== "place") return;
    let cancel = false;
    setGate(false);
    void api.requestHandoff(active).then(() => {
      if (!cancel) setGate(true);
    });
    return () => {
      cancel = true;
    };
  }, [api, link, phase, active]);

  useEffect(() => {
    if (link || phase !== "battle" || over.current) return;
    let cancel = false;
    setGate(false);
    void api.requestHandoff(turn).then(() => {
      if (cancel) return;
      setActive(turn);
      setFleet(fleets.current[turn] ?? []);
      setGate(true);
    });
    return () => {
      cancel = true;
    };
  }, [api, link, phase, turn]);

  function end(winnerSeat: Seat, why: string) {
    if (over.current) return;
    over.current = true;
    setWinner(winnerSeat);
    setPhase("over");
    setNote(why);
    apiRef.current.sound(!link || winnerSeat === apiRef.current.seat ? "win" : "lose");
    apiRef.current.finish(winnerSeat);
    if (link && !sentAudit.current) {
      sentAudit.current = true;
      const mineFleet = fleets.current[apiRef.current.seat];
      if (mineFleet) {
        apiRef.current.send({
          g: "battleship",
          t: "audit",
          fleet: mineFleet,
          nonce: nonces.current[apiRef.current.seat],
        });
      }
    }
  }

  function pushShot(shooter: Seat, shot: Shot) {
    const prev = logsRef.current;
    if (prev[shooter].some((s) => s.x === shot.x && s.y === shot.y)) return prev;
    const next: [Shot[], Shot[]] = [[...prev[0]], [...prev[1]]];
    next[shooter] = [...prev[shooter], shot];
    logsRef.current = next;
    setLogs(next);
    return next;
  }

  function cellAt(ev: React.PointerEvent): { x: number; y: number } | null {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = Math.floor(((ev.clientX - rect.left) / rect.width) * 10);
    const y = Math.floor(((ev.clientY - rect.top) / rect.height) * 10);
    if (x < 0 || y < 0 || x > 9 || y > 9) return null;
    return { x, y };
  }

  function onGridDown(ev: React.PointerEvent) {
    if (phase !== "place" || (!link && !gate)) return;
    const cell = cellAt(ev);
    if (!cell) return;
    const hit = fleet.find((ship) => cellsOf(ship).some((c) => c.x === cell.x && c.y === cell.y));
    drag.current = { id: hit?.id ?? selected, x: cell.x, y: cell.y };
    if (hit) {
      setSelected(hit.id);
      setDir(hit.dir);
    }
    setHover(cell);
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
  }

  function onGridMove(ev: React.PointerEvent) {
    if (phase !== "place") return;
    const cell = cellAt(ev);
    if (cell) setHover(cell);
  }

  function onGridUp(ev: React.PointerEvent) {
    const cell = cellAt(ev);
    const started = drag.current;
    drag.current = null;
    if (!cell || !started || phase !== "place") return;
    const hit = fleet.find((ship) => cellsOf(ship).some((c) => c.x === cell.x && c.y === cell.y));
    if (hit && started.x === cell.x && started.y === cell.y && hit.id === started.id) {
      const nextDir = hit.dir === "h" ? "v" : "h";
      const moved = tryPlace(hit.id, hit.x, hit.y, nextDir, fleet);
      setDir(nextDir);
      setSelected(hit.id);
      if (moved) setFleet(moved);
      else api.sound("bust");
      return;
    }
    const placed = tryPlace(started.id, cell.x, cell.y, dir, fleet);
    if (!placed) {
      api.sound("tap");
      return;
    }
    setFleet(placed);
    setSelected(started.id);
    api.sound("tap");
  }

  function rotate() {
    const nextDir = dir === "h" ? "v" : "h";
    setDir(nextDir);
    const ship = fleet.find((s) => s.id === selected);
    if (!ship) return;
    const moved = tryPlace(ship.id, ship.x, ship.y, nextDir, fleet);
    if (moved) setFleet(moved);
    else api.sound("bust");
  }

  async function lockIn() {
    if (!fleetValid(fleet)) return;
    const nonce = randomNonce();
    const commit = await commitFleet(fleet, nonce);
    if (link) {
      fleets.current[api.seat] = fleet.map((s) => ({ ...s }));
      nonces.current[api.seat] = nonce;
      commits.current[api.seat] = commit;
      setReady((flags) => {
        const next: [boolean, boolean] = [...flags];
        next[api.seat] = true;
        return next;
      });
      api.send({ g: "battleship", t: "ready", commit });
      setNote("Fleet locked on this phone. Waiting for your partner.");
      api.sound("tap");
      return;
    }
    fleets.current[active] = fleet.map((s) => ({ ...s }));
    if (active === 0) {
      setFleet([]);
      setSelected(FLEET[0]!.id);
      setActive(1);
      setNote("Pass is done. Place the second fleet.");
      api.sound("tap");
      return;
    }
    setGate(false);
    setPhase("battle");
    setTurn(0);
    setNote(`${api.names[0]} fires first.`);
    api.sound("connect");
  }

  function resolveLocal(shooter: Seat, x: number, y: number) {
    const target = fleets.current[other(shooter)];
    if (!target) return;
    const previous = logsRef.current[shooter].filter((s) => s.hit);
    const result = shotOn(target, x, y, previous);
    const shot: Shot = { x, y, hit: result.hit, sunk: Boolean(result.sunk) };
    const nextLogs: [Shot[], Shot[]] = [[...logsRef.current[0]], [...logsRef.current[1]]];
    nextLogs[shooter] = [...nextLogs[shooter], shot];
    logsRef.current = nextLogs;
    setLogs(nextLogs);
    api.sound(result.hit ? "boom" : "splash");
    const left = afloat(target, nextLogs[shooter].filter((s) => s.hit));
    if (result.hit && left === 0) {
      end(shooter, `${api.names[shooter]} sinks the fleet.`);
      return;
    }
    if (result.hit) setNote(result.sunk ? `${nameOf(result.sunk.id)} sunk. Shoot again.` : "Hit. Shoot again.");
    else {
      setTurn(other(shooter));
      setNote("Miss.");
    }
  }

  function fireAt(x: number, y: number) {
    if (phase !== "battle" || over.current) return;
    const shooter: Seat = link ? api.seat : turn;
    if (link && turn !== api.seat) return;
    if (!link && !gate) return;
    if (logsRef.current[shooter].some((s) => s.x === x && s.y === y)) return;
    if (link) {
      api.send({ g: "battleship", t: "fire", x, y, by: shooter });
      setNote("Shot away…");
      api.sound("throw");
      return;
    }
    resolveLocal(shooter, x, y);
  }

  useEffect(() => {
    if (!link) return;
    if (ready[0] && ready[1] && phase === "place") {
      setPhase("battle");
      setNote(api.seat === 0 ? "You fire first." : "Partner fires first.");
      api.sound("connect");
    }
  }, [api, link, phase, ready]);

  useEffect(() => {
    return api.subscribe((evt) => {
      if (evt.g !== "battleship" || !link) return;
      if (evt.t === "ready") {
        const who: Seat = apiRef.current.seat === 0 ? 1 : 0;
        commits.current[who] = evt.commit;
        setReady((flags) => {
          const next: [boolean, boolean] = [...flags];
          next[who] = true;
          return next;
        });
      } else if (evt.t === "fire" && evt.by !== apiRef.current.seat) {
        const fleetNow = fleets.current[apiRef.current.seat];
        if (!fleetNow) return;
        const previous = logsRef.current[evt.by].filter((s) => s.hit);
        const result = shotOn(fleetNow, evt.x, evt.y, previous);
        const shot: Shot = { x: evt.x, y: evt.y, hit: result.hit, sunk: Boolean(result.sunk) };
        pushShot(evt.by, shot);
        apiRef.current.send({
          g: "battleship",
          t: "answer",
          x: evt.x,
          y: evt.y,
          hit: result.hit,
          sunk: result.sunk,
        });
        apiRef.current.sound(result.hit ? "boom" : "splash");
        const left = afloat(fleetNow, [...previous, ...(result.hit ? [{ x: evt.x, y: evt.y }] : [])]);
        if (result.hit && left === 0) {
          end(evt.by, "Your fleet is under.");
          return;
        }
        setTurn(result.hit ? evt.by : apiRef.current.seat);
        setNote(result.hit ? (result.sunk ? `${nameOf(result.sunk.id)} sunk.` : "They hit.") : "They missed. Your shot.");
      } else if (evt.t === "answer") {
        const shot: Shot = { x: evt.x, y: evt.y, hit: evt.hit, sunk: Boolean(evt.sunk) };
        const next = pushShot(apiRef.current.seat, shot);
        apiRef.current.sound(evt.hit ? "boom" : "splash");
        const sunkCount = next[apiRef.current.seat].filter((s) => s.sunk).length;
        if (shot.sunk && sunkCount >= FLEET.length) {
          end(apiRef.current.seat, "You sank the fleet.");
          return;
        }
        if (evt.hit) {
          setTurn(apiRef.current.seat);
          setNote(evt.sunk ? `${nameOf(evt.sunk.id)} sunk. Shoot again.` : "Hit. Shoot again.");
        } else {
          setTurn(other(apiRef.current.seat));
          setNote("Miss.");
        }
      } else if (evt.t === "audit") {
        const who: Seat = apiRef.current.seat === 0 ? 1 : 0;
        void commitFleet(evt.fleet, evt.nonce).then((hash) => {
          setAudit(hash === commits.current[who] ? "Partner's fleet matches the lock-in." : "Partner's fleet did not match the lock-in.");
        });
      }
    });
    // subscribe once; logs are read from a ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, link]);

  const placing = phase === "place" && (link ? !ready[api.seat] : gate);
  const ghostShip = placing && hover ? tryPlace(selected, hover.x, hover.y, dir, fleet)?.find((s) => s.id === selected) : null;
  const ghostCells = new Set((ghostShip ? cellsOf(ghostShip) : []).map((c) => `${c.x},${c.y}`));
  const ownCells = new Map<string, string>();
  const shownFleet = phase === "place" ? fleet : (fleets.current[view] ?? fleet);
  for (const ship of shownFleet) for (const cell of cellsOf(ship)) ownCells.set(`${cell.x},${cell.y}`, ship.id);
  const radar = logs[view];
  const incoming = logs[other(view)];
  const enemyDown = new Set(radar.filter((s) => s.sunk).map((_, i) => i));
  void enemyDown;
  const sunkEnemy = radar.filter((s) => s.sunk).length;
  const sunkMine = new Set(
    shownFleet
      .filter((ship) => cellsOf(ship).every((c) => incoming.some((s) => s.hit && s.x === c.x && s.y === c.y)))
      .map((ship) => ship.id),
  );

  function Grid({
    shots,
    ships,
    interactive,
    onFire,
  }: {
    shots: Shot[];
    ships: boolean;
    interactive?: boolean;
    onFire?: (x: number, y: number) => void;
  }) {
    return (
      <div
        ref={ships ? gridRef : undefined}
        className="sea"
        onPointerDown={ships && placing ? onGridDown : undefined}
        onPointerMove={ships && placing ? onGridMove : undefined}
        onPointerUp={ships && placing ? onGridUp : undefined}
      >
        {Array.from({ length: 100 }, (_, i) => {
          const x = i % 10;
          const y = Math.floor(i / 10);
          const key = `${x},${y}`;
          const shot = shots.find((s) => s.x === x && s.y === y);
          const occupied = ships && (link || gate || phase === "over") && ownCells.has(key);
          const cls = [
            occupied ? "ship" : "",
            shot?.hit ? (sunkMine.has(ownCells.get(key) ?? "") || shot.sunk ? "sunk" : "hit") : "",
            shot && !shot.hit ? "miss" : "",
            ships && ghostCells.has(key) ? "ghost" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button key={key} type="button" className={cls} onClick={() => interactive && onFire?.(x, y)}>
              {shot?.hit ? "•" : shot ? "·" : ""}
            </button>
          );
        })}
      </div>
    );
  }

  const canLock = fleetValid(fleet) && placing;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{note}</p>
          <p className="text-sm text-muted">
            {phase === "battle" ? `${api.names[turn]} to fire.` : "Ship coordinates stay on this phone until the end."}
            {winner !== null ? ` ${api.names[winner]} wins.` : ""}
          </p>
          {audit ? <p className="text-xs text-primary">{audit}</p> : null}
        </div>
        <p className="pill">{Math.max(0, FLEET.length - sunkEnemy)} afloat</p>
      </div>

      {placing ? (
        <>
          <div className="flex gap-2 overflow-x-auto">
            {FLEET.map((ship) => {
              const placed = fleet.some((s) => s.id === ship.id);
              return (
                <button
                  key={ship.id}
                  type="button"
                  className={`btn btn-ghost ${selected === ship.id ? "is-live" : ""}`}
                  onClick={() => {
                    setSelected(ship.id);
                    const found = fleet.find((s) => s.id === ship.id);
                    if (found) setDir(found.dir);
                  }}
                >
                  {ship.name}
                  <span className="text-muted">{placed ? " · set" : ` · ${ship.len}`}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost" onClick={rotate}>
              Rotate
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setFleet(randomFleet());
                api.sound("tap");
              }}
            >
              Randomize fleet
            </button>
          </div>
          <p className="text-xs text-muted">Drag a ship onto the water. Tap a ship already placed to rotate it.</p>
          <Grid shots={[]} ships />
          <button type="button" className="btn btn-primary" disabled={!canLock} onClick={() => void lockIn()}>
            Lock in fleet
          </button>
        </>
      ) : null}

      {phase !== "place" || (link && ready[api.seat]) ? (
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-sm text-muted">Enemy radar</p>
            <Grid
              shots={radar}
              ships={false}
              interactive={phase === "battle" && !over.current && (link ? turn === api.seat : gate && active === turn)}
              onFire={fireAt}
            />
          </div>
          <div>
            <p className="mb-1 text-sm text-muted">Your fleet</p>
            <Grid shots={incoming} ships />
          </div>
          <ul className="grid grid-cols-2 gap-1 text-sm">
            {FLEET.map((ship) => (
              <li key={ship.id} className={sunkMine.has(ship.id) ? "text-danger" : ""}>
                {ship.name}
                {sunkMine.has(ship.id) ? " · sunk" : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function nameOf(id: string): string {
  return FLEET.find((s) => s.id === id)?.name ?? id;
}
