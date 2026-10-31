import ember from '../../bosses/house/ember-anvil.json';
import neon from '../../bosses/house/neon-brood.json';
import prism from '../../bosses/house/prism-warden.json';
import serpent from '../../bosses/house/brass-serpent.json';
import { BossSchema } from '../../engine/boss-api';

export const houseBosses = [ember, neon, prism, serpent].map((boss) => BossSchema.parse(boss));
