import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GraphV1 } from '../graph/types.js';

/** `computeStats` lives in `util/state.ts` alongside the rest of the `.cache/`
 * state, so the hooks and the graph's own pre-query refresh report the same
 * numbers. Re-exported here because that's where callers already import it from. */
export { computeStats } from '../util/state.js';

export function readWiring(projectDir: string): GraphV1 | null {
  try {
    return JSON.parse(readFileSync(join(projectDir, 'graft', '.graph', 'wiring.json'), 'utf8')) as GraphV1;
  } catch { return null; }
}
