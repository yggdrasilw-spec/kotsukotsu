import { paintPath, nearPath, rockGroups } from './forest-preview-landscape.js';
const canvas = document.querySelector('#forest');
const ctx = canvas.getContext('2d');
const W = 2800, H = 2200, center = {x: 1250, y: 1000};
const camera = {x: center.x, y: center.y, zoom: 1};
let width = 1, height = 1, progress = 0, target = 0, previous = 0;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const load = src => new Promise((resolve, reject) => {const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src;});
let grass, tree, flower, rockMedium, rockSmall;
try { [grass, tree, flower, rockMedium, rockSmall] = await Promise.all(['assets/grass-watercolor-v3.png','assets/tree-growing-v2.png','assets/flower-effort-v2.png','assets/rock_medium_01.png','assets/rock_small_01.png'].map(load)); }
catch { document.querySelector('#status').textContent = '画像を読み込めませんでした。ページを再読み込みしてください。'; throw new Error('Forest assets failed to load'); }
const ground = document.createElement('canvas'); ground.width = W; ground.height = H;
const g = ground.getContext('2d');
// Mirrored tiles keep shared edge pixels adjacent; the translucent wash softens repetition.
const tile = 600;
for(let y=0;y<H;y+=tile) for(let x=0;x<W;x+=tile){g.save();g.translate(x+(x/tile%2?tile:0),y+(y/tile%2?tile:0));g.scale(x/tile%2?-1:1,y/tile%2?-1:1);g.drawImage(grass,0,0,tile,tile);g.restore();}
g.fillStyle='#faf0d4';g.globalAlpha=.28;g.fillRect(0,0,W,H);g.globalAlpha=1;
const wash=g.createRadialGradient(center.x,center.y,30,center.x,center.y,540);wash.addColorStop(0,'#fff4cd99');wash.addColorStop(1,'#fff4cd00');g.fillStyle=wash;g.fillRect(0,0,W,H);
paintPath(g);
// Moss washes tie each stone group to the surrounding meadow.
for(const rock of rockGroups){const moss=g.createRadialGradient(rock.x,rock.y-22,4,rock.x,rock.y-22,rock.w*.55);moss.addColorStop(0,'#758d4245');moss.addColorStop(1,'#758d4200');g.save();g.translate(0,(rock.y-22)*.4);g.scale(1,.6);g.fillStyle=moss;g.fillRect(rock.x-rock.w,rock.y-rock.w,rock.w*2,rock.w*2);g.restore();}
const fog=document.createElement('canvas');fog.width=W;fog.height=H;const f=fog.getContext('2d');
const mist=document.createElement('canvas');mist.width=W;mist.height=H;const m=mist.getContext('2d');m.fillStyle='#f1f0e3';m.fillRect(0,0,W,H);
for(let i=0;i<130;i++){const x=(i*739)%W,y=(i*431)%H,r=55+i%7*18;const cloud=m.createRadialGradient(x,y,0,x,y,r);cloud.addColorStop(0,i%2?'#ffffff38':'#becbb51c');cloud.addColorStop(1,'#ffffff00');m.fillStyle=cloud;m.fillRect(x-r,y-r,r*2,r*2);}
function reveal(x,y,rx,ry){f.save();f.translate(x,y);f.scale(rx,ry);const gradient=f.createRadialGradient(0,0,.58,0,0,1);gradient.addColorStop(0,'#000');gradient.addColorStop(.73,'#000e');gradient.addColorStop(1,'#0000');f.fillStyle=gradient;f.fillRect(-1,-1,2,2);f.restore();}
function makeFog(){f.globalCompositeOperation='source-over';f.clearRect(0,0,W,H);f.drawImage(mist,0,0);f.globalCompositeOperation='destination-out';reveal(1250,990,405,325);for(let i=0;i<7;i++){const a=i*Math.PI*2/7;reveal(1250+Math.cos(a)*(190+i%3*20),990+Math.sin(a)*150,230+i%2*35,210);}if(progress>0){reveal(1420,1130,180+progress*2.7,150+progress*2.2);reveal(1300,890,260+progress*1.55,200+progress*1.2);}f.globalCompositeOperation='source-over';}
const flowers=Array.from({length:45},(_,i)=>{const a=i*2.39996;const r=170+Math.sqrt(i/45)*410;return {x:1250+Math.cos(a)*r,y:1040+Math.sin(a)*r*.66,size:42+i%4*7,at:i<7?0:(i-6)*2.6};}).filter(o=>!nearPath(o.x,o.y,55));
function bounds(){return {left:820,right:1660+progress*2.3,top:610-progress*.5,bottom:1350+progress*2.6};}
function clamp(){const b=bounds();camera.x=Math.max(b.left,Math.min(b.right,camera.x));camera.y=Math.max(b.top,Math.min(b.bottom,camera.y));}
function home(){camera.x=center.x;camera.y=980;camera.zoom=Math.max(.25,Math.min(width/1150,height/930));clamp();}
function resize(){const r=canvas.getBoundingClientRect();width=r.width;height=r.height;const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);}
new ResizeObserver(()=>{resize();clamp();}).observe(canvas);resize();home();makeFog();
function sprite(img,x,y,w,h){ctx.drawImage(img,x-w/2,y-h,w,h);}
function draw(time){const dt=Math.min(64,time-previous);previous=time;if(Math.abs(target-progress)>.01){progress=reduced?target:progress+(target-progress)*Math.min(1,dt/230);makeFog();clamp();}else if(progress!==target){progress=target;makeFog();}
ctx.setTransform(canvas.width/width,0,0,canvas.height/height,0,0);ctx.fillStyle='#f1f0e3';ctx.fillRect(0,0,width,height);ctx.translate(width/2,height/2);ctx.scale(camera.zoom,camera.zoom);ctx.translate(-camera.x,-camera.y);ctx.drawImage(ground,0,0);
const objects=flowers.filter(o=>o.at<=progress).map(o=>({...o,img:flower,w:o.size,h:o.size}));
for(const rock of rockGroups){objects.push({...rock,img:rock.kind==='medium'?rockMedium:rockSmall});objects.push({x:rock.x-rock.w*.3,y:rock.y+3,img:flower,w:38,h:38});}
objects.push({x:1250,y:1030,img:tree,w:275,h:310});if(progress>35)objects.push({x:1550,y:1200,img:tree,w:76,h:90});if(progress>70)objects.push({x:1680,y:1350,img:tree,w:68,h:82});objects.sort((a,b)=>a.y-b.y).forEach(o=>sprite(o.img,o.x,o.y,o.w,o.h));ctx.drawImage(fog,0,0);requestAnimationFrame(draw);}
requestAnimationFrame(draw);
function setProgress(value){target=Math.max(0,Math.min(100,value));document.querySelector('#progress').value=target;document.querySelector('#stage').textContent=target===0?'はじめの小さな広場':target<50?'小道の先が、見えてきた':'みんなで広げた草地';document.querySelector('#status').textContent=target===0?'小さな広場から、はじまります。':target===100?'ここまでが今回の試作です。森全体を見渡してみよう。':'霧の向こうに、少しずつ草地が広がります。';document.querySelector('#grow').disabled=target===100;}
document.querySelector('#grow').onclick=()=>setProgress(target+10);document.querySelector('#progress').oninput=e=>setProgress(Number(e.target.value));document.querySelector('#reset').onclick=()=>{setProgress(0);home();};document.querySelector('#home').onclick=home;
document.querySelector('#fit').onclick=()=>{const b=bounds();camera.x=(b.left+b.right)/2;camera.y=(b.top+b.bottom)/2;camera.zoom=Math.max(.2,Math.min(width/(b.right-b.left+250),height/(b.bottom-b.top+250)));};
function zoom(factor,x=width/2,y=height/2){const wx=camera.x+(x-width/2)/camera.zoom,wy=camera.y+(y-height/2)/camera.zoom;camera.zoom=Math.max(.2,Math.min(2,camera.zoom*factor));camera.x=wx-(x-width/2)/camera.zoom;camera.y=wy-(y-height/2)/camera.zoom;clamp();}
document.querySelector('#in').onclick=()=>zoom(1.2);document.querySelector('#out').onclick=()=>zoom(1/1.2);
canvas.addEventListener('wheel',e=>{e.preventDefault();const r=canvas.getBoundingClientRect();zoom(Math.exp(-e.deltaY*.001),e.clientX-r.left,e.clientY-r.top);},{passive:false});
const pointers=new Map();
canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});};
canvas.onpointermove=e=>{const old=pointers.get(e.pointerId);if(!old)return;const before=[...pointers.values()];pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const after=[...pointers.values()];if(after.length===1){camera.x-=(e.clientX-old.x)/camera.zoom;camera.y-=(e.clientY-old.y)/camera.zoom;}else if(after.length===2){const distance=p=>Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);const r=canvas.getBoundingClientRect();const bx=(before[0].x+before[1].x)/2,by=(before[0].y+before[1].y)/2,ax=(after[0].x+after[1].x)/2,ay=(after[0].y+after[1].y)/2;zoom(distance(after)/Math.max(1,distance(before)),bx-r.left,by-r.top);camera.x-=(ax-bx)/camera.zoom;camera.y-=(ay-by)/camera.zoom;}clamp();};
for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,e=>pointers.delete(e.pointerId));
