// A stable flower for each 20 shared points. Reopening never invents new progress.
export function growthFlowers(points, generation = 1) {
  const count = Math.min(250, Math.floor(Math.max(0, Number(points) || 0) / 20));
  return Array.from({ length: count }, (_, i) => {
    const angle = (i * 137.508 + generation * 17) * Math.PI / 180;
    const radius = 3.8 + Math.sqrt(i / 250) * 10;
    return { x: 29 + Math.cos(angle) * radius, y: 24 + Math.sin(angle) * radius * .48, variant: i % 3 };
  });
}

export function createGrowthView({ core, camera, viewport }) {
  const scene = document.createElement('div');
  scene.className = 'living-garden';
  document.getElementById('forestWorld').prepend(scene);
  let signature = '';
  let announcementTimer;
  function update() {
    const state = core.getState();
    const percent = core.getProgressPercent();
    const flowers = growthFlowers(state.classPoints, state.forestGeneration);
    const next = `${flowers.length}:${state.forestGeneration}`;
    if (next !== signature) {
      signature = next;
      scene.innerHTML = `<div class="garden-clearing"></div><div class="garden-path"></div>` +
        flowers.map((f, i) => `<img class="garden-flower" alt="" src="assets/flower-effort-v2.png" style="left:${f.x * 112}px;top:${f.y * 112}px;--turn:${(i % 5 - 2) * 8}deg" />`).join('');
    }
    const nextEvent = core.events.find(e => e.progress > percent);
    const nextLabel = document.getElementById('gardenNext');
    if (nextLabel) nextLabel.textContent = nextEvent ? `つぎは… ${nextEvent.title}` : 'みんなで そだてた もり！';
    const fill = document.getElementById('gardenProgress');
    if (fill) fill.style.width = `${Math.min(100, percent)}%`;
    const label = document.getElementById('gardenProgressLabel');
    if (label) label.textContent = `もりの せいちょう ${Math.floor(percent)}%`;
    document.getElementById('gardenMode').textContent = core.sharedMode ? 'みんなの もり' : 'れんしゅうの もり';
  }
  function celebrate(origin, text = 'あなたの「できた！」で おはなが さいたよ') {
    camera.zoom = Math.min(viewport.clientWidth / (32 * 112), viewport.clientHeight / (23 * 112));
    camera.centerOnCell(29, 22);
    const status = document.getElementById('growthMessage');
    status.textContent = text;
    status.classList.add('is-visible');
    clearTimeout(announcementTimer);
    announcementTimer = setTimeout(() => status.classList.remove('is-visible'), 5500);
    viewport.classList.remove('just-grew');
    void viewport.offsetWidth;
    viewport.classList.add('just-grew');
    if (core.getState().settings?.calmMode || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = viewport.getBoundingClientRect();
    const anchor = camera.worldToScreen(29 * 112, 23 * 112);
    const end = {x: rect.left + anchor.x, y: rect.top + anchor.y};
    const start = origin ? {x: origin.left + origin.width / 2, y: origin.top + origin.height / 2} : {x: rect.left + rect.width / 2, y: rect.bottom - 60};
    const seed = document.createElement('div');
    seed.className = 'effort-seed'; seed.textContent = '🌱';
    seed.style.left = `${start.x}px`; seed.style.top = `${start.y}px`;
    document.body.append(seed);
    const animation = seed.animate([
      {transform: 'translate(-50%,-50%) scale(.7)', opacity: 0},
      {transform: `translate(${(end.x-start.x)*.5}px,${(end.y-start.y)*.5-90}px) scale(1.3)`, opacity: 1, offset: .5},
      {transform: `translate(${end.x-start.x}px,${end.y-start.y}px) scale(.6)`, opacity: 0}
    ], {duration: 1100, easing: 'ease-in-out'});
    animation.finished.finally(() => seed.remove());
  }
  return { update, celebrate };
}
