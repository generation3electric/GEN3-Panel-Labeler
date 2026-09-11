export const PHOTO_RULES_VERSION = 1;
export const MAX_PHOTOS = 20;
export const unavailableReasons = ['Label missing', 'Label damaged / unreadable', 'Label inaccessible', 'Other'];

export function photoGuidance(spaces) {
  const count = Number(spaces);
  if (!Number.isInteger(count) || count < 1 || count > 84) {
    return { spaces: null, perSide: null, text: 'Size unknown: work from top to bottom on each side, adding close-ups until all breaker positions and markings are covered.' };
  }
  const perSide = Math.ceil(Math.ceil(count / 2) / 7);
  return { spaces: count, perSide, text: `${count} spaces: start with ${perSide} close-up${perSide === 1 ? '' : 's'} per side${perSide === 1 ? ' showing the full column' : ', working from top to bottom with a little overlap'}. Use fewer if every marking is readable, or add more as needed.` };
}

export function unavailableReason(value) {
  if (!unavailableReasons.includes(value?.reason)) return '';
  return value.reason === 'Other' ? (value.details || '').trim().slice(0, 300) : value.reason;
}

export function qualityResolved(quality) {
  return Boolean(quality && ['checked', 'unavailable'].includes(quality.status) &&
    ((quality.status === 'checked' && !(quality.issues || []).length) || quality.accepted) &&
    (!quality.accepted || quality.reason?.trim()));
}

// Also runs on the server before writing versioned records. Legacy offline queues remain uploadable.
export function validatePhotoRecord(record, filenames) {
  if (!record.photoRulesVersion) return [];
  const errors = [];
  const steps = Array.isArray(record.photoSteps) ? record.photoSteps : [];
  const captured = steps.filter((item) => item.status === 'Captured');
  if (filenames.length > MAX_PHOTOS) errors.push(`Use at most ${MAX_PHOTOS} photos.`);
  if (captured.length !== filenames.length || new Set(captured.map((item) => item.filename)).size !== captured.length ||
      captured.some((item) => !filenames.includes(item.filename))) errors.push('The photo manifest does not match the uploaded files.');
  if (!captured.some((item) => item.key === 'overview') || !captured.some((item) => /^left-\d+$/.test(item.key)) || !captured.some((item) => /^right-\d+$/.test(item.key))) errors.push('An overview and coverage of both breaker sides are required.');
  for (const key of ['manufacturer', 'directory']) {
    if (!captured.some((item) => item.key === key) && !String(record.skippedPhotos?.[key] || '').trim()) errors.push(`Provide a ${key} photo or a not available reason.`);
  }
  if (!record.coverageConfirmed) errors.push('Confirm breaker coverage and readability.');
  if (captured.some((item) => !qualityResolved(item.quality))) errors.push('Review every photo quality warning before saving.');
  return errors;
}
