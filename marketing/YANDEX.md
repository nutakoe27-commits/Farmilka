# Яндекс Игры — материалы черновика

Всё, что вставляется в форму черновика, и что делает сборка на платформе.
Тексты даны отдельно для русского и английского черновика: по п. 8.2.3 поля,
зависящие от языка, должны быть на языке черновика — это относится и к
обложке, и к скриншотам.

## Правила, под которые всё это подогнано

| Пункт | Что требует | Как выполнено |
|---|---|---|
| 5.1.3 | название одинаково в игре и во всех материалах | везде ровно `FarmClash` — в игре, на обложке, в заголовке черновика |
| 8.4.2 | никаких доменных зон и ссылок в текстах и графике | из текстов и с обложки убрано `.io`; жанр называется «многопользовательская онлайн-игра» |
| 8.3.3 | медиа без скруглённых углов и рамок | иконка и обложки рисуются во всё поле кадра, логотип — прямой квадрат |
| 8.2.3 | тексты по языку черновика | два комплекта: `yandex-cover-ru.png` + `yandex-ru-*.png` и `yandex-cover-en.png` + `yandex-en-*.png` |
| 2.7 | возрастной рейтинг | 6+ (условное насилие), выставлен модератором — оставляем |

## Материалы

| Файл | Куда |
|---|---|
| `yandex-icon.png` | иконка 512×512, общая для обоих черновиков (без текста) |
| `yandex-cover-ru.png` | обложка 800×470 — **русский** черновик |
| `yandex-cover-en.png` | обложка 800×470 — **английский** черновик |
| `yandex-ru-screen-1-base.png` … `-5-boss.png` | скриншоты 1280×720 — русский черновик |
| `yandex-en-screen-1-base.png` … `-5-boss.png` | скриншоты 1280×720 — английский черновик |
| `yandex-ru-mobile-*.png`, `yandex-en-mobile-*.png` | мобильные скриншоты по языкам |

Пересобрать: `npm run yandex` (иконка и обложки), `npm run shots:ru` и
`npm run shots:en` (скриншоты, нужен сервер захвата — см. CRAZYGAMES.md).

---

## Русский черновик

**Название**
```
FarmClash
```

**Краткое описание**
```
Строй ферму, обноси её стеной и грабь чужие базы, пока не разграбили твою.
```

**Описание**
```
FarmClash — многопользовательская онлайн-игра про базу, которую придётся защищать по-настоящему.

Вы начинаете с хранилища и фермы. Фермы и шахты копят золото независимо от того, в игре вы или нет, поэтому каждая вылазка — это выбор: фармить дальше или донести добычу домой, пока её не отобрали. Золото в руках теряется в момент смерти. Золото в хранилище в безопасности — пока до него не доберётся рейдер.

Обнесите базу стеной. Стены сплошные: враги и мобы обязаны их проломить, а сквозь свои проходите только вы. Поставьте турели — и отправляйтесь делать то же самое с чужой базой. Каждая база принадлежит живому игроку: те, кто сейчас офлайн, стоят на карте с полными силосами и ждут, когда до них дойдут с молотом.

Золото, занесённое в хранилище, навсегда поднимает ранг базы: шире силосы, быстрее производство, больше слотов под постройки, крепче хранилище. Ранг никогда не трогает урон, здоровье и скорость — база ветерана богаче вашей, но убить его не сложнее.

Пять биомов, у каждого свой босс с фирменной атакой: Чемпион разгоняется в рывке, Ледяной Исполин вымораживает всё вокруг, Песчаный Червь бьёт из-под земли, Владыка Теней телепортируется вплотную, Кристальная Королева насаживает полполя. Боссы ходят по всей карте, и чьи там стены — им безразлично.

Открывайте сундуки ради шляп и уникального оружия, которое нельзя купить: крюк, притягивающий врага, клинок, по владельцу которого промахиваются, коса, добивающая раненых мобов, лук, чьи стрелы прошивают четыре цели. Уникальное оружие исчезает при смерти — рискуйте им или продавайте подороже.
```

**Управление**
```
WASD или стрелки — движение
Мышь — прицел
ЛКМ — атака
1–4 — смена оружия (слоты можно перетаскивать)
B — магазин: оружие, постройки, стены, шляпы, сундуки
Q — съесть еду и подлечиться
Телефон: левый джойстик — движение, правая кнопка — атака (тап — автоприцел, тяни — ручной)
```

**Категории/теги:** многопользовательские, экшен, выживание, стратегия, аркады

---

## English draft

**Title**
```
FarmClash
```

**Short description**
```
Build a walled farm, bank your gold, then raid everyone else before they raid you.
```

**Description**
```
FarmClash is a multiplayer online game about a base you actually have to defend.

You start with a vault and a farm. Farms and mines fill up whether you are there or not, so every run is a decision: keep farming, or walk the gold home before someone takes it. Gold in your hands is lost the moment you die. Gold in your vault is safe — until a raider cracks it open.

Wall your base in. Walls are solid: enemies and monsters have to break through, and only you can walk through your own. Add turrets, then go out and do the same to somebody else. Every base you find belongs to a real player — the ones who are offline are still standing there, silos full, waiting for someone to take a hammer to them.

Banking gold raises your Base Rank forever: wider silos, faster production, more building slots, a tougher vault. It never touches your damage, health or speed, so a veteran's base is richer than yours — never harder to kill.

Five biomes, each ruled by its own boss with a signature attack: the Champion charges, the Frost Titan freezes, the Sand Worm erupts from below, the Shadow Lord teleports onto you, the Crystal Queen impales half the field. Bosses roam the whole map, and they do not care whose walls are in the way.

Open crates for hats and unique weapons you cannot buy: a hook that drags enemies to you, a blade that makes attacks miss, a scythe that executes wounded monsters, a bow whose arrows pierce four targets. Unique weapons vanish when you die — risk them, or sell them high.
```

**Controls**
```
WASD or arrow keys — move
Mouse — aim
Left mouse button — attack
1–4 — switch weapons (hotbar slots can be dragged)
B — shop: weapons, buildings, walls, hats, crates
Q — eat food to heal
Phone: left stick to move, right button to attack (tap for auto-aim, drag to aim)
```

**Tags:** multiplayer, action, survival, strategy, arcade

---

## Что делает сборка на платформе

Собирается через `npm run build:yandex -w client` (`VITE_PLATFORM=yandex`).

- **LoadingAPI.ready** вызывается сразу после инициализации SDK. До этого момента
  игру закрывает загрузочная заслонка, которая перехватывает все клики — по
  п. 1.19 игра не должна быть кликабельной до GameReady.
- **GameplayAPI start/stop** — на входе в мир, после возрождения и на смерти.
- **Реклама** — полноэкранная только по нажатию «Возродиться» на экране смерти.
  Смерть сама по себе не действие игрока, поэтому реклама ждёт его нажатия
  (п. 4.4). Звук игры на время ролика приглушается (п. 4.7).
- **Внешние ссылки** скрыты с первого кадра во всей портальной сборке, а не
  после ответа SDK — иначе при медленной инициализации они успевают мелькнуть
  (пп. 8.4.2, 8.4.3).
- **Выделение и контекстное меню** отключены во всём интерфейсе, текст
  выделяется только в поле ввода имени (пп. 1.6.1.8, 1.6.2.7).
- **Безопасные зоны** — весь HUD отступает от «чёлки» и домашней полосы через
  `env(safe-area-inset-*)`, панели ограничены по высоте (п. 1.10.1).
- **Аккаунты** — подпись игрока Яндекса передаётся на наш сервер, прогресс
  (золото, хранилище, база, ранг, шляпы) сохраняется между сеансами. Гости
  играют без входа.

## Обязательное действие на стороне Яндекса

Мультиплеер работает на нашем сервере `farmclash.online`. Архив на CDN Яндекса
имеет строгий CSP, и без явного разрешения соединение WebSocket не открывается —
игра доходит до меню и не запускается дальше. Это ровно та картина, что описана
в замечании по п. 1.15.

В консоли разработчика нужно запросить добавление домена в CSP игры:

```
connect-src  wss://farmclash.online  https://farmclash.online
```

До того как домен разрешат, игра на платформе играться не будет, какими бы
правильными ни были остальные пункты.
