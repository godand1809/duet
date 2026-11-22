/** Commutative-lock deck deal so each phone learns only its own hole cards. */

const P = 2305843009213693951n; // 2^61 − 1
const PHI = P - 1n;

export function modPow(base: bigint, exp: bigint, mod = P): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function modInv(a: bigint, m: bigint): bigint {
  let t = 0n;
  let newT = 1n;
  let r = m;
  let newR = ((a % m) + m) % m;
  while (newR !== 0n) {
    const q = r / newR;
    const prevT = t;
    t = newT;
    newT = prevT - q * newT;
    const prevR = r;
    r = newR;
    newR = prevR - q * newR;
  }
  if (r > 1n) throw new Error("exponent is not invertible");
  if (t < 0n) t += m;
  return t;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) {
    const n = x % y;
    x = y;
    y = n;
  }
  return x;
}

export interface Lock {
  e: bigint;
  d: bigint;
}

export function randomLock(): Lock {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  let e = 0n;
  for (const b of buf) e = (e << 8n) | BigInt(b);
  e = (e | 1n) % PHI;
  if (e < 3n) e = 5n;
  let guard = 0;
  while (gcd(e, PHI) !== 1n) {
    e += 2n;
    if (e >= PHI) e = 5n;
    if (++guard > 4000) throw new Error("could not draw a lock");
  }
  return { e, d: modInv(e, PHI) };
}

export function lockInt(m: bigint, e: bigint): bigint {
  return modPow(m, e);
}

export function cardInt(id: number): bigint {
  return BigInt(id + 2);
}

export function intCardId(v: bigint): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 2 || n > 53) throw new Error("sealed card failed to open");
  return n - 2;
}

export function shuffleBig(list: bigint[]): bigint[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const j = buf[0]! % (i + 1);
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

/** Local two-party rehearsal used by the self-check — mirrors the wire protocol. */
export function rehearsalDeal(): { alice: number[]; bob: number[]; board: number[] } {
  const alice = randomLock();
  let deck = shuffleBig(Array.from({ length: 52 }, (_, i) => cardInt(i))).map((c) => lockInt(c, alice.e));
  const bob = randomLock();
  deck = shuffleBig(deck.map((c) => lockInt(c, bob.e)));
  deck = deck.map((c) => lockInt(c, alice.d));
  const aliceLocked = deck.slice(0, 2);
  const bobLocked = deck.slice(2, 4);
  const boardLocked = deck.slice(4, 9);
  const bobHoles = bobLocked.map((c) => intCardId(lockInt(c, bob.d)));
  const alice2 = randomLock();
  const blinded = aliceLocked.map((c) => lockInt(c, alice2.e));
  const opened = blinded.map((c) => lockInt(c, bob.d));
  const aliceHoles = opened.map((c) => intCardId(lockInt(c, alice2.d)));
  const board = boardLocked.map((c) => intCardId(lockInt(c, bob.d)));
  for (const c of boardLocked) {
    const plain = lockInt(c, bob.d);
    if (lockInt(plain, bob.e) !== c) throw new Error("audit mismatch");
  }
  return { alice: aliceHoles, bob: bobHoles, board };
}

export function invertExp(e: bigint): bigint {
  return modInv(((e % PHI) + PHI) % PHI, PHI);
}

/** Open a guest-locked deck with the guest exponent and reject a tampered deal. */
export function idsFromLocked(locked: bigint[], e: bigint): number[] | null {
  let d: bigint;
  try {
    d = invertExp(e);
  } catch {
    return null;
  }
  const ids: number[] = [];
  for (const c of locked) {
    try {
      ids.push(intCardId(lockInt(c, d)));
    } catch {
      return null;
    }
  }
  if (new Set(ids).size !== ids.length) return null;
  if (ids.some((id) => id < 0 || id > 51)) return null;
  return ids;
}
