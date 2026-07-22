import { getBalance } from './balance.js';
import { World } from './world.js';

/** How long a world may sit empty (above the minimum) before it is torn down. */
const REAP_GRACE_MS = Number(process.env.REAP_GRACE_MS) || 20_000;

/**
 * Owns the live set of game worlds and grows/shrinks it with demand.
 *
 * Worlds live in fixed slots so their server ids stay small and stable
 * (1..maxServers). The first `servers` slots are always-on; slots above that
 * are spawned when players need room and reaped once they sit empty. Players
 * are packed into low-index worlds so higher ones can empty out and be reaped.
 */
export class WorldManager {
  private slots: (World | null)[] = [];
  private emptySince = new Map<number, number>();

  constructor() {
    for (let i = 0; i < this.minServers; i++) this.slots[i] = new World(i + 1);
  }

  private get minServers(): number {
    return Math.max(1, Math.floor(getBalance().world.servers));
  }
  private get maxServers(): number {
    return Math.max(this.minServers, Math.floor(getBalance().world.maxServers));
  }
  private get capacity(): number {
    return getBalance().world.maxPlayers;
  }

  /** Currently-active worlds — for the tick loop, admin and cross-world checks. */
  active(): World[] {
    return this.slots.filter((w): w is World => w !== null);
  }

  /** World for a 1-based server id, or undefined if that slot is empty. */
  get(serverId: number): World | undefined {
    return this.slots[serverId - 1] ?? undefined;
  }

  hasRoom(w: World): boolean {
    return w.connectedPlayers().length < this.capacity;
  }

  /**
   * Picks a world for a joining player: the lowest-index active world with a
   * free slot, or a freshly-spawned world (up to maxServers). Returns null only
   * when every world is full and the cap is reached.
   */
  assign(): World | null {
    for (const w of this.slots) {
      if (w && this.hasRoom(w)) return w;
    }
    const max = this.maxServers;
    for (let i = 0; i < max; i++) {
      if (!this.slots[i]) {
        const w = new World(i + 1);
        this.slots[i] = w;
        console.log(`[worlds] spawned server ${w.serverId} (${this.active().length}/${max} active)`);
        return w;
      }
    }
    return null;
  }

  /** True when even a fresh world cannot be created and all worlds are full. */
  atHardCap(): boolean {
    if (this.active().length < this.maxServers) return false;
    return this.active().every((w) => !this.hasRoom(w));
  }

  /** Tears down worlds that have stayed empty past the grace period (above min). */
  reap(now: number): void {
    const min = this.minServers;
    for (let i = min; i < this.slots.length; i++) {
      const w = this.slots[i];
      if (!w) continue;
      if (w.connectedPlayers().length > 0) {
        this.emptySince.delete(w.serverId);
        continue;
      }
      const since = this.emptySince.get(w.serverId);
      if (since === undefined) {
        this.emptySince.set(w.serverId, now);
      } else if (now - since >= REAP_GRACE_MS) {
        this.slots[i] = null;
        this.emptySince.delete(w.serverId);
        console.log(`[worlds] reaped empty server ${w.serverId} (${this.active().length} active)`);
      }
    }
  }

  /** Public list for the client server picker / welcome message. */
  list(): { id: number; online: number; max: number }[] {
    const cap = this.capacity;
    return this.active().map((w) => ({ id: w.serverId, online: w.connectedPlayers().length, max: cap }));
  }
}
