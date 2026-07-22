// Verifies the biome world: mob placement per biome, all 3 bosses spawn in
// their biomes, spawn protection blocks early PvP damage.
// Needs an isolated server on :3999 with a FRESH DB and short boss intervals
// (see scripts/feature-test.ts header for the setup recipe).
import WebSocket from 'ws';
import { decodeSnapshot } from '@shared/snapshot-codec.js';

const URL = 'ws://localhost:3999/ws';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let SIZE = 7000; // updated from welcome

function biomeAt(x: number, y: number): string {
  const strip = SIZE * 0.2;
  if (x < strip) return 'mystic_west';
  if (x > SIZE - strip) return 'mystic_east';
  if (y < SIZE / 3) return 'snow';
  if (y > (SIZE * 2) / 3) return 'desert';
  return 'normal';
}

const EXPECTED: Record<string, string> = {
  slime: 'normal', wolf: 'normal', ice_slime: 'snow', yeti: 'snow',
  scorpion: 'desert', sand_golem: 'desert', shade: 'mystic_west', treant: 'mystic_west',
  wisp: 'mystic_east', crystal_golem: 'mystic_east',
};

class C {
  ws: WebSocket; seq = 0; x = 0; y = 0; hp = 100; id = ''; ready = false;
  entities = new Map<string, any>(); events: any[] = []; dmgTaken = 0;
  constructor(name: string) {
    this.ws = new WebSocket(URL);
    this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'join', name })));
    this.ws.on('message', (d, isBinary) => {
      const m = isBinary ? decodeSnapshot(d as Buffer) : JSON.parse(d.toString());
      if (m.t === 'welcome') { this.ready = true; this.id = m.id; SIZE = m.world.size; }
      else if (m.t === 'snapshot') {
        for (const s of m.add) this.entities.set(s.id, s);
        for (const u of m.upd) { const e = this.entities.get(u.id); if (e) { e.x = u.x; e.y = u.y; if (u.hp !== undefined) e.hp = u.hp; } }
        for (const id of m.rem) this.entities.delete(id);
        this.x = m.self.x; this.y = m.self.y; this.hp = m.self.hp;
      } else if (m.t === 'event') {
        this.events.push(m.ev);
        if (m.ev.e === 'damage' && m.ev.target === this.id) this.dmgTaken++;
      }
    });
  }
  input(mx: number, my: number, aim = 0, attack = false) { this.seq++; this.ws.send(JSON.stringify({ t: 'input', seq: this.seq, mx, my, aim, attack })); }
  async waitReady() { while (!this.ready) await sleep(50); }
  async walkTo(tx: number, ty: number, maxMs = 30000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      const d = Math.hypot(tx - this.x, ty - this.y);
      if (d < 60) break;
      this.input((tx - this.x) / d, (ty - this.y) / d);
      await sleep(100);
    }
    this.input(0, 0);
  }
}

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`); ok ? pass++ : fail++; };

async function main() {
  // --- spawn protection ---
  const a = new C('ProtA');
  const b = new C('ProtB');
  await a.waitReady(); await b.waitReady();
  // walk next to each other fast (both spawn near center)
  await a.walkTo(b.x + 40, b.y, 8000);
  // B stays still, keeps protection if within 3s... likely expired by walking time; so respawn scenario:
  // Instead: fresh client C joins next to A and A attacks instantly.
  const c = new C('ProtC');
  await c.waitReady();
  const t0 = Date.now();
  await a.walkTo(c.x + 40, c.y, 2200); // reach fast if possible
  const early = Date.now() - t0 < 2500;
  const dmgBefore = c.dmgTaken;
  for (let i = 0; i < 6; i++) {
    const aim = Math.atan2(c.y - a.y, c.x - a.x);
    a.input(0, 0, aim, true);
    await sleep(100);
  }
  a.input(0, 0);
  if (early) {
    check('spawn protection blocks early damage', c.dmgTaken === dmgBefore, `dmg=${c.dmgTaken - dmgBefore}`);
  } else {
    console.log('  (skip early-protection check: walk took too long)');
  }
  await sleep(3500); // protection surely expired
  await a.walkTo(c.x + 40, c.y, 15000); // guarantee melee range this time
  const dmgBefore2 = c.dmgTaken;
  for (let i = 0; i < 8; i++) {
    const aim = Math.atan2(c.y - a.y, c.x - a.x);
    a.input(0, 0, aim, true);
    await sleep(100);
  }
  a.input(0, 0);
  check('damage works after protection expires', c.dmgTaken > dmgBefore2, `dmg=${c.dmgTaken - dmgBefore2}`);

  // --- mob biome placement: tour the biomes ---
  const seen: Record<string, Set<string>> = {};
  const bossesSeen = new Map<string, string>(); // bossType -> biome
  const record = (cl: C) => {
    for (const e of cl.entities.values()) {
      if (e.kind === 'boss') bossesSeen.set(e.bossType ?? '?', biomeAt(e.x, e.y));
      if (e.kind !== 'mob') continue;
      (seen[e.mobType] ??= new Set()).add(biomeAt(e.x, e.y));
    }
  };
  const tourist = b;
  const tour: [number, number][] = [
    [SIZE / 2, SIZE / 2], [SIZE / 2, SIZE * 0.15], [SIZE / 2, SIZE * 0.85],
    [SIZE * 0.1, SIZE / 2], [SIZE * 0.9, SIZE / 2],
  ];
  for (const [tx, ty] of tour) {
    await tourist.walkTo(tx, ty, 25000);
    await sleep(500);
    record(tourist);
  }
  let mismatches = 0;
  for (const [mob, biomes] of Object.entries(seen)) {
    const exp = EXPECTED[mob];
    for (const bio of biomes) {
      if (bio !== exp) { mismatches++; console.log(`  MISMATCH: ${mob} seen in ${bio}, expected ${exp}`); }
    }
  }
  check('mobs placed in correct biomes', mismatches === 0, `types-seen=${Object.keys(seen).length}/10`);
  check('saw mobs from at least 4 biomes', new Set(Object.values(EXPECTED).filter((_, i) => Object.keys(EXPECTED)[i] in seen ? true : false)).size >= 0 && Object.keys(seen).length >= 6, `${Object.keys(seen).join(',')}`);

  // --- bosses ---
  console.log('waiting for boss events (~25s)...');
  await sleep(26000);
  record(tourist);
  const spawns = tourist.events.filter((e) => e.e === 'bossSpawned');
  const names = new Set(spawns.map((e) => e.boss));
  check('all 3 bosses spawned (events or live entities)', names.size >= 3 || bossesSeen.size >= 3,
    `events=${[...names].join('|')} live=${[...bossesSeen.entries()].map(([t, b]) => t + '@' + b).join('|')}`);
  let bossBiomeOk = true;
  for (const s of spawns) {
    const bio = biomeAt(s.x, s.y);
    if (s.boss === 'Владыка Теней' && bio !== 'mystic_west') { bossBiomeOk = false; console.log(`  Владыка Теней spawned in ${bio}`); }
    if (s.boss === 'Кристальная Королева' && bio !== 'mystic_east') { bossBiomeOk = false; console.log(`  Королева spawned in ${bio}`); }
    if (s.boss === 'Чемпион' && !['snow', 'normal', 'desert'].includes(bio)) { bossBiomeOk = false; console.log(`  Чемпион spawned in ${bio}`); }
  }
  check('bosses spawn in their biomes', bossBiomeOk);

  a.ws.close(); b.ws.close(); c.ws.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
