// Lightweight client-side i18n. Language is stored in localStorage and chosen
// once at load; switching reloads the page so every UI surface picks the new
// dictionary cleanly (simpler and safer than live-rebinding hundreds of nodes).

export type Lang = 'ru' | 'en';

type Dict = Record<string, string | string[]>;

const RU: Dict = {
  // name / login screen
  'menu.tagline': 'Фарми мобов, строй фермы, покупай оружие,<br>охоться на боссов и других игроков.',
  'menu.namePh': 'Ваше имя',
  'menu.passPh': 'Пароль (нужен только для аккаунта)',
  'menu.play': 'Играть',
  'menu.register': 'Создать аккаунт',
  'menu.accHint': 'Без пароля — гостевой вход (прогресс не сохраняется).<br>С аккаунтом золото и оружие сохраняются между сеансами.',
  'menu.tg': '📢 Новости и чат — Telegram-канал',
  'menu.share': '🔗 Поделиться игрой',
  'menu.needPass': 'Для аккаунта нужен пароль (мин. 4 символа)',
  'menu.startFailed': 'Не удалось запустить игру',
  'menu.initFailed': 'Ошибка инициализации графики',
  'menu.shareCopied': 'Ссылка скопирована — зови друзей!',
  'menu.shareText': 'Играй со мной в FarmClash — браузерная онлайн-игра! ',
  'net.lost': 'Соединение потеряно',
  'net.error': 'Ошибка соединения',
  'time.min': 'м',
  'time.sec': 'с',

  // HUD
  'hud.hint': 'WASD — движение · мышь — прицел · ЛКМ — атака<br>B — магазин · Q — еда · 1–4 — оружие · перетаскивай слоты',
  'hud.protect': '🛡 Защита после возрождения',
  'hud.protectSec': '🛡 Защита после возрождения: {n}с',
  'hud.level': '⭐ Ур. {n}',
  'hud.foodTitle': 'Съесть еду (Q)',
  'hud.settingsTitle': 'Настройки',
  'hud.placeHint': 'Кликните на карте, чтобы поставить постройку · ПКМ/Esc — отмена',
  'hud.atk': 'тап — атака · тяни — прицел',

  // settings
  'set.title': '⚙ Настройки',
  'set.server': 'Игровой сервер (смена переподключит):',
  'set.shake': 'Тряска экрана',
  'set.dmg': 'Числа урона',
  'set.feed': 'Лента убийств',
  'set.lang': 'Язык / Language',
  'set.tg': '📢 Новости и чат — Telegram',
  'set.share': '🔗 Поделиться игрой',
  'set.continue': 'Продолжить игру',
  'set.exit': 'Выйти в меню',
  'set.loading': 'загрузка…',
  'set.auto': 'Авто',
  'set.srvBtn': 'Сервер {id} — {online}/{max}',
  'set.srvFail': 'не удалось получить список серверов',

  // shop
  'shop.title': 'Магазин',
  'shop.sub': 'Работает из любой точки мира. При смерти теряются оружие и еда!',
  'shop.level': '⭐ Уровень',
  'shop.levelDesc': '+HP и +урон за уровень. Теряется при смерти. На боссов не действует.',
  'shop.tabWeapons': '⚔️ Оружие',
  'shop.tabBuildings': '🏰 Постройки',
  'shop.tabHats': '🎩 Шляпы',
  'shop.food': 'Еда',
  'shop.weapons': 'Оружие',
  'shop.buildings': 'Постройки',
  'shop.prestige': '✦ Престиж',
  'shop.prestigeDesc': 'Слив золота на статус: цвет имени, аура, значок. На бой не влияет.',
  'shop.hats': '🎩 Шляпы',
  'shop.foodName': '🍖 Еда',
  'shop.foodStat': '+{heal} HP · перезарядка {cd}с · макс. {max} шт<br>жми Q вовремя — и выживешь в PvP',
  'shop.buildingVanish': 'исчезает при выходе из игры',
  'shop.lootbox': '🎁 Лутбокс',
  'shop.lootboxDesc': 'Шанс на эпическую или легендарную шляпу,<br>золото — или ничего. Дубликат = бонусное золото.',
  'shop.max': 'Максимум',
  'shop.bought': 'Куплено',
  'shop.sell': 'Продать',
  'shop.sellFor': 'Продать +{n}',
  'shop.none': 'Нет',
  'shop.unequip': 'Снять',
  'shop.equip': 'Надеть',
  'shop.buildCount': '({n}/{max})',
  'shop.hatCount': '(собрано {n}/{total})',
  'shop.dmg': 'урон {dmg} · дальн. {range} · {rate}/с',
  'shop.dmgRanged': 'урон {dmg} · дальн. {range} · {rate}/с · снаряд',
  'shop.income': '+{n} монет / {sec}с · HP {hp}',
  'shop.turretStat': 'урон {dmg}/выстрел · дальн. {range} · HP {hp}',

  // death screen
  'death.title': 'Вы погибли',
  'death.survived': 'Прожито',
  'death.kills': 'Убийств',
  'death.level': 'Уровень',
  'death.dropped': '💰 потеряно',
  'death.lost': 'Оружие и еда потеряны, уровень сброшен.',
  'death.respawn': 'Возвращаемся в бой… (3с защиты после спавна)',
  'death.byPlayer': '☠ Убит игроком',
  'death.byMob': 'Убит мобом',
  'death.byBoss': 'Убит боссом',
  'death.byTurret': 'Расстрелян турелью',
  'death.generic': 'Погиб',

  // leaderboard
  'lb.title': '🏆 Топ сервера',
  'lb.you': 'Ты: #{rank} из {total}',

  // queue
  'queue.title': 'Все серверы заполнены',
  'queue.body': 'Вы в очереди — как только освободится место, игра начнётся автоматически.',
  'queue.pos': 'Ваша позиция в очереди',

  // onboarding
  'onboard.desktop': [
    'WASD — движение, мышь — прицел, ЛКМ — атака',
    'Убивай мобов и собирай монеты 💰',
    'B — магазин: оружие, постройки, уровни',
    'Q — съешь еду, чтобы выжить в бою 🍖',
  ],
  'onboard.mobile': [
    '👈 Левый джойстик — движение',
    '⚔ Большая кнопка — атака (тап = автоприцел)',
    '🛒 Кнопка магазина — оружие и уровни',
    '🍖 Ешь еду, чтобы выжить в бою',
  ],

  // events / notices
  'ev.hatDup': '🎩 Дубликат «{name}» → <b style="color:#ffd76e">+{gold} золота</b>',
  'ev.hatNewBanner': '🎩 Новая шляпа: {name}!',
  'ev.hatNew': '🎩 Выпала шляпа: <b>{name}</b> — надень её в магазине (B)',
  'ev.lootGold': '🎁 Лутбокс: <b style="color:#ffd76e">+{gold} золота!</b>',
  'ev.lootNothing': '🎁 Лутбокс: пусто… не повезло',
  'ev.prestige': '✦ Престиж {level}{tier}',
  'ev.levelMax': '⭐ <b style="color:#7ee787">Максимальный уровень {n}!</b> Ты силён в PvE — но босса в одиночку не одолеть.',
  'ev.level': '⭐ Уровень <b style="color:#7ee787">{n}</b> — больше HP и урона',
  'ev.bossWarn': '⚠ {boss} появится через {n}с — смотри на миникарту!',
  'ev.bossSpawned': '💀 {boss} появился! Убей его ради награды!',
  'ev.bossKilled': '💀 {boss} повержен! {top}',
  'ev.bossGone': '{boss} исчез…',
  'ev.buildAttacked': '⚠ <b style="color:#ffd76e">Вашу постройку атакуют!</b>',
  'ev.buildDestroyedMine': '💥 Вашу постройку разрушил <b>{name}</b>',
  'ev.buildDestroyedTheirs': '💥 Вы разрушили постройку — заберите лут!',
  'ev.daily': '🎁 Ежедневная награда: <b style="color:#ffd76e">+{gold} золота</b> · серия {streak} дн.',

  // weapon / building notes (shop)
  'note.sword': 'база',
  'note.spear': 'длинный укол',
  'note.hammer': 'медленный, AoE + отброс',
  'note.bow': 'дальний бой',
  'note.crossbow': 'снайпер',
  'note.daggers': 'быстрые · удар в спину ×2.5',
  'note.scythe': 'бьёт вокруг на 360°',
  'note.venom_blade': 'отравляет: урон со временем',
  'note.vampire_blade': 'вампиризм: лечит за урон',
  'note.triple_bow': '3 стрелы веером',
  'note.ice_staff': 'замораживает: замедляет цель',
  'note.farm': 'пассивный доход',
  'note.mine': 'больше дохода',
  'note.turret': 'стреляет по врагам',

  // hat sources
  'src.common': 'падает с мобов',
  'src.rare': 'падает с боссов',
  'src.epic': 'только из лутбокса',
  'src.legendary': 'только из лутбокса',

  // hat effect descriptions
  'fx.none': 'без эффекта',
  'fx.speed': '+{n}% скорость',
  'fx.hp': '+{n} HP',
  'fx.damage': '+{n}% урон',
  'fx.foodHeal': '+{n}% лечение едой',
  'fx.income': '+{n}% доход построек',
  'fx.regen': '×{n} реген',
  'fx.magnet': '+{n} радиус сбора монет',
  'fx.foodFind': '+{n}% шанс еды с мобов',
  'fx.mobReward': '+{n}% награда с мобов',
  'fx.respawn': '×{n} время возрождения',
  'fx.dropSave': '−{n}% потеря денег при смерти',
  'fx.bossDmg': '+{n}% урон боссам',
};

const EN: Dict = {
  'menu.tagline': 'Farm mobs, build farms, buy weapons,<br>hunt bosses and other players.',
  'menu.namePh': 'Your name',
  'menu.passPh': 'Password (only needed for an account)',
  'menu.play': 'Play',
  'menu.register': 'Create account',
  'menu.accHint': 'No password — guest login (progress is not saved).<br>With an account, gold and weapons persist between sessions.',
  'menu.tg': '📢 News & chat — Telegram channel',
  'menu.share': '🔗 Share the game',
  'menu.needPass': 'An account needs a password (min. 4 characters)',
  'menu.startFailed': 'Could not start the game',
  'menu.initFailed': 'Graphics initialization error',
  'menu.shareCopied': 'Link copied — invite your friends!',
  'menu.shareText': 'Play FarmClash with me — a browser online game! ',
  'net.lost': 'Connection lost',
  'net.error': 'Connection error',
  'time.min': 'm',
  'time.sec': 's',

  'hud.hint': 'WASD — move · mouse — aim · LMB — attack<br>B — shop · Q — food · 1–4 — weapons · drag slots',
  'hud.protect': '🛡 Spawn protection',
  'hud.protectSec': '🛡 Spawn protection: {n}s',
  'hud.level': '⭐ Lv {n}',
  'hud.foodTitle': 'Eat food (Q)',
  'hud.settingsTitle': 'Settings',
  'hud.placeHint': 'Click on the map to place the building · RMB/Esc — cancel',
  'hud.atk': 'tap — attack · drag — aim',

  'set.title': '⚙ Settings',
  'set.server': 'Game server (switching reconnects):',
  'set.shake': 'Screen shake',
  'set.dmg': 'Damage numbers',
  'set.feed': 'Kill feed',
  'set.lang': 'Язык / Language',
  'set.tg': '📢 News & chat — Telegram',
  'set.share': '🔗 Share the game',
  'set.continue': 'Resume game',
  'set.exit': 'Quit to menu',
  'set.loading': 'loading…',
  'set.auto': 'Auto',
  'set.srvBtn': 'Server {id} — {online}/{max}',
  'set.srvFail': 'could not load server list',

  'shop.title': 'Shop',
  'shop.sub': 'Works from anywhere in the world. On death you lose weapons and food!',
  'shop.level': '⭐ Level',
  'shop.levelDesc': '+HP and +damage per level. Lost on death. Does not affect bosses.',
  'shop.tabWeapons': '⚔️ Weapons',
  'shop.tabBuildings': '🏰 Buildings',
  'shop.tabHats': '🎩 Hats',
  'shop.food': 'Food',
  'shop.weapons': 'Weapons',
  'shop.buildings': 'Buildings',
  'shop.prestige': '✦ Prestige',
  'shop.prestigeDesc': 'Burn gold for status: name color, aura, badge. No combat effect.',
  'shop.hats': '🎩 Hats',
  'shop.foodName': '🍖 Food',
  'shop.foodStat': '+{heal} HP · cooldown {cd}s · max {max}<br>hit Q in time and survive PvP',
  'shop.buildingVanish': 'vanishes when you leave the game',
  'shop.lootbox': '🎁 Lootbox',
  'shop.lootboxDesc': 'Chance at an epic or legendary hat,<br>gold — or nothing. Duplicate = bonus gold.',
  'shop.max': 'Max',
  'shop.bought': 'Owned',
  'shop.sell': 'Sell',
  'shop.sellFor': 'Sell +{n}',
  'shop.none': 'No',
  'shop.unequip': 'Unequip',
  'shop.equip': 'Equip',
  'shop.buildCount': '({n}/{max})',
  'shop.hatCount': '(collected {n}/{total})',
  'shop.dmg': 'dmg {dmg} · range {range} · {rate}/s',
  'shop.dmgRanged': 'dmg {dmg} · range {range} · {rate}/s · projectile',
  'shop.income': '+{n} coins / {sec}s · HP {hp}',
  'shop.turretStat': 'dmg {dmg}/shot · range {range} · HP {hp}',

  'death.title': 'You died',
  'death.survived': 'Survived',
  'death.kills': 'Kills',
  'death.level': 'Level',
  'death.dropped': '💰 lost',
  'death.lost': 'Weapons and food lost, level reset.',
  'death.respawn': 'Returning to battle… (3s protection after spawn)',
  'death.byPlayer': '☠ Killed by a player',
  'death.byMob': 'Killed by a mob',
  'death.byBoss': 'Killed by a boss',
  'death.byTurret': 'Gunned down by a turret',
  'death.generic': 'Died',

  'lb.title': '🏆 Server top',
  'lb.you': 'You: #{rank} of {total}',

  'queue.title': 'All servers are full',
  'queue.body': "You're in the queue — the game will start automatically once a slot frees up.",
  'queue.pos': 'Your position in the queue',

  'onboard.desktop': [
    'WASD — move, mouse — aim, LMB — attack',
    'Kill mobs and collect coins 💰',
    'B — shop: weapons, buildings, levels',
    'Q — eat food to survive in combat 🍖',
  ],
  'onboard.mobile': [
    '👈 Left joystick — move',
    '⚔ Big button — attack (tap = auto-aim)',
    '🛒 Shop button — weapons and levels',
    '🍖 Eat food to survive in combat',
  ],

  'ev.hatDup': '🎩 Duplicate "{name}" → <b style="color:#ffd76e">+{gold} gold</b>',
  'ev.hatNewBanner': '🎩 New hat: {name}!',
  'ev.hatNew': '🎩 Hat dropped: <b>{name}</b> — equip it in the shop (B)',
  'ev.lootGold': '🎁 Lootbox: <b style="color:#ffd76e">+{gold} gold!</b>',
  'ev.lootNothing': '🎁 Lootbox: empty… no luck',
  'ev.prestige': '✦ Prestige {level}{tier}',
  'ev.levelMax': '⭐ <b style="color:#7ee787">Max level {n}!</b> Strong in PvE — but you can\'t solo a boss.',
  'ev.level': '⭐ Level <b style="color:#7ee787">{n}</b> — more HP and damage',
  'ev.bossWarn': '⚠ {boss} arrives in {n}s — watch the minimap!',
  'ev.bossSpawned': '💀 {boss} has appeared! Kill it for a reward!',
  'ev.bossKilled': '💀 {boss} defeated! {top}',
  'ev.bossGone': '{boss} vanished…',
  'ev.buildAttacked': '⚠ <b style="color:#ffd76e">Your building is under attack!</b>',
  'ev.buildDestroyedMine': '💥 <b>{name}</b> destroyed your building',
  'ev.buildDestroyedTheirs': '💥 You destroyed a building — grab the loot!',
  'ev.daily': '🎁 Daily reward: <b style="color:#ffd76e">+{gold} gold</b> · {streak}-day streak',

  'note.sword': 'basic',
  'note.spear': 'long thrust',
  'note.hammer': 'slow, AoE + knockback',
  'note.bow': 'ranged',
  'note.crossbow': 'sniper',
  'note.daggers': 'fast · backstab ×2.5',
  'note.scythe': 'hits all around 360°',
  'note.venom_blade': 'poisons: damage over time',
  'note.vampire_blade': 'lifesteal: heals for damage',
  'note.triple_bow': '3 arrows in a fan',
  'note.ice_staff': 'freezes: slows the target',
  'note.farm': 'passive income',
  'note.mine': 'more income',
  'note.turret': 'shoots enemies',

  'src.common': 'drops from mobs',
  'src.rare': 'drops from bosses',
  'src.epic': 'lootbox only',
  'src.legendary': 'lootbox only',

  'fx.none': 'no effect',
  'fx.speed': '+{n}% speed',
  'fx.hp': '+{n} HP',
  'fx.damage': '+{n}% damage',
  'fx.foodHeal': '+{n}% food healing',
  'fx.income': '+{n}% building income',
  'fx.regen': '×{n} regen',
  'fx.magnet': '+{n} coin pickup radius',
  'fx.foodFind': '+{n}% food drop chance',
  'fx.mobReward': '+{n}% mob reward',
  'fx.respawn': '×{n} respawn time',
  'fx.dropSave': '−{n}% money lost on death',
  'fx.bossDmg': '+{n}% boss damage',
};

const DICTS: Record<Lang, Dict> = { ru: RU, en: EN };

const KEY = 'farmclash-lang';

function detect(): Lang {
  const saved = localStorage.getItem(KEY);
  if (saved === 'ru' || saved === 'en') return saved;
  return (navigator.language || '').toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export let lang: Lang = detect();

/** Translate a key, interpolating {name} placeholders from params. */
export function t(key: string, params?: Record<string, string | number>): string {
  const raw = (DICTS[lang][key] ?? DICTS.ru[key] ?? key) as string;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
}

/** Translate a key whose value is a string list (onboarding tips). */
export function tList(key: string): string[] {
  const v = DICTS[lang][key] ?? DICTS.ru[key];
  return Array.isArray(v) ? v : [];
}

// English boss names (RU names come from balance.json via the event payload).
const BOSS_EN: Record<string, string> = {
  champion: 'Champion',
  shadow_lord: 'Shadow Lord',
  crystal_queen: 'Crystal Queen',
};

/** Localized boss name: EN from the map, RU falls back to the server-sent name. */
export function bossName(id: string, ruName: string): string {
  return lang === 'en' ? BOSS_EN[id] ?? ruName : ruName;
}

export function setLang(l: Lang): void {
  if (l === lang) return;
  localStorage.setItem(KEY, l);
  location.reload();
}

/**
 * Apply translations to static markup: elements with [data-i18n] get their
 * innerHTML set (HTML allowed so <br> works), [data-i18n-ph] get their input
 * placeholder set, [data-i18n-title] get their title attribute set.
 */
export function applyStaticI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18n!);
  });
  root.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh!);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle!);
  });
  document.documentElement.lang = lang;
}
