import { loadForestBundle } from './data-loader.js';
import { ForestCore, SaveManager } from './core-runtime.js';
import { Camera } from './camera.js';
import { createForestRenderer } from './render.js';
import { createExpandingForest } from './forest-expansion.js';
import { growthFlowers } from './growth-view.js';
const el=id=>document.getElementById(id);
let pending=null,ready=false,renderData;
window.addEventListener('message',event=>{if(event.origin!==location.origin || event.source!==parent || event.data?.type!=='class-forest')return;pending=event.data;if(ready)renderData(pending);});
async function start(){
 const {assets,spots,map,events}=await loadForestBundle();
 const memory={load:()=>new SaveManager().defaultState(),save(){}};
 const core=new ForestCore({assets,spots,saveManager:memory});core.setEvents(events);
 const viewport=el('forestViewport'),world=el('forestWorld');
 viewport.style.visibility='hidden';
 const camera=new Camera({cellSize:map.cellSize,mapWidth:map.width,mapHeight:map.height,minZoom:.04,maxZoom:1.2});
 const renderer=createForestRenderer({viewportEl:viewport,worldEl:world,camera,map,assets,spots,layers:{terrain:el('layerTerrain'),assets:el('layerAssets'),animals:el('layerAnimals')}});
 const landscape=createExpandingForest({world,camera,core,map});
 const flowers=document.createElement('div');flowers.className='living-garden';world.append(flowers);
 let connectedCode='',generation=0;
 const refresh=()=>{landscape.update();renderer.render(core.state);};
 new ResizeObserver(()=>{camera.setViewport(viewport.clientWidth,viewport.clientHeight);landscape.fit();refresh();}).observe(viewport);
 renderData=data=>{
  if(!data.classCode || !data.classData){viewport.style.visibility='hidden';el('classCode').textContent='——';el('progressLabel').textContent='クラスの接続を待っています';el('status').textContent='先生画面でクラスを開いてください';connectedCode='';return;}
  const fs=data.classData.forestState||{};const fit=connectedCode!==data.classCode || generation!==(Number(fs.forestGeneration)||1);
  connectedCode=data.classCode;generation=Number(fs.forestGeneration)||1;
  // Derive shared growth in memory; never load/save a student's local data or write to Firebase.
  core.state=memory.load();Object.assign(core.state,fs);core.state.classInfo={...core.state.classInfo,...data.classData.classInfo};core.state.completedEvents=[];core.state.placedAssets=(data.placed||[]).map(p=>({...p}));core.animals.hydrate([]);core.ensureSymbolTree();core.syncMilestones();
  flowers.replaceChildren();for(const p of growthFlowers(core.state.classPoints,generation)){const img=document.createElement('img');img.alt='';img.src='assets/flower-effort-v2.png';img.className='garden-flower';img.style.left=`${p.x*camera.cellSize}px`;img.style.top=`${p.y*camera.cellSize}px`;flowers.append(img);}
  viewport.style.visibility='visible';el('classCode').textContent=connectedCode;
  el('progressLabel').textContent=`みんなで ${Number(core.state.classPoints)||0} P ・ 森の成長 ${Math.floor(core.getProgressPercent())}%`;
  el('status').textContent=`${generation}代目の森 ・ クラスのがんばりを自動更新`;
  refresh();if(fit){landscape.fit();renderer.updateCamera();}
 };
 el('fit').onclick=()=>{landscape.fit();renderer.updateCamera();};
 const zoom=factor=>{camera.setZoom(camera.zoom*factor,{x:viewport.clientWidth/2,y:viewport.clientHeight/2});renderer.updateCamera();};
 el('zoomIn').onclick=()=>zoom(1.2);el('zoomOut').onclick=()=>zoom(1/1.2);
 viewport.onwheel=e=>{e.preventDefault();zoom(e.deltaY<0?1.1:1/1.1);};
 let pointer=null;viewport.onpointerdown=e=>{pointer={id:e.pointerId,x:e.clientX,y:e.clientY};viewport.setPointerCapture(e.pointerId);};viewport.onpointermove=e=>{if(pointer?.id!==e.pointerId)return;camera.panBy(e.clientX-pointer.x,e.clientY-pointer.y);pointer={id:e.pointerId,x:e.clientX,y:e.clientY};renderer.updateCamera();};viewport.onpointerup=viewport.onpointercancel=()=>pointer=null;
 el('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await el('presentation').requestFullscreen();}catch{el('status').textContent='ブラウザーの全画面表示もご利用ください';}};
 document.addEventListener('fullscreenchange',()=>el('fullscreen').textContent=document.fullscreenElement?'全画面を終了':'全画面で映す');
 ready=true;if(pending)renderData(pending);parent.postMessage({type:'class-forest-ready'},location.origin);
}
start().catch(()=>el('status').textContent='森を読み込めませんでした。先生画面を再読み込みしてください。');
