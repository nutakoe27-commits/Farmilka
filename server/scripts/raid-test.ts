// Extraction/raid loop probe: starter base, silo accrual and collection,
// banking, the death rule, raid loot from silos and the vault, the raid shield,
// and base persistence across a logout. Runs against real modules with a real
// World — no network.
import { loadBalance, getBalance } from '../src/game/balance.js';
import { World } from '../src/game/world.js';
import { updateBuildings, depositAll, tryWithdraw, findVault, lootFromDestroyed } from '../src/game/buildings.js';
import { applyDamage } from '../src/game/combat.js';
import { captureBase } from '../src/game/base.js';
import type { Player, Building } from '../src/game/entities.js';

loadBalance();
const bal = getBalance();
const SIZE = bal.world.size;

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`);
  ok ? pass++ : fail++;
};

function addPlayer(world: World, name = 'P'): Player {
  const p = world.spawnPlayer(name, null);
  p.ws = { readyState: 99 } as never;
  p.invulnUntil = 0;
  p.hp = p.maxHp = 10_000;
  return p;
}

function owned(world: World, p: Player, type: string): Building | null {
  for (const id of p.buildingIds) {
    const b = world.buildings.get(id);
    if (b && b.buildingType === type) return b;
  }
  return null;
}

// ---------- starter base ----------
{
  const world = new World(1);
  const p = addPlayer(world);
  // grantStarterBase runs via the socket path; call it the same way restoreBase does
  const { grantStarterBase } = await import('../src/game/buildings.js');
  grantStarterBase(world, p);
  const vault = owned(world, p, 'vault');
  const farm = owned(world, p, 'farm');
  check('new player gets a vault and a farm for free', !!vault && !!farm, `n=${p.buildingIds.size}`);
  check('the starter base costs nothing', p.money === bal.player.startMoney, `money=${p.money}`);
}

// ---------- silo fills, owner collects, vault banks ----------
{
  const world = new World(1);
  const p = addPlayer(world);
  const { grantStarterBase } = await import('../src/game/buildings.js');
  grantStarterBase(world, p);
  const farm = owned(world, p, 'farm')!;
  const vault = owned(world, p, 'vault')!;
  const cfg = bal.buildings.farm;

  // park the player far away so nothing is auto-collected while it fills
  world.moveEntity(p, SIZE / 2, SIZE / 2);
  world.moveEntity(farm, 200, 200);
  world.moveEntity(vault, 600, 600);
  // buildings stamp incomeAt from the wall clock, so drive the probe from it too
  let now = Date.now();
  for (let i = 0; i < 6; i++) { now += cfg.incomeIntervalSec * 1000; updateBuildings(world, 0.1, now); }
  check('farm accrues into its own silo', farm.stored > 0, `stored=${farm.stored}`);

  const before = p.money;
  world.moveEntity(p, farm.x + 20, farm.y);
  now += 100;
  updateBuildings(world, 0.1, now);
  check('walking up to the farm collects the silo', p.money > before && farm.stored < 1, `money=${p.money} left=${farm.stored}`);

  // silo is capped so an idle farm is not infinite money
  for (let i = 0; i < 500; i++) { now += cfg.incomeIntervalSec * 1000; }
  world.moveEntity(p, SIZE / 2, SIZE / 2);
  for (let i = 0; i < 500; i++) { now += cfg.incomeIntervalSec * 1000; updateBuildings(world, 0.1, now); }
  check('silo stops at its cap', farm.stored <= (cfg.storeCap ?? 0) + 0.001, `stored=${farm.stored} cap=${cfg.storeCap}`);

  // touching the vault banks everything carried
  p.money = 500;
  world.moveEntity(p, vault.x + 20, vault.y);
  now += 100;
  updateBuildings(world, 0.1, now);
  check('touching the vault banks carried gold', p.banked >= 500 && p.money === 0, `banked=${p.banked} carried=${p.money}`);

  // withdrawing only works next to the vault
  const away = { ...p };
  world.moveEntity(p, SIZE / 2, SIZE / 2);
  check('cannot withdraw away from the vault', !tryWithdraw(world, p).ok);
  world.moveEntity(p, vault.x + 20, vault.y);
  const bankedBefore = p.banked;
  check('withdrawing at the vault returns the gold', tryWithdraw(world, p).ok && p.money === bankedBefore, `carried=${p.money}`);

  // Regression: banking is edge-triggered. Standing at the vault after a
  // withdrawal must NOT sweep the gold straight back in.
  const carried = p.money;
  for (let i = 0; i < 20; i++) { now += 100; updateBuildings(world, 0.1, now); }
  check('withdrawn gold is not auto-banked while standing at the vault',
    p.money === carried && p.banked === 0, `carried=${p.money} banked=${p.banked}`);

  // ...but walking away and coming back banks again, as designed
  world.moveEntity(p, SIZE / 2, SIZE / 2);
  now += 100; updateBuildings(world, 0.1, now);
  world.moveEntity(p, vault.x + 20, vault.y);
  now += 100; updateBuildings(world, 0.1, now);
  check('returning to the vault banks again', p.banked === carried && p.money === 0,
    `banked=${p.banked} carried=${p.money}`);
  void away;
}

// ---------- death: carried is lost, banked survives ----------
{
  const world = new World(1);
  const p = addPlayer(world, 'Victim');
  const killer = addPlayer(world, 'Killer');
  world.moveEntity(p, 1000, 1000);
  world.moveEntity(killer, 1100, 1000);
  p.money = 800;
  p.banked = 1500;
  p.hp = 10;
  applyDamage(world, p, 999, { id: killer.id, name: killer.name, weapon: 'sword', cause: 'player' }, Date.now(), 50);
  check('death takes everything carried', p.dead && p.money === 0, `carried=${p.money}`);
  check('death leaves the vault untouched', p.banked === 1500, `banked=${p.banked}`);
}

// ---------- raiding: silo and vault loot ----------
{
  const world = new World(1);
  const victim = addPlayer(world, 'Farmer');
  const { grantStarterBase } = await import('../src/game/buildings.js');
  grantStarterBase(world, victim);
  const farm = owned(world, victim, 'farm')!;
  const vault = owned(world, victim, 'vault')!;
  farm.stored = 250;
  victim.banked = 10_000;

  const silo = lootFromDestroyed(world, farm, victim);
  const scrap = Math.floor(bal.buildings.farm.price * bal.economy.raidLootFrac);
  check('razing a farm drops its silo plus scrap', silo === 250 + scrap, `loot=${silo} expected=${250 + scrap}`);
  check('the looted silo is emptied', farm.stored === 0);

  const bankedBefore = victim.banked;
  const vaultLoot = lootFromDestroyed(world, vault, victim);
  const expected = Math.floor(bankedBefore * bal.economy.vaultRaidFrac);
  check('cracking the vault takes a slice of banked gold', vaultLoot >= expected && victim.banked === bankedBefore - expected,
    `loot=${vaultLoot} taken=${bankedBefore - victim.banked} expected=${expected}`);
  check('most of the vault survives a raid', victim.banked > bankedBefore * 0.8, `left=${victim.banked}/${bankedBefore}`);
}

// ---------- raid shield ----------
{
  const world = new World(1);
  const victim = addPlayer(world, 'Shielded');
  const raider = addPlayer(world, 'Raider');
  const { grantStarterBase } = await import('../src/game/buildings.js');
  grantStarterBase(world, victim);
  const farm = owned(world, victim, 'farm')!;
  const now = Date.now();
  const src = { id: raider.id, name: raider.name, weapon: 'sword', cause: 'player' as const };

  const hpBefore = farm.hp;
  check('an unshielded base can be attacked', applyDamage(world, farm, 10, src, now, 10) && farm.hp < hpBefore);
  victim.raidShieldUntil = now + 60_000;
  const hpShielded = farm.hp;
  check('a shielded base cannot be attacked', !applyDamage(world, farm, 10, src, now, 10) && farm.hp === hpShielded);
  victim.raidShieldUntil = now - 1;
  check('the shield expires', applyDamage(world, farm, 10, src, now, 10) && farm.hp < hpShielded);
}

// ---------- base persistence ----------
{
  const world = new World(1);
  const p = addPlayer(world, 'Builder');
  p.account = 'Builder';
  const { grantStarterBase } = await import('../src/game/buildings.js');
  grantStarterBase(world, p);
  const farm = owned(world, p, 'farm')!;
  farm.stored = 120;
  const snap = captureBase(world, p);
  check('base snapshot keeps every structure', snap.buildings.length === p.buildingIds.size, `n=${snap.buildings.length}`);
  check('base snapshot keeps silo contents', snap.buildings.some((b) => b.t === 'farm' && b.s === 120), JSON.stringify(snap.buildings));
  check('base snapshot keeps the vault', snap.buildings.some((b) => b.t === 'vault'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
