const $ = (id: string): HTMLElement => document.getElementById(id)!;

export interface GameSettings {
  shake: boolean;
  damageNumbers: boolean;
  killFeed: boolean;
}

const KEY = 'farmilka-settings';

export class Settings {
  values: GameSettings = { shake: true, damageNumbers: true, killFeed: true };
  onExit: () => void = () => {};

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
      this.values = { ...this.values, ...saved };
    } catch {
      // defaults
    }
    const shake = $('set-shake') as HTMLInputElement;
    const dmg = $('set-dmg') as HTMLInputElement;
    const feed = $('set-feed') as HTMLInputElement;
    shake.checked = this.values.shake;
    dmg.checked = this.values.damageNumbers;
    feed.checked = this.values.killFeed;

    const save = (): void => {
      this.values = { shake: shake.checked, damageNumbers: dmg.checked, killFeed: feed.checked };
      localStorage.setItem(KEY, JSON.stringify(this.values));
    };
    shake.onchange = save;
    dmg.onchange = save;
    feed.onchange = save;

    $('settings-btn').onclick = () => this.toggle();
    $('settings-close').onclick = () => this.hide();
    $('exit-btn').onclick = () => this.onExit();
  }

  get visible(): boolean {
    return !$('settings').classList.contains('hidden');
  }

  toggle(): void {
    this.visible ? this.hide() : this.show();
  }

  show(): void {
    $('settings').classList.remove('hidden');
  }

  hide(): void {
    $('settings').classList.add('hidden');
  }
}
