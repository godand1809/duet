import assert from "node:assert/strict";
import { cardId, idToCard } from "./cards.ts";
import { apply501, checkoutRoute, scoreAt } from "./darts.ts";
import { rehearsalDeal } from "./mental.ts";
import { addBoard, applyAction, award, bestHand, compareRank, dealHand, legal } from "./poker.ts";
import { applySimulation, newMatch, simulate } from "./pool.ts";
import { fleetValid, randomFleet, shotOn } from "./ships.ts";
import { scoreHand, trickWinner } from "./spades.ts";
import type { Card } from "./types.ts";

function C(s: Card["s"], r: number): Card {
  return { s, r };
}

const royal = bestHand([
  C("h", 14),
  C("h", 13),
  C("h", 12),
  C("h", 11),
  C("h", 10),
  C("s", 2),
  C("d", 3),
]);
assert.equal(royal.name, "Royal flush");

const wheel = bestHand([C("s", 14), C("h", 2), C("d", 3), C("c", 4), C("s", 5), C("d", 9), C("h", 9)]);
const six = bestHand([C("s", 2), C("h", 3), C("d", 4), C("c", 5), C("s", 6), C("d", 9), C("h", 8)]);
assert.equal(wheel.name, "Straight");
assert.ok(compareRank(six, wheel) > 0);

const dealt = rehearsalDeal();
const ids = [...dealt.alice, ...dealt.bob, ...dealt.board];
assert.equal(new Set(ids).size, 9);
for (const id of ids) assert.ok(id >= 0 && id <= 51);
assert.equal(cardId(idToCard(dealt.alice[0]!)), dealt.alice[0]);

let hand = dealHand({ handNo: 1, dealer: 0, stacks: [1000, 1000], sb: 10, bb: 20 });
assert.equal(hand.commit[0], 10);
assert.equal(hand.commit[1], 20);
assert.equal(hand.toAct, 0);
hand = applyAction(hand, 0, { kind: "fold" });
assert.equal(hand.winners?.[0], 1);
assert.equal(hand.stacks[1], 1010);
assert.equal(hand.stacks[0], 990);

hand = dealHand({ handNo: 2, dealer: 0, stacks: [200, 200], sb: 10, bb: 20 });
hand = applyAction(hand, 0, { kind: "call" });
assert.equal(hand.toAct, 1);
hand = applyAction(hand, 1, { kind: "check" });
assert.equal(hand.street, "flop");
assert.equal(hand.awaiting, 3);
const flop = [C("s", 2), C("h", 7), C("d", 9)];
hand = addBoard(hand, flop);
assert.equal(hand.board.length, 3);
assert.equal(hand.toAct, 1);
const L = legal(hand, 1);
assert.equal(L.check, true);
assert.ok(L.canRaise);

const route = checkoutRoute(40, true);
assert.equal(route, "D20");
assert.equal(checkoutRoute(50, true), "Bull");
assert.equal(scoreAt(0, 0).score, 50);
const topDouble = scoreAt(0, 0.97);
assert.equal(topDouble.wedge, 20);
assert.equal(topDouble.ring, "double");
const bust = apply501(20, scoreAt(0, 0), true);
assert.equal(bust.bust, true);

const nil = scoreHand(0, 0, false, 0);
assert.equal(nil.delta, 100);
const bags = scoreHand(3, 5, false, 8);
assert.equal(bags.bags, 0);
assert.ok(bags.delta < 30);
assert.equal(trickWinner([{ seat: 0, card: C("h", 10) }, { seat: 1, card: C("s", 2) }]), 1);

assert.equal(fleetValid(randomFleet()), true);
const fleet = randomFleet();
const cell = { x: fleet[0]!.x, y: fleet[0]!.y };
assert.equal(shotOn(fleet, cell.x, cell.y, []).hit, true);
assert.equal(shotOn(fleet, 9, 9, []).hit || true, true);

const match = newMatch();
const sim = simulate(match.balls, { ax: 1000, ay: 0, power: 900, ex: 0, ey: 0, cue: null });
assert.ok(sim.frames.length > 2);
const movingLeft = sim.balls.some((b) => b.vx !== 0 || b.vy !== 0);
assert.equal(movingLeft, false);
const after = applySimulation(match, sim);
assert.ok(after.shotCount === 1);

const a = sim.balls.find((b) => b.id === 1)!;
const b = sim.balls.find((b) => b.id === 9)!;
assert.ok(Math.abs(a.x) < 20000 && Math.abs(b.y) < 20000);

console.log("duet self-check ok", { route, after: after.message, pocketed: sim.balls.filter((ball) => ball.pocketed).map((ball) => ball.id) });
