// Procedural sound effects via the Web Audio API — no asset files, no licences.
// Everything is synthesised on the fly (retro "io" blips). Audio only starts
// after a user gesture (browser autoplay policy / Yandex rules); it is muted
// while an ad plays and while the tab is hidden.

type OscType = 'sine' | 'square' | 'sawtooth' | 'triangle';

const KEY = 'farmclash-muted';

class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted: boolean;        // user setting
  private adMuted = false;       // an ad is showing
  private blurMuted = false;     // tab hidden / unfocused
  private lastAt: Record<string, number> = {};

  constructor() {
    this.muted = (typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1');
  }

  /** Create/resume the audio context — must be called from a user gesture (Play/first tap). */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext });
      const AC = Ctor.AudioContext || Ctor.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
      } catch { this.ctx = null; return; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  // ---- mute state (user + ad + blur all silence output) ----
  isMuted(): boolean { return this.muted; }
  setMuted(m: boolean): void {
    this.muted = m;
    try { localStorage.setItem(KEY, m ? '1' : '0'); } catch { /* ignore */ }
    if (!m) this.unlock(); // toggling on is itself a gesture
  }
  duckForAd(on: boolean): void { this.adMuted = on; }
  duckForBlur(on: boolean): void { this.blurMuted = on; }

  private active(): boolean { return !!this.ctx && !!this.master && !this.muted && !this.adMuted && !this.blurMuted; }
  private throttle(key: string, ms: number): boolean {
    const now = performance.now();
    if (now - (this.lastAt[key] ?? -1e9) < ms) return false;
    this.lastAt[key] = now;
    return true;
  }

  // ---- low-level synthesis ----
  private env(g: GainNode, t0: number, dur: number, peak: number, attack = 0.005): void {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  private tone(from: number, to: number, dur: number, type: OscType, gain: number, attack = 0.005): void {
    if (!this.active()) return;
    const ctx = this.ctx!, t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    const g = ctx.createGain();
    this.env(g, t0, dur, gain, attack);
    osc.connect(g).connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  private noise(dur: number, gain: number, freq: number, q = 1): void {
    if (!this.active()) return;
    const ctx = this.ctx!, t0 = ctx.currentTime;
    const frames = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t0, dur, gain, 0.002);
    src.connect(bp).connect(g).connect(this.master!);
    src.start(t0);
    src.stop(t0 + dur + 0.03);
  }

  private arp(freqs: number[], step: number, type: OscType, gain: number): void {
    if (!this.active()) return;
    const ctx = this.ctx!;
    freqs.forEach((f, i) => {
      const t0 = ctx.currentTime + i * step;
      const osc = ctx.createOscillator();
      osc.type = type; osc.frequency.setValueAtTime(f, t0);
      const g = ctx.createGain();
      this.env(g, t0, step * 1.7, gain, 0.004);
      osc.connect(g).connect(this.master!);
      osc.start(t0); osc.stop(t0 + step * 1.7 + 0.03);
    });
  }

  // ---- game events ----
  swing(): void { if (this.throttle('swing', 55)) this.tone(520, 170, 0.12, 'sawtooth', 0.16); }
  hit(): void { if (this.throttle('hit', 45)) { this.noise(0.08, 0.22, 1300, 1.2); this.tone(180, 90, 0.08, 'square', 0.1); } }
  mobDie(): void { if (this.throttle('mobdie', 45)) { this.noise(0.2, 0.2, 520, 0.8); this.tone(300, 70, 0.2, 'sawtooth', 0.1); } }
  coin(): void { if (this.throttle('coin', 45)) this.tone(880, 1320, 0.09, 'square', 0.12); }
  heal(): void { this.tone(520, 800, 0.18, 'sine', 0.16); }
  level(): void { this.arp([523, 659, 784, 1047], 0.09, 'triangle', 0.18); }
  reward(): void { this.arp([659, 988, 1319], 0.08, 'square', 0.15); }
  boss(): void { this.tone(120, 68, 0.7, 'sawtooth', 0.28); }
  death(): void { this.tone(420, 60, 0.6, 'sawtooth', 0.24); }
  click(): void { if (this.throttle('click', 40)) this.tone(660, 660, 0.03, 'square', 0.07); }
}

export const audio = new AudioManager();
