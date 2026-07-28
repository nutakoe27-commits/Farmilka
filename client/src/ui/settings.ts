import { t } from './i18n.js';
import { API_ORIGIN } from '../config.js';
import { audio } from '../game/audio.js';
import { fullscreenSupported, isFullscreen, toggleFullscreen, onFullscreenChange } from './fullscreen.js';

const $ = (id: string): HTMLElement => document.getElementById(id)!;

export interface GameSettings {
  shake: boolean;
  damageNumbers: boolean;
  killFeed: boolean;
}

const KEY = 'farmclash-settings';

export class Settings {
  values: GameSettings = { shake: true, damageNumbers: true, killFeed: true };
  onExit: () => void = () => {};
  /** surfaced through the HUD notice line */
  onNotice: (text: string) => void = () => {};
  /** current game server id, set after welcome */
  currentServer = 0;

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

    // sound toggle (stored by the audio manager itself, checkbox = sound ON)
    const sound = $('set-sound') as HTMLInputElement;
    sound.checked = !audio.isMuted();
    sound.onchange = () => audio.setMuted(!sound.checked);

    $('settings-btn').onclick = () => this.toggle();
    $('settings-close').onclick = () => this.hide();
    $('exit-btn').onclick = () => this.onExit();
    this.wireFullscreen();
  }

  /**
   * Fullscreen from the HUD and from the settings panel. Both are hidden where
   * the browser has no fullscreen API at all (iPhone Safari), so the player is
   * never offered a button that does nothing.
   */
  private wireFullscreen(): void {
    const hudBtn = $('fullscreen-btn');
    const row = $('set-fullscreen-row');
    if (!fullscreenSupported()) {
      hudBtn.style.display = 'none';
      row.style.display = 'none';
      return;
    }
    const sync = (): void => {
      // Same glyph either way — the state reads from the highlight, which beats
      // gambling on an "exit fullscreen" symbol that renders as tofu somewhere.
      const on = isFullscreen();
      hudBtn.title = t(on ? 'hud.fullscreenExitTitle' : 'hud.fullscreenTitle');
      hudBtn.classList.toggle('active', on);
      $('set-fullscreen-btn').textContent = t(on ? 'set.fullscreenOff' : 'set.fullscreenOn');
    };
    const go = async (): Promise<void> => {
      // Inside a portal iframe the request can simply be refused; say so rather
      // than leaving the button looking broken.
      if (!(await toggleFullscreen())) this.onNotice(t('set.fullscreenFail'));
      sync();
    };
    hudBtn.onclick = go;
    ($('set-fullscreen-btn') as HTMLButtonElement).onclick = go;
    onFullscreenChange(sync);
    sync();
  }

  get visible(): boolean {
    return !$('settings').classList.contains('hidden');
  }

  toggle(): void {
    this.visible ? this.hide() : this.show();
  }

  show(): void {
    $('settings').classList.remove('hidden');
    this.renderServers().catch(() => {});
  }

  private async renderServers(): Promise<void> {
    const list = $('server-list');
    list.innerHTML = `<span style="color:#6a7085;font-size:12px">${t('set.loading')}</span>`;
    try {
      const servers = (await (await fetch(`${API_ORIGIN}/servers`)).json()) as { id: number; online: number; max: number }[];
      list.innerHTML = '';
      const auto = document.createElement('button');
      auto.className = 'srv-btn' + (localStorage.getItem('farmclash-server') ? '' : ' current');
      auto.textContent = t('set.auto');
      auto.onclick = () => {
        localStorage.removeItem('farmclash-server');
        location.reload();
      };
      list.appendChild(auto);
      for (const srv of servers) {
        const b = document.createElement('button');
        const full = srv.online >= srv.max;
        b.className = 'srv-btn' + (srv.id === this.currentServer ? ' current' : '') + (full ? ' full' : '');
        b.textContent = t('set.srvBtn', { id: srv.id, online: srv.online, max: srv.max });
        b.onclick = () => {
          if (full || srv.id === this.currentServer) return;
          localStorage.setItem('farmclash-server', String(srv.id));
          location.reload();
        };
        list.appendChild(b);
      }
    } catch {
      list.innerHTML = `<span style="color:#ff7b72;font-size:12px">${t('set.srvFail')}</span>`;
    }
  }

  hide(): void {
    $('settings').classList.add('hidden');
  }
}
