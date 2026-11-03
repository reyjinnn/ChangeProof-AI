/* global process, console */
// Minimal mutex target for native counterexample replay (WP3-33 / T-37).
// Usage: node checker-target.mjs <buggy|fixed> <op...>
// Prints one JSON line: { "endState": string, "violated": string[] }.
const [, , mode, ...ops] = process.argv;
if (mode !== 'buggy' && mode !== 'fixed') {
  console.error('mode must be buggy or fixed');
  process.exit(2);
}
const held = new Set();
for (const op of ops) {
  if (op === 'acquire-a' || op === 'acquire-b') {
    const owner = op === 'acquire-a' ? 'a' : 'b';
    if (mode === 'fixed' && held.size > 0 && !held.has(owner)) {
      continue; // blocked: a correct mutex never grants a second holder
    }
    held.add(owner);
  } else if (op === 'release-a') {
    held.delete('a');
  } else if (op === 'release-b') {
    held.delete('b');
  } else {
    console.error(`unknown op: ${op}`);
    process.exit(2);
  }
}
const endState =
  held.size === 0 ? 'idle' : held.has('a') && held.has('b') ? 'both' : held.has('a') ? 'locked-a' : 'locked-b';
console.log(JSON.stringify({ endState, violated: endState === 'both' ? ['never-both'] : [] }));
