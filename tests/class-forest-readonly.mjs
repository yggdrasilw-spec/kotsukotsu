import assert from 'node:assert/strict';
import {ForestCore,SaveManager} from '../js/core-runtime.js';
globalThis.localStorage={getItem(){throw Error('Must not read student storage');},setItem(){throw Error('Must not write student storage');}};
const core=new ForestCore({saveManager:{load:()=>new SaveManager().defaultState(),save(){}}});
core.state.classPoints=600;core.state.classInfo.clearPoint=1000;
assert.equal(core.getProgressPercent(),60);core.persist();
console.log('PASS: presentation state does not read or write student storage');
