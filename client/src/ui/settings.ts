import { t } from './i18n.js';
import { API_ORIGIN } from '../config.js';

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
