# CrazyGames submission kit

Everything needed for the developer portal, plus what the build does on-platform.

The game is pitched on the loop that is actually ours: **build a base, bank what
you earn, break into everyone else's.** Every asset in this folder says that.

## Assets in this folder

| File | Use |
|---|---|
| `crazygames-cover-landscape.png` | 1920×1080 (16:9) landscape cover |
| `crazygames-cover-portrait.png` | 1080×1920 (9:16) portrait cover |
| `crazygames-cover-square.png` | 1080×1080 (1:1) square cover |
| `screen-1-base.png` | a walled base: vault, farms, turret, wall line |
| `screen-2-raid.png` | breaking into someone else's base |
| `screen-3-combat.png` | field combat with the local wildlife |
| `screen-4-shop.png` | the shop: vault, Base Rank, buildings |
| `screen-5-boss.png` | a boss telegraphing its signature attack |
| `mobile-1-play.png`, `mobile-2-shop.png` | mobile gameplay stills |
| `farmclash-preview.mp4` | gameplay preview, 1920×1080 (hover preview) |
| `farmclash-preview-vertical.mp4` | the same cut at 9:16, for mobile/social |

### Regenerating them

```
cd marketing
npm install                 # playwright + ffmpeg-static, kept out of the game build
npm run covers              # vector covers -> SVG -> PNG
npm run shots               # screenshots, needs the capture server (below)
npm run preview             # the video, needs the video server (below)
npm run ux                  # UI smoke check for the build/demolish flow (not a store asset)
```

Covers are vector (`make-crazygames-covers.mjs`), so if the portal ever asks for
different pixel sizes, change the numbers at the bottom of that script and
re-render — no image editing.

Screenshots and the video are captured from **real play**, never staged. Both
scripts drive a browser against a local server started with a rig balance:

```
# screenshots — a compact world so two clients meet, gold to wall a base in
DATA_DIR=/tmp/cap PORT=3996 BALANCE_PATH=marketing/capture-rig-balance.json \
  npx tsx src/index.ts        # from server/

# preview video — slow-motion rig, see the note below
DATA_DIR=/tmp/vid PORT=3993 BALANCE_PATH=marketing/video-rig-balance.json \
  npx tsx src/index.ts        # from server/
```

`capture-screens.mjs` joins twice — a defender who builds a walled base and a
raider who walks over and smashes it — and shoots from whichever side tells the
story. It converts screen clicks to world coordinates through a small read-only
hook the client exposes (`window.farmclashView`), so a wall line lands exactly
shoulder-to-shoulder instead of approximately.

### Why the video is recorded in slow motion

Headless Chromium has no GPU, so WebGL falls back to software rasterisation and
the game renders at only ~4-5 fps at 1080p. The recording works around that: the
world runs at 1/S speed (make-video-rig.mjs scales every rate and duration) and
is captured at 720p, then the video is sped back up by S and upscaled, so each
frame the browser did manage to draw lands on a distinct moment.

S is the `SLOWMO` env var and must be the same for the rig and the recorder:

```
SLOWMO=5 node make-video-rig.mjs
SLOWMO=5 node record-preview.mjs
```

The current preview is S=5: 25 s at 1920×1080, of which ~520 of 751 frames are
genuinely distinct (~21 effective fps). S=2.5 gave a longer clip but only ~10
effective fps. Higher S is smoother but shorter — the cut windows are measured
in raw capture seconds and get divided by S — so raising S means widening the
windows in `cut()` to keep the clip around 25-30 s.

The preview has no audio: headless Chromium has no audio device, and the portal
plays hover previews muted.

## Store text (English)

**Title:** FarmClash

**Tagline:** Build your farm. Raid theirs.

**Short description**
> Build a walled farm, bank your gold, then smash your way into everyone else's
> base before they do it to yours.

**Description**
> FarmClash is a multiplayer .io game about a base you actually have to defend.
>
> You start with a vault and a farm. Farms and mines fill up whether you are
> there or not, so every run is a decision: keep farming, or walk the gold home
> before someone takes it. Gold in your hands is lost the moment you die. Gold
> in your vault is safe — until a raider cracks it open.
>
> Wall your base in. Walls are solid: enemies and monsters have to break
> through, and only you can walk through your own. Add turrets, then go out and
> do the same to somebody else. Every base you find is a real player's — the
> ones who are offline are still standing there, silos full, waiting for
> someone to take a hammer to them.
>
> Banking gold raises your Base Rank forever: wider silos, faster production,
> more building slots, a tougher vault. It never touches your damage, health or
> speed, so a veteran's base is richer than yours — never harder to kill.
>
> Five biomes, each ruled by its own boss with a signature attack: the Champion
> charges, the Frost Titan freezes, the Sand Worm erupts from below, the Shadow
> Lord teleports onto you, the Crystal Queen impales half the field. Bosses roam
> the whole map, and they do not care whose walls are in the way.
>
> Open crates for hats and unique weapons you cannot buy: a hook that drags
> enemies to you, a blade that makes attacks miss, a scythe that executes
> wounded monsters, a bow whose arrows pierce four targets. Unique weapons
> vanish when you die — risk them, or sell them high.
>
> Play solo or invite a friend straight into your world.

**Controls**
> - WASD or arrow keys — move
> - Mouse — aim
> - Left mouse button — attack
> - 1–4 — switch weapons (drag hotbar slots to reorder)
> - B — shop (weapons, buildings, walls, hats, crates)
> - Q — eat food to heal
> - Mobile: left stick to move, right side to aim and attack

**Tags:** io, multiplayer, base building, raid, action, survival, arena, pvp, upgrade

## What the CrazyGames build does

Built with `npm run build:crazygames -w client` (sets `VITE_PLATFORM=crazygames`).
Only the CrazyGames SDK is ever fetched — the Yandex init never runs. (Both
adapters are still linked into the bundle: the platform choice resolves through
a runtime host check, so the bundler cannot drop one. It is a couple of kB of
dead code and nothing is loaded from it.)

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
  progress (gold, vault, base layout, Base Rank, hats) follows the player.
  Guests can still play without logging in.
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
