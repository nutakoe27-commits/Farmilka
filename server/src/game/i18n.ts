// Server-side i18n for messages sent to a single client (reject/reason/notice
// text). The player's language is captured from the join message; game-logic
// helpers translate via the player's `lang` field. Boss display names are also
// resolved here so events arrive already localized.

export type Lang = 'ru' | 'en';

type Args = Record<string, string | number>;

const RU: Record<string, string> = {
  dead: 'Вы мертвы',
  noMoney: 'Недостаточно денег',
  unknownItem: 'Неизвестный предмет',
  uniqueNoBuy: 'Уникальное оружие выпадает только из сундука оружия',
  vaultOnlyOne: 'Хранилище выдаётся один раз вместе с базой',
  vaultEmpty: 'В хранилище пусто',
  notAtVault: 'Подойди к своему хранилищу',
  owned: 'Уже куплено',
  hotbarFull: 'Хотбар заполнен (кулаки + 3 оружия)',
  maxFood: 'Максимум еды: {n}',
  fistsNoSell: 'Кулаки не продаются',
  noWeapon: 'У вас нет этого оружия',
  unknownBuilding: 'Неизвестная постройка',
  buildLimit: 'Лимит построек: {n}',
  turretLimit: 'Лимит турелей: {n}',
  wallLimit: 'Лимит стен: {n}',
  blockedByPlayer: 'Здесь стоит игрок',
  notYourBuilding: 'Это не ваша постройка',
  vaultNoDemolish: 'Хранилище — сердце базы, его не снести',
  outOfWorld: 'За границей мира',
  tooFar: 'Слишком далеко от вас',
  tooClose: 'Слишком близко к другой постройке',
  prestigeMax: 'Достигнут максимальный уровень престижа',
  levelMax: 'Достигнут максимальный уровень',
  needGold: 'Нужно {n} золота',
  // auth / connection
  authError: 'Ошибка авторизации',
  accountInGame: 'Этот аккаунт уже в игре',
  nameRegistered: 'Это имя зарегистрировано — введите пароль',
  authServerError: 'Ошибка сервера при авторизации',
  serverNotExist: 'Сервера {n} не существует',
  serverFull: 'Сервер {n} заполнен — выберите другой',
  passShort: 'Пароль слишком короткий (мин. 4 символа)',
  nameTaken: 'Это имя уже зарегистрировано',
  accountNotFound: 'Аккаунт не найден — отметьте «Создать аккаунт»',
  wrongPass: 'Неверный пароль',
  anon: 'Безымянный',
};

const EN: Record<string, string> = {
  dead: 'You are dead',
  noMoney: 'Not enough money',
  unknownItem: 'Unknown item',
  uniqueNoBuy: 'Unique weapons only drop from the weapon crate',
  vaultOnlyOne: 'The vault comes with your base — only one',
  vaultEmpty: 'Your vault is empty',
  notAtVault: 'Stand next to your vault',
  owned: 'Already owned',
  hotbarFull: 'Hotbar is full (fists + 3 weapons)',
  maxFood: 'Max food: {n}',
  fistsNoSell: 'Fists cannot be sold',
  noWeapon: "You don't have this weapon",
  unknownBuilding: 'Unknown building',
  buildLimit: 'Building limit: {n}',
  turretLimit: 'Turret limit: {n}',
  wallLimit: 'Wall limit: {n}',
  blockedByPlayer: 'Someone is standing there',
  notYourBuilding: 'That is not your building',
  vaultNoDemolish: 'The vault is the heart of the base — it cannot be torn down',
  outOfWorld: 'Outside the world',
  tooFar: 'Too far from you',
  tooClose: 'Too close to another building',
  prestigeMax: 'Max prestige level reached',
  levelMax: 'Max level reached',
  needGold: 'Need {n} gold',
  authError: 'Authorization error',
  accountInGame: 'This account is already in game',
  nameRegistered: 'This name is registered — enter the password',
  authServerError: 'Server error during authorization',
  serverNotExist: "Server {n} doesn't exist",
  serverFull: 'Server {n} is full — pick another',
  passShort: 'Password too short (min. 4 characters)',
  nameTaken: 'This name is already registered',
  accountNotFound: 'Account not found — check "Create account"',
  wrongPass: 'Wrong password',
  anon: 'Anonymous',
};

const DICTS: Record<Lang, Record<string, string>> = { ru: RU, en: EN };

export function tr(lang: Lang, key: string, args?: Args): string {
  const raw = DICTS[lang]?.[key] ?? RU[key] ?? key;
  if (!args) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k) => (args[k] !== undefined ? String(args[k]) : `{${k}}`));
}

// Boss display names keyed by boss id. RU names come from balance.json (the
// authoritative source); EN names are provided here so English clients see
// localized boss banners.
const BOSS_EN: Record<string, string> = {
  champion: 'Champion',
  shadow_lord: 'Shadow Lord',
  crystal_queen: 'Crystal Queen',
};

/** Localized boss name; falls back to the balance.json (Russian) name. */
export function bossName(lang: Lang, id: string, ruName: string): string {
  return lang === 'en' ? BOSS_EN[id] ?? ruName : ruName;
}

export function normalizeLang(v: unknown): Lang {
  return v === 'en' ? 'en' : 'ru';
}
