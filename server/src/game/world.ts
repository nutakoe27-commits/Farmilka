import { WebSocket } from 'ws';
import { encode, type GameEvent, type ServerMsg } from '@shared/protocol.js';
import type { MobId, BossId, WeaponId } from '@shared/types.js';
import { clamp, dist } from '@shared/math.js';
import { randomPointInBiome, type BiomeId } from '@shared/biomes.js';
import { getBalance } from './balance.js';
import { SpatialGrid } from './grid.js';
import { freshStatus } from './entities.js';
import { recomputeMaxHp } from './hats.js';
import type { Entity, Player, Mob, Boss, Projectile, Coin, Food, Building } from './entities.js';
import { updatePlayers } from './player.js';
import { updateMobs, populateMobs } from './mobs.js';
import { updateBosses, updateBossTimers } from './boss.js';
import { updateBuildings } from './buildings.js';
import { updateCoins } from './economy.js';
import { updateProjectiles } from './combat.js';
import { ensureBots, updateBots } from './bots.js';

export class World {
  tickNo = 0;
  time = Date.now();

  // runtime load metrics, updated by the loop and read by the admin dashboard
  tickMs = 0; // EMA of this world's tick + snapshot-send time
  bytesOut = 0; // bytes sent since the last sample window
  bytesRate = 0; // outgoing bytes/sec (updated ~1×/sec)

  entities = new Map<string, Entity>();
  players = new Map<string, Player>();
  mobs = new Map<string, Mob>();
  projectiles = new Map<string, Projectile>();
  coins = new Map<string, Coin>();
  foods = new Map<string, Food>();
  buildings = new Map<string, Building>();
  bosses = new Map<string, Boss>();

  grid: SpatialGrid<Entity>;
  mobRespawnQueue: { mobType: MobId; at: number }[] = [];

  /**
   * Single boss rotation: one random boss at a time. The next one is picked
   * (and its timer started) only after the current boss dies or despawns.
   */
  bossRotation: { bossType: BossId; nextSpawnAt: number; warned: boolean; pos: { x: number; y: number } } | null = null;

  private nextId = 1;

  constructor(public readonly serverId: number = 1) {
    const bal = getBalance();
    this.grid = new SpatialGrid<Entity>(bal.world.size, 200);
    populateMobs(this);
  }

  id(prefix: string): string {
    return `${prefix}${this.serverId}_${this.nextId++}`;
  }

  get center(): number {
    return getBalance().world.size / 2;
  }

  addEntity(e: Entity): void {
    this.entities.set(e.id, e);
    this.grid.insert(e);
    switch (e.kind) {
      case 'player': this.players.set(e.id, e); break;
      case 'mob': this.mobs.set(e.id, e); break;
      case 'projectile': this.projectiles.set(e.id, e); break;
      case 'coin': this.coins.set(e.id, e); break;
      case 'food': this.foods.set(e.id, e); break;
      case 'building': this.buildings.set(e.id, e); break;
      case 'boss': this.bosses.set(e.id, e); break;
    }
  }

  /** Removes the entity from the world/grid. Player objects stay in `players` (for respawn / ownership). */
  removeEntity(e: Entity): void {
    this.grid.remove(e);
    this.entities.delete(e.id);
    switch (e.kind) {
      case 'mob': this.mobs.delete(e.id); break;
      case 'projectile': this.projectiles.delete(e.id); break;
      case 'coin': this.coins.delete(e.id); break;
      case 'food': this.foods.delete(e.id); break;
      case 'building': this.buildings.delete(e.id); break;
      case 'boss': this.bosses.delete(e.id); break;
    }
  }

  moveEntity(e: Entity, nx: number, ny: number): void {
    const size = getBalance().world.size;
    nx = clamp(nx, e.radius, size - e.radius);
    ny = clamp(ny, e.radius, size - e.radius);
    if (nx === e.x && ny === e.y) return;
    e.x = nx;
    e.y = ny;
    this.grid.move(e);
    e.movedTick = this.tickNo;
  }

  // ---------- messaging ----------

  send(p: Player, msg: ServerMsg): void {
    if (p.ws && p.ws.readyState === WebSocket.OPEN) p.ws.send(encode(msg));
  }

  sendEvent(p: Player, ev: GameEvent): void {
    this.send(p, { t: 'event', ev });
  }

  broadcast(ev: GameEvent): void {
    const msg = encode({ t: 'event', ev } satisfies ServerMsg);
    for (const p of this.players.values()) {
      if (p.ws && p.ws.readyState === WebSocket.OPEN) p.ws.send(msg);
    }
  }

  /** Sends an event to every connected player whose view covers (x, y). */
  sendNear(x: number, y: number, ev: GameEvent): void {
    const r = getBalance().world.viewRadius;
    const r2 = r * r;
    const msg = encode({ t: 'event', ev } satisfies ServerMsg);
    for (const p of this.players.values()) {
      if (!p.ws || p.ws.readyState !== WebSocket.OPEN) continue;
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy <= r2) p.ws.send(msg);
    }
  }

  // ---------- spawning ----------

  /** Starter biomes players (and bots) can spawn in — spread out to avoid a single entry-point meatgrinder. */
  private static readonly STARTER_BIOMES: BiomeId[] = ['normal', 'snow', 'desert'];

  /** Spawn point: a random spot inside one of the three (newbie-friendly) starter biomes. */
  private spawnPoint(): { x: number; y: number } {
    const size = getBalance().world.size;
    const biomes = World.STARTER_BIOMES;
    const b = biomes[Math.floor(Math.random() * biomes.length)];
    return randomPointInBiome(b, size, 300);
  }

  spawnPlayer(name: string, ws: WebSocket | null, account?: { name: string; money: number; weapons: WeaponId[]; hats: string[]; hat: string | null; prestige: number; level: number; food: number }, lang: 'ru' | 'en' = 'ru', bot = false): Player {
    const bal = getBalance();
    const pos = this.spawnPoint();
    const weapons: WeaponId[] = account ? [...account.weapons] : ['fists'];
    if (!weapons.includes('fists')) weapons.unshift('fists');
    const p: Player = {
      id: this.id('p'),
      kind: 'player',
      x: pos.x,
      y: pos.y,
      angle: 0,
      radius: bal.player.radius,
      hp: bal.player.hp,
      maxHp: bal.player.hp,
      dead: false,
      cell: -1,
      movedTick: this.tickNo,
      dirtyTick: this.tickNo,
      name,
      ws,
      input: { seq: 0, mx: 0, my: 0, aim: 0, attack: false },
      money: account ? account.money : bal.player.startMoney,
      weapons,
      equipped: 'fists',
      food: account ? Math.max(0, Math.min(Math.floor(account.food), bal.food.maxCarry)) : 0,
      foodReadyAt: 0,
      hats: account ? [...account.hats] : [],
      hat: account ? account.hat : null,
      prestige: account ? account.prestige : 0,
      level: account ? Math.max(1, Math.min(Math.floor(account.level), bal.levels.max)) : 1,
      levelKills: 0,
      ...freshStatus(),
      invulnUntil: Date.now() + bal.player.spawnProtectSec * 1000,
      account: account ? account.name : null,
      lang,
      bot,
      brain: null,
      attackReadyAt: 0,
      lastDamagedAt: 0,
      lastBossContactAt: 0,
      respawnAt: 0,
      lifeStartAt: Date.now(),
      killsThisLife: 0,
      buildingIds: new Set(),
      known: new Set(),
      session: { joinedAt: Date.now(), kills: 0, deaths: 0, moneyEarned: 0 },
    };
    this.addEntity(p);
    return p;
  }

  respawnPlayer(p: Player): void {
    const bal = getBalance();
    const pos = this.spawnPoint();
    p.x = pos.x;
    p.y = pos.y;
    Object.assign(p, freshStatus());
    p.level = 1; // levels are per-life — reset on death
    p.levelKills = 0;
    p.maxHp = bal.player.hp;
    recomputeMaxHp(this, p); // fold in the equipped hat's HP bonus (level is 1)
    p.hp = p.maxHp; // respawn at full HP
    p.dead = false;
    p.respawnAt = 0;
    p.lifeStartAt = Date.now();
    p.killsThisLife = 0;
    p.invulnUntil = Date.now() + bal.player.spawnProtectSec * 1000;
    p.equipped = p.weapons.includes(p.equipped) ? p.equipped : 'fists';
    p.movedTick = this.tickNo;
    p.dirtyTick = this.tickNo;
    this.addEntity(p);
  }

  /** Spawns a server-driven filler bot (no ws; the brain is attached by game/bots.ts). */
  spawnBot(name: string): Player {
    return this.spawnPlayer(name, null, undefined, 'ru', true);
  }

  spawnFood(x: number, y: number): Food {
    const bal = getBalance();
    const size = bal.world.size;
    const food: Food = {
      id: this.id('f'),
      kind: 'food',
      x: clamp(x, 10, size - 10),
      y: clamp(y, 10, size - 10),
      angle: 0,
      radius: 14,
      hp: 1,
      maxHp: 1,
      dead: false,
      cell: -1,
      movedTick: this.tickNo,
      dirtyTick: this.tickNo,
      despawnAt: Date.now() + bal.food.despawnSec * 1000,
    };
    this.addEntity(food);
    return food;
  }

  spawnCoin(x: number, y: number, value: number): Coin {
    const bal = getBalance();
    const size = bal.world.size;
    const coin: Coin = {
      id: this.id('c'),
      kind: 'coin',
      x: clamp(x, 10, size - 10),
      y: clamp(y, 10, size - 10),
      angle: 0,
      radius: 12,
      hp: 1,
      maxHp: 1,
      dead: false,
      cell: -1,
      movedTick: this.tickNo,
      dirtyTick: this.tickNo,
      value,
      despawnAt: Date.now() + bal.economy.coinDespawnSec * 1000,
    };
    this.addEntity(coin);
    return coin;
  }

  /** Drops `total` money as 3-6 coin piles scattered around (x, y). */
  spawnCoinPiles(x: number, y: number, total: number): void {
    if (total <= 0) return;
    const piles = Math.min(3 + Math.floor(Math.random() * 4), Math.max(1, total));
    const base = Math.floor(total / piles);
    let rem = total - base * piles;
    for (let i = 0; i < piles; i++) {
      const value = base + (rem-- > 0 ? 1 : 0);
      if (value <= 0) continue;
      const a = Math.random() * Math.PI * 2;
      const d = 20 + Math.random() * 50;
      this.spawnCoin(x + Math.cos(a) * d, y + Math.sin(a) * d, value);
    }
  }

  spawnProjectile(
    ownerId: string,
    ownerKind: 'player' | 'boss' | 'turret',
    weapon: string,
    x: number,
    y: number,
    angle: number,
    speed: number,
    damage: number,
    maxDist: number,
    pierce = 0,
  ): Projectile {
    const proj: Projectile = {
      id: this.id('pr'),
      kind: 'projectile',
      x,
      y,
      angle,
      radius: 8,
      hp: 1,
      maxHp: 1,
      dead: false,
      cell: -1,
      movedTick: this.tickNo,
      dirtyTick: this.tickNo,
      ownerId,
      ownerKind,
      weapon,
      damage,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      maxDist,
      traveled: 0,
      pierceLeft: pierce,
      hitIds: pierce > 0 ? new Set() : null,
    };
    this.addEntity(proj);
    return proj;
  }

  /**
   * Marks an entity's state as changed so the next snapshot emits a delta with
   * its stateful fields. Changes made OUTSIDE the tick (WebSocket message
   * handlers: buy/equip/eat/prestige) must target the NEXT tick, otherwise the
   * delta condition (dirtyTick === tickNo) would miss them by one tick.
   */
  markDirty(e: { dirtyTick: number }): void {
    e.dirtyTick = this.inTick ? this.tickNo : this.tickNo + 1;
  }

  // ---------- tick ----------

  private inTick = false;

  tick(now: number, dt: number): void {
    this.tickNo++;
    this.time = now;
    this.inTick = true;
    ensureBots(this); // keep the world stocked with filler bots
    updateBots(this, dt, now); // set bot inputs before players are simulated
    updatePlayers(this, dt, now);
    updateMobs(this, dt, now);
    updateBossTimers(this, now);
    updateBosses(this, dt, now);
    updateProjectiles(this, dt, now);
    updateBuildings(this, dt, now);
    updateCoins(this, now);
    this.inTick = false;
  }

  connectedPlayers(): Player[] {
    const res: Player[] = [];
    for (const p of this.players.values()) {
      if (p.ws && p.ws.readyState === WebSocket.OPEN) res.push(p);
    }
    return res;
  }
}

export type { WeaponId };
