// Each stage changes the tree's silhouette, branches and foliage.
export const TREE_GROWTH_STAGES = Object.freeze([
  { min: 0, name: 'めばえ', image: 'tree_symbol_stage_01.png', scale: 4 },
  { min: 20, name: 'なえぎ', image: 'tree_symbol_stage_02.png', scale: 5 },
  { min: 40, name: 'わかぎ', image: 'tree_symbol_stage_03.png', scale: 7 },
  { min: 60, name: 'おおきな き', image: 'tree_symbol_stage_04.png', scale: 9 },
  { min: 80, name: 'はなさく き', image: 'tree_symbol_01.png', scale: 11 }
].map(Object.freeze));

export function symbolTreeStage(progressPercent) {
  const value = Number(progressPercent);
  const progress = Number.isNaN(value) ? 0 : Math.max(0, Math.min(100, value));
  return TREE_GROWTH_STAGES.findLast(stage => progress >= stage.min);
}
