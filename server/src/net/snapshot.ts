import type { EntityState, EntityDelta, SnapshotMsg, SelfState } from '@shared/protocol.js';
import { getBalance } from '../game/balance.js';
import type { World } from '../game/world.js';
import type { Entity, Player } from '../game/entities.js';
import { nextPrestigeCost } from '../game/prestige.js';

function statusFx(e: { poisonUntil: number; chillUntil: number }): number {
  const now = Date.now();
  return (e.poisonUntil > now ? 1 : 0) | (e.chillUntil > now ? 2 : 0);
}

function fullState(e: Entity): EntityState {
  const s: EntityState = {
    id: e.id,
    kind: e.kind,
    x: Math.round(e.x * 10) / 10,
    y: Math.round(e.y * 10) / 10,
    angle: Math.round(e.angle * 100) / 100,
    radius: e.radius,
  };
  switch (e.kind) {
    case 'player':
      s.hp = Math.round(e.hp);
      s.maxHp = e.maxHp;
      s.name = e.name;
      s.weapon = e.equipped;
      s.hat = e.hat;
      s.prestige = e.prestige;
      s.fx = statusFx(e);
      if (e.invulnUntil > Date.now()) s.prot = true;
      break;
    case 'mob':
      s.hp = Math.round(e.hp);
      s.maxHp = e.maxHp;
      s.mobType = e.mobType;
      s.fx = statusFx(e);
      break;
    case 'boss':
      s.hp = Math.round(e.hp);
      s.maxHp = e.maxHp;
      s.bossType = e.bossType;
      break;
    case 'building':
      s.hp = Math.round(e.hp);
      s.maxHp = e.maxHp;
      s.buildingType = e.buildingType;
      s.owner = e.ownerId;
      s.name = e.ownerName;
      break;
    case 'coin':
      s.value = e.value;
      break;
    case 'food':
      break;
    case 'projectile':
      s.owner = e.ownerId;
      s.name = e.weapon;
      break;
  }
  return s;
}

export function buildSnapshot(world: World, p: Player): SnapshotMsg {
  const bal = getBalance();
  const visible = world.grid.queryCircle(p.x, p.y, bal.world.viewRadius);
  const visibleIds = new Set<string>();
  const add: EntityState[] = [];
  const upd: EntityDelta[] = [];

  for (const e of visible) {
    visibleIds.add(e.id);
    if (!p.known.has(e.id)) {
      add.push(fullState(e));
      p.known.add(e.id);
    } else if (e.movedTick === world.tickNo || e.dirtyTick === world.tickNo) {
      const d: EntityDelta = {
        id: e.id,
        x: Math.round(e.x * 10) / 10,
        y: Math.round(e.y * 10) / 10,
        angle: Math.round(e.angle * 100) / 100,
      };
      if (e.dirtyTick === world.tickNo) {
        d.hp = Math.round(e.hp);
        if (e.kind === 'player') {
          d.maxHp = e.maxHp; // changes with level / hat — keep the over-head bar in sync
          d.weapon = e.equipped;
          d.prot = e.invulnUntil > world.time;
          d.hat = e.hat;
          d.prestige = e.prestige;
          d.fx = statusFx(e);
        } else if (e.kind === 'mob') {
          d.fx = statusFx(e);
        }
      }
      upd.push(d);
    }
  }

  const rem: string[] = [];
  for (const id of p.known) {
    if (!visibleIds.has(id)) {
      rem.push(id);
      p.known.delete(id);
    }
  }

  const self: SelfState = {
    x: Math.round(p.x * 10) / 10,
    y: Math.round(p.y * 10) / 10,
    hp: Math.round(p.hp),
    maxHp: p.maxHp,
    money: p.money,
    weapons: p.weapons,
    equipped: p.equipped,
    buildings: p.buildingIds.size,
    hats: p.hats,
    hat: p.hat,
    prestige: p.prestige,
    prestigeCost: nextPrestigeCost(p),
    level: p.level,
    levelKills: p.levelKills,
    food: p.food,
    foodIn: Math.max(0, Math.round((p.foodReadyAt - world.time) / 100) / 10),
    protIn: Math.max(0, Math.round((p.invulnUntil - world.time) / 100) / 10),
    chill: p.chillUntil > world.time ? p.chillFactor : 1,
  };
  if (p.dead && p.respawnAt) {
    self.respawnIn = Math.max(0, (p.respawnAt - world.time) / 1000);
  }

  return {
    t: 'snapshot',
    tick: world.tickNo,
    time: world.time,
    lastSeq: p.input.seq,
    add,
    upd,
    rem,
    self,
  };
}
