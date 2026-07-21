import type { BaseEntity } from './entities.js';

/**
 * Uniform spatial hash over the square world. Entities keep their cell index
 * in `entity.cell`; move() only rehashes when the cell actually changes.
 */
export class SpatialGrid<T extends BaseEntity> {
  private cells: Map<number, Set<T>> = new Map();
  private cols: number;

  constructor(private worldSize: number, private cellSize: number) {
    this.cols = Math.ceil(worldSize / cellSize) + 1;
  }

  private key(x: number, y: number): number {
    const cx = Math.max(0, Math.min(this.cols - 1, Math.floor(x / this.cellSize)));
    const cy = Math.max(0, Math.min(this.cols - 1, Math.floor(y / this.cellSize)));
    return cy * this.cols + cx;
  }

  insert(e: T): void {
    const k = this.key(e.x, e.y);
    e.cell = k;
    let set = this.cells.get(k);
    if (!set) {
      set = new Set();
      this.cells.set(k, set);
    }
    set.add(e);
  }

  remove(e: T): void {
    if (e.cell < 0) return;
    const set = this.cells.get(e.cell);
    if (set) {
      set.delete(e);
      if (set.size === 0) this.cells.delete(e.cell);
    }
    e.cell = -1;
  }

  /** Call after changing e.x/e.y. */
  move(e: T): void {
    const k = this.key(e.x, e.y);
    if (k === e.cell) return;
    this.remove(e);
    e.cell = k;
    let set = this.cells.get(k);
    if (!set) {
      set = new Set();
      this.cells.set(k, set);
    }
    set.add(e);
  }

  /** All entities whose center lies within `r` of (x, y). */
  queryCircle(x: number, y: number, r: number, out?: T[]): T[] {
    const res = out ?? [];
    const minCx = Math.max(0, Math.floor((x - r) / this.cellSize));
    const maxCx = Math.min(this.cols - 1, Math.floor((x + r) / this.cellSize));
    const minCy = Math.max(0, Math.floor((y - r) / this.cellSize));
    const maxCy = Math.min(this.cols - 1, Math.floor((y + r) / this.cellSize));
    const r2 = r * r;
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const set = this.cells.get(cy * this.cols + cx);
        if (!set) continue;
        for (const e of set) {
          const dx = e.x - x;
          const dy = e.y - y;
          if (dx * dx + dy * dy <= r2) res.push(e);
        }
      }
    }
    return res;
  }
}
