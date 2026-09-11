import express from 'express';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { rankLocationMatches, formatServiceTitanLocationAddress, locationToJobChoice } from './serviceTitanLocationSearch.js';

const PORT = Number(process.env.PORT || 3000);
const AUTH_PORT = Number(process.env.AUTH_GATEWAY_PORT || 3002);
const AUTH_SECRET = String(process.env.MS_AUTH_CLIENT_SECRET || '');
const SESSION_COOKIE = '__Host-gen3-panel-session';
const sessionKey = createHmac('sha256', AUTH_SECRET || 'not-configured').update('GEN3 Panel Labeler session').digest();
const ST_AUTH_URL = 'https://auth.servicetitan.io/connect/token';
const ST_API_URL = 'https://api.servicetitan.io';
const ST_CACHE_MS = 10 * 60 * 1000;
const MAX_LOCATION_PAGES = 60;
let locationCache = { loadedAt: 0, locations: [], incomplete: false };

function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function unpack(value, key) {
  if (!value || value.length > 6000) return null;
  const [body, sig, extra] = String(value).split('.');
  if (!body || !sig || extra) return null;
  const expected = createHmac('sha256', key).update(body).digest('base64url');
  if (!same(sig, expected)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
}
function cookie(req, name) {
  const prefix = `${name}=`;
  const match = String(req.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : '';
}
function signedIn(req) {
  const data = unpack(cookie(req, SESSION_COOKIE), sessionKey);
  return Boolean(data && data.v === 1 && data.oid && data.exp > Date.now());
}
function stConfigured() {
  return Boolean(process.env.SERVICETITAN_APP_KEY && process.env.SERVICETITAN_CLIENT_ID && process.env.SERVICETITAN_CLIENT_SECRET && process.env.SERVICETITAN_TENANT_ID);
}
async function stToken() {
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.SERVICETITAN_CLIENT_ID, client_secret: process.env.SERVICETITAN_CLIENT_SECRET });
  const response = await fetch(ST_AUTH_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || `ServiceTitan authentication returned ${response.status}.`);
  return data.access_token;
}
async function stGet(pathname, token) {
  const response = await fetch(`${ST_API_URL}${pathname}`, {
    headers: { Authorization: `Bearer ${token}`, 'ST-App-Key': process.env.SERVICETITAN_APP_KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.message || data?.error?.message || data?.title || `ServiceTitan returned ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return data;
}
async function loadLocations(token) {
  if (locationCache.locations.length && Date.now() - locationCache.loadedAt < ST_CACHE_MS) return locationCache;
  const tenant = encodeURIComponent(process.env.SERVICETITAN_TENANT_ID);
  const locations = [];
  let incomplete = false;
  for (let page = 1; page <= MAX_LOCATION_PAGES; page += 1) {
    const result = await stGet(`/crm/v2/tenant/${tenant}/locations?page=${page}&pageSize=500`, token);
    locations.push(...(result.data || []));
    if (!result.hasMore) {
      incomplete = false;
      break;
    }
    incomplete = page === MAX_LOCATION_PAGES;
  }
  locationCache = { loadedAt: Date.now(), locations, incomplete };
  return locationCache;
}
async function customersFor(ids, token) {
  const unique = [...new Set(ids.filter(Boolean).map(String))].slice(0, 50);
  if (!unique.length) return new Map();
  const tenant = encodeURIComponent(process.env.SERVICETITAN_TENANT_ID);
  const params = new URLSearchParams({ ids: unique.join(','), pageSize: '200' });
  const result = await stGet(`/crm/v2/tenant/${tenant}/customers?${params}`, token);
  return new Map((result.data || []).map((item) => [String(item.id), item]));
}

const child = spawn(process.execPath, ['secureServer.js'], {
  env: { ...process.env, PORT: String(AUTH_PORT), AUTH_PUBLIC_URL: process.env.AUTH_PUBLIC_URL },
  stdio: ['ignore', 'inherit', 'inherit'],
});
child.on('exit', (code, signal) => {
  console.error(`Panel Labeler auth gateway exited (${code ?? signal ?? 'unknown'}).`);
  process.exit(code || 1);
});

const app = express();
app.disable('x-powered-by');
app.get('/healthz', (_req, res) => res.json({ ok: true, searchGateway: true }));

app.get('/api/servicetitan/location-search', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  if (!signedIn(req)) return res.status(401).json({ error: 'Sign in with your GEN3 Microsoft account first.' });
  if (!stConfigured()) return res.status(503).json({ error: 'ServiceTitan is not configured.' });
  const q = String(req.query.q || '').trim();
  if (q.length < 3) return res.status(400).json({ error: 'Type at least 3 characters.' });
  try {
    const token = await stToken();
    const cache = await loadLocations(token);
    const ranked = rankLocationMatches(cache.locations, q, 25);
    const customerMap = await customersFor(ranked.map(({ location }) => location.customerId), token);
    const results = ranked.map(({ location, score }) => {
      const customer = customerMap.get(String(location.customerId)) || {};
      return {
        score,
        locationId: String(location.id || ''),
        customerId: String(location.customerId || customer.id || ''),
        customer: String(customer.name || location.name || 'ServiceTitan customer'),
        address: formatServiceTitanLocationAddress(location),
        job: locationToJobChoice(location, customer),
      };
    });
    res.json({ query: q, results, count: results.length, searchedLocations: cache.locations.length, incomplete: cache.incomplete });
  } catch (error) {
    console.error('ServiceTitan location search failed:', error.message);
    const hint = error.status === 403 ? ' Confirm the ServiceTitan app has read access to Customers and Locations.' : '';
    res.status(error.status || 502).json({ error: `${error.message}${hint}` });
  }
});

app.use((req, res) => {
  const headers = { ...req.headers, host: `127.0.0.1:${AUTH_PORT}` };
  const proxy = http.request({ hostname: '127.0.0.1', port: AUTH_PORT, path: req.originalUrl, method: req.method, headers }, (upstream) => {
    res.status(upstream.statusCode || 502);
    for (const [name, value] of Object.entries(upstream.headers)) {
      if (value !== undefined && !['connection', 'keep-alive', 'transfer-encoding'].includes(name.toLowerCase())) res.setHeader(name, value);
    }
    upstream.pipe(res);
  });
  proxy.on('error', (error) => {
    console.error('Search gateway proxy error:', error.message);
    if (!res.headersSent) res.status(502).json({ error: 'Panel Labeler is starting. Please retry in a moment.' });
    else res.end();
  });
  req.pipe(proxy);
});

app.listen(PORT, '0.0.0.0', () => console.log(`GEN3 ServiceTitan search gateway listening on port ${PORT}`));
