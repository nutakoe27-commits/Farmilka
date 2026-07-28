// Extraction loop over the wire — needs a server on :3992.
// Registers an account, checks the starter base arrives, banks gold at the
// vault, dies and confirms banked gold survived, then reconnects and confirms
// the base and vault came back.
import WebSocket from 'ws';
import { decodeSnapshot } from '@shared/snapshot-codec.js';

const URL = 'ws://localhost:3990/ws';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`);
  ok ? pass++ : fail++;
};

class Client {
  ws: WebSocket;
  ready = false;
  id = '';
  self: { money: number; banked: number; buildings: number } = { money: 0, banked: 0, buildings: 0 };
  entities = new Map<string, { kind: string; buildingType?: string; owner?: string; x: number; y: number }>();
  events: { e: string; [k: string]: unknown }[] = [];

  constructor(name: string, password: string, register: boolean) {
    this.ws = new WebSocket(URL);
    this.ws.binaryType = 'nodebuffer';
    this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'join', name, password, register: register || undefined })));
    this.ws.on('message', (d, isBinary) => {
      if (!isBinary) {
        const m = JSON.parse(d.toString());
        if (m.t === 'welcome') { this.ready = true; this.id = m.id; }
        else if (m.t === 'event') this.events.push(m.ev);
        else if (m.t === 'reject') console.error('rejected:', m.reason);
        return;
      }
      const m = decodeSnapshot(d as Buffer);
      for (const s of m.add) this.entities.set(s.id, s as never);
      for (const u of m.upd) { const e = this.entities.get(u.id); if (e) { e.x = u.x; e.y = u.y; } }
      for (const id of m.rem) this.entities.delete(id);
      this.self = { money: m.self.money, banked: m.self.banked, buildings: m.self.buildings };
    });
  }
  send(o: object): void { this.ws.send(JSON.stringify(o)); }
  input(mx: number, my: number): void { this.send({ t: 'input', seq: Date.now() % 60000, mx, my, aim: 0, attack: false }); }
  async waitReady(): Promise<void> {
    const t0 = Date.now();
    while (!this.ready && Date.now() - t0 < 8000) await sleep(40);
  }
  mine(type: string): { x: number; y: number } | null {
    for (const e of this.entities.values()) {
      if (e.kind === 'building' && e.buildingType === type && e.owner === this.id) return { x: e.x, y: e.y };
    }
    return null;
  }
}

/** Walks to a world point by feeding movement input until close enough. */
async function walkTo(c: Client, tx: number, ty: number, ms = 12000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const me = c.entities.get(c.id);
    const sx = me?.x ?? 0, sy = me?.y ?? 0;
    const dx = tx - sx, dy = ty - sy;
    const d = Math.hypot(dx, dy);
    if (d < 45) break;
    c.input(dx / d, dy / d);
    await sleep(60);
  }
  c.input(0, 0);
}

async function main(): Promise<void> {
  const name = `Raider${Date.now() % 100000}`;
  const pass1 = 'testpass';

  // ---- first session: starter base + banking ----
  const a = new Client(name, pass1, true);
  await a.waitReady();
  await sleep(800);
  check('joined and registered', a.ready);
  check('starter base is granted', a.self.buildings >= 2, `buildings=${a.self.buildings}`);
  const vault = a.mine('vault');
  const farm = a.mine('farm');
  check('the base has a vault', !!vault);
  check('the base has a farm', !!farm);

  // walk to the vault to bank whatever we start with
  if (vault) {
    await walkTo(a, vault.x, vault.y);
    await sleep(900);
  }
  const banked = a.self.banked;
  check('touching the vault banks carried gold', banked > 0 && a.self.money === 0, `banked=${banked} carried=${a.self.money}`);
  check('a bank event was sent', a.events.some((e) => e.e === 'bank'), a.events.map((e) => e.e).join(','));

  a.ws.close();
  await sleep(1200); // let the base save and the session close

  // ---- second session: the base and the vault came back ----
  const b = new Client(name, pass1, false);
  await b.waitReady();
  await sleep(900);
  check('reconnect restores the saved base', b.self.buildings >= 2, `buildings=${b.self.buildings}`);
  check('banked gold persisted across the logout', b.self.banked === banked, `banked=${b.self.banked} was=${banked}`);
  check('the restored base still has a vault', !!b.mine('vault'));

  b.ws.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
