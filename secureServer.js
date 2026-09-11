import express from 'express';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const PORT = Number(process.env.PORT || 3000);
const APP_PORT = Number(process.env.INTERNAL_APP_PORT || 3001);
const TENANT_ID = String(process.env.MS_AUTH_TENANT_ID || '').trim();
const CLIENT_ID = String(process.env.MS_AUTH_CLIENT_ID || '').trim();
const CLIENT_SECRET = String(process.env.MS_AUTH_CLIENT_SECRET || '');
const PUBLIC_URL = String(process.env.AUTH_PUBLIC_URL || '').replace(/\/$/, '');
const READY = Boolean(TENANT_ID && CLIENT_ID && CLIENT_SECRET && /^https:\/\//i.test(PUBLIC_URL));
const AUTHORITY = `https://login.microsoftonline.com/${encodeURIComponent(TENANT_ID)}/oauth2/v2.0`;
const REDIRECT_URI = `${PUBLIC_URL}/auth/callback`;
const SESSION_COOKIE = '__Host-gen3-panel-session';
const TX_COOKIE = '__Host-gen3-panel-transaction';
const SESSION_MS = 8 * 60 * 60 * 1000;
const TX_MS = 10 * 60 * 1000;
const sessionKey = createHmac('sha256', CLIENT_SECRET || 'not-configured').update('GEN3 Panel Labeler session').digest();
const txKey = createHmac('sha256', CLIENT_SECRET || 'not-configured').update('GEN3 Panel Labeler transaction').digest();

function token() { return randomBytes(32).toString('base64url'); }
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function pack(data, key) {
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig = createHmac('sha256', key).update(body).digest('base64url');
  return `${body}.${sig}`;
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
  const matches = String(req.headers.cookie || '').split(';').map((x) => x.trim()).filter((x) => x.startsWith(prefix));
  return matches.length === 1 ? decodeURIComponent(matches[0].slice(prefix.length)) : '';
}
function session(req) {
  const data = unpack(cookie(req, SESSION_COOKIE), sessionKey);
  return data && data.v === 1 && data.oid && data.exp > Date.now() ? data : null;
}
function cookieOptions(maxAge) { return { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge }; }
function noStore(res) {
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
}
async function jsonResponse(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

const child = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(APP_PORT) },
  stdio: ['ignore', 'inherit', 'inherit'],
});
child.on('exit', (code, signal) => {
  console.error(`Panel Labeler application process exited (${code ?? signal ?? 'unknown'}).`);
  process.exit(code || 1);
});

const app = express();
app.disable('x-powered-by');

app.get('/healthz', (_req, res) => res.json({ ok: true, authConfigured: READY }));

app.get('/auth/login', (req, res) => {
  noStore(res);
  if (!READY) return res.status(503).send('GEN3 employee sign-in is not configured.');
  const state = token();
  const verifier = token();
  const tx = { v: 1, state, verifier, exp: Date.now() + TX_MS };
  res.cookie(TX_COOKIE, pack(tx, txKey), cookieOptions(TX_MS));
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    response_mode: 'query',
    scope: 'openid profile email User.Read',
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  res.redirect(`${AUTHORITY}/authorize?${params}`);
});

app.get('/auth/callback', async (req, res) => {
  noStore(res);
  const tx = unpack(cookie(req, TX_COOKIE), txKey);
  res.clearCookie(TX_COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
  if (!READY || !tx || tx.v !== 1 || tx.exp <= Date.now() || !same(tx.state, String(req.query.state || '')) || req.query.error || typeof req.query.code !== 'string' || req.query.code.length > 8192) {
    return res.redirect('/?authError=signin_failed');
  }
  try {
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code: req.query.code,
      code_verifier: tx.verifier,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
      scope: 'openid profile email User.Read',
    });
    const tokenResponse = await fetch(`${AUTHORITY}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    const tokens = await jsonResponse(tokenResponse);
    if (!tokenResponse.ok || !tokens?.access_token) throw new Error('token_exchange_failed');
    const graphResponse = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName,userType', {
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    const profile = await jsonResponse(graphResponse);
    if (!graphResponse.ok || !profile?.id || profile.userType !== 'Member') return res.redirect('/?authError=employee_required');
    const authSession = {
      v: 1,
      oid: String(profile.id),
      name: String(profile.displayName || 'GEN3 employee').slice(0, 200),
      email: String(profile.mail || profile.userPrincipalName || '').slice(0, 320),
      exp: Date.now() + SESSION_MS,
    };
    res.cookie(SESSION_COOKIE, pack(authSession, sessionKey), cookieOptions(SESSION_MS));
    return res.redirect('/');
  } catch (error) {
    console.warn('GEN3 employee sign-in failed:', error?.message || 'unknown');
    return res.redirect('/?authError=signin_failed');
  }
});

app.post('/auth/logout', (req, res) => {
  noStore(res);
  if (req.headers.origin && req.headers.origin !== PUBLIC_URL) return res.status(403).json({ error: 'Request origin rejected.' });
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
  res.status(204).end();
});

app.get('/auth/session', (req, res) => {
  noStore(res);
  const authSession = session(req);
  if (!authSession) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, user: { id: authSession.oid, name: authSession.name, email: authSession.email }, expiresAt: authSession.exp });
});

function loginPage(req, res) {
  noStore(res);
  const reason = String(req.query.authError || '');
  const message = reason === 'employee_required'
    ? 'This account is not an active member of the GEN3 Microsoft organization.'
    : reason
      ? 'Microsoft sign-in could not be completed. Please try again.'
      : 'Sign in with your GEN3 Microsoft account to use the Panel Labeler.';
  res.status(401).type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GEN3 Panel Labeler Sign-In</title><style>body{margin:0;font-family:Arial,sans-serif;background:#f5f7fa;color:#12233f;display:grid;min-height:100vh;place-items:center}.card{width:min(420px,calc(100% - 40px));background:white;border-radius:18px;padding:32px;box-shadow:0 12px 38px #0002}.brand{font-size:29px;font-weight:800;margin-bottom:8px}.sub{font-size:18px;font-weight:700;margin-bottom:24px}.msg{line-height:1.5;color:#46546a;margin-bottom:24px}.btn{display:block;text-align:center;text-decoration:none;background:#122d53;color:white;font-weight:700;padding:14px 18px;border-radius:10px}.note{font-size:12px;color:#6b778b;margin-top:18px;line-height:1.4}</style></head><body><main class="card"><div class="brand">⚡ GEN3</div><div class="sub">Panel Labeler</div><div class="msg">${message}</div><a class="btn" href="/auth/login">Sign in with Microsoft</a><div class="note">Access is limited to GEN3 Microsoft accounts. Panel photos already saved offline on this device are not deleted by signing in.</div></main></body></html>`);
}

app.use((req, res, next) => {
  if (!READY) return loginPage(req, res);
  const authSession = session(req);
  if (!authSession) return loginPage(req, res);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== PUBLIC_URL) {
    return res.status(403).json({ error: 'Request origin rejected.' });
  }
  next();
});

app.use((req, res) => {
  const headers = { ...req.headers, host: `127.0.0.1:${APP_PORT}` };
  const proxy = http.request({ hostname: '127.0.0.1', port: APP_PORT, path: req.originalUrl, method: req.method, headers }, (upstream) => {
    res.status(upstream.statusCode || 502);
    for (const [name, value] of Object.entries(upstream.headers)) {
      if (value !== undefined && !['connection', 'keep-alive', 'transfer-encoding'].includes(name.toLowerCase())) res.setHeader(name, value);
    }
    upstream.pipe(res);
  });
  proxy.on('error', (error) => {
    console.error('Panel Labeler proxy error:', error.message);
    if (!res.headersSent) res.status(502).json({ error: 'Panel Labeler is starting. Please retry in a moment.' });
    else res.end();
  });
  req.pipe(proxy);
});

app.listen(PORT, '0.0.0.0', () => console.log(`GEN3 employee sign-in gateway listening on port ${PORT}`));
