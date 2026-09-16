import test from 'node:test';
import assert from 'node:assert/strict';
import { circuitReady, verifyCircuit, normalizeReviewProgress, warningPhoto } from '../src/reviewProgress.js';
const row = (circuit, extra = {}) => ({ circuit, amps:20, breakerKind:'1p_standard', description:'Kitchen', confidence:'Review', ...extra });

test('verification clears only the selected breaker and its linked pole', () => {
 const rows = [row(1,{breakerKind:'2p_standard'}),row(2),row(3,{breakerKind:'2p_standard',continuationOf:1}),row(4)];
 const verified = verifyCircuit(rows,1);
 assert.deepEqual(verified.map(r=>r.confidence),['Verified','Review','Verified','Review']);
 assert.equal(rows[0].confidence,'Review');
});
test('unknown and incomplete readings cannot be cleared as verified', () => {
 for (const patch of [{amps:null},{description:''},{breakerKind:'1p_unknown'}]) {
  assert.equal(circuitReady(row(1,patch)),false);
  assert.throws(()=>verifyCircuit([row(1,patch),row(2)],1));
 }
 assert.throws(()=>verifyCircuit([row(1,{breakerKind:'2p_standard'}),row(2)],1));
 assert.equal(circuitReady(row(1,{breakerKind:'empty',amps:null,description:''})),true);
});
test('progress roundtrip preserves resolved warning notes and empty positions', () => {
 const progress = normalizeReviewProgress({rows:[row(1),row(2,{breakerKind:'empty',amps:null,description:'',confidence:'Verified'})],resolutions:{'01-overview.jpg: blurred':{note:'Checked close-up and corrected circuit 1.',resolvedAt:'2026-09-16T12:00:00Z'}}},'PNL-1');
 const reopened = normalizeReviewProgress(JSON.parse(JSON.stringify(progress)),'PNL-1');
 assert.equal(reopened.rows[1].breakerKind,'empty');
 assert.equal(reopened.resolutions['01-overview.jpg: blurred'].note,'Checked close-up and corrected circuit 1.');
 assert.throws(()=>normalizeReviewProgress({rows:[row(1),row(1)]},'PNL-1'));
 assert.throws(()=>normalizeReviewProgress({rows:[row(1,{amps:null,confidence:'Verified'}),row(2)]},'PNL-1'));
});
test('photo links use explicit filenames without guessing positions from warning prose', () => {
 assert.equal(warningPhoto('10-left-1.jpg: glare at positions approximately 24–30'), '10-left-1.jpg');
 assert.equal(warningPhoto('Directory missing, check circuit 20'), '');
});
