import assert from 'node:assert/strict';
import test from 'node:test';
import { createFinalDirectoryPdf, normalizeVerifiedDirectory } from '../finalDirectory.js';

const input = {
  recordId: 'PNL-123-TEST',
  verifiedBy: 'Pat Technician',
  job: { id: '123', serviceTitanId: '987', customer: 'Test Customer', address: '123 Main St, Philadelphia, PA' },
  panel: { name: 'Main Panel', manufacturer: 'Square D', mainAmps: '200' },
  rows: [
    { circuit: 1, amps: 20, breakerKind: '1p_afci', description: 'Kitchen receptacles', confidenceScore: 0.75, notes: 'AI was unsure' },
    { circuit: 2, amps: 30, breakerKind: '2p_standard', description: 'Dryer' },
  ],
};

test('normalizes a corrected directory as a verified permanent record', () => {
  const result = normalizeVerifiedDirectory(input, new Date('2026-09-11T16:00:00.000Z'));
  assert.equal(result.verificationStatus, 'Verified');
  assert.equal(result.verifiedBy, 'Pat Technician');
  assert.equal(result.verifiedAt, '2026-09-11T16:00:00.000Z');
  assert.equal(result.panel.mainAmps, 200);
  assert.deepEqual(result.circuits[0], {
    circuit: 1,
    amps: 20,
    breakerKind: '1p_afci',
    poles: 1,
    breakerType: 'afci',
    description: 'Kitchen receptacles',
    continuationOf: null,
    aiConfidence: 0.75,
    aiNotes: 'AI was unsure',
    verificationStatus: 'Verified',
  });
});

test('requires the verifier name and valid circuit positions', () => {
  assert.throws(() => normalizeVerifiedDirectory({ ...input, verifiedBy: '' }), /Verifier name/);
  assert.throws(() => normalizeVerifiedDirectory({ ...input, rows: [{ circuit: 1 }, { circuit: 1 }] }), /invalid circuit/);
});

test('creates a real PDF for the saved panel label', async () => {
  const directory = normalizeVerifiedDirectory(input, new Date('2026-09-11T16:00:00.000Z'));
  const pdf = await createFinalDirectoryPdf(directory);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 1000);
});
