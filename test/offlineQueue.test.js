import test from 'node:test';
import assert from 'node:assert/strict';
import { splitLocalPanels, uploadedPanelRecord } from '../src/offlineQueue.js';

test('splitLocalPanels groups pending and uploaded panels newest first', () => {
  const result = splitLocalPanels([
    { recordId: 'old-upload', status: 'uploaded', uploadedAt: '2026-09-09T12:00:00Z' },
    { recordId: 'new-pending', status: 'pending', savedLocallyAt: '2026-09-11T12:00:00Z' },
    { recordId: 'new-upload', status: 'uploaded', uploadedAt: '2026-09-11T13:00:00Z' },
    { recordId: 'old-pending', status: 'pending', savedLocallyAt: '2026-09-10T12:00:00Z' },
  ]);

  assert.deepEqual(result.pending.map((item) => item.recordId), ['new-pending', 'old-pending']);
  assert.deepEqual(result.uploaded.map((item) => item.recordId), ['new-upload', 'old-upload']);
});

test('records without an uploaded status remain pending', () => {
  const result = splitLocalPanels([{ recordId: 'legacy-record', savedLocallyAt: '2026-09-11T12:00:00Z' }]);
  assert.equal(result.pending.length, 1);
  assert.equal(result.uploaded.length, 0);
});

test('an uploaded panel keeps its AI result while releasing photo blobs', () => {
  const item = { recordId: 'panel-1', status: 'pending', photos: [{ file: 'large-image' }] };
  const aiAnalysis = { panel: { manufacturer: 'Square D' }, circuits: [{ circuit: 1, amps: 20 }] };
  const result = uploadedPanelRecord(item, { recordId: 'panel-1', aiAnalysis, aiModel: 'test-model' }, '2026-09-11T13:00:00Z');

  assert.equal(result.status, 'uploaded');
  assert.deepEqual(result.photos, []);
  assert.deepEqual(result.receipt.aiAnalysis, aiAnalysis);
  assert.equal(result.receipt.aiModel, 'test-model');
});
