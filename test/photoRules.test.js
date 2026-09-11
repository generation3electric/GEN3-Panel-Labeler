import test from 'node:test';
import assert from 'node:assert/strict';
import { photoGuidance, unavailableReason, validatePhotoRecord, qualityResolved } from '../src/photoRules.js';
import { assessPixels } from '../src/photoQuality.js';
import { panelToFormData, uploadedPanelRecord } from '../src/offlineQueue.js';
import { analyzePanelPhotos } from '../aiPanel.js';

test('guidance adapts to small, large and unknown panels', () => {
  assert.equal(photoGuidance(12).perSide, 1);
  assert.equal(photoGuidance(14).perSide, 1);
  assert.equal(photoGuidance(15).perSide, 2);
  assert.equal(photoGuidance(24).perSide, 2);
  assert.equal(photoGuidance(30).perSide, 3);
  assert.equal(photoGuidance(42).perSide, 3);
  assert.equal(photoGuidance(84).perSide, 6);
  for (const input of ['', 'abc', -1, 3.5, 10000]) assert.equal(photoGuidance(input).spaces, null);
});

test('other reasons and quality exceptions require explanations', () => {
  assert.equal(unavailableReason({ reason: 'Other', details: '   ' }), '');
  assert.equal(unavailableReason({ reason: 'Other', details: ' Door replaced ' }), 'Door replaced');
  assert.equal(unavailableReason({ reason: 'Label missing' }), 'Label missing');
  assert.equal(qualityResolved({ status: 'checking' }), false);
  assert.equal(qualityResolved({ status: 'unavailable', issues: [] }), false);
  assert.equal(qualityResolved({ status: 'checked', issues: ['blur'], accepted: true, reason: '' }), false);
  assert.equal(qualityResolved({ status: 'checked', issues: ['blur'], accepted: true, reason: 'Best available' }), true);
});

function pixels(valueAt) {
  const width = 64, height = 64, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = valueAt(x, y); data[i + 3] = 255;
  }
  return { data, width, height };
}

test('local screening distinguishes flat, blown-out, dark, and sharp images', () => {
  assert.match(assessPixels(pixels(() => 128), 1200, 1200).issues.join(' '), /blur.*Low contrast/);
  assert.match(assessPixels(pixels(() => 255), 1200, 1200).issues.join(' '), /glare/);
  assert.match(assessPixels(pixels(() => 10), 1200, 1200).issues.join(' '), /Too dark/);
  const sharp = pixels((x, y) => ((x + y) % 2) ? 70 : 180);
  assert.deepEqual(assessPixels(sharp, 1200, 1200).issues, []);
  assert.match(assessPixels(sharp, 300, 300).issues.join(' '), /Low resolution/);
});

function validRecord() {
  return { photoRulesVersion: 1, coverageConfirmed: true, panel: { spaces: 30 }, skippedPhotos: { manufacturer: 'Label missing', directory: 'Label damaged / unreadable' },
    photoSteps: ['overview', 'left-1', 'right-1'].map((key) => ({ key, title: key, filename: `${key}.jpg`, status: 'Captured', quality: { status: 'checked', issues: [], accepted: false } })) };
}

test('upload validation requires coverage, label disposition, resolved checks and matching files', () => {
  const record = validRecord();
  const names = record.photoSteps.map((item) => item.filename);
  assert.deepEqual(validatePhotoRecord(record, names), []); // 30 spaces can use fewer photos with coverage confirmed.
  assert.match(validatePhotoRecord({ ...record, skippedPhotos: {} }, names).join(' '), /manufacturer.*directory/);
  assert.match(validatePhotoRecord({ ...record, coverageConfirmed: false }, names).join(' '), /coverage/);
  assert.match(validatePhotoRecord(record, ['wrong.jpg']).join(' '), /manifest/);
  record.photoSteps[1].quality = { status: 'checked', issues: ['blur'] };
  assert.match(validatePhotoRecord(record, names).join(' '), /quality warning/);
  assert.deepEqual(validatePhotoRecord({}, ['legacy.jpg']), []);
});

test('offline upload and receipt preserve skip reasons and quality information', () => {
  const record = validRecord();
  const item = { recordId: 'test', record, photos: record.photoSteps.map((step) => ({ file: new Blob(['image']), name: step.filename, type: 'image/jpeg' })) };
  const form = panelToFormData(item);
  assert.deepEqual(JSON.parse(form.get('record')), record);
  assert.deepEqual(form.getAll('photos').map((file) => file.name), record.photoSteps.map((step) => step.filename));
  const uploaded = uploadedPanelRecord(item, { aiAnalysis: { warnings: ['blur'] } });
  assert.equal(uploaded.record, record);
  assert.deepEqual(uploaded.photos, []);
});

test('AI receives labeled photos and field exceptions remain in analysis warnings', async () => {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-only';
  let request;
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ output_text: JSON.stringify({ panel: {}, circuits: [], warnings: [] }) }) };
  };
  try {
    const record = validRecord();
    record.photoSteps[1].quality = { status: 'checked', issues: ['blur'], accepted: true, reason: 'Faded print' };
    const result = await analyzePanelPhotos({ record, files: [{ originalname: 'left-1.jpg', mimetype: 'image/jpeg', buffer: Buffer.from('image') }] });
    const content = request.input[0].content;
    assert.match(content[0].text, /Faded print/);
    assert.equal(content[1].text, 'Photo: left-1.jpg');
    assert.equal(content[2].type, 'input_image');
    assert.match(result.analysis.warnings.join(' '), /Faded print/);
    assert.match(result.analysis.warnings.join(' '), /manufacturer photo not available: Label missing/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
  }
});
