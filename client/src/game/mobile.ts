/**
 * Touch controls: left joystick moves, right joystick aims and fires while held.
 * Extra on-screen buttons: eat food, open shop.
 */
export interface TouchState {
  moveX: number;
  moveY: number;
  aimActive: boolean;
  aimAngle: number;
  firing: boolean;
}

export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

const STICK_RANGE = 45;

class Joystick {
  active = false;
  dx = 0;
  dy = 0;
  private touchId: number | null = null;

  constructor(zoneId: string, baseId: string, stickId: string) {
    const zone = document.getElementById(zoneId)!;
    const base = document.getElementById(baseId)!;
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
}

export class MobileControls {
  private left: Joystick;
  private right: Joystick;
  onEat: () => void = () => {};
  onShop: () => void = () => {};

  constructor() {
    document.body.classList.add('touch');
    this.left = new Joystick('joy-left', 'joy-left-base', 'joy-left-stick');
    this.right = new Joystick('joy-right', 'joy-right-base', 'joy-right-stick');
    document.getElementById('mob-eat')!.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onEat();
    });
    document.getElementById('mob-shop')!.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onShop();
    });
  }

  state(): TouchState {
    const aimActive = this.right.active && (Math.abs(this.right.dx) > 0.15 || Math.abs(this.right.dy) > 0.15);
    return {
      moveX: this.left.dx,
      moveY: this.left.dy,
      aimActive,
      aimAngle: Math.atan2(this.right.dy, this.right.dx),
      firing: aimActive,
    };
  }

  setFoodCount(n: number): void {
    document.getElementById('mob-eat-cnt')!.textContent = String(n);
  }
}
