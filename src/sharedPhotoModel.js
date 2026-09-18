export const WORKFLOWS = { directory: 'Panel Labeler', recall: 'Recall Check', inspection: 'Panel Inspection' };
export const TARGET_ROLES = {
  directory: { overview: 'Full open panel overview', left: 'Left-side breakers', right: 'Right-side breakers', label: 'Manufacturer label', directory: 'Existing directory' },
  recall: { overview: 'Overall panel', label: 'Manufacturer label', detail: 'Date / serial / other label detail' },
  inspection: { overview: 'Overall panel', interior: 'Panel interior', label: 'Manufacturer / date label', surroundings: 'Access and surroundings', detail: 'Concern close-up' },
};
export const LIMITS = { directory: 20, recall: 6, inspection: 10 };
export const repeatRole = (target, role) => target === 'directory' ? ['left', 'right'].includes(role) : role === 'detail';
export function canonicalRole(role = '') {
  if (/^left(?:-\d+)?$/.test(role)) return 'left';
  if (/^right(?:-\d+)?$/.test(role)) return 'right';
  return ({ manufacturer: 'label', breakerField: 'overview' })[role] || role;
}
export function roleFromFilename(name = '') { return canonicalRole(name.replace(/^\d+-/, '').replace(/\.[^.]+$/, '')); }
export function matchingJob(a, b) {
  if (!a || !b) return false;
  if (a.serviceTitanId && b.serviceTitanId) return String(a.serviceTitanId) === String(b.serviceTitanId);
  // Location-only references are not job IDs. Do not guess from customer names/addresses.
  return Boolean(a.id && b.id && String(a.id) === String(b.id) && (!a.serviceTitanId || !b.serviceTitanId));
}
export function suggestedRole(source, target, role) {
  const normalized = canonicalRole(role);
  // Breaker columns cannot prove complete interior coverage. The technician may map
  // them explicitly, but they are never silently treated as a full interior photo.
  if (['overview', 'label'].includes(normalized)) return normalized;
  if (source === target && TARGET_ROLES[target][normalized]) return normalized;
  return '';
}
export function suggestAssignments(source, target, existing = []) {
  const used = new Set(existing.map(p => canonicalRole(p.role)));
  return Object.fromEntries(source.photos.map(p => {
    if (existing.some(v => v.source?.kind === source.kind && v.source?.recordId === source.recordId && v.source?.photoKey === p.key)) return [p.key, ''];
    const role = suggestedRole(source.kind, target, p.role);
    if (!role || (!repeatRole(target, role) && used.has(role))) return [p.key, ''];
    used.add(role); return [p.key, role];
  }));
}
export function validateAssignments(target, photos, assignments, existing = []) {
  const selected = photos.filter(p => assignments[p.key]);
  if (!selected.length) throw new Error('Choose at least one photo to reuse.');
  if (selected.length + existing.length > LIMITS[target]) throw new Error(`This section allows ${LIMITS[target]} photos. Select fewer photos or remove existing ones first.`);
  const counts = {};
  for (const p of [...existing, ...selected.map(p => ({ role: assignments[p.key] }))]) {
    const role = canonicalRole(p.role);
    if (!TARGET_ROLES[target][role]) throw new Error('Choose a valid photo requirement.');
    counts[role] = (counts[role] || 0) + 1;
    if (!repeatRole(target, role) && counts[role] > 1) throw new Error(`A ${TARGET_ROLES[target][role].toLowerCase()} photo is already filled. Remove it first to replace it.`);
  }
  if (target === 'recall' && counts.detail > 4) throw new Error('Recall checks allow up to four detail photos.');
  return selected;
}
export function fillMissing(current = {}, proposed = {}) {
  return Object.fromEntries(Object.entries(current).map(([key, value]) => [key, !value || value === 'Unknown' ? proposed[key] || value : value]));
}
// Traceability only: these references never authorize fetching a URL or copying a review.
export function normalizePhotoSource(input) {
  if (!input || !WORKFLOWS[input.kind]) return undefined;
  const text = value => String(value || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 200);
  return { kind: input.kind, recordId: text(input.recordId), photoKey: text(input.photoKey), sourceDate: text(input.sourceDate), reusedAt: text(input.reusedAt), currentConditionConfirmed: input.currentConditionConfirmed === true };
}
