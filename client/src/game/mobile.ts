/**
 * Touch controls, Brawl-Stars style:
 *  - left joystick: movement
 *  - big attack button (bottom-right): tap = one attack at the nearest enemy
 *    (auto-aim), hold & drag = manual aim + continuous fire
 *  - side buttons: eat food, open shop
 */
export interface TouchState {
  moveX: number;
  moveY: number;
  firing: boolean;
  /** manual aim angle when dragging the attack button, null = use auto-aim */
  manualAim: number | null;
}

export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

const STICK_RANGE = 45;
const DRAG_THRESHOLD = 22;
const TAP_MS = 220;

class Joystick {
  active = false;
  dx = 0;
  dy = 0;
  private touchId: number | null = null;
  private baseEl: HTMLElement;

  constructor(zoneId: string, baseId: string, stickId: string) {
    const zone = document.getElementById(zoneId)!;
    const base = document.getElementById(baseId)!;
    this.baseEl = base;
    const stick = document.getElementById(stickId)!;
    let baseX = 0;
    let baseY = 0;

    zone.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      if (this.touchId !== null) return;
      e.preventDefault();
      this.touchId = t.identifier;
      this.active = true;
      baseX = t.clientX;
      baseY = t.clientY;
      const zr = zone.getBoundingClientRect();
      base.style.display = 'block';
      base.style.left = `${baseX - zr.left - 55}px`;
      base.style.top = `${baseY - zr.top - 55}px`;
      stick.style.left = '29px';
      stick.style.top = '29px';
    }, { passive: false });

    const move = (e: TouchEvent): void => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== this.touchId) continue;
        e.preventDefault();
        let dx = t.clientX - baseX;
        let dy = t.clientY - baseY;
        const len = Math.hypot(dx, dy);
        if (len > STICK_RANGE) {
          dx = (dx / len) * STICK_RANGE;
          dy = (dy / len) * STICK_RANGE;
        }
        this.dx = dx / STICK_RANGE;
        this.dy = dy / STICK_RANGE;
        stick.style.left = `${29 + dx}px`;
        stick.style.top = `${29 + dy}px`;
      }
    };
    const end = (e: TouchEvent): void => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== this.touchId) continue;
        this.touchId = null;
        this.active = false;
        this.dx = 0;
        this.dy = 0;
        base.style.display = 'none';
      }
    };
    zone.addEventListener('touchmove', move, { passive: false });
    zone.addEventListener('touchend', end);
    zone.addEventListener('touchcancel', end);
  }

  /** Drops any in-flight touch — used when the game is taken over (ad break). */
  reset(): void {
    this.touchId = null;
    this.active = false;
    this.dx = 0;
    this.dy = 0;
    this.baseEl.style.display = 'none';
  }
}

class AttackButton {
  held = false;
  manualAim: number | null = null;
  private tapFireUntil = 0;
  private touchId: number | null = null;
  private startX = 0;
  private startY = 0;
  private startAt = 0;

  constructor() {
    const btn = document.getElementById('atk-btn')!;
    const dir = document.getElementById('atk-dir')!;

    btn.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      if (this.touchId !== null) return;
      e.preventDefault();
      e.stopPropagation();
      this.touchId = t.identifier;
      this.held = true;
      this.manualAim = null;
      this.startX = t.clientX;
      this.startY = t.clientY;
      this.startAt = performance.now();
      btn.classList.add('pressed');
    }, { passive: false });

    const move = (e: TouchEvent): void => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== this.touchId) continue;
        e.preventDefault();
        const dx = t.clientX - this.startX;
        const dy = t.clientY - this.startY;
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
          this.manualAim = Math.atan2(dy, dx);
          const len = Math.min(26, Math.hypot(dx, dy) * 0.4);
          dir.style.display = 'block';
          dir.style.transform = `translate(${Math.cos(this.manualAim) * len}px, ${Math.sin(this.manualAim) * len}px)`;
        } else {
          this.manualAim = null;
          dir.style.display = 'none';
        }
      }
    };
    const end = (e: TouchEvent): void => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== this.touchId) continue;
        e.preventDefault();
        const quick = performance.now() - this.startAt < TAP_MS && this.manualAim === null;
        if (quick) this.tapFireUntil = performance.now() + 350; // one auto-aimed attack
        this.touchId = null;
        this.held = false;
        this.manualAim = null;
        btn.classList.remove('pressed');
        dir.style.display = 'none';
      }
    };
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
  }

  firing(): boolean {
    return this.held || performance.now() < this.tapFireUntil;
  }

  /** Drops any in-flight press — used when the game is taken over (ad break). */
  reset(): void {
    this.touchId = null;
    this.held = false;
    this.manualAim = null;
    this.tapFireUntil = 0;
    document.getElementById('atk-btn')?.classList.remove('pressed');
    const dir = document.getElementById('atk-dir');
    if (dir) dir.style.display = 'none';
  }
}

/** Simple tap button that reliably fires exactly once per touch or click. */
function tapButton(id: string, handler: () => void): void {
  const el = document.getElementById(id)!;
  let lastFire = 0;
  const fire = (e: Event): void => {
    e.preventDefault();
    e.stopPropagation();
    const now = performance.now();
    if (now - lastFire < 250) return; // guard against touch->click double fire
    lastFire = now;
    handler();
  };
  el.addEventListener('pointerdown', fire);
  // fallback for browsers where pointer events are flaky on touch
  el.addEventListener('touchstart', fire, { passive: false });
}

export class MobileControls {
  private left: Joystick;
  private atk: AttackButton;
  onEat: () => void = () => {};
  onShop: () => void = () => {};
  onWeapon: () => void = () => {};

  constructor() {
    document.body.classList.add('touch');
    this.left = new Joystick('joy-left', 'joy-left-base', 'joy-left-stick');
    this.atk = new AttackButton();
    tapButton('mob-eat', () => this.onEat());
    tapButton('mob-shop', () => this.onShop());
    tapButton('mob-weapon', () => this.onWeapon());
  }

  state(): TouchState {
    return {
      moveX: this.left.dx,
      moveY: this.left.dy,
      firing: this.atk.firing(),
      manualAim: this.atk.manualAim,
    };
  }

  setFoodCount(n: number): void {
    document.getElementById('mob-eat-cnt')!.textContent = String(n);
  }

  /**
   * Hides the pads and releases whatever was held. Used while an ad owns the
   * screen: the game is paused, so nothing may keep firing behind the overlay.
   */
  setVisible(on: boolean): void {
    document.body.classList.toggle('pads-off', !on);
    if (!on) {
      this.left.reset();
      this.atk.reset();
    }
  }

  setWeapon(icon: string, name: string): void {
    const i = document.getElementById('mob-weapon-icon')!;
    const n = document.getElementById('mob-weapon-name')!;
    if (i.textContent !== icon) i.textContent = icon;
    if (n.textContent !== name) n.textContent = name;
  }
}
