import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const EIGHT_HOURS = 8 * 60 * 60 * 1000;
const TEN_MINUTES = 10 * 60 * 1000;

function randomToken() {
  return randomBytes(32).toString('base64url');
}

function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function settings(env = process.env) {
  const tenantId = String(env.MS_AUTH_TENANT_ID || '').trim();
  const clientId = String(env.MS_AUTH_CLIENT_ID || '').trim();
  const clientSecret = String(env.MS_AUTH_CLIENT_SECRET || '');
  const origin = String(env.AUTH_PUBLIC_URL || '').replace(/\/$/, '');
  const ready = Boolean(tenantId && clientId && clientSecret && /^https:\/\//i.test(origin));
  return {
    tenantId,
    clientId,
    clientSecret,
    origin,
    ready,
    authority: `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0`,
    redirectUri: `${origin}/auth/callback`,
    sessionCookie: '__Host-gen3-panel-session',
    transactionCookie: '__Host-gen3-panel-transaction',
  };
}

function signer(secret, purpose) {
  return createHmac('sha256', secret).update(`GEN3 Panel Labeler:${purpose}`).digest();
}

function pack(value, key) {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature = createHmac('sha256', key).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function unpack(value, key) {
  if (!value || value.length > 5000) return null;
  const [body, signature, extra] = String(value).split('.');
  if (!body || !signature || extra) return null;
  const expected = createHmac('sha256', key).update(body).digest('base64url');
  if (!same(signature, expected)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); }
  catch { return null; }
}

function readCookie(req, name) {
  const prefix = `${name}=`;
  const matches = String(req.headers.cookie || '').split(';').map((part) => part.trim()).filter((part) => part.startsWith(prefix));
  return matches.length === 1 ? decodeURIComponent(matches[0].slice(prefix.length)) : '';
}

function cookieOptions(maxAge) {
  return { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge };
}

function clearCookie(res, name) {
  res.clearCookie(name, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
}

async function readJson(response) {
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return data;
}

export function installEmployeeAuth(app, { env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const config = settings(env);
  const sessionKey = signer(config.clientSecret, 'session');
  const transactionKey = signer(config.clientSecret, 'transaction');

  app.disable('x-powered-by');

  function noStore(res) {
    res.set({
      'Cache-Control': 'private, no-store',
      Pragma: 'no-cache',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
  }

  function currentSession(req) {
    if (!config.ready) return null;
    const session = unpack(readCookie(req, config.sessionCookie), sessionKey);
    if (!session || session.v !== 1 || !session.oid || !session.exp || session.exp <= now()) return null;
    return session;
  }

  function authError(res, status = 401, code = 'AUTH_REQUIRED') {
    noStore(res);
    const message = status === 503
      ? 'GEN3 employee sign-in is not configured. Access is locked.'
      : status === 403
        ? 'A GEN3 employee Microsoft account is required.'
        : 'Sign in with your GEN3 Microsoft account to continue.';
    return res.status(status).json({ error: message, code });
  }

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  app.get('/auth/session', (req, res) => {
    noStore(res);
    if (!config.ready) return authError(res, 503, 'AUTH_NOT_CONFIGURED');
    const session = currentSession(req);
    if (!session) {
      clearCookie(res, config.sessionCookie);
      return authError(res, 401, 'AUTH_REQUIRED');
    }
    return res.json({
      user: { id: session.oid, name: session.name, email: session.email },
      expiresAt: session.exp,
    });
  });

  app.get('/auth/login', (req, res) => {
    noStore(res);
    if (!config.ready) return authError(res, 503, 'AUTH_NOT_CONFIGURED');
    const state = randomToken();
    const verifier = randomToken();
    const transaction = { v: 1, state, verifier, exp: now() + TEN_MINUTES };
    res.cookie(config.transactionCookie, pack(transaction, transactionKey), cookieOptions(TEN_MINUTES));
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      redirect_uri: config.redirectUri,
      response_mode: 'query',
      scope: 'openid profile email User.Read',
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return res.redirect(`${config.authority}/authorize?${params.toString()}`);
  });

  app.get('/auth/callback', async (req, res) => {
    noStore(res);
    const transaction = unpack(readCookie(req, config.transactionCookie), transactionKey);
    clearCookie(res, config.transactionCookie);
    if (!config.ready || !transaction || transaction.v !== 1 || transaction.exp <= now() || !same(transaction.state, String(req.query.state || ''))) {
      return res.redirect('/?authError=signin_failed');
    }
    if (req.query.error || typeof req.query.code !== 'string' || req.query.code.length > 8192) {
      return res.redirect('/?authError=signin_failed');
    }

    try {
      const body = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code: req.query.code,
        code_verifier: transaction.verifier,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
        scope: 'openid profile email User.Read',
      });
      const tokenResponse = await fetchImpl(`${config.authority}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      const tokens = await readJson(tokenResponse);
      if (!tokenResponse.ok || !tokens?.access_token) throw new Error('TOKEN_EXCHANGE_FAILED');

      const graphResponse = await fetchImpl('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName,userType', {
        headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      const profile = await readJson(graphResponse);
      if (!graphResponse.ok || !profile?.id) throw new Error('PROFILE_LOOKUP_FAILED');
      if (profile.userType !== 'Member') return res.redirect('/?authError=employee_required');

      const expiresAt = now() + EIGHT_HOURS;
      const session = {
        v: 1,
        oid: String(profile.id),
        name: String(profile.displayName || 'GEN3 employee').slice(0, 200),
        email: String(profile.mail || profile.userPrincipalName || '').slice(0, 320),
        exp: expiresAt,
      };
      res.cookie(config.sessionCookie, pack(session, sessionKey), cookieOptions(EIGHT_HOURS));
      return res.redirect('/');
    } catch (error) {
      console.warn('GEN3 employee sign-in failed:', error?.message || 'unknown error');
      return res.redirect('/?authError=signin_failed');
    }
  });

  app.post('/auth/logout', (req, res) => {
    noStore(res);
    if (req.headers.origin && req.headers.origin !== config.origin) return authError(res, 403, 'ORIGIN_REJECTED');
    clearCookie(res, config.sessionCookie);
    return res.status(204).end();
  });

  app.use('/api', (req, res, next) => {
    noStore(res);
    if (!config.ready) return authError(res, 503, 'AUTH_NOT_CONFIGURED');
    const session = currentSession(req);
    if (!session) {
      clearCookie(res, config.sessionCookie);
      return authError(res, 401, 'AUTH_REQUIRED');
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== config.origin) {
      return authError(res, 403, 'ORIGIN_REJECTED');
    }
    req.employee = { id: session.oid, name: session.name, email: session.email };
    return next();
  });
}
