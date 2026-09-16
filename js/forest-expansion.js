import { paintPath, rockGroups } from './forest-preview-landscape.js';

// Relative to a generation's goal: changing clearPoint changes the growth pace.
export function expansionArea(percent, cellSize = 112) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0)) / 100;
  return { x: (29 + p * 1.5) * cellSize, y: (23 + p) * cellSize,
    rx: (9 + p * 13) * cellSize, ry: (7 + p * 12) * cellSize };
}

export function isOpenGround(x, y, percent, retained = [], cell = 112) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const a = expansionArea(percent,cell);
  const inside = (cx,cy,rx,ry) => ((x-cx)/rx)**2+((y-cy)/ry)**2 <= 1;
  // Keep new objects inside the clear part, away from the feathered fog edge.
  return inside(a.x,a.y,a.rx*.85,a.ry*.85)
    || inside(a.x+a.rx*.42,a.y+a.ry*.4,a.rx*.6,a.ry*.53)
    || retained.some(p=>!p.systemGenerated && inside(Number(p.x)*cell,Number(p.y)*cell-cell,cell*2,cell*2));
}

export function createExpandingForest({world, camera, core, map}) {
  const cell = camera.cellSize, width = map.width * cell, height = map.height * cell;
  const terrain = document.createElement('canvas');
  terrain.className = 'expanding-terrain';
  terrain.width = Math.ceil(width / 2); terrain.height = Math.ceil(height / 2);
  terrain.style.width = `${width}px`; terrain.style.height = `${height}px`;
  world.prepend(terrain);
  const stones = document.createElement('div'); stones.className = 'expanding-stones';world.append(stones);
  const scale = cell / 45, ox = 29 * cell - 1250 * scale, oy = 23 * cell - 1030 * scale;
  for (const rock of rockGroups) {
    const img = document.createElement('img'); img.alt = '';
    img.src = `assets/rock_${rock.kind}_01.png`;
    img.style.cssText = `left:${ox + rock.x*scale}px;top:${oy + rock.y*scale}px;width:${rock.w*scale}px;height:${rock.h*scale}px`;
    stones.append(img);
  }
  const g = terrain.getContext('2d');
  g.scale(terrain.width/width,terrain.height/height);
  g.fillStyle = '#dce5b8';g.fillRect(0,0,width,height);
  const grass = new Image();
  grass.onload = () => {
    const tile = cell * 12;
    for(let y=0;y<height;y+=tile) for(let x=0;x<width;x+=tile){
      g.save();g.translate(x+(x/tile%2?tile:0),y+(y/tile%2?tile:0));
      g.scale(x/tile%2?-1:1,y/tile%2?-1:1);g.drawImage(grass,0,0,tile,tile);g.restore();
    }
    g.fillStyle='#faf0d448';g.fillRect(0,0,width,height);
    g.save();g.translate(ox,oy);g.scale(scale,scale);paintPath(g);g.restore();
  };
  grass.src = 'assets/grass-watercolor-v3.png';
  const ns = 'http://www.w3.org/2000/svg';
  const fog = document.createElementNS(ns,'svg');fog.classList.add('expanding-fog');
  fog.setAttribute('viewBox',`0 0 ${width} ${height}`);fog.setAttribute('width',width);fog.setAttribute('height',height);
  fog.innerHTML = `<defs><filter id="forest-soft-fog" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="95"/></filter><mask id="forest-open-ground" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="white"/><g fill="black" filter="url(#forest-soft-fog)" id="forest-clearings"></g></mask></defs><rect width="${width}" height="${height}" fill="#f1f0e3" mask="url(#forest-open-ground)"/>`;
  world.append(fog);
  const clearings = fog.querySelector('#forest-clearings');
  let signature = '';
  let animation = 0, shownArea = null;
  function update() {
    const state = core.getState();
    const area = expansionArea(core.getProgressPercent(),cell);
    // Preserve access to already-owned scenery when upgrading an existing forest.
    const retained = (state.placedAssets || []).filter(p=>!p.systemGenerated && !p.isSymbolTree && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)));
    const next = JSON.stringify([area,retained.map(p=>[p.x,p.y])]);
    if(next === signature) return; signature = next;
    const bounds = {left:Math.max(0,area.x-area.rx-cell*2),right:Math.min(width,area.x+area.rx*1.2+cell*2),top:Math.max(0,area.y-area.ry-cell*2),bottom:Math.min(height,area.y+area.ry*1.2+cell*2)};
    for(const p of retained){bounds.left=Math.min(bounds.left,Math.max(0,Number(p.x)*cell-cell*4));bounds.right=Math.max(bounds.right,Math.min(width,Number(p.x)*cell+cell*4));bounds.top=Math.min(bounds.top,Math.max(0,Number(p.y)*cell-cell*4));bounds.bottom=Math.max(bounds.bottom,Math.min(height,Number(p.y)*cell+cell*4));}
    camera.explorationBounds = bounds;
    camera.clampToBounds();
    clearings.replaceChildren();
    const ellipse = (x,y,rx,ry) => {const el=document.createElementNS(ns,'ellipse');for(const [key,value] of Object.entries({cx:x,cy:y,rx,ry}))el.setAttribute(key,value);clearings.append(el);return el;};
    const first=ellipse(area.x,area.y,area.rx,area.ry);
    const second=ellipse(area.x+area.rx*.42,area.y+area.ry*.4,area.rx*.72,area.ry*.65);
    for(const p of retained)ellipse(Number(p.x)*cell,Number(p.y)*cell-cell,cell*3,cell*3);
    cancelAnimationFrame(animation);
    const start=shownArea || area, began=performance.now();
    const calm=state.settings?.calmMode || matchMedia('(prefers-reduced-motion: reduce)').matches;
    function step(now){const t=calm?1:Math.min(1,(now-began)/900),ease=1-(1-t)**3;const a={};for(const k of ['x','y','rx','ry'])a[k]=start[k]+(area[k]-start[k])*ease;
      for(const [el,v] of [[first,[a.x,a.y,a.rx,a.ry]],[second,[a.x+a.rx*.42,a.y+a.ry*.4,a.rx*.72,a.ry*.65]]])['cx','cy','rx','ry'].forEach((key,i)=>el.setAttribute(key,v[i]));
      shownArea=a;if(t<1)animation=requestAnimationFrame(step);
    }
    step(began);
  }
  function fit() {
    const b=camera.explorationBounds;
    camera.zoom=camera.clampZoom(Math.min(camera.viewportWidth/(b.right-b.left),camera.viewportHeight/(b.bottom-b.top))*.94);
    camera.centerOnCell((b.left+b.right)/(2*cell),(b.top+b.bottom)/(2*cell));
  }
  update();
  function canPlace(cellX,cellY) {
    if(cellX<0 || cellY<0 || cellX>=map.width || cellY>=map.height)return false;
    return isOpenGround(cellX*cell,cellY*cell,core.getProgressPercent(),core.getState().placedAssets || [],cell);
  }
  return { update, fit, canPlace };
}
