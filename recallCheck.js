// CPSC discovery is deliberately conservative. A model token is evidence of a
// candidate, never proof that date/serial/plant/exemption criteria are satisfied.
export const CPSC_ENDPOINT = 'https://www.saferproducts.gov/RestWebServices/Recall';
export const IDENTIFIER_FIELDS = ['manufacturer', 'productFamily', 'model', 'serialNumber', 'dateCode', 'plantCode', 'labelText'];
export const STATUS_LABELS = {
  matched: 'Recall criteria matched', possible: 'Possible match — review needed',
  no_match: 'No matching recall found', unable: 'Unable to check',
};
const ALIASES = [
  ['Square D', 'Schneider Electric', 'SquareD'], ['Eaton', 'Cutler-Hammer', 'Cutler Hammer'],
  ['Siemens', 'ITE', 'I-T-E', 'Murray'], ['General Electric', 'GE'],
  ['Federal Pacific', 'FPE', 'Federal Pacific Electric'], ['Zinsco', 'Sylvania'],
  ['Challenger'], ['ABB'], ['Leviton'], ['Schneider Electric', 'Square D'],
];
const PRODUCT_QUERIES = ['electrical panel', 'load center', 'loadcenter', 'circuit breaker', 'panelboard', 'breaker box'];
const clean = (v, n = 200) => typeof v === 'string' ? v.trim().slice(0, n) : '';
const normalize = (v) => String(v || '').normalize('NFKD').replace(/[™®]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function includesPhrase(text, phrase) { return (` ${normalize(text)} `).includes(` ${normalize(phrase)} `); }
export function normalizeIdentification(input = {}) {
  return Object.fromEntries(IDENTIFIER_FIELDS.map((key) => [key, clean(input[key], key === 'labelText' ? 6000 : 200)]));
}
export function brandAliases(brand) {
  const groups = ALIASES.filter((group) => group.some((alias) => includesPhrase(brand, alias)));
  return groups.length ? [...new Set(groups.flat())] : [clean(brand)];
}
export function meaningfulIdentifier(value) {
  return !!clean(value) && !/^(unknown|unreadable|not available|n\/?a|none|other|\?+|unidentified)$/i.test(clean(value));
}
function officialUrl(value) {
  try { const url = new URL(value); if (['cpsc.gov', 'www.cpsc.gov'].includes(url.hostname)) { url.protocol = 'https:'; return url.href; } } catch {}
  throw new Error('The recall feed returned a notice without a valid CPSC source link.');
}
function names(values) { return (values || []).map((v) => clean(v.Name, 16000)).filter(Boolean).join('\n'); }
export function normalizeNotice(raw) {
  if (!raw?.RecallID || !raw.Title || !raw.URL || !Array.isArray(raw.Products)) throw new Error('The recall feed returned an incomplete notice.');
  return { id: String(raw.RecallID), number: clean(raw.RecallNumber), title: clean(raw.Title, 1000),
    date: clean(raw.RecallDate), updatedAt: clean(raw.LastPublishDate), url: officialUrl(raw.URL),
    description: clean(raw.Description, 60000), products: raw.Products.map((p) => ({ name: clean(p.Name, 5000), model: clean(p.Model, 12000), description: clean(p.Description, 30000) })),
    manufacturers: names(raw.Manufacturers), hazard: names(raw.Hazards), remedy: names(raw.Remedies), contact: clean(raw.ConsumerContact, 16000) };
}
export function candidateFor(notice, identification) {
  const productText = [notice.title, ...notice.products.map((p) => `${p.name} ${p.description}`)].join(' ');
  if (!/panel|load[ -]?cent(?:er|re)|circuit[ -]?break|breaker[ -]?box|service[ -]?entrance|switchboard/i.test(productText)) return null;
  const text = [productText, notice.description, notice.manufacturers, ...notice.products.map((p) => p.model)].join(' ');
  if (!brandAliases(identification.manufacturer).some((alias) => includesPhrase(text, alias))) return null;
  const modelFound = meaningfulIdentifier(identification.model) && includesPhrase(text, identification.model);
  const required = ['model'];
  if (/date|manufactur(?:ed|ing)|production|sold (?:from|between)/i.test(notice.description)) required.push('dateCode');
  if (/serial/i.test(notice.description)) required.push('serialNumber');
  if (/plant/i.test(notice.description)) required.push('plantCode');
  return { ...notice, modelFound: !!modelFound, required,
    missing: required.filter((key) => !meaningfulIdentifier(identification[key])),
    reason: modelFound ? 'Brand and model text appear in this notice. Verify all production limits and exclusions.' : 'The brand appears in an electrical-product recall. Verify the affected model list, ranges, and production limits in the official notice.' };
}
const cache = new Map();
export async function fetchCpscQuery(params, { fetchImpl = fetch, now = Date.now() } = {}) {
  const url = `${CPSC_ENDPOINT}?${new URLSearchParams({ format: 'json', ...params })}`;
  const previous = cache.get(url);
  if (fetchImpl === fetch && previous && now - previous.at < 3600000) return { ...previous.result, cached: true };
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`CPSC lookup returned HTTP ${response.status}.`);
  const text = await response.text();
  if (text.length > 15000000) throw new Error('The recall feed response exceeded the supported size.');
  let rows; try { rows = JSON.parse(text); } catch { throw new Error('CPSC returned unreadable data.'); }
  if (!Array.isArray(rows) || rows.length >= 3000) throw new Error('The recall feed could not be verified as complete.');
  const notices = rows.map(normalizeNotice);
  const result = { notices, source: { url, retrievedAt: new Date(now).toISOString(), count: notices.length } };
  if (fetchImpl === fetch) { if (cache.size > 150) cache.clear(); cache.set(url, { at: now, result }); }
  return result;
}
export async function checkRecalls(input, { fetchQuery = fetchCpscQuery, now = new Date().toISOString() } = {}) {
  const identification = normalizeIdentification(input);
  const snapshot = { version: 1, checkedAt: now, identification, status: 'unable', notices: [], sources: [],
    scope: 'CPSC U.S. recall database: electrical panels, load centers, circuit breakers, panelboards and manufacturer searches. Manufacturer-only safety notices and general condition concerns are outside this check.',
    message: '', errors: [] };
  if (!meaningfulIdentifier(identification.manufacturer)) {
    snapshot.message = 'A readable manufacturer name is needed. Photograph the manufacturer label or enter a verified brand.';
    return snapshot;
  }
  const aliases = brandAliases(identification.manufacturer);
  const queries = [...PRODUCT_QUERIES.map((term) => ({ ProductName: term })), ...aliases.flatMap((term) => [{ Manufacturer: term }, { RecallDescription: term }])];
  const all = new Map();
  for (let i = 0; i < queries.length; i += 4) {
    const results = await Promise.allSettled(queries.slice(i, i + 4).map((query) => fetchQuery(query)));
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        snapshot.sources.push(result.value.source);
        result.value.notices.forEach((notice) => all.set(notice.id, notice));
      } else snapshot.errors.push({ query: queries[i + index], message: 'This CPSC query could not be completed.' });
    });
  }
  snapshot.notices = [...all.values()].map((notice) => candidateFor(notice, identification)).filter(Boolean)
    .sort((a, b) => Number(b.modelFound) - Number(a.modelFound) || b.date.localeCompare(a.date));
  if (snapshot.errors.length) {
    snapshot.message = 'The official lookup was incomplete. Retry when connected. Any notices below are partial results; this check cannot clear the panel.';
  } else if (snapshot.notices.length) {
    snapshot.status = 'possible';
    snapshot.message = 'Review each notice against the actual panel label. Brand or model similarity alone does not confirm a recall.';
  } else if (!meaningfulIdentifier(identification.model)) {
    snapshot.message = 'The manufacturer was searched, but the panel model is missing or unreadable. Add a clear model/catalog-label photo and check again.';
  } else {
    snapshot.status = 'no_match';
    snapshot.message = 'No relevant notice was found in the sources searched for the confirmed brand and model. This is not a safety certification.';
  }
  return snapshot;
}
export function applyDecisions(snapshot, input = {}) {
  const decisions = {};
  for (const notice of snapshot.notices) {
    const supplied = input[notice.id] || {};
    const outcome = ['matched', 'excluded'].includes(supplied.outcome) ? supplied.outcome : 'possible';
    const note = clean(supplied.note, 2000);
    if (outcome !== 'possible' && (note.length < 10 || supplied.product !== true || supplied.production !== true || supplied.exclusions !== true)) {
      throw Object.assign(new Error('For every confirmed match or exclusion, document the reason and verify model, production limits, and exceptions against the official notice.'), { status: 400 });
    }
    if (outcome !== 'possible' && (!meaningfulIdentifier(snapshot.identification.manufacturer) || !meaningfulIdentifier(snapshot.identification.model))) {
      throw Object.assign(new Error('A verified manufacturer and model are required before confirming or excluding a recall.'), { status: 400 });
    }
    if (outcome === 'matched' && notice.required.some((field) => !meaningfulIdentifier(snapshot.identification[field]))) {
      throw Object.assign(new Error('Add the missing production identifiers before confirming a recall match. Otherwise save it as a possible match.'), { status: 400 });
    }
    decisions[notice.id] = { outcome, note, product: supplied.product === true, production: supplied.production === true, exclusions: supplied.exclusions === true };
  }
  const outcomes = Object.values(decisions).map((d) => d.outcome);
  const status = outcomes.includes('matched') ? 'matched' : snapshot.status === 'unable' ? 'unable' : outcomes.includes('possible') ? 'possible' : outcomes.length ? 'no_match' : snapshot.status;
  return { decisions, status, lookupIncomplete: !!snapshot.errors.length };
}
