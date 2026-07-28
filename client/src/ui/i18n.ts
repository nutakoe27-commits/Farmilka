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
  'menu.retry': '🔄 Повторить подключение',
  'menu.connFail': 'Не удалось подключиться к игровому серверу. Проверьте интернет и попробуйте снова.',
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
  'set.sound': 'Звук',
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
  'shop.levelDesc': 'Уровень растёт от убийств мобов и игроков. +HP и +урон, теряется при смерти.',
  'shop.levelProg': 'ещё {n} до ур. ↑',
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
  'shop.buildingVanish': 'остаётся в мире и копит добычу — её могут разграбить',
  'shop.lootbox': '🎁 Лутбокс',
  'shop.lootboxDesc': 'Любая шляпа (шанс зависит от редкости: легендарная 2%),<br>еда, золото — или пусто. Дубликат = бонусное золото.',
  'shop.weaponLootbox': '⚔️ Сундук оружия',
  'shop.weaponLootboxDesc': 'Обычное оружие, золото — или УНИКАЛЬНОЕ оружие<br>со способностями (эпик 6%, легендарка 2%).<br>Уникальное исчезает при смерти, но продаётся дорого.',
  'shop.max': 'Максимум',
  'shop.bought': 'Куплено',
  'shop.sell': 'Продать',
  'shop.sellFor': 'Продать +{n}',
  'shop.none': 'Нет',
  'shop.unequip': 'Снять',
  'shop.equip': 'Надеть',
  'shop.buildCount': '({n}/{max})',
  'shop.wallCount': '🧱 {n}/{max}',
  'shop.hatCount': '(собрано {n}/{total})',
  'shop.dmg': 'урон {dmg} · дальн. {range} · {rate}/с',
  'shop.dmgRanged': 'урон {dmg} · дальн. {range} · {rate}/с · снаряд',
  'shop.income': '+{n} монет / {sec}с · HP {hp}',
  'shop.turretStat': 'урон {dmg}/выстрел · дальн. {range} · HP {hp}',
  'shop.wallStat': 'HP {hp} · сплошная — враги и мобы не пройдут, только проломят',

  // death screen
  'death.title': 'Вы погибли',
  'death.survived': 'Прожито',
  'death.kills': 'Убийств',
  'death.level': 'Уровень',
  'death.dropped': '💰 потеряно',
  'death.lost': 'Оружие и еда потеряны, уровень сброшен.',
  'death.respawnBtn': '⚔ Возродиться',
  'death.respawnWait': 'Возродиться ({n}с)',
  'death.shop': '🛒 Магазин',
  'death.hint': 'Пока ты выбыл — можно закупиться в магазине (кроме построек).',
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
  'ev.banked': '🏦 В хранилище: <b style="color:#7ee787">+{amount}</b> (всего {total})',
  'ev.withdrew': '🏦 Снято из хранилища: <b>{amount}</b>',
  'ev.raided': '🔥 <b>{name}</b> разграбил твою базу — потеряно {lost} золота',
  'ev.raidedBanner': '🔥 Твою базу грабит {name}!',
  'note.vault': 'хранилище: золото здесь не теряется при смерти',
  'note.wall': 'просто много прочности — прикрой ферму',
  'shop.withdraw': '🏦 Забрать всё',
  'shop.bankRow': 'В хранилище: {n}',
  'shop.bankHint': 'Забрать можно, стоя рядом со своим хранилищем',
  'shop.rankTitle': 'Ранг базы {n} — до следующего сдать ещё {need}',
  'shop.rankPerks': 'Только экономика, боевые характеристики ранг не трогает:<br>+{silo}% силос · +{prod}% производство · +{slots} слотов построек<br>−{respawn}% возрождение · +{magnet} сбор монет · −{prot}% потери при рейде',
  'hud.bankedHint': 'Золото в хранилище не теряется при смерти',
  'ev.lootFood': '🎁 Лутбокс: <b style="color:#7ee787">+{n} еды!</b>',
  'ev.wlootUnique': '⚔️ Сундук: <b style="color:{color}">{name}</b> — уникальное оружие!',
  'ev.wlootUniqueBanner': '⚔️ {name} — уникальное оружие!',
  'ev.wlootWeapon': '⚔️ Сундук: выпало оружие — <b>{name}</b>',
  'ev.wlootGold': '⚔️ Сундук: <b style="color:#ffd76e">+{gold} золота</b>',
  'ev.wlootNothing': '⚔️ Сундук: пусто… не повезло',
  'ev.miss': 'мимо',
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
  'note.hook_blade': 'крюк: притягивает жертву к тебе',
  'note.mirror_blade': 'в руках: 25% шанс, что удар по тебе промахнётся',
  'note.storm_hammer': 'бьёт вокруг на 360° с мощным отбросом',
  'note.tamer_blade': 'в руках: мобы тебя не замечают',
  'note.reaper_scythe': 'казнит мобов ниже 25% HP · вампиризм',
  'note.dragon_bow': 'стрелы пробивают до 4 целей насквозь',
  'wname.hook_blade': 'Крюк-цепь',
  'wname.mirror_blade': 'Зеркальный клинок',
  'wname.storm_hammer': 'Молот бури',
  'wname.tamer_blade': 'Клинок укротителя',
  'wname.reaper_scythe': 'Коса Жнеца',
  'wname.dragon_bow': 'Драконий лук',
  'shop.uniqueSrc': 'только из сундука оружия · исчезает при смерти',
  'note.farm': 'пассивный доход',
  'note.mine': 'больше дохода',
  'note.turret': 'бьёт всех: мобов, боссов, игроков · макс. 2',

  // hat sources
  'src.common': 'мобы или лутбокс',
  'src.rare': 'боссы или лутбокс',
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
  'menu.retry': '🔄 Reconnect',
  'menu.connFail': "Couldn't connect to the game server. Check your internet and try again.",
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
  'set.sound': 'Sound',
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
  'shop.levelDesc': 'Level up by killing mobs and players. +HP and +damage, lost on death.',
  'shop.levelProg': '{n} more to level ↑',
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
  'shop.buildingVanish': 'stays in the world and stockpiles loot — raiders can take it',
  'shop.lootbox': '🎁 Lootbox',
  'shop.lootboxDesc': 'Any hat (chance scales with rarity: legendary 2%),<br>food, gold — or nothing. Duplicate = bonus gold.',
  'shop.weaponLootbox': '⚔️ Weapon crate',
  'shop.weaponLootboxDesc': 'A regular weapon, gold — or a UNIQUE weapon<br>with special powers (epic 6%, legendary 2%).<br>Uniques vanish on death but sell high.',
  'shop.max': 'Max',
  'shop.bought': 'Owned',
  'shop.sell': 'Sell',
  'shop.sellFor': 'Sell +{n}',
  'shop.none': 'No',
  'shop.unequip': 'Unequip',
  'shop.equip': 'Equip',
  'shop.buildCount': '({n}/{max})',
  'shop.wallCount': '🧱 {n}/{max}',
  'shop.hatCount': '(collected {n}/{total})',
  'shop.dmg': 'dmg {dmg} · range {range} · {rate}/s',
  'shop.dmgRanged': 'dmg {dmg} · range {range} · {rate}/s · projectile',
  'shop.income': '+{n} coins / {sec}s · HP {hp}',
  'shop.turretStat': 'dmg {dmg}/shot · range {range} · HP {hp}',
  'shop.wallStat': 'HP {hp} · solid — enemies and mobs have to break through',

  'death.title': 'You died',
  'death.survived': 'Survived',
  'death.kills': 'Kills',
  'death.level': 'Level',
  'death.dropped': '💰 lost',
  'death.lost': 'Weapons and food lost, level reset.',
  'death.respawnBtn': '⚔ Respawn',
  'death.respawnWait': 'Respawn ({n}s)',
  'death.shop': '🛒 Shop',
  'death.hint': "While you're down you can shop (except buildings).",
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
  'ev.banked': '🏦 Banked: <b style="color:#7ee787">+{amount}</b> (total {total})',
  'ev.withdrew': '🏦 Withdrawn: <b>{amount}</b>',
  'ev.raided': '🔥 <b>{name}</b> raided your base — {lost} gold lost',
  'ev.raidedBanner': '🔥 {name} is raiding your base!',
  'note.vault': 'vault: gold kept here survives your death',
  'note.wall': 'just a lot of hit points — shield your farms',
  'shop.withdraw': '🏦 Take it all',
  'shop.bankRow': 'In the vault: {n}',
  'shop.bankHint': 'Withdraw while standing next to your own vault',
  'shop.rankTitle': 'Base Rank {n} — bank {need} more for the next one',
  'shop.rankPerks': 'Economy only — rank never touches combat stats:<br>+{silo}% silo · +{prod}% production · +{slots} building slots<br>−{respawn}% respawn · +{magnet} coin pickup · −{prot}% lost to raids',
  'hud.bankedHint': 'Vault gold is never lost on death',
  'ev.lootFood': '🎁 Lootbox: <b style="color:#7ee787">+{n} food!</b>',
  'ev.wlootUnique': '⚔️ Crate: <b style="color:{color}">{name}</b> — a unique weapon!',
  'ev.wlootUniqueBanner': '⚔️ {name} — a unique weapon!',
  'ev.wlootWeapon': '⚔️ Crate: you got a weapon — <b>{name}</b>',
  'ev.wlootGold': '⚔️ Crate: <b style="color:#ffd76e">+{gold} gold</b>',
  'ev.wlootNothing': '⚔️ Crate: empty… no luck',
  'ev.miss': 'miss',
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
  'note.hook_blade': 'hook: drags the victim to you',
  'note.mirror_blade': 'equipped: 25% chance attacks on you miss',
  'note.storm_hammer': '360° swing with a heavy knockback',
  'note.tamer_blade': 'equipped: mobs ignore you completely',
  'note.reaper_scythe': 'executes mobs below 25% HP · lifesteal',
  'note.dragon_bow': 'arrows pierce through up to 4 targets',
  'wname.hook_blade': 'Hook Chain',
  'wname.mirror_blade': 'Mirror Blade',
  'wname.storm_hammer': 'Storm Hammer',
  'wname.tamer_blade': 'Tamer\'s Blade',
  'wname.reaper_scythe': 'Reaper\'s Scythe',
  'wname.dragon_bow': 'Dragon Bow',
  'shop.uniqueSrc': 'weapon crate only · lost on death',
  'note.farm': 'passive income',
  'note.mine': 'more income',
  'note.turret': 'hits everyone: mobs, bosses, players · max 2',

  'src.common': 'mobs or lootbox',
  'src.rare': 'bosses or lootbox',
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

// Hat names come from balance.json in Russian only, so the English build needs
// its own table; anything missing falls back to the server-sent name.
const HAT_EN: Record<string, string> = {
  straw_hat: 'Straw Hat', cap: 'Cap', miner_helmet: "Miner's Helmet", bandana: 'Bandana',
  chef_hat: "Chef's Hat", champion_crown: "Champion's Crown", shadow_hood: 'Shadow Hood',
  crystal_circlet: 'Crystal Circlet', hunter_hood: "Hunter's Hood", skull_mask: 'Skull Mask',
  dragon_helm: 'Dragon Helm', wizard_hat: 'Wizard Hat', titan_guard: 'Titan Guard',
  golden_crown: 'Golden Crown', phoenix_plume: 'Phoenix Plume', slayer_crown: "Slayer's Crown",
};

/** Hat name in the current UI language. */
export function hatName(id: string, ruName: string): string {
  return lang === 'en' ? HAT_EN[id] ?? ruName : ruName;
}

/**
 * Weapon label for the hotbar and shop. Unique weapons have proper names;
 * ordinary ones use their id with underscores turned into spaces.
 */
export function weaponName(id: string): string {
  const unique = t(`wname.${id}`);
  if (!unique.startsWith('wname.')) return unique;
  return id.replace(/_/g, ' ');
}

// Biome names painted onto the ground. Localised here rather than taken from
// the shared BIOME_NAMES map, which is Russian-only.
const BIOME_EN: Record<string, string> = {
  normal: 'Plains',
  snow: 'Snowlands',
  desert: 'Desert',
  mystic_west: 'Dark Forest',
  mystic_east: 'Crystal Wastes',
};

/** Ground label for a biome in the current UI language. */
export function biomeLabel(id: string, ruName: string): string {
  return lang === 'en' ? BIOME_EN[id] ?? ruName : ruName;
}

// Boss names shown on the world label above each boss. Kept here (not in
// balance.json) because the label must follow the UI language, not the server.
const BOSS_RU: Record<string, string> = {
  champion: 'ЧЕМПИОН',
  frost_titan: 'ЛЕДЯНОЙ ИСПОЛИН',
  sand_worm: 'ПЕСЧАНЫЙ ЧЕРВЬ',
  shadow_lord: 'ВЛАДЫКА ТЕНЕЙ',
  crystal_queen: 'КРИСТАЛЬНАЯ КОРОЛЕВА',
};

/** Uppercase boss name in the current UI language, for the in-world label. */
export function bossLabel(id: string): string {
  return (lang === 'en' ? BOSS_EN[id] ?? id : BOSS_RU[id] ?? id).toUpperCase();
}

// English boss names (RU names come from balance.json via the event payload).
const BOSS_EN: Record<string, string> = {
  champion: 'Champion',
  frost_titan: 'Frost Titan',
  sand_worm: 'Sand Worm',
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
 * Switch language live (no reload, not persisted). Used to follow the Yandex
 * platform language (ysdk.environment.i18n.lang) when the player hasn't made a
 * manual choice — so the interface auto-matches their locale (rule 2.14).
 */
export function setLangLive(l: Lang): void {
  if (l === lang) return;
  lang = l;
  applyStaticI18n();
}

/** Whether the player has explicitly picked a language (which must win over the SDK). */
export function hasManualLang(): boolean {
  return localStorage.getItem(KEY) === 'ru' || localStorage.getItem(KEY) === 'en';
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
