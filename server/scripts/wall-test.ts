// Walls, for real this time: they are solid, they can be laid shoulder to
// shoulder, they run on their own build budget, and the owner still gets to
// walk around inside their own base.
import { loadBalance, getBalance } from '../src/game/balance.js';
import { World } from '../src/game/world.js';
import { makeBuilding, tryPlaceBuilding, canPlaceAt, minSpacing, countBuildings, grantStarterBase } from '../src/game/buildings.js';
import { updatePlayers } from '../src/game/player.js';
import { resolveSolids } from '@shared/collision.js';
import { restoreBase, captureBase } from '../src/game/base.js';
import type { Player } from '../src/game/entities.js';

loadBalance();
const bal = getBalance();
const WALL_R = bal.buildings.wall.radius;
const PR = bal.player.radius;

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`);
  ok ? pass++ : fail++;
};

function addPlayer(world: World, name = 'P', x = 3000, y = 3000): Player {
  const p = world.spawnPlayer(name, null);
  p.ws = { readyState: 99 } as never;
  p.invulnUntil = 0;
  p.hp = p.maxHp = 10_000;
  world.moveEntity(p, x, y);
  return p;
}

/** Feeds movement input for `steps` ticks, as the game loop would. */
function walk(world: World, p: Player, mx: number, my: number, steps = 60): void {
  p.input = { seq: 1, mx, my, aim: 0, attack: false };
  for (let i = 0; i < steps; i++) updatePlayers(world, 1 / 30, Date.now());
  p.input = { seq: 2, mx: 0, my: 0, aim: 0, attack: false };
}

// ---------- the resolver itself ----------
{
  const wall = { x: 100, y: 100, radius: WALL_R };
  const inside = resolveSolids(100, 100, PR, [wall]);
  check('a body inside a wall is ejected', Math.hypot(inside.x - 100, inside.y - 100) >= WALL_R,
    `d=${Math.hypot(inside.x - 100, inside.y - 100).toFixed(1)}`);

  const head = resolveSolids(100 - WALL_R, 100, PR, [wall]);
  check('walking into a wall face stops at its surface', head.x <= 100 - WALL_R - PR + 0.01,
    `x=${head.x.toFixed(1)} limit=${100 - WALL_R - PR}`);
  check('the tangential component survives (you slide, not stick)', Math.abs(head.y - 100) < 0.01, `y=${head.y}`);

  // two walls exactly touching: nothing of player size fits through the seam
  const a = { x: 0, y: 0, radius: WALL_R };
  const b = { x: WALL_R * 2, y: 0, radius: WALL_R };
  let sx = WALL_R, sy = -WALL_R - PR; // lined up with the seam, just outside
  for (let i = 0; i < 40; i++) {
    const step = resolveSolids(sx, sy + 8, PR, [a, b]);
    sx = step.x;
    sy = step.y;
  }
  check('a touching pair of walls has no gap to squeeze through', sy <= -WALL_R,
    `y=${sy.toFixed(1)} limit=${-WALL_R}`);

  // buried in the middle of a wall line, the way out is sideways, not along it
  const line = [-1, 0, 1].map((i) => ({ x: i * WALL_R * 2, y: 0, radius: WALL_R }));
  const buried = resolveSolids(0, 0, PR, line);
  check('a body buried in a wall line escapes perpendicular to it',
    Math.abs(buried.y) >= WALL_R, `pos=${buried.x.toFixed(0)},${buried.y.toFixed(0)}`);
}

// ---------- solid in the world ----------
{
  const world = new World(1);
  const me = addPlayer(world, 'Raider', 3000, 3000);
  const owner = addPlayer(world, 'Owner', 5000, 5000);
  const now = Date.now();
  // a wall line across the raider's path
  for (let i = -2; i <= 2; i++) {
    makeBuilding(world, 'wall', 3200, 3000 + i * WALL_R * 2, { id: owner.id, name: owner.name, account: null }, now);
  }
  walk(world, me, 1, 0, 120);
  check('a stranger cannot walk through a wall line', me.x < 3200 - WALL_R,
    `x=${me.x.toFixed(0)} wall=${3200 - WALL_R}`);

  // the owner is at home and passes through their own fortification
  world.moveEntity(owner, 3000, 3000);
  walk(world, owner, 1, 0, 120);
  check('the owner walks through their own walls', owner.x > 3200 + WALL_R,
    `x=${owner.x.toFixed(0)}`);

  // ...and gets pushed out if a wall lands on top of them
  world.moveEntity(me, 3200, 3000);
  walk(world, me, 0, 0, 5);
  check('a body caught inside a foreign wall is pushed out',
    Math.abs(me.x - 3200) > WALL_R || Math.abs(me.y - 3000) > WALL_R,
    `pos=${me.x.toFixed(0)},${me.y.toFixed(0)}`);
}

// ---------- placement spacing ----------
{
  const world = new World(1);
  const p = addPlayer(world, 'Builder', 2000, 2000);
  const q = addPlayer(world, 'Neighbour', 6000, 6000);
  const now = Date.now();

  check('a wall next to your own wall only needs to not overlap',
    minSpacing('wall', 'wall', true) === WALL_R * 2, `${minSpacing('wall', 'wall', true)}`);
  check('a wall next to a stranger keeps the wide spacing',
    minSpacing('wall', 'wall', false) === bal.economy.buildingMinDist, `${minSpacing('wall', 'wall', false)}`);
  check('two farms still keep the wide spacing',
    minSpacing('farm', 'farm', true) === bal.economy.buildingMinDist);

  makeBuilding(world, 'wall', 2000, 2000, { id: p.id, name: p.name, account: null }, now);
  check('you may lay your own walls shoulder to shoulder',
    canPlaceAt(world, 'wall', 2000 + WALL_R * 2, 2000, p.id));
  check('but not overlapping', !canPlaceAt(world, 'wall', 2000 + WALL_R * 2 - 4, 2000, p.id));
  check('a stranger cannot brick up against your base',
    !canPlaceAt(world, 'wall', 2000 + WALL_R * 2, 2000, q.id));
}

// ---------- wall budget is separate from the building budget ----------
{
  const world = new World(1);
  const p = addPlayer(world, 'Fortifier', 2000, 2000);
  p.money = 1_000_000;
  const now = Date.now();
  // fill the ordinary slots with farms placed by hand (no range limit here)
  for (let i = 0; i < bal.economy.maxBuildingsPerPlayer; i++) {
    const b = makeBuilding(world, 'farm', 1000 + i * 150, 1000, { id: p.id, name: p.name, account: null }, now);
    p.buildingIds.add(b.id);
  }
  check('the ordinary slots are full', countBuildings(world, p).other >= bal.economy.maxBuildingsPerPlayer);
  const wall = tryPlaceBuilding(world, p, 'wall', p.x + 60, p.y);
  check('walls can still be built when the farm slots are full', wall.ok, wall.reason ?? '');
  const farm = tryPlaceBuilding(world, p, 'farm', p.x, p.y + 140);
  check('another farm is still refused', !farm.ok, farm.reason ?? '');

  // fill the wall budget too
  let placed = countBuildings(world, p).walls;
  for (let i = 0; placed < bal.economy.maxWallsPerPlayer && i < 200; i++) {
    const b = makeBuilding(world, 'wall', 4000 + (i % 20) * WALL_R * 2, 4000 + Math.floor(i / 20) * WALL_R * 2,
      { id: p.id, name: p.name, account: null }, now);
    p.buildingIds.add(b.id);
    placed++;
  }
  const over = tryPlaceBuilding(world, p, 'wall', p.x - 60, p.y);
  check('the wall budget is enforced', !over.ok, over.reason ?? '');
}

// ---------- a tightly packed base survives a save/restore round-trip ----------
{
  const world = new World(1);
  const p = addPlayer(world, 'Packer', 2500, 2500);
  p.account = 'Packer';
  grantStarterBase(world, p);
  const now = Date.now();
  for (let i = 0; i < 6; i++) {
    const b = makeBuilding(world, 'wall', 2200 + i * WALL_R * 2, 2700, { id: p.id, name: p.name, account: 'Packer' }, now);
    p.buildingIds.add(b.id);
  }
  const snap = captureBase(world, p);
  const walls = snap.buildings.filter((b) => b.t === 'wall').length;
  check('the snapshot keeps every wall', walls === 6, `walls=${walls}`);

  // rebuild it in a fresh world, the way a login does
  const world2 = new World(2);
  const p2 = addPlayer(world2, 'Packer', 100, 100);
  p2.account = 'Packer';
  const stub = { ...snap };
  // restoreBase reads from the DB; exercise the placement rule directly instead
  let fits = 0;
  for (const sb of stub.buildings) {
    if (canPlaceAt(world2, sb.t, sb.x, sb.y, p2.id, true)) {
      const b = makeBuilding(world2, sb.t, sb.x, sb.y, { id: p2.id, name: p2.name, account: 'Packer' }, now);
      p2.buildingIds.add(b.id);
      fits++;
    }
  }
  check('a packed base rebuilds without dropping its own walls', fits === stub.buildings.length,
    `${fits}/${stub.buildings.length}`);
  void restoreBase;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
