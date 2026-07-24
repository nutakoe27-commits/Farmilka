// Quick sanity print of the freshly validated balance config.
import { loadBalance, getBalance } from '../src/game/balance.js';

loadBalance();
const b = getBalance();
console.log('bosses:', Object.keys(b.bosses).join(','));
console.log('uniques:', Object.entries(b.bosses).map(([k, v]) => `${k}:${v.unique.kind}@${v.biome}`).join(' '));
console.log('weapons:', Object.keys(b.weapons).length);
console.log('uniqueWeapons:', Object.entries(b.weapons).filter(([, w]) => w.tier).map(([k, w]) => `${k}(${w.tier})`).join(' '));
console.log('hatLootbox:', JSON.stringify(b.hats.lootbox));
console.log('weaponLootbox:', JSON.stringify(b.weaponLootbox));
