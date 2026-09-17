export const AREAS = { enclosure: 'Enclosure and cover', moisture: 'Moisture and corrosion', heat: 'Visible heat damage', wiring: 'Visible wiring and terminations', breakers: 'Breaker identification / compatibility', labels: 'Circuit labeling', access: 'Access and surroundings' };
export const ROLES = { overview: 'Overall panel', interior: 'Panel interior', label: 'Manufacturer / date label', surroundings: 'Access and surroundings', detail: 'Concern close-up' };
export const CONDITIONS = { clear: 'No visible concerns identified', attention: 'Attention needed', repair: 'Repairs recommended', urgent: 'Urgent attention', incomplete: 'Incomplete review' };
export const PRIORITIES = { attention: 'Needs closer examination', repair: 'Repair recommended', urgent: 'Urgent attention' };
export const SYMPTOMS = { tripping: 'Repeated breaker trips', odor: 'Burning or unusual odor', buzzing: 'Unusual buzzing / sizzling', water: 'Known water exposure', repairs: 'Previous panel repairs' };
export const DATE_SOURCE = 'https://www.se.com/us/en/faqs/FA274608/';
export const SCOPE = 'Visual panel review limited to the recorded photos and technician observations. It does not certify electrical safety, code compliance, load capacity, breaker trip performance, connection torque, or hidden conditions.';
export const text = (v, max = 500) => typeof v === 'string' ? v.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max) : '';
export function unknownAge(reason = 'No verified manufacturing evidence available.') { return { kind: 'unknown', label: 'Manufacturing age unknown', reason, sourceUrl: '', evidence: '' }; }
export function estimateAge(identity = {}, evidence = {}, now = new Date()) {
  const yearNow = now.getUTCFullYear();
  if (evidence.mode === 'documented_range') {
    const from = Number(evidence.yearFrom), to = Number(evidence.yearTo);
    if (!evidence.verified || !Number.isInteger(from) || !Number.isInteger(to) || from < 1900 || to < from || to > yearNow || text(evidence.sourceNote).length < 12) return unknownAge('Enter and verify a supported year range and its documentary source.');
    let sourceUrl = ''; try { const u = new URL(evidence.sourceUrl); if (u.protocol === 'https:' && !u.username && !u.password) sourceUrl = u.href; } catch {}
    return { kind: 'documented_range', label: `Estimated manufacture: ${from === to ? from : `${from}–${to}`}`, yearFrom: from, yearTo: to, ageLabel: `Approximately ${Math.max(0, yearNow - to - 1)}–${yearNow - from} years since manufacture`, evidence: text(evidence.sourceNote, 2000), sourceUrl, reason: 'Technician-supplied documentary evidence; this is not the installation date.' };
  }
  if (evidence.mode !== 'date_code' || evidence.verified !== true) return unknownAge('Verify the date-code reading and the component it belongs to.');
  if (!['enclosure', 'interior'].includes(evidence.component)) return unknownAge('A breaker or replacement cover date cannot establish the panel manufacturing date.');
  if (!/square\s*d|schneider/i.test(identity.manufacturer || '') || !(/\bQO\b|homeline/i.test(identity.productFamily || '') || /^(QO|HOM)/i.test(identity.model || '')) || /^QOC/i.test(identity.model || '')) return unknownAge('Automatic decoding in this first version supports modern Square D QO and Homeline panel labels only. Use documented evidence for other products.');
  const code = text(identity.dateCode);
  if (!/^\d{6}$/.test(code)) return unknownAge('This date code does not match the supported six-digit modern panel format. Older date codes need manufacturer verification.');
  const year = 2000 + Number(code.slice(0, 2)), week = Number(code.slice(2, 4)), day = Number(code[4]), shift = Number(code[5]);
  const approximateWeek = Math.ceil((((now - Date.UTC(yearNow, 0, 1)) / 86400000) + new Date(Date.UTC(yearNow, 0, 1)).getUTCDay() + 1) / 7);
  if (week < 1 || week > 53 || day < 1 || day > 7 || shift < 1 || year > yearNow || year === yearNow && week > approximateWeek) return unknownAge('The date code is invalid or in the future. Recheck the photo and product format.');
  return { kind: 'decoded', label: `Manufactured ${year}, week ${week}`, yearFrom: year, yearTo: year, ageLabel: `About ${yearNow - year} years since manufacture`, component: evidence.component, evidence: `Verified ${evidence.component} label: ${code} (YY / week / day / shift).`, sourceUrl: DATE_SOURCE, reason: 'Manufacturer decoding rule; component manufacturing date, not installation date.' };
}
export function normalizeFinding(f, i, photoIds) {
  const photoId = photoIds.includes(f.photoId) ? f.photoId : '';
  return { id: text(f.id, 80) || `finding-${i + 1}`, source: f.source === 'ai' ? 'ai' : 'technician', category: AREAS[f.category] ? f.category : 'enclosure',
    title: text(f.title, 160), observation: text(f.observation, 1800), recommendation: text(f.recommendation, 1200),
    priority: PRIORITIES[f.priority] ? f.priority : 'attention', status: ['confirmed', 'dismissed'].includes(f.status) ? f.status : 'pending',
    reviewNote: text(f.reviewNote, 1800), photoId,
    x: photoId && typeof f.x === 'number' && Number.isFinite(f.x) ? Math.max(0, Math.min(100, f.x)) : null,
    y: photoId && typeof f.y === 'number' && Number.isFinite(f.y) ? Math.max(0, Math.min(100, f.y)) : null };
}
export function conditionSummary(record) {
  const findings = record.findings || [];
  const confirmed = findings.filter((f) => f.status === 'confirmed');
  const pending = findings.filter((f) => !['confirmed', 'dismissed'].includes(f.status));
  const missingAreas = Object.keys(AREAS).filter((key) => record.coverage?.[key]?.status !== 'reviewed');
  const missingPhotos = ['overview', 'interior', 'label', 'surroundings'].filter((role) => !(record.photos || []).some((p) => p.role === role));
  const qualityPending = (record.qualityWarnings || []).filter((w) => !record.qualityReviews?.[w.photoId]);
  const unansweredSymptoms = Object.keys(SYMPTOMS).filter((key) => !['yes', 'no', 'unknown'].includes(record.symptoms?.[key]));
  const symptomConcerns = Object.keys(SYMPTOMS).filter((key) => record.symptoms?.[key] === 'yes');
  const complete = !pending.length && !missingAreas.length && !missingPhotos.length && !qualityPending.length && !unansweredSymptoms.length && record.identificationReviewed === true;
  let condition = 'clear';
  if (confirmed.some((f) => f.priority === 'urgent')) condition = 'urgent';
  else if (confirmed.some((f) => f.priority === 'repair')) condition = 'repair';
  else if (confirmed.length || symptomConcerns.length) condition = 'attention';
  else if (!complete) condition = 'incomplete';
  return { condition, complete, pending: pending.length, confirmed: confirmed.length, missingAreas, missingPhotos, qualityPending: qualityPending.length, unansweredSymptoms,
    symptomConcerns, pendingUrgent: pending.some((f) => f.priority === 'urgent'),
    needsOfficeReview: !complete || condition === 'urgent' || record.officeReview === true };
}
export function normalizeInspection(input, photoManifest, originalAnalysis = null, now = new Date()) {
  const fail = (message) => { throw Object.assign(new Error(message), { status: 400 }); };
  if (input.reportReviewed !== true) fail('Confirm that you reviewed the report before saving.');
  if (!Array.isArray(input.findings) || input.findings.length > 60) fail('The inspection findings are invalid.');
  const ids = photoManifest.map((p) => p.id);
  const findings = input.findings.map((f, i) => normalizeFinding(f, i, ids));
  if (new Set(findings.map((f) => f.id)).size !== findings.length) fail('Finding IDs must be unique.');
  for (const f of findings) {
    if (!f.title || !f.observation) fail('Every finding needs a title and an observation.');
    if (f.status !== 'pending' && f.reviewNote.length < 10) fail('Document the evidence for each confirmed or dismissed finding.');
    if (f.status === 'confirmed' && !f.recommendation) fail('Add a recommended next step for each confirmed finding.');
  }
  // AI suggestions must remain in the audit trail; dismissing requires a reason.
  for (const f of originalAnalysis?.findings || []) if (!findings.some((item) => item.id === f.id)) fail('Review or dismiss each AI suggestion instead of deleting it.');
  const coverage = Object.fromEntries(Object.keys(AREAS).map((key) => {
    const v = input.coverage?.[key] || {};
    const status = ['reviewed', 'not_inspected'].includes(v.status) ? v.status : 'pending';
    const reason = text(v.reason, 1000);
    if (status === 'not_inspected' && !reason) fail(`Document why ${AREAS[key].toLowerCase()} was not inspected.`);
    return [key, { status, reason }];
  }));
  const identity = Object.fromEntries(['manufacturer', 'productFamily', 'model', 'dateCode', 'serialNumber', 'plantCode'].map((key) => [key, text(input.identity?.[key], 200)]));
  const ageEvidence = { mode: text(input.ageEvidence?.mode, 40), component: text(input.ageEvidence?.component, 40), verified: input.ageEvidence?.verified === true,
    yearFrom: text(input.ageEvidence?.yearFrom, 4), yearTo: text(input.ageEvidence?.yearTo, 4), sourceNote: text(input.ageEvidence?.sourceNote, 2000), sourceUrl: text(input.ageEvidence?.sourceUrl, 1000) };
  const installation = { year: text(input.installation?.year, 4), evidence: text(input.installation?.evidence, 1000) };
  if (installation.year && (!/^\d{4}$/.test(installation.year) || Number(installation.year) < 1900 || Number(installation.year) > now.getUTCFullYear() || installation.evidence.length < 10)) fail('Provide a valid installation year and its separate evidence, or leave it blank.');
  const qualityWarnings = originalAnalysis?.qualityWarnings || [];
  const qualityReviews = Object.fromEntries(qualityWarnings.map((w) => [w.photoId, text(input.qualityReviews?.[w.photoId], 1000)]));
  const record = { version: 1, panelName: text(input.panelName, 200) || 'Main Panel',
    job: input.job ? Object.fromEntries(['id','serviceTitanId','customer','address'].map((key) => [key, text(input.job[key], 500)])) : null,
    identity, identificationReviewed: input.identificationReviewed === true, ageEvidence, age: estimateAge(identity, ageEvidence, now), installation,
    findings, coverage, symptoms: Object.fromEntries(Object.keys(SYMPTOMS).map((key) => [key, ['yes', 'no', 'unknown'].includes(input.symptoms?.[key]) ? input.symptoms[key] : ''])),
    symptomNotes: text(input.symptomNotes, 2000), photos: photoManifest, skippedPhotos: Object.fromEntries(['interior','label','surroundings'].map((key) => [key, text(input.skippedPhotos?.[key], 1000)])),
    qualityWarnings, qualityReviews, originalAnalysis, notes: text(input.notes, 4000), officeReview: input.officeReview === true, reportReviewed: true, scope: SCOPE };
  if (!photoManifest.some((p) => p.role === 'overview')) fail('An overall panel photo is required.');
  for (const role of ['interior','label','surroundings']) if (!photoManifest.some((p) => p.role === role) && !record.skippedPhotos[role]) fail(`Photograph ${ROLES[role].toLowerCase()} or document why it is unavailable.`);
  return { ...record, summary: conditionSummary(record) };
}
