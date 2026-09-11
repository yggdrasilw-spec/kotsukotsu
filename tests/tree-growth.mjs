import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('js/tree-growth.js', root), 'utf8');
const { symbolTreeStage, TREE_GROWTH_STAGES } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
assert.equal(new Set(TREE_GROWTH_STAGES.map(stage => stage.image)).size, 5, 'Growth needs five distinct images');
for (const [percent, index] of [[-5,0],[0,0],[19.99,0],[20,1],[39.99,1],[40,2],[59.99,2],[60,3],[79.99,3],[80,4],[100,4],[150,4],[NaN,0]]) {
  const stage = symbolTreeStage(percent);
  assert.equal(stage, TREE_GROWTH_STAGES[index], `Stage boundary at ${percent}%`);
  assert.ok(existsSync(new URL(`assets/${stage.image}`, root)), `Missing stage sprite: ${stage.image}`);
}
assert.equal(symbolTreeStage(10).scale, symbolTreeStage(19).scale, 'A stage does not merely keep enlarging the same sprite');
assert.equal(symbolTreeStage(90).image, symbolTreeStage(100).image);
assert.equal(symbolTreeStage(0).image, TREE_GROWTH_STAGES[0].image, 'New forest returns to seedling');
console.log('PASS: five distinct growth sprites, exact thresholds, clamped progress, new forest reset');
