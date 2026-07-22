import { decode, encode, type ClientMsg, type ServerMsg, type WelcomeMsg, type SnapshotMsg, type GameEvent, type EntityState, type LeaderEntry } from '@shared/protocol.js';
import { decodeSnapshot } from '@shared/snapshot-codec.js';
import { lang, t } from '../ui/i18n.js';

export interface Remote {
  state: EntityState;
  /** timed position history for interpolation */
  buf: { t: number; x: number; y: number; angle: number }[];
  /** set on the tick the entity appeared (fade-in) */
  bornAt: number;
}

export interface PendingInput {
  seq: number;
  mx: number;
  my: number;
  dt: number;
  attack: boolean;
}

export class Connection {
  ws: WebSocket;
  welcome: WelcomeMsg | null = null;
  entities = new Map<string, Remote>();
  self: SnapshotMsg['self'] | null = null;
  lastSeq = 0;
  /** serverTime - performance.now(), smoothed */
  timeOffset = 0;
  private offsetInit = false;

  pending: PendingInput[] = [];

  onWelcome: (w: WelcomeMsg) => void = () => {};
  onEvent: (ev: GameEvent) => void = () => {};
  onSnapshot: (s: SnapshotMsg) => void = () => {};
  onRemove: (id: string, state: EntityState) => void = () => {};
  onQueued: (pos: number) => void = () => {};
  onLeaderboard: (top: LeaderEntry[], rank: number, total: number) => void = () => {};
  onClose: (reason: string) => void = () => {};

  constructor(name: string, password = '', register = false, server?: number) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = () => this.send({ t: 'join', name, password: password || undefined, register: register || undefined, server, lang });
    this.ws.onclose = () => this.onClose(this.closeReason ?? t('net.lost'));
    this.ws.onerror = () => this.onClose(t('net.error'));
    // snapshots arrive as binary frames; everything else is JSON text
    this.ws.onmessage = (e) => {
      if (typeof e.data === 'string') this.handle(e.data);
      else this.applySnapshot(decodeSnapshot(e.data as ArrayBuffer));
    };
  }

  private closeReason: string | null = null;

  send(msg: ClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }

  private handle(data: string): void {
    const msg = decode<ServerMsg>(data);
    if (!msg) return;
    switch (msg.t) {
      case 'welcome':
        this.welcome = msg;
        this.timeOffset = msg.time - performance.now();
        this.offsetInit = true;
        this.onWelcome(msg);
        break;
      case 'snapshot':
        this.applySnapshot(msg);
        break;
      case 'event':
        this.onEvent(msg.ev);
        break;
      case 'queued':
        this.onQueued(msg.pos);
        break;
      case 'leaderboard':
        this.onLeaderboard(msg.top, msg.rank, msg.total);
        break;
      case 'reject':
        this.closeReason = msg.reason;
        this.onClose(msg.reason);
        this.ws.close();
        break;
      case 'pong':
        break;
    }
  }

  private applySnapshot(s: SnapshotMsg): void {
    // smooth server clock sync
    const inst = s.time - performance.now();
    this.timeOffset = this.offsetInit ? this.timeOffset * 0.95 + inst * 0.05 : inst;
    this.offsetInit = true;

    for (const st of s.add) {
      this.entities.set(st.id, {
        state: st,
        buf: [{ t: s.time, x: st.x, y: st.y, angle: st.angle }],
        bornAt: performance.now(),
      });
    }
    for (const d of s.upd) {
      const r = this.entities.get(d.id);
      if (!r) continue;
      r.state.x = d.x;
      r.state.y = d.y;
      if (d.angle !== undefined) r.state.angle = d.angle;
      if (d.hp !== undefined) r.state.hp = d.hp;
      if (d.maxHp !== undefined) r.state.maxHp = d.maxHp;
      if (d.weapon !== undefined) r.state.weapon = d.weapon;
      if (d.prot !== undefined) r.state.prot = d.prot;
      if (d.hat !== undefined) r.state.hat = d.hat;
      if (d.prestige !== undefined) r.state.prestige = d.prestige;
      if (d.fx !== undefined) r.state.fx = d.fx;
      r.buf.push({ t: s.time, x: d.x, y: d.y, angle: d.angle ?? r.state.angle });
      if (r.buf.length > 12) r.buf.shift();
    }
    for (const id of s.rem) {
      const r = this.entities.get(id);
      if (r) {
        this.onRemove(id, r.state);
        this.entities.delete(id);
      }
    }
    this.self = s.self;
    this.lastSeq = s.lastSeq;
    // drop acknowledged inputs (for prediction replay)
    while (this.pending.length && this.pending[0].seq <= s.lastSeq) this.pending.shift();
    this.onSnapshot(s);
  }

  /** Server-time timestamp to render at (with interpolation delay). */
  renderTime(): number {
    return performance.now() + this.timeOffset - 100;
  }
}
