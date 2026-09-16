import test from 'node:test';
import assert from 'node:assert/strict';
import { NUMBERING_ORIGINS, normalizeNumberingOrigin, panelDisplayPairs, breakerPlacement, adjacentCircuit } from '../src/panelLayout.js';
import { normalizeReviewProgress } from '../src/reviewProgress.js';
import { normalizeVerifiedDirectory } from '../finalDirectory.js';
import { buildRowsFromAnalysis } from '../src/panelAnalysis.js';

const rows = Array.from({length: 8}, (_,i) => ({ circuit: i+1, description:`Circuit ${i+1}`, amps:20, breakerKind:'1p_standard', confidence:'Review' }));

test('four origins place circuit 1 in the selected corner without changing identities', () => {
 const expected = {
  'top-left': [{left:1,right:2},{left:3,right:4},{left:5,right:6},{left:7,right:8}],
  'top-right': [{left:2,right:1},{left:4,right:3},{left:6,right:5},{left:8,right:7}],
  'bottom-left': [{left:7,right:8},{left:5,right:6},{left:3,right:4},{left:1,right:2}],
  'bottom-right': [{left:8,right:7},{left:6,right:5},{left:4,right:3},{left:2,right:1}],
 };
 for (const {value} of NUMBERING_ORIGINS) {
  assert.deepEqual(panelDisplayPairs(8,value),expected[value]);
  assert.deepEqual(panelDisplayPairs(8,value).flatMap(pair=>[pair.left,pair.right]).sort((a,b)=>a-b),rows.map(row=>row.circuit));
 }
 assert.equal(normalizeNumberingOrigin(undefined),'top-left');
 assert.deepEqual(panelDisplayPairs(8,'unknown'),expected['top-left']);
});

test('inverted two-pole breakers occupy both slots above the lower-numbered position', () => {
 assert.deepEqual(breakerPlacement(1,30,'bottom-right',2),{side:'right',row:13,span:2});
 assert.deepEqual(breakerPlacement(3,30,'bottom-right'),{side:'right',row:13,span:1});
 assert.deepEqual(breakerPlacement(1,30,'top-left',2),{side:'left',row:0,span:2});
 assert.deepEqual(breakerPlacement(29,30,'bottom-right',2),{side:'right',row:0,span:1});
 assert.equal(adjacentCircuit(1,-1,'bottom-right'),3);
 assert.equal(adjacentCircuit(3,1,'bottom-right'),1);
 assert.equal(adjacentCircuit(1,1,'top-left'),3);
});

test('all supported sizes preserve one slot per circuit in every orientation', () => {
 for (const {value} of NUMBERING_ORIGINS) for(let size=2;size<=84;size+=2) {
  const pairs=panelDisplayPairs(size,value);
  for (let n=1;n<=size;n++) {
   const position=breakerPlacement(n,size,value);
   assert.equal(pairs[position.row][position.side],n);
  }
 }
});

test('review and final records retain numbering with existing descriptions and legacy defaults', () => {
 const original=structuredClone(rows);
 const progress=normalizeReviewProgress({rows,numberingOrigin:'bottom-right'},'PNL-test');
 const directory=normalizeVerifiedDirectory({recordId:'PNL-test',verifiedBy:'Tech',rows,panel:{numberingOrigin:progress.numberingOrigin}});
 assert.equal(progress.numberingOrigin,'bottom-right');
 assert.equal(directory.panel.numberingOrigin,'bottom-right');
 assert.deepEqual(directory.circuits.map(row=>[row.circuit,row.description]),rows.map(row=>[row.circuit,row.description]));
 assert.deepEqual(rows,original);
 assert.equal(normalizeReviewProgress({rows},'PNL-old').numberingOrigin,'top-left');
});

test('AI side checks follow selected numbering while retaining N plus 2 pole linkage', () => {
 const result=buildRowsFromAnalysis({spaces:8,numberingOrigin:'bottom-right'}, {circuits:[{circuit:1,side:'right',poles:2,amps:30,description:'Dryer',breakerType:'standard',confidence:1}]});
 assert.equal(result.warnings.length,0);
 assert.equal(result.rows[2].continuationOf,1);
});
