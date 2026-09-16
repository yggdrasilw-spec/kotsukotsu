// Fixed world-space geometry: growth reveals the landscape without rebuilding it.
export function pathPoint(t) {
  const segments = [
    [[1250,1030],[1330,1170],[1570,1130],[1590,1330]],
    [[1590,1330],[1590,1460],[1830,1390],[1970,1590]]
  ];
  const index = t < .5 ? 0 : 1;
  const u = Math.min(1, Math.max(0, t * 2 - index)), v = 1-u;
  const p = segments[index];
  return {x:v*v*v*p[0][0]+3*v*v*u*p[1][0]+3*v*u*u*p[2][0]+u*u*u*p[3][0],
    y:v*v*v*p[0][1]+3*v*v*u*p[1][1]+3*v*u*u*p[2][1]+u*u*u*p[3][1]};
}
const samples = Array.from({length:241},(_,i)=>pathPoint(i/240));
export function nearPath(x,y,margin=48) {
  return samples.some(p=>Math.hypot(p.x-x,p.y-y)<margin);
}
export function paintPath(g) {
  let seed=4217;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  // Overlapping translucent washes give a continuous, slightly uneven path.
  g.save();
  for(let i=0;i<samples.length;i++){
    const p=samples[i], next=samples[Math.min(i+1,240)], prev=samples[Math.max(0,i-1)];
    const angle=Math.atan2(next.y-prev.y,next.x-prev.x);
    const breadth=24+4*Math.sin(i*.083)+2*Math.sin(i*.27);
    g.save();g.translate(p.x,p.y);g.rotate(angle);
    g.fillStyle='#a1975420';g.beginPath();g.ellipse(0,0,7,breadth+8,0,0,Math.PI*2);g.fill();
    g.fillStyle='#ead0a48c';g.beginPath();g.ellipse(0,0,6,breadth,0,0,Math.PI*2);g.fill();
    g.fillStyle='#fae4bb60';g.beginPath();g.ellipse(0,-2,5,breadth*.69,0,0,Math.PI*2);g.fill();
    for(let j=0;j<7;j++){
      g.fillStyle=j%2?'#a7895b22':'#fff4db66';
      g.beginPath();g.ellipse((random()-.5)*9,(random()-.5)*breadth*1.8,.4+random()*1.5,.3+random()*.8,0,0,Math.PI*2);g.fill();
    }
    if(i%5===0){
      const side=i%10===0?1:-1,y=side*(breadth+random()*7);
      g.strokeStyle='#77904e66';g.lineWidth=1.1;
      for(let k=0;k<3;k++){g.beginPath();g.moveTo(k*2,y);g.quadraticCurveTo(k*2-3,y-side*4,k*2-5+random()*8,y-side*(5+random()*5));g.stroke();}
    }
    if(i%11===0){g.fillStyle='#b09c7977';g.beginPath();g.ellipse(0,(random()-.5)*breadth*1.6,2+random()*2,1.4,random(),0,Math.PI*2);g.fill();}
    g.restore();
  }
  g.restore();
}

export const rockGroups = [
  {x:1030,y:950,w:180,h:180,kind:'medium'},
  {x:1100,y:972,w:86,h:86,kind:'small'},
  {x:1450,y:880,w:105,h:105,kind:'small'},
  {x:1140,y:1220,w:115,h:115,kind:'small'},
  {x:1605,y:1150,w:150,h:150,kind:'medium'},
  {x:1770,y:1435,w:125,h:125,kind:'small'}
];
