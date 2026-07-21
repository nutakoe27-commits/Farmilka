export class InputManager {
  private keys = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  attackHeld = false;

  onHotbar: (slot: number) => void = () => {};
  onToggleShop: () => void = () => {};
  onEat: () => void = () => {};
  onWorldClick: (sx: number, sy: number) => boolean = () => false; // return true to consume (placement mode)
  onCancel: () => void = () => {};

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      this.keys.add(e.code);
      if (k === 'b' || k === 'и') this.onToggleShop();
      if (e.code === 'KeyQ') this.onEat();
      if (e.code === 'Escape') this.onCancel();
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= 4) this.onHotbar(n - 1);
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.attackHeld = false;
    });
    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
    window.addEventListener('mousedown', (e) => {
      if (e.target instanceof HTMLElement && e.target.closest('.panel')) return;
      if (e.button === 0) {
        if (this.onWorldClick(e.clientX, e.clientY)) return;
        this.attackHeld = true;
      }
      if (e.button === 2) this.onCancel();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.attackHeld = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  moveVector(): { mx: number; my: number } {
    let mx = 0;
    let my = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    if (mx !== 0 && my !== 0) {
      const inv = 1 / Math.SQRT2;
      mx *= inv;
      my *= inv;
    }
    return { mx, my };
  }
}
