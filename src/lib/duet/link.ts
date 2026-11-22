import type { DataConnection, Peer } from "peerjs";
import type { GameId, GameOptions, LinkPhase, WireEvt } from "./types";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeCode(): string {
  const buf = new Uint32Array(5);
  crypto.getRandomValues(buf);
  let code = "";
  for (const n of buf) code += ALPHABET[n % ALPHABET.length];
  return code;
}

export function peerIdFor(code: string): string {
  return `duet${code.toLowerCase()}`;
}

export function joinUrl(code: string, game: GameId): string {
  const url = new URL(window.location.href);
  url.searchParams.set("room", code);
  url.searchParams.set("game", game);
  url.hash = "";
  return url.toString();
}

export type NetMsg =
  | { k: "hello"; name: string }
  | { k: "welcome"; name: string }
  | { k: "start"; game: GameId; options: GameOptions }
  | { k: "evt"; evt: WireEvt }
  | { k: "ping"; t: number }
  | { k: "pong"; t: number };

export interface LinkHandlers {
  onPhase: (phase: LinkPhase, detail?: string) => void;
  onPeerName: (name: string) => void;
  onStart: (game: GameId, options: GameOptions) => void;
  onEvent: (evt: WireEvt) => void;
  onRtt: (ms: number) => void;
}

export class TableLink {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private pingTimer = 0;
  private natTimer = 0;
  private closed = false;
  private tries = 0;
  role: "host" | "guest" = "host";
  code = "";

  constructor(
    private handlers: LinkHandlers,
    private name: string,
  ) {}

  private ice() {
    return {
      iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }],
    };
  }

  private async makePeer(id?: string): Promise<Peer> {
    const { default: PeerCtor } = await import("peerjs");
    const opts = { debug: 0 as const, config: this.ice() };
    return id ? new PeerCtor(id, opts) : new PeerCtor(opts);
  }

  async host(code: string) {
    this.role = "host";
    this.code = code;
    this.handlers.onPhase("creating");
    const peer = await this.makePeer(peerIdFor(code));
    this.peer = peer;
    this.armNat(14000);
    peer.on("open", () => {
      this.handlers.onPhase("waiting");
    });
    peer.on("error", (err) => {
      const type = (err as { type?: string }).type ?? "";
      if (type === "unavailable-id") {
        this.handlers.onPhase("failed", "That code is already in use. Try creating the table again.");
        return;
      }
      if (type === "network" || type === "server-error" || type === "socket-error") {
        this.handlers.onPhase("failed", "nat");
        return;
      }
      if (!this.conn || !this.conn.open) this.handlers.onPhase("failed", "nat");
    });
    peer.on("disconnected", () => {
      if (this.closed) return;
      this.handlers.onPhase("reconnecting");
      peer.reconnect();
    });
    peer.on("connection", (conn) => {
      if (this.conn && this.conn.open) conn.close();
      else this.bind(conn);
    });
  }

  async join(code: string) {
    this.role = "guest";
    this.code = code.toUpperCase();
    this.handlers.onPhase("connecting");
    const peer = await this.makePeer();
    this.peer = peer;
    this.armNat(14000);
    peer.on("open", () => this.dial());
    peer.on("error", (err) => {
      const type = (err as { type?: string }).type ?? "";
      if (type === "peer-unavailable") {
        this.handlers.onPhase("failed", "That table isn't open. Check the code with your partner.");
        return;
      }
      if (this.tries < 3 && !this.closed) {
        this.tries += 1;
        this.handlers.onPhase("reconnecting");
        window.setTimeout(() => this.dial(), 900);
        return;
      }
      this.handlers.onPhase("failed", "nat");
    });
    peer.on("disconnected", () => {
      if (this.closed) return;
      this.handlers.onPhase("reconnecting");
      if (this.tries < 4) {
        this.tries += 1;
        peer.reconnect();
        window.setTimeout(() => this.dial(), 700);
      }
    });
  }

  private dial() {
    if (!this.peer || this.closed || this.peer.destroyed) return;
    const conn = this.peer.connect(peerIdFor(this.code), { reliable: true });
    this.bind(conn);
  }

  private bind(conn: DataConnection) {
    this.conn = conn;
    conn.on("open", () => {
      window.clearTimeout(this.natTimer);
      this.handlers.onPhase("open");
      this.send({ k: "hello", name: this.name });
      this.pingTimer = window.setInterval(() => {
        this.send({ k: "ping", t: Date.now() });
      }, 3000);
    });
    conn.on("data", (raw) => this.inbox(raw as NetMsg));
    conn.on("close", () => {
      window.clearInterval(this.pingTimer);
      if (this.closed) return;
      this.handlers.onPhase("reconnecting");
      if (this.role === "guest" && this.tries < 4) {
        this.tries += 1;
        window.setTimeout(() => this.dial(), 800);
      }
    });
    conn.on("error", () => {
      if (!this.closed) this.handlers.onPhase("failed", "nat");
    });
  }

  private inbox(msg: NetMsg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.k === "hello") {
      this.handlers.onPeerName(msg.name.slice(0, 16) || "Partner");
      this.send({ k: "welcome", name: this.name });
    } else if (msg.k === "welcome") {
      this.handlers.onPeerName(msg.name.slice(0, 16) || "Partner");
    } else if (msg.k === "start") {
      this.handlers.onStart(msg.game, msg.options);
    } else if (msg.k === "evt") {
      this.handlers.onEvent(msg.evt);
    } else if (msg.k === "ping") {
      this.send({ k: "pong", t: msg.t });
    } else if (msg.k === "pong") {
      this.handlers.onRtt(Math.max(0, Date.now() - msg.t));
    }
  }

  private armNat(ms: number) {
    window.clearTimeout(this.natTimer);
    this.natTimer = window.setTimeout(() => {
      if (!this.conn?.open && !this.closed) this.handlers.onPhase("failed", "nat");
    }, ms);
  }

  send(msg: NetMsg) {
    if (this.conn?.open) this.conn.send(msg);
  }

  rename(name: string) {
    this.name = name;
  }

  close() {
    this.closed = true;
    window.clearInterval(this.pingTimer);
    window.clearTimeout(this.natTimer);
    try {
      this.conn?.close();
    } catch {
      /* already gone */
    }
    try {
      this.peer?.destroy();
    } catch {
      /* already gone */
    }
  }
}

export const NAT_COPY =
  "A direct phone-to-phone link didn't open. Strict mobile networks sometimes block peer connections. Try Wi-Fi, or use Pass-and-Play on one phone.";
