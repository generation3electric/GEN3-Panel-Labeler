import { normalizeNumberingOrigin } from './panelLayout.js';

export function circuitReady(row) {
  return row?.breakerKind === 'empty' || Boolean(row && Number.isInteger(Number(row.amps)) && Number(row.amps) > 0 &&
    /^(1|2)p_(standard|afci|gfci|dual|surge)$/.test(row.breakerKind) && String(row.description || '').trim());
}

export function warningPhoto(text) {
  return String(text).match(/\b\d{1,3}-[a-z0-9-]+\.(?:jpe?g|png|heic|heif|webp)\b/i)?.[0] || '';
}

export function verifyCircuit(rows, circuit) {
  const row = rows.find((item) => item.circuit === circuit);
  if (!row || row.continuationOf || !circuitReady(row)) throw new Error('Confirm the amperage, breaker type, and circuit description before verifying.');
  if (row.breakerKind.startsWith('2p_') && !rows.some((item) => item.circuit === circuit + 2 && item.continuationOf === circuit)) throw new Error('Confirm both positions of this 2-pole breaker.');
  return rows.map((item) => item.circuit === circuit || item.continuationOf === circuit ? { ...item, confidence: 'Verified' } : item);
}

export function normalizeReviewProgress(input, recordId) {
  if (!Array.isArray(input?.rows) || input.rows.length < 2 || input.rows.length > 84) throw new Error('Invalid review circuit list.');
  const seen = new Set();
  const rows = input.rows.map((row) => {
    if (!Number.isInteger(row.circuit) || row.circuit < 1 || row.circuit > 84 || seen.has(row.circuit)) throw new Error('Invalid circuit position.');
    seen.add(row.circuit);
    if (!/^(?:empty|[12]p_(?:unknown|standard|afci|gfci|dual|surge))$/.test(row.breakerKind)) throw new Error('Invalid breaker type.');
    const result = { circuit: row.circuit, amps: Number(row.amps) > 0 ? Number(row.amps) : null, breakerKind: row.breakerKind,
      description: String(row.description || '').slice(0,280), confidence: ['High','Verified'].includes(row.confidence) ? row.confidence : 'Review',
      confidenceScore: row.confidenceScore == null ? null : Number(row.confidenceScore), notes: String(row.notes || '').slice(0,2000),
      aiDetected: Boolean(row.aiDetected), continuationOf: Number.isInteger(row.continuationOf) ? row.continuationOf : null };
    if (result.confidence === 'Verified' && !circuitReady(result)) throw new Error(`Circuit ${row.circuit} is incomplete.`);
    return result;
  });
  for (const row of rows) {
    if (row.continuationOf && !rows.some((parent) => parent.circuit === row.continuationOf && parent.circuit + 2 === row.circuit && parent.breakerKind.startsWith('2p_') && !parent.continuationOf)) throw new Error('Invalid linked breaker position.');
  }
  const resolutions = {};
  for (const [warning, value] of Object.entries(input.resolutions || {}).slice(0,300)) {
    if (warning.length > 8000 || !value || typeof value.note !== 'string' || !value.note.trim()) continue;
    Object.defineProperty(resolutions, warning, { value: { note: value.note.trim().slice(0,1000), resolvedAt: String(value.resolvedAt || '').slice(0,40) }, enumerable: true });
  }
  return { schemaVersion: 1, recordId, rows, resolutions, numberingOrigin: normalizeNumberingOrigin(input.numberingOrigin), updatedAt: new Date().toISOString() };
}
