const STREET_WORDS = new Map([
  ['street', 'st'], ['st.', 'st'],
  ['avenue', 'ave'], ['ave.', 'ave'],
  ['road', 'rd'], ['rd.', 'rd'],
  ['boulevard', 'blvd'], ['blvd.', 'blvd'],
  ['drive', 'dr'], ['dr.', 'dr'],
  ['lane', 'ln'], ['ln.', 'ln'],
  ['court', 'ct'], ['ct.', 'ct'],
  ['place', 'pl'], ['pl.', 'pl'],
  ['terrace', 'ter'], ['ter.', 'ter'],
  ['circle', 'cir'], ['cir.', 'cir'],
  ['parkway', 'pkwy'], ['pkwy.', 'pkwy'],
  ['highway', 'hwy'], ['hwy.', 'hwy'],
]);

export function normalizeLocationSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => STREET_WORDS.get(word) || word)
    .join(' ');
}

export function formatServiceTitanLocationAddress(location = {}) {
  const address = location.address || {};
  if (typeof address === 'string') return address.replace(/\s+/g, ' ').trim();
  const street = address.street || address.streetAddress || address.addressLine1 || location.addressLine1 || '';
  const unit = address.unit || address.addressLine2 || location.addressLine2 || '';
  const city = address.city || location.city || '';
  const state = address.state || address.stateCode || location.state || '';
  const zip = address.zip || address.zipCode || address.postalCode || location.zip || '';
  const locality = [city, state].filter(Boolean).join(', ');
  return [street, unit, locality, zip].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function words(value) {
  return normalizeLocationSearchText(value).split(' ').filter(Boolean);
}

function tokenMatches(token, haystackWords) {
  if (/^\d+[a-z]?$/.test(token)) return haystackWords.includes(token);
  return haystackWords.some((word) => word.startsWith(token)) || haystackWords.some((word) => word.includes(token));
}

export function locationSearchScore(location, rawQuery) {
  const query = normalizeLocationSearchText(rawQuery);
  if (!query) return 0;

  const address = formatServiceTitanLocationAddress(location);
  const street = typeof location.address === 'object' ? (location.address?.street || location.address?.streetAddress || location.address?.addressLine1 || '') : address;
  const name = location.name || '';
  const normalizedAddress = normalizeLocationSearchText(address);
  const normalizedStreet = normalizeLocationSearchText(street);
  const normalizedName = normalizeLocationSearchText(name);
  const haystackWords = words(`${address} ${name}`);
  const queryWords = words(query);

  if (!queryWords.every((token) => tokenMatches(token, haystackWords))) return 0;

  let score = 10;
  if (normalizedStreet === query || normalizedAddress === query) score += 300;
  if (normalizedStreet.startsWith(query)) score += 220;
  else if (normalizedAddress.startsWith(query)) score += 180;
  if (normalizedName.startsWith(query)) score += 120;
  if (normalizedAddress.includes(query)) score += 90;

  const numberToken = queryWords.find((token) => /^\d+[a-z]?$/.test(token));
  if (numberToken && words(normalizedStreet)[0] === numberToken) score += 100;

  queryWords.forEach((token, index) => {
    const streetWords = words(normalizedStreet);
    if (streetWords[index]?.startsWith(token)) score += 15;
  });

  return score;
}

export function rankLocationMatches(locations, query, limit = 30) {
  return (locations || [])
    .map((location) => ({ location, score: locationSearchScore(location, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || formatServiceTitanLocationAddress(a.location).localeCompare(formatServiceTitanLocationAddress(b.location)))
    .slice(0, limit);
}

export function locationToJobChoice(location, customer = {}) {
  const locationId = String(location.id || '');
  const customerId = String(location.customerId || customer.id || '');
  const address = formatServiceTitanLocationAddress(location) || location.name || `Location #${locationId || 'unknown'}`;
  const customerName = customer.name || location.customerName || location.name || (customerId ? `Customer #${customerId}` : 'ServiceTitan customer');
  return {
    id: `LOC-${locationId || 'UNKNOWN'}`,
    serviceTitanId: '',
    appointmentId: `location-${locationId || 'unknown'}`,
    start: '',
    end: '',
    time: 'History',
    customer: String(customerName),
    address: String(address),
    status: 'ServiceTitan location',
    summary: 'Historical location · no active appointment required',
    customerId,
    locationId,
    referenceType: 'location',
  };
}
