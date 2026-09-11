import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const source = file => readFileSync(new URL(file, root), 'utf8');
const url = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
const coreUrl = url(source('js/core-runtime.js'));
const treeUrl = url(source('js/tree-growth.js'));
const rendererUrl = url(source('js/render.js').replace('./core-runtime.js', coreUrl).replace('./tree-growth.js', treeUrl));
class Element {
  style = { setProperty() {} }; dataset = {}; children = []; className = '';
  appendChild(child) { this.children.push(child); child.parent = this; }
  get firstChild() { return this.children[0]; }
  remove() { this.parent.children = this.parent.children.filter(c => c !== this); }
}
globalThis.document = { createElement: () => new Element() };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.window = { localStorage };
try {
  const { ForestCore } = await import(coreUrl);
  const { createForestRenderer } = await import(rendererUrl);
  const assets = JSON.parse(source('data/assets.json')).assets;
  const core = new ForestCore({ assets, spots: [] });
  const state = core.getState();
  state.classInfo.clearPoint = 1000;
  state.placedAssets = [{ placedId: 'tree', assetId: 'tree_symbol_01', isSymbolTree: true, x: 29, y: 24 }];
  const layer = new Element();
  const renderer = createForestRenderer({ layers: { assets: layer }, assets, map: { width: 58, height: 46 }, camera: { cellSize: 112, zoom: 1, clampToBounds() {}, getVisibleRect: () => ({ x: 0, y: 0, width: 10000, height: 10000 }) } });
  const expected = ['tree_symbol_stage_01.png', 'tree_symbol_stage_02.png', 'tree_symbol_stage_03.png', 'tree_symbol_stage_04.png', 'tree_symbol_01.png', 'tree_symbol_stage_01.png'];
  for (const [i, points] of [0, 200, 400, 600, 800, 0].entries()) {
    state.classPoints = points;
    renderer.render(state);
    assert.equal(layer.children.length, 1, 'Keep the same placed tree node');
    assert.ok(layer.children[0].style.backgroundImage.includes(expected[i]), `Wrong rendered image at ${points} points`);
    renderer.render(state);
    assert.equal(layer.children.length, 1, 'Repeated snapshots do not duplicate the tree');
  }
  console.log('PASS: renderer swaps all five images on the existing tree and resets to seedling');
} catch (error) { console.error(error.message); process.exitCode = 1; }

