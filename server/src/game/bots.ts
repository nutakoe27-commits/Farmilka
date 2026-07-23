// Server-driven filler bots. They are ordinary Player entities with no
// WebSocket, so `connectedPlayers()` (and everything built on it — online
// counts, leaderboard, the player cap, world reaping) ignores them, and all
// telemetry call sites skip them explicitly. To real players they look and
// behave like normal opponents: they roam, farm mobs, pick up loot, shop,
// level up, dodge boss wind-ups, eat when hurt, flee when losing, and pick
// fights based on a per-bot aggression personality.
import { angleDiff } from '@shared/math.js';
import type { WeaponId } from '@shared/types.js';
import { getBalance } from './balance.js';
import type { World } from './world.js';
import type { Entity, Player, Boss, BotBrain } from './entities.js';
import { tryBuyWeapon, tryBuyFood, tryEat, tryEquip } from './economy.js';
import { tryPlaceBuilding } from './buildings.js';

/** Filler bots per world. 0 disables the feature. */
const BOTS_PER_WORLD = Number(process.env.BOTS_PER_WORLD ?? 5);

const NAME_POOL = [
  'Shadow', 'Ghost', 'Reaper', 'Blaze', 'Frost', 'Viper', 'Nova', 'Storm', 'Raven', 'Fang',
  'Zephyr', 'Onyx', 'Crimson', 'Hunter', 'Wolf', 'Titan', 'Echo', 'Drake', 'Rogue', 'Slayer',
  'Nyx', 'Vortex', 'Ember', 'Talon', 'Grim', 'Havoc', 'Jinx', 'Lynx', 'Phantom', 'Zeal',
  'Кот', 'Барон', 'Гроза', 'Тень', 'Викинг', 'Мамонт', 'Пума', 'Сокол', 'Рысь', 'Буря',
];

let namePick = 0;

function pickName(used: Set<string>): string {
  for (let i = 0; i < NAME_POOL.length * 3; i++) {
    const base = NAME_POOL[namePick++ % NAME_POOL.length];
    // occasionally suffix a number so names look organic and stay unique
    const candidate = i < NAME_POOL.length && !used.has(base.toLowerCase())
      ? base
      : `${base}${10 + (namePick * 7) % 89}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `Player${namePick++}`;
}

/** Tops each world up to BOTS_PER_WORLD bots. Dead bots persist and respawn, so this only spawns on world creation. */
export function ensureBots(world: World): void {
  if (BOTS_PER_WORLD <= 0) return;
  let count = 0;
  for (const p of world.players.values()) if (p.bot) count++;
  if (count >= BOTS_PER_WORLD) return;
  const used = new Set<string>();
  for (const p of world.players.values()) used.add(p.name.toLowerCase());
  for (; count < BOTS_PER_WORLD; count++) {
    const name = pickName(used);
    used.add(name.toLowerCase());
    const bot = world.spawnBot(name);
    bot.brain = {
      wanderAngle: Math.random() * Math.PI * 2,
      nextWanderAt: 0,
      nextShopAt: Date.now() + Math.random() * 2000,
      aggro: Math.random(),
      reserve: 250 + Math.floor(Math.random() * 500),
      seq: 0,
    };
  }
}

/** Drives every bot's decision for this tick. Runs before updatePlayers so the input is consumed the same tick. */
export function updateBots(world: World, dt: number, now: number): void {
  if (BOTS_PER_WORLD <= 0) return;
  for (const p of world.players.values()) {
    if (!p.bot || p.dead || !p.brain) continue;
    stepBot(world, p, now);
  }
}

function setInput(p: Player, angle: number, mx: number, my: number, attack: boolean): void {
  p.input = { seq: ++p.brain!.seq, mx, my, aim: angle, attack };
}

/** Heading that points from `a` away toward `b` (used to run from a threat). */
function awayAngle(a: Entity, b: Entity): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function stepBot(world: World, p: Player, now: number): void {
  const bal = getBalance();
  const brain = p.brain!;
  const size = bal.world.size;

  if (now >= brain.nextShopAt) {
    botShop(world, p, brain);
    brain.nextShopAt = now + 3000 + Math.random() * 4000;
  }

  // ---- perception: nearest mob / hostile player / boss / loot in view ----
  let mob: Entity | null = null, mobD = Infinity;
  let enemy: Player | null = null, enemyD = Infinity;
  let boss: Boss | null = null, bossD = Infinity;
  let loot: Entity | null = null, lootD = Infinity;
  for (const e of world.grid.queryCircle(p.x, p.y, 820)) {
    if (e === p || e.dead) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (e.kind === 'mob') { if (d < mobD) { mobD = d; mob = e; } }
    else if (e.kind === 'player') {
      const op = e as Player;
      if (op.id === p.id || op.invulnUntil > now) continue; // never poke a protected spawn
      if (d < enemyD) { enemyD = d; enemy = op; }
    } else if (e.kind === 'boss') { if (d < bossD) { bossD = d; boss = e as Boss; } }
    else if (e.kind === 'coin' || e.kind === 'food') { if (d < lootD) { lootD = d; loot = e; } }
  }

  const hpFrac = p.hp / p.maxHp;

  // survival: eat when hurt and off cooldown
  if (hpFrac < 0.6 && p.food > 0 && now >= p.foodReadyAt) tryEat(world, p, now);

  // dodge an active boss wind-up — run out of its reach
  if (boss && boss.telegraph && bossD < 440) {
    const a = awayAngle(boss, p);
    setInput(p, a, Math.cos(a), Math.sin(a), false);
    return;
  }

  // flee when critical and out of food
  if (hpFrac < 0.3 && p.food === 0) {
    const threat: Entity | null = enemy ?? boss ?? mob;
    const a = threat ? awayAngle(threat, p) : brain.wanderAngle;
    setInput(p, a, Math.cos(a), Math.sin(a), false);
    return;
  }

  // pick a combat target: mobs by default, players if aggressive & healthy, boss if healthy
  let target: Entity | null = null;
  if (mob && mobD < 700) target = mob;
  if (enemy && hpFrac > 0.45) {
    const reach = 320 + brain.aggro * 380;
    if (enemyD < reach && (!target || enemyD < mobD || brain.aggro > 0.7)) target = enemy;
  }
  if (!target && boss && bossD < 560 && hpFrac > 0.6) target = boss;

  if (target) {
    engage(world, p, target);
    return;
  }

  // no target: grab nearby loot, otherwise wander
  if (loot && lootD < 320) {
    const a = Math.atan2(loot.y - p.y, loot.x - p.x);
    setInput(p, a, Math.cos(a), Math.sin(a), false);
    return;
  }
  wander(p, brain, now, size);
}

function engage(world: World, p: Player, target: Entity): void {
  const w = getBalance().weapons[p.equipped];
  const dx = target.x - p.x;
  const dy = target.y - p.y;
  const d = Math.hypot(dx, dy) || 0.001;
  const aim = Math.atan2(dy, dx);
  const reach = w.range + target.radius;
  let mx = 0, my = 0, attack = false;

  if (w.type === 'ranged') {
    const ideal = w.range * 0.62;
    if (d > ideal + 50) { mx = Math.cos(aim); my = Math.sin(aim); }        // close in
    else if (d < ideal - 70) { mx = -Math.cos(aim); my = -Math.sin(aim); } // kite back
    else { mx = Math.cos(aim + Math.PI / 2) * 0.6; my = Math.sin(aim + Math.PI / 2) * 0.6; } // strafe
    attack = d <= w.range * 0.95 + target.radius;
  } else {
    if (d > reach * 0.72) { mx = Math.cos(aim); my = Math.sin(aim); }
    // face roughly at the target before swinging (server also checks the arc)
    attack = d <= reach && Math.abs(angleDiff(aim, p.angle)) < Math.PI / 2;
  }
  setInput(p, aim, mx, my, attack);
}

function wander(p: Player, brain: BotBrain, now: number, size: number): void {
  if (now >= brain.nextWanderAt) {
    brain.wanderAngle += (Math.random() - 0.5) * 1.2; // gentle heading drift, not jitter
    brain.nextWanderAt = now + 1500 + Math.random() * 2500;
  }
  const m = 320; // steer away from the world edges
  if (p.x < m) brain.wanderAngle = 0;
  else if (p.x > size - m) brain.wanderAngle = Math.PI;
  if (p.y < m) brain.wanderAngle = Math.PI / 2;
  else if (p.y > size - m) brain.wanderAngle = -Math.PI / 2;
  const a = brain.wanderAngle;
  setInput(p, a, Math.cos(a), Math.sin(a), false);
}

function botShop(world: World, p: Player, brain: BotBrain): void {
  const bal = getBalance();
  // keep a couple of food on hand
  if (p.food < 3 && p.money >= bal.food.price) tryBuyFood(world, p);

  // fill the hotbar with the cheapest weapon it can still afford
  if (p.weapons.length < 4) {
    const affordable = (Object.entries(bal.weapons) as [WeaponId, { price: number }][])
      .filter(([id, c]) => id !== 'fists' && c.price > 0 && c.price <= p.money && !p.weapons.includes(id))
      .sort((a, b) => a[1].price - b[1].price);
    if (affordable.length) tryBuyWeapon(world, p, affordable[0][0]);
  }

  // equip the strongest owned weapon (highest base damage)
  let best: WeaponId = 'fists';
  let bestDmg = -1;
  for (const wid of p.weapons) {
    const c = bal.weapons[wid];
    if (c && c.damage > bestDmg) { bestDmg = c.damage; best = wid; }
  }
  if (best !== p.equipped) tryEquip(world, p, best);

  // (levels are earned from kills now — bots gain them automatically in combat)

  // occasionally set up a farm for a bit of income and world flavour
  if (p.money > 900 && p.buildingIds.size < 1 && Math.random() < 0.25) {
    const a = Math.random() * Math.PI * 2;
    tryPlaceBuilding(world, p, 'farm', Math.round(p.x + Math.cos(a) * 140), Math.round(p.y + Math.sin(a) * 140));
  }
}
