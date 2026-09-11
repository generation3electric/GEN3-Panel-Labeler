import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRowsFromAnalysis, getAIAnalysis } from '../src/panelAnalysis.js';

test('maps AI circuits into verification rows without sample data', () => {
  const analysis = {
    panel: { spaceCount: 12 },
    circuits: [
      { circuit: 1, amps: 20, poles: 1, breakerType: 'gfci', description: 'Bathroom GFCI', confidence: 0.96, needsReview: false, notes: '' },
      { circuit: 2, amps: 30, poles: 2, breakerType: 'standard', description: 'Dryer', confidence: 0.91, needsReview: false, notes: '' },
    ],
  };

  const { rows, warnings } = buildRowsFromAnalysis({ spaces: 12 }, analysis);
  assert.equal(rows.length, 12);
  assert.deepEqual(rows[0], {
    circuit: 1, amps: 20, breakerKind: '1p_gfci', description: 'Bathroom GFCI', confidence: 'High',
    confidenceScore: 0.96, notes: '', aiDetected: true, continuationOf: null,
  });
  assert.equal(rows[1].breakerKind, '2p_standard');
  assert.equal(rows[3].continuationOf, 2);
  assert.equal(rows[3].description, 'Dryer');
  assert.equal(rows[4].amps, null);
  assert.equal(rows[4].description, '');
  assert.equal(rows[4].confidence, 'Review');
  assert.deepEqual(warnings, []);
});

test('keeps uncertain or incomplete AI readings marked for review', () => {
  const { rows } = buildRowsFromAnalysis({}, {
    panel: { spaceCount: 4 },
    circuits: [{ circuit: 1, amps: null, poles: null, breakerType: 'unknown', description: '', confidence: 0.4, needsReview: true, notes: 'Glare' }],
  });
  assert.equal(rows.length, 4);
  assert.equal(rows[0].breakerKind, '1p_unknown');
  assert.equal(rows[0].confidence, 'Review');
  assert.equal(rows[0].notes, 'Glare');
});

test('marks a missing pole count for review and reports side conflicts', () => {
  const { rows, warnings } = buildRowsFromAnalysis({ spaces: 12 }, {
    panel: { spaceCount: 12 },
    circuits: [{ circuit: 1, side: 'right', amps: 20, poles: null, breakerType: 'standard', description: 'Kitchen', confidence: 0.99, needsReview: false, notes: '' }],
  });
  assert.equal(rows[0].confidence, 'Review');
  assert.match(warnings[0], /Circuit 1.*right side/);
});

test('uses the largest reliable panel size and unwraps supported receipts', () => {
  const analysis = { panel: { spaceCount: 30 }, circuits: [{ circuit: 41, amps: 20, poles: 1, breakerType: 'standard', description: 'Spare', confidence: 0.9, needsReview: false, notes: '' }] };
  const { rows } = buildRowsFromAnalysis({ spaces: 40 }, analysis);
  assert.equal(rows.length, 42);
  assert.equal(getAIAnalysis({ receipt: { aiAnalysis: analysis } }), analysis);
});
