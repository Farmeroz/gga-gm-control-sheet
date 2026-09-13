import { ID } from './core.mjs';

export function error(...details) {
  console.error(`${ID} |`, ...details);
}
