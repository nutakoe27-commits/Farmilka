// Compact binary codec for the snapshot message — by far the highest-volume
// packet (sent to every player every tick). Everything else stays JSON. Shared
// by server and client so the wire format has a single source of truth.
//
// Only the snapshot is binary; the client tells frames apart by type
// (ArrayBuffer = snapshot, string = JSON).
import type { SnapshotMsg, EntityState, EntityDelta, SelfState } from './protocol.js';
import type { EntityKind, WeaponId, MobId, BossId, BuildingId } from './types.js';

const KINDS: EntityKind[] = ['player', 'mob', 'boss', 'building', 'coin', 'food', 'projectile'];
const ANG = 10000; // angle fixed-point scale (radian precision ~1e-4, fits i16)

const TE = new TextEncoder();
const TD = new TextDecoder();

class Writer {
  private buf = new Uint8Array(2048);
  private view = new DataView(this.buf.buffer);
  private off = 0;
  private ensure(n: number): void {
    if (this.off + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.off + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf);
    this.buf = nb;
    this.view = new DataView(this.buf.buffer);
  }
  u8(v: number): void { this.ensure(1); this.view.setUint8(this.off, v & 0xff); this.off += 1; }
  u16(v: number): void { this.ensure(2); this.view.setUint16(this.off, v & 0xffff); this.off += 2; }
  u32(v: number): void { this.ensure(4); this.view.setUint32(this.off, v >>> 0); this.off += 4; }
  i16(v: number): void { this.ensure(2); this.view.setInt16(this.off, Math.max(-32768, Math.min(32767, v))); this.off += 2; }
  f32(v: number): void { this.ensure(4); this.view.setFloat32(this.off, v); this.off += 4; }
  f64(v: number): void { this.ensure(8); this.view.setFloat64(this.off, v); this.off += 8; }
  ang(rad: number): void { this.i16(Math.round(rad * ANG)); }
  str(s: string | null | undefined): void {
    const bytes = TE.encode(s ?? '');
    this.u8(Math.min(255, bytes.length));
    this.ensure(bytes.length);
    this.buf.set(bytes.subarray(0, 255), this.off);
    this.off += Math.min(255, bytes.length);
  }
  bytes(): Uint8Array { return this.buf.subarray(0, this.off); }
}

class Reader {
  private view: DataView;
  private off = 0;
  constructor(private buf: Uint8Array) { this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); }
  u8(): number { const v = this.view.getUint8(this.off); this.off += 1; return v; }
  u16(): number { const v = this.view.getUint16(this.off); this.off += 2; return v; }
  u32(): number { const v = this.view.getUint32(this.off); this.off += 4; return v; }
  i16(): number { const v = this.view.getInt16(this.off); this.off += 2; return v; }
  f32(): number { const v = this.view.getFloat32(this.off); this.off += 4; return v; }
  f64(): number { const v = this.view.getFloat64(this.off); this.off += 8; return v; }
  ang(): number { return this.i16() / ANG; }
  str(): string { const n = this.u8(); const s = TD.decode(this.buf.subarray(this.off, this.off + n)); this.off += n; return s; }
}

function writeEntity(w: Writer, e: EntityState): void {
  w.u8(KINDS.indexOf(e.kind));
  w.str(e.id);
  w.f32(e.x);
  w.f32(e.y);
  w.ang(e.angle);
  w.u8(e.radius);
  switch (e.kind) {
    case 'player':
      w.u16(e.hp ?? 0); w.u16(e.maxHp ?? 0);
      w.str(e.name); w.str(e.weapon); w.str(e.hat ?? '');
      w.u8(e.prestige ?? 0); w.u8(e.fx ?? 0); w.u8(e.prot ? 1 : 0);
      break;
    case 'mob':
      w.u16(e.hp ?? 0); w.u16(e.maxHp ?? 0); w.str(e.mobType); w.u8(e.fx ?? 0);
      break;
    case 'boss':
      w.u16(e.hp ?? 0); w.u16(e.maxHp ?? 0); w.str(e.bossType);
      break;
    case 'building':
      w.u16(e.hp ?? 0); w.u16(e.maxHp ?? 0); w.str(e.buildingType); w.str(e.owner); w.str(e.name);
      break;
    case 'coin':
      w.u16(e.value ?? 0);
      break;
    case 'food':
      break;
    case 'projectile':
      w.str(e.owner); w.str(e.name);
      break;
  }
}

function readEntity(r: Reader): EntityState {
  const kind = KINDS[r.u8()];
  const e: EntityState = { id: r.str(), kind, x: r.f32(), y: r.f32(), angle: r.ang(), radius: r.u8() };
  switch (kind) {
    case 'player':
      e.hp = r.u16(); e.maxHp = r.u16();
      e.name = r.str(); e.weapon = r.str() as WeaponId;
      { const h = r.str(); e.hat = h || null; }
      e.prestige = r.u8(); e.fx = r.u8();
      if (r.u8()) e.prot = true;
      break;
    case 'mob':
      e.hp = r.u16(); e.maxHp = r.u16(); e.mobType = r.str() as MobId; e.fx = r.u8();
      break;
    case 'boss':
      e.hp = r.u16(); e.maxHp = r.u16(); e.bossType = r.str() as BossId;
      break;
    case 'building':
      e.hp = r.u16(); e.maxHp = r.u16(); e.buildingType = r.str() as BuildingId; e.owner = r.str(); e.name = r.str();
      break;
    case 'coin':
      e.value = r.u16();
      break;
    case 'food':
      break;
    case 'projectile':
      e.owner = r.str(); e.name = r.str();
      break;
  }
  return e;
}

// delta flag bits
const D_HP = 1, D_MAXHP = 2, D_WEAPON = 4, D_PROT_SET = 8, D_PROT_VAL = 16, D_HAT = 32, D_PRESTIGE = 64, D_FX = 128;

function writeDelta(w: Writer, d: EntityDelta): void {
  w.str(d.id);
  w.f32(d.x);
  w.f32(d.y);
  w.ang(d.angle ?? 0);
  let flags = 0;
  if (d.hp !== undefined) flags |= D_HP;
  if (d.maxHp !== undefined) flags |= D_MAXHP;
  if (d.weapon !== undefined) flags |= D_WEAPON;
  if (d.prot !== undefined) { flags |= D_PROT_SET; if (d.prot) flags |= D_PROT_VAL; }
  if (d.hat !== undefined) flags |= D_HAT;
  if (d.prestige !== undefined) flags |= D_PRESTIGE;
  if (d.fx !== undefined) flags |= D_FX;
  w.u8(flags);
  if (flags & D_HP) w.u16(d.hp!);
  if (flags & D_MAXHP) w.u16(d.maxHp!);
  if (flags & D_WEAPON) w.str(d.weapon);
  if (flags & D_HAT) w.str(d.hat ?? '');
  if (flags & D_PRESTIGE) w.u8(d.prestige!);
  if (flags & D_FX) w.u8(d.fx!);
}

function readDelta(r: Reader): EntityDelta {
  const d: EntityDelta = { id: r.str(), x: r.f32(), y: r.f32(), angle: r.ang() };
  const flags = r.u8();
  if (flags & D_HP) d.hp = r.u16();
  if (flags & D_MAXHP) d.maxHp = r.u16();
  if (flags & D_WEAPON) d.weapon = r.str() as WeaponId;
  if (flags & D_PROT_SET) d.prot = (flags & D_PROT_VAL) !== 0;
  if (flags & D_HAT) { const h = r.str(); d.hat = h || null; }
  if (flags & D_PRESTIGE) d.prestige = r.u8();
  if (flags & D_FX) d.fx = r.u8();
  return d;
}

function writeSelf(w: Writer, s: SelfState): void {
  w.f32(s.x); w.f32(s.y);
  w.u16(s.hp); w.u16(s.maxHp);
  w.u32(s.money);
  w.str(s.equipped);
  w.u8(s.weapons.length); for (const wp of s.weapons) w.str(wp);
  w.u16(s.buildings);
  w.u8(s.hats.length); for (const h of s.hats) w.str(h);
  w.str(s.hat ?? '');
  w.u8(s.prestige); w.u32(s.prestigeCost);
  w.u8(s.level); w.u32(s.levelKills);
  w.u16(s.food);
  w.f32(s.foodIn); w.f32(s.protIn); w.f32(s.chill);
  if (s.respawnIn !== undefined) { w.u8(1); w.f32(s.respawnIn); } else { w.u8(0); }
}

function readSelf(r: Reader): SelfState {
  const s: SelfState = {
    x: r.f32(), y: r.f32(), hp: r.u16(), maxHp: r.u16(), money: r.u32(),
    equipped: r.str() as WeaponId,
    weapons: [], buildings: 0, hats: [], hat: null,
    prestige: 0, prestigeCost: 0, level: 0, levelKills: 0,
    food: 0, foodIn: 0, protIn: 0, chill: 1,
  };
  const wn = r.u8(); for (let i = 0; i < wn; i++) s.weapons.push(r.str() as WeaponId);
  s.buildings = r.u16();
  const hn = r.u8(); for (let i = 0; i < hn; i++) s.hats.push(r.str());
  { const h = r.str(); s.hat = h || null; }
  s.prestige = r.u8(); s.prestigeCost = r.u32();
  s.level = r.u8(); s.levelKills = r.u32();
  s.food = r.u16();
  s.foodIn = r.f32(); s.protIn = r.f32(); s.chill = r.f32();
  if (r.u8()) s.respawnIn = r.f32();
  return s;
}

export function encodeSnapshot(m: SnapshotMsg): Uint8Array {
  const w = new Writer();
  w.u32(m.tick);
  w.f64(m.time);
  w.u32(m.lastSeq);
  w.u16(m.add.length); for (const e of m.add) writeEntity(w, e);
  w.u16(m.upd.length); for (const d of m.upd) writeDelta(w, d);
  w.u16(m.rem.length); for (const id of m.rem) w.str(id);
  writeSelf(w, m.self);
  return w.bytes();
}

export function decodeSnapshot(data: ArrayBuffer | Uint8Array): SnapshotMsg {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const r = new Reader(buf);
  const tick = r.u32();
  const time = r.f64();
  const lastSeq = r.u32();
  const add: EntityState[] = []; let n = r.u16(); for (let i = 0; i < n; i++) add.push(readEntity(r));
  const upd: EntityDelta[] = []; n = r.u16(); for (let i = 0; i < n; i++) upd.push(readDelta(r));
  const rem: string[] = []; n = r.u16(); for (let i = 0; i < n; i++) rem.push(r.str());
  const self = readSelf(r);
  return { t: 'snapshot', tick, time, lastSeq, add, upd, rem, self };
}
