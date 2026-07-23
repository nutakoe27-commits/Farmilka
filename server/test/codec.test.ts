import { describe, it, expect } from 'vitest';
import { encodeSnapshot, decodeSnapshot } from '@shared/snapshot-codec.js';
import { encode } from '@shared/protocol.js';
import type { SnapshotMsg } from '@shared/protocol.js';

// f32 coords + i16 angle are intentionally lossy; compare numbers with a small
// tolerance and everything else exactly.
function approx(a: unknown, b: unknown, path = ''): void {
  if (typeof a === 'number' && typeof b === 'number') {
    expect(Math.abs(a - b), `${path}: ${a} vs ${b}`).toBeLessThan(0.02);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    expect(a.length, `${path}.length`).toBe(b.length);
    a.forEach((v, i) => approx(v, b[i], `${path}[${i}]`));
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    expect(ka, `${path} keys`).toEqual(kb);
    for (const k of ka) approx((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    return;
  }
  expect(a, path).toEqual(b);
}

const snap: SnapshotMsg = {
  t: 'snapshot',
  tick: 123456,
  time: 1_700_000_000_123,
  lastSeq: 999,
  add: [
    { id: 'p1_2', kind: 'player', x: 1234.5, y: 678, angle: 1.2345, radius: 24, hp: 130, maxHp: 190, name: 'Игрок', weapon: 'ice_staff', hat: 'golden_crown', prestige: 7, fx: 3, prot: true },
    { id: 'p1_9', kind: 'player', x: 10, y: 20.5, angle: -3.1415, radius: 24, hp: 50, maxHp: 100, name: 'Guest', weapon: 'fists', hat: null, prestige: 0, fx: 0 },
    { id: 'm1_3', kind: 'mob', x: 800, y: 900.5, angle: 0.5, radius: 20, hp: 40, maxHp: 70, mobType: 'wolf', fx: 1 },
    { id: 'b1_1', kind: 'boss', x: 3500, y: 3500, angle: 0, radius: 66, hp: 8000, maxHp: 9000, bossType: 'crystal_queen' },
    { id: 'bd1_4', kind: 'building', x: 500, y: 500, angle: 0, radius: 40, hp: 150, maxHp: 200, buildingType: 'turret', owner: 'p1_2', name: 'Игрок' },
    { id: 'c1_5', kind: 'coin', x: 111, y: 222.5, angle: 0, radius: 12, value: 450 },
    { id: 'f1_6', kind: 'food', x: 333, y: 444, angle: 0, radius: 14 },
    { id: 'pr1_7', kind: 'projectile', x: 600, y: 600, angle: 2.5, radius: 8, owner: 'p1_2', name: 'ice_staff' },
  ],
  upd: [
    { id: 'm1_3', x: 810, y: 905, angle: 0.75 },
    { id: 'p1_2', x: 1240, y: 680, angle: 1.5, hp: 120, prot: true, weapon: 'sword' },
    { id: 'p1_9', x: 12, y: 22, angle: -3, maxHp: 110, hat: null, prot: false },
    { id: 'p1_9', x: 12, y: 22, angle: -3, prestige: 2, fx: 2, hat: 'chef_hat' },
  ],
  rem: ['c1_5', 'f1_6'],
  self: {
    x: 1240, y: 680, hp: 120, maxHp: 190, money: 1_250_000,
    weapons: ['fists', 'sword', 'ice_staff'], equipped: 'ice_staff',
    buildings: 3, hats: ['cap', 'golden_crown', 'chef_hat'], hat: 'golden_crown',
    prestige: 7, prestigeCost: 34567, level: 10, levelKills: 12,
    food: 42, foodIn: 0, protIn: 2.5, chill: 0.65, respawnIn: 3.4,
  },
};

describe('snapshot binary codec', () => {
  it('round-trips a full snapshot', () => {
    approx(decodeSnapshot(encodeSnapshot(snap)), snap, 'snap');
  });

  it('round-trips without respawnIn', () => {
    const s2 = { ...snap, self: { ...snap.self } };
    delete s2.self.respawnIn;
    approx(decodeSnapshot(encodeSnapshot(s2)), s2, 'snap');
  });

  it('is much smaller than JSON', () => {
    const bin = encodeSnapshot(snap).length;
    const json = Buffer.byteLength(encode(snap));
    expect(bin).toBeLessThan(json * 0.6);
  });
});
