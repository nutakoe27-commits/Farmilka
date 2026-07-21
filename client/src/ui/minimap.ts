import { biomeRect, type BiomeId } from '@shared/biomes.js';
import type { Remote } from '../net/connection.js';

interface Ping {
  x: number;
  y: number;
  until: number;
}

const MINI_BIOME_COLORS: Record<BiomeId, string> = {
  normal: '#1d2b1f',
  snow: '#26324a',
  desert: '#3a2e18',
  mystic_west: '#2c1b3e',
  mystic_east: '#16383c',
};

export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private size = 160;
  private pings: Ping[] = [];

  constructor(private worldSize: number) {
    const canvas = document.getElementById('minimap') as HTMLCanvasElement;
    this.ctx = canvas.getContext('2d')!;
  }

  ping(x: number, y: number, ms: number): void {
    this.pings.push({ x, y, until: performance.now() + ms });
  }

  draw(selfX: number, selfY: number, selfId: string, entities: Map<string, Remote>): void {
    const ctx = this.ctx;
    const k = this.size / this.worldSize;
    ctx.clearRect(0, 0, this.size, this.size);

    // biome map
    for (const b of ['mystic_west', 'mystic_east', 'snow', 'normal', 'desert'] as BiomeId[]) {
      const r = biomeRect(b, this.worldSize);
      ctx.fillStyle = MINI_BIOME_COLORS[b];
      ctx.fillRect(r.x0 * k, r.y0 * k, (r.x1 - r.x0) * k, (r.y1 - r.y0) * k);
    }

    for (const r of entities.values()) {
      const s = r.state;
      if (s.id === selfId) continue;
      let color: string | null = null;
      let size = 2;
      if (s.kind === 'player') color = '#ff7b72';
      else if (s.kind === 'building') { color = '#9ecbff'; size = 3; }
      else if (s.kind === 'boss') { color = '#f0c8ff'; size = 5; }
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(s.x * k - size / 2, s.y * k - size / 2, size, size);
    }

    // boss pings (pulsing)
    const now = performance.now();
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      if (now > p.until) {
        this.pings.splice(i, 1);
        continue;
      }
      const pulse = 3 + Math.sin(now / 150) * 2;
      ctx.beginPath();
      ctx.arc(p.x * k, p.y * k, pulse, 0, Math.PI * 2);
      ctx.strokeStyle = '#f0c8ff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // self
    ctx.beginPath();
    ctx.arc(selfX * k, selfY * k, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
}
