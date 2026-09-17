import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const nodes=new Map();
const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,style:{},textContent:'',innerHTML:'',events:{},addEventListener(event,fn){this.events[event]=fn;},replaceChildren(){this.innerHTML='';}});return nodes.get(id);};
const callbacks={};
class FirebaseClient {
 isReady(){return true;} cleanup(){for(const key of Object.keys(callbacks))delete callbacks[key];}
 async getClass({classCode}){return {ok:classCode==='TEST'};}
}
for(const name of ['listenClass','listenStudentsRoster','listenStudents','listenApprovalQueue','listenActivityLog','listenPlacedAssets'])FirebaseClient.prototype[name]=opts=>callbacks[name]=opts;
const context=vm.createContext({FirebaseClient,location:{origin:'http://localhost'},document:{getElementById:node},window:{addEventListener(){},localStorage:{getItem:()=>null,setItem(){},removeItem(){}}},console,setTimeout});
vm.runInContext(readFileSync(new URL('../js/teacher.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/,''),context);
node('joinCodeInput').value='TEST';await node('btnManageClass').events.click();
assert.equal(node('dashboardView').style.display,'grid');
callbacks.listenClass.onData({classInfo:{classCode:'TEST',clearPoint:1000},forestState:{classPoints:120}});
callbacks.listenApprovalQueue.onData([{logId:'log1',studentId:'s1',goalTitle:'本を読む',date:'2026-09-17'}]);
callbacks.listenStudents.onData([{studentId:'s1',nickname:'はな'}]);
assert.match(node('approvalList').innerHTML,/はなさん/,'Late roster updates resolve pending names');
callbacks.listenStudentsRoster.onData([{nickname:'はな',status:'good',daysSinceLogin:0,todayAchieved:2,activeGoalsCount:1,lifetimePoints:40,goals:[{title:'<本>',targetCount:2}]}]);
assert.match(node('classOverview').innerHTML,/120 P/);
assert.match(node('classOverview').innerHTML,/2件/);
assert.match(node('studentRoster').innerHTML,/&lt;本&gt;/);
callbacks.listenStudentsRoster.onError(new Error('permission-denied'));
assert.match(node('appMessage').textContent,/取得できません/);
await node('btnDisconnect').events.click();assert.equal(node('dashboardView').style.display,'none');
node('joinCodeInput').value='MISSING';await node('btnManageClass').events.click();
assert.match(node('appMessage').textContent,/見つかりません/);
assert.equal(node('dashboardView').style.display,'none');
console.log('PASS: independent class connection, overview, escaped goals, late names, visible errors and disconnect');
