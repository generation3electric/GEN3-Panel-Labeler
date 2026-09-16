import test from 'node:test';
import assert from 'node:assert/strict';
import { panelPhotoList, photoLabel } from '../src/photoGallery.js';

test('gallery includes raster photos only and preserves numeric capture order', () => {
  const files = [
    { id: 'right', name: '30-right-1.jpg', file: { mimeType: 'image/jpeg' } },
    { id: 'json', name: 'record.json', file: { mimeType: 'application/json' } },
    { id: 'pdf', name: 'panel-directory.pdf', file: { mimeType: 'application/pdf' } },
    { id: 'svg', name: 'active.svg', file: { mimeType: 'image/svg+xml' } },
    { id: 'folder', name: 'photos.jpg', folder: {} },
    { id: 'overview', name: '01-overview.jpg', file: { mimeType: 'image/jpeg' } },
    { id: 'heic', name: '10-left-1.heic', file: { mimeType: 'image/heic' } },
  ];
  const photos = panelPhotoList(files, 'item/1');
  assert.deepEqual(photos.map((photo) => photo.id), ['overview', 'heic', 'right']);
  assert.equal(photos[0].url, '/api/sharepoint/panel-records/item%2F1/photos/overview');
  assert.equal(photos[1].label, 'Left Breakers 1');
});

test('labels support current files, capture URLs, and older filenames', () => {
  assert.equal(photoLabel('breakerField'), 'Full Panel Overview');
  assert.equal(photoLabel('80-manufacturer.png'), 'Manufacturer Label');
  assert.equal(photoLabel('90-directory.jpg'), 'Existing Panel Directory');
  assert.equal(photoLabel('old-photo.jpeg'), 'old-photo.jpeg');
});
