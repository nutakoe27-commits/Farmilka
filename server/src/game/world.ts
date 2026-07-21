import { WebSocket } from 'ws';
import { encode, type GameEvent, type ServerMsg } from '@shared/protocol.js';
import type { MobId, WeaponId } from '@shared/types.js';
import { clamp, dist } from '@shared/math.js';
import { getBalance } from './balance.js';
import { SpatialGrid } from './grid.js';
import type { Entity, Player, Mob, Boss, Projectile, Coin, Building } from './entities.js';
import { updatePlayers } from './player.js';
import { updateMobs, populateMobs } from './mobs.js';
import { updateBoss, updateBossTimer } from './boss.js';
import { updateBuildings } from './buildings.js';
import { updateCoins } from './economy.js';
import { updateProjectiles } from './combat.js';

export class World {
  tickNo = 0;
  time = Date.now();

  entities = new Map<string, Entity>();
  players = new Map<string, Player>();
  mobs = new Map<string, Mob>();
  projectiles = new Map<string, Projectile>();
  coins = new Map<string, Coin>();
  buildings = new Map<string, Building>();
  boss: Boss | null = null;

  grid: SpatialGrid<Entity>;
  mobRespawnQueue: { mobType: MobId; at: number }[] = [];

  bossNextSpawnAt: number;
  bossWarned = false;
  bossSpawnPos = { x: 0, y: 0 };

  private nextId = 1;

  constructor() {
    const bal = getBalance();
    this.grid = new SpatialGrid<Entity>(bal.world.size, 200);
    this.bossNextSpawnAt = Date.now() + bal.boss.spawnIntervalSec * 1000;
    populateMobs(this);
  }

  id(prefix: string): string {
    return `${prefix}${this.nextId++}`;
  }

  get center(): number {
    return getBalance().world.size / 2;
  }

  inSafeZone(x: number, y: number): boolean {
    const c = this.center;
    return dist(x, y, c, c) <= getBalance().world.safeZoneRadius;
  }

  addEntity(e: Entity): void {
    this.entities.set(e.id, e);
    this.grid.insert(e);
    switch (e.kind) {
      case 'player': this.players.set(e.id, e); break;
      case 'mob': this.mobs.set(e.id, e); break;
      case 'projectile': this.projectiles.set(e.id, e); break;
      case 'coin': this.coins.set(e.id, e); break;
      case 'building': this.buildings.set(e.id, e); break;
      case 'boss': this.boss = e; break;
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
      case 'building': this.buildings.delete(e.id); break;
      case 'boss': if (this.boss === e) this.boss = null; break;
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

  spawnPlayer(name: string, ws: WebSocket): Player {
    const bal = getBalance();
    const c = this.center;
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * bal.world.safeZoneRadius * 0.6;
    const p: Player = {
      id: this.id('p'),
      kind: 'player',
      x: c + Math.cos(a) * r,
      y: c + Math.sin(a) * r,
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
      money: bal.player.startMoney,
      weapons: ['fists'],
      equipped: 'fists',
      attackReadyAt: 0,
      lastDamagedAt: 0,
      lastBossContactAt: 0,
      respawnAt: 0,
      buildingIds: new Set(),
      known: new Set(),
      session: { joinedAt: Date.now(), kills: 0, deaths: 0, moneyEarned: 0 },
    };
    this.addEntity(p);
    return p;
  }

  respawnPlayer(p: Player): void {
    const bal = getBalance();
    const c = this.center;
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * bal.world.safeZoneRadius * 0.6;
    p.x = c + Math.cos(a) * r;
    p.y = c + Math.sin(a) * r;
    p.hp = bal.player.hp;
    p.maxHp = bal.player.hp;
    p.dead = false;
    p.respawnAt = 0;
    p.equipped = p.weapons.includes(p.equipped) ? p.equipped : 'fists';
    p.movedTick = this.tickNo;
    p.dirtyTick = this.tickNo;
    this.addEntity(p);
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
    };
    this.addEntity(proj);
    return proj;
  }

  // ---------- tick ----------

  tick(now: number, dt: number): void {
    this.tickNo++;
    this.time = now;
    updatePlayers(this, dt, now);
    updateMobs(this, dt, now);
    updateBossTimer(this, now);
    updateBoss(this, dt, now);
    updateProjectiles(this, dt, now);
    updateBuildings(this, dt, now);
    updateCoins(this, now);
  }

  connectedPlayers(): Player[] {
    const res: Player[] = [];
    for (const p of this.players.values()) {
      if (p.ws && p.ws.readyState === WebSocket.OPEN) res.push(p);
    }
    return res;
  }

  /** Fully forgets a player once nothing in the world references them. */
  maybeForgetPlayer(p: Player): void {
    if (!p.ws && p.buildingIds.size === 0) this.players.delete(p.id);
  }
}

export type { WeaponId };
