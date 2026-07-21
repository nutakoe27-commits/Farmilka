import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SpatialGrid } from '../src/game/grid.js';
import { validateBalance } from '@shared/balance-schema.js';
import { angleDiff } from '@shared/math.js';
import type { BaseEntity } from '../src/game/entities.js';

const balanceFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../balance/balance.json');

function makeEntity(id: string, x: number, y: number): BaseEntity {
  return { id, kind: 'mob', x, y, angle: 0, radius: 10, hp: 10, maxHp: 10, dead: false, cell: -1, movedTick: 0, dirtyTick: 0 };
}

describe('SpatialGrid', () => {
  it('finds entities within radius and not outside', () => {
    const grid = new SpatialGrid<BaseEntity>(4000, 200);
    const a = makeEntity('a', 100, 100);
    const b = makeEntity('b', 350, 100);
    const c = makeEntity('c', 2000, 2000);
    grid.insert(a);
    grid.insert(b);
    grid.insert(c);
    const near = grid.queryCircle(100, 100, 300);
    expect(near.map((e) => e.id).sort()).toEqual(['a', 'b']);
    expect(grid.queryCircle(100, 100, 50).map((e) => e.id)).toEqual(['a']);
  });

  it('rehashes on move', () => {
    const grid = new SpatialGrid<BaseEntity>(4000, 200);
    const a = makeEntity('a', 100, 100);
    grid.insert(a);
    a.x = 3900;
    a.y = 3900;
    grid.move(a);
    expect(grid.queryCircle(100, 100, 300)).toHaveLength(0);
    expect(grid.queryCircle(3900, 3900, 50).map((e) => e.id)).toEqual(['a']);
  });

  it('remove takes the entity out of queries', () => {
    const grid = new SpatialGrid<BaseEntity>(4000, 200);
    const a = makeEntity('a', 100, 100);
    grid.insert(a);
    grid.remove(a);
    expect(grid.queryCircle(100, 100, 500)).toHaveLength(0);
  });
});

describe('balance.json', () => {
  it('current balance file passes validation', () => {
    const raw = JSON.parse(fs.readFileSync(balanceFile, 'utf-8'));
    expect(() => validateBalance(raw)).not.toThrow();
  });

  it('rejects broken configs with a readable message', () => {
    const raw = JSON.parse(fs.readFileSync(balanceFile, 'utf-8'));
    raw.weapons.sword.damage = 'oops';
    expect(() => validateBalance(raw)).toThrow(/weapons\.sword\.damage/);
  });

  it('rejects missing sections', () => {
    expect(() => validateBalance({})).toThrow(/world/);
  });
});

describe('boss reward split', () => {
  // mirrors the proportional split in onBossKilled
  function split(reward: number, minDmg: number, ledger: Record<string, number>): Record<string, number> {
    const eligible = Object.entries(ledger).filter(([, d]) => d >= minDmg);
    const total = eligible.reduce((s, [, d]) => s + d, 0);
    const out: Record<string, number> = {};
    for (const [name, d] of eligible) out[name] = Math.round((reward * d) / total);
    return out;
  }

  it('splits proportionally to damage', () => {
    const res = split(3000, 100, { alice: 3000, bob: 1000 });
    expect(res.alice).toBe(2250);
    expect(res.bob).toBe(750);
  });

  it('excludes players below the participation threshold', () => {
    const res = split(3000, 100, { alice: 500, lurker: 50 });
    expect(res.lurker).toBeUndefined();
    expect(res.alice).toBe(3000);
  });
});

describe('angleDiff', () => {
  it('wraps across PI boundary', () => {
    expect(Math.abs(angleDiff(Math.PI - 0.1, -Math.PI + 0.1))).toBeCloseTo(0.2, 5);
    expect(angleDiff(0.5, 0.2)).toBeCloseTo(0.3, 5);
  });
});
