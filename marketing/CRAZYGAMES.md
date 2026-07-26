# CrazyGames submission kit

Everything needed for the developer portal, plus what the build does on-platform.

## Assets in this folder

| File | Use |
|---|---|
| `crazygames-cover-landscape.png` | 1920×1080 (16:9) landscape cover |
| `crazygames-cover-portrait.png` | 1080×1920 (9:16) portrait cover |
| `crazygames-cover-square.png` | 1080×1080 (1:1) square cover |
| `screen-1-combat.png` … `screen-4-buildings.png` | desktop gameplay stills |
| `mobile-1-combat.png` … `mobile-3-shop.png` | mobile gameplay stills |

Covers are generated from vector sources by `make-crazygames-covers.mjs`, so if
the portal asks for different pixel sizes they can be re-rendered exactly —
change the numbers at the bottom of that script and re-run it.

| `farmclash-preview.mp4` | 28 s gameplay preview, 1920×1080 (hover preview) |
| `farmclash-preview-vertical.mp4` | the same cut at 9:16, for mobile/social |

The preview is recorded from real play, not mocked: `record-preview.mjs` drives
a browser against a local server started with `video-rig-balance.json` (denser
mobs, a fast boss, a guaranteed legendary crate) and steers the hero by reading
the minimap canvas, so it stays off the world edge and walks into the boss
fight. The take is then cut into three beats — mob combat, the unique-weapon
reveal, the boss fight — and encoded to H.264. It has no audio: headless
Chromium has no audio device, and the portal plays hover previews muted.

## Store text (English)

**Title:** FarmClash

**Short description**
> Farm gold, buy weapons, and fight players and giant bosses in a fast .io arena.

**Description**
> FarmClash is a multiplayer .io arena where every run starts from nothing.
> Kill mobs to earn gold, spend it on weapons and buildings, and level up by
> fighting — but drop everything when you die.
>
> Explore five biomes, each ruled by its own boss with a signature attack: the
> Champion charges across the field, the Frost Titan freezes everything around
> it, the Sand Worm erupts from below, the Shadow Lord teleports onto you, and
> the Crystal Queen impales several players at once. Bosses roam the whole map,
> so nowhere is safe.
>
> Open crates for hats and unique weapons with powers you cannot buy: a hook
> that drags enemies to you, a blade that makes attacks miss, a scythe that
> executes wounded mobs, a bow whose arrows pierce four targets. Unique weapons
> vanish when you die — risk them or sell them high.
>
> Build farms and mines for passive income, defend them with turrets, and raid
> everyone else's. Play solo or invite a friend into your world.

**Controls**
> - WASD or arrow keys — move
> - Mouse — aim
> - Left mouse button — attack
> - 1–4 — switch weapons (drag hotbar slots to reorder)
> - B — shop (weapons, buildings, hats, crates)
> - Q — eat food to heal
> - Mobile: left stick to move, right side to aim and attack

**Tags:** io, multiplayer, action, survival, arena, pvp, rpg, upgrade

## What the CrazyGames build does

Built with `npm run build:crazygames -w client` (sets `VITE_PLATFORM=crazygames`).
Only the CrazyGames SDK is loaded — the Yandex code path is never touched.

- **SDK init** — `SDK.init()` is awaited before anything else (v3 requirement).
- **Gameplay markers** — `gameplayStart()` on entering the world and after
  respawn, `gameplayStop()` on death, so their metrics and ad timing are right.
- **Ads** — a midgame ad at the death break only (a natural pause, never mid-
  fight). Game audio is muted for the duration and restored after.
- **`happytime()`** — fires on real achievements: level-up, a new hat, a unique
  weapon drop, and a boss kill you actually contributed to.
- **Rooms and invites** — each of our worlds is a room. On entering a world we
  call `showInviteButton({ roomId })` so friends can join from the CrazyGames
  UI; the button is hidden on disconnect. A player arriving through an invite
  link is routed into that exact world (`getInviteLinkParameter('roomId')`), and
  an instant-multiplayer launch skips the menu straight into gameplay.
- **Accounts** — `SDK.user.getUserToken()` is forwarded to our server, which
  verifies it and keys a persistent account by the CrazyGames user id, so
  progress (gold, hats, prestige) follows the player. Guests can still play
  without logging in.
- **No external links** — the site, Telegram and share buttons are hidden on
  the platform, as required.

Multiplayer runs on our own server (`farmclash.online`), which CrazyGames
allows — they host the game files only.

## Server configuration

Token verification is off by default so the game works before registration.
After the game is registered, take the public key from the developer portal and
set on the VPS:

```
CRAZYGAMES_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
CRAZYGAMES_VERIFY_TOKEN=1
```

With those set, forged or tampered tokens are rejected (verified by
`server/scripts/crazygames-test.ts`). Until then the server decodes the token
without checking the signature and logs a warning on startup.
