import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { AppError, NotFoundError, UnauthorizedError, ValidationError } from '../domain/errors.js';
import { toPublicUser, type User } from '../domain/types.js';
import type { Services } from '../services/index.js';
import { parseCookies, serializeCookie } from './cookies.js';
import type { OAuthProvider } from './googleOAuth.js';
import { Router } from './router.js';

export interface AppOptions {
  services: Services;
  oauth: OAuthProvider | null;
  secureCookies: boolean;
  publicDir: string;
  log?: (message: string) => void;
}

interface Context {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
  cookies: Record<string, string>;
  token: string | undefined;
  user: User | null;
}

interface Reply {
  status: number;
  body?: unknown;
  cookies?: string[];
  redirect?: string;
}

type Handler = (ctx: Context) => Promise<Reply>;

const SESSION_COOKIE = 'sid';
const STATE_COOKIE = 'oauth_state';
const SESSION_MAX_AGE = 14 * 24 * 3600;
const MAX_BODY_BYTES = 16 * 1024;

const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
};

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

/**
 * The HTTP layer: it reads the request, finds the user from the session, calls
 * ONE service function and turns the result or the AppError into a response.
 * It contains no business rules and no permission checks of its own.
 */
export function createApp(options: AppOptions) {
  const { services, oauth, secureCookies } = options;
  const log = options.log ?? ((m: string) => console.error(m));
  const router = new Router<Handler>();

  const sessionCookie = (token: string) =>
    serializeCookie(SESSION_COOKIE, token, { maxAgeSeconds: SESSION_MAX_AGE, secure: secureCookies });
  const requireUser = (ctx: Context): User => {
    if (!ctx.user) throw new UnauthorizedError();
    return ctx.user;
  };
  const idParam = (ctx: Context) => Number(ctx.params.id);

  // --- auth -----------------------------------------------------------------
  router.add('POST', '/api/auth/register', async (ctx) => {
    const { user, token } = await services.auth.register(ctx.body);
    return { status: 201, body: { user: toPublicUser(user) }, cookies: [sessionCookie(token)] };
  });
  router.add('POST', '/api/auth/login', async (ctx) => {
    const { user, token } = await services.auth.login(ctx.body);
    return { status: 200, body: { user: toPublicUser(user) }, cookies: [sessionCookie(token)] };
  });
  router.add('POST', '/api/auth/logout', async (ctx) => {
    await services.auth.logout(ctx.token);
    return {
      status: 204,
      cookies: [serializeCookie(SESSION_COOKIE, '', { maxAgeSeconds: 0, secure: secureCookies })],
    };
  });
  router.add('GET', '/api/auth/me', async (ctx) => ({
    status: 200,
    body: { user: toPublicUser(requireUser(ctx)) },
  }));
  router.add('POST', '/api/auth/tokens', async (ctx) => ({
    status: 201,
    body: { token: await services.auth.issueToken(requireUser(ctx)) },
  }));
  router.add('GET', '/api/auth/google', async () => {
    if (!oauth) {
      // A full-page navigation, so answer with a page the user can read, not JSON.
      return { status: 302, redirect: `/#/login?error=${encodeURIComponent('Входът с Google не е настроен на този сървър.')}` };
    }
    const state = randomBytes(16).toString('base64url');
    return {
      status: 302,
      redirect: oauth.authUrl(state),
      cookies: [serializeCookie(STATE_COOKIE, state, { maxAgeSeconds: 600, secure: secureCookies, path: '/api/auth' })],
    };
  });
  router.add('GET', '/api/auth/google/callback', async (ctx) => {
    const clearState = serializeCookie(STATE_COOKIE, '', { maxAgeSeconds: 0, secure: secureCookies, path: '/api/auth' });
    const fail = (message: string): Reply => ({
      status: 302,
      redirect: `/#/login?error=${encodeURIComponent(message)}`,
      cookies: [clearState],
    });
    const state = ctx.query.get('state');
    const code = ctx.query.get('code');
    // The state must match the cookie we set, or this callback was not started by this browser.
    if (!oauth || !state || !code || state !== ctx.cookies[STATE_COOKIE]) {
      return fail('Входът с Google не завърши. Опитай отново.');
    }
    try {
      const profile = await oauth.profileFromCode(code);
      const { token } = await services.auth.loginWithProvider(profile);
      return { status: 302, redirect: '/#/calendar', cookies: [clearState, sessionCookie(token)] };
    } catch (error) {
      if (error instanceof AppError) return fail(error.message);
      throw error;
    }
  });

  // --- labs and the calendar ------------------------------------------------
  router.add('GET', '/api/labs', async () => ({ status: 200, body: { labs: await services.labs.listLabs() } }));
  router.add('POST', '/api/labs', async (ctx) => ({
    status: 201,
    body: { lab: await services.labs.createLab(requireUser(ctx), ctx.body) },
  }));
  router.add('POST', '/api/labs/:id/supervisors', async (ctx) => {
    await services.labs.assignSupervisor(requireUser(ctx), idParam(ctx), ctx.body.email);
    return { status: 204 };
  });
  router.add('GET', '/api/availability', async (ctx) => {
    requireUser(ctx);
    return { status: 200, body: await services.labs.availability(ctx.query.get('date')) };
  });

  // --- bookings -------------------------------------------------------------
  router.add('GET', '/api/bookings/mine', async (ctx) => ({
    status: 200,
    body: { bookings: await services.bookings.listMine(requireUser(ctx)) },
  }));
  router.add('GET', '/api/bookings/pending', async (ctx) => ({
    status: 200,
    body: { bookings: await services.bookings.listPending(requireUser(ctx)) },
  }));
  router.add('POST', '/api/bookings', async (ctx) => ({
    status: 201,
    body: { booking: await services.bookings.create(requireUser(ctx), ctx.body) },
  }));
  router.add('POST', '/api/bookings/:id/cancel', async (ctx) => ({
    status: 200,
    body: { booking: await services.bookings.cancel(requireUser(ctx), idParam(ctx)) },
  }));
  router.add('POST', '/api/bookings/:id/approve', async (ctx) => ({
    status: 200,
    body: { booking: await services.bookings.approve(requireUser(ctx), idParam(ctx)) },
  }));
  router.add('POST', '/api/bookings/:id/reject', async (ctx) => ({
    status: 200,
    body: { booking: await services.bookings.reject(requireUser(ctx), idParam(ctx)) },
  }));

  // --- the model feature ----------------------------------------------------
  router.add('POST', '/api/suggestions', async (ctx) => ({
    status: 200,
    body: await services.suggestions.suggest(requireUser(ctx), ctx.body),
  }));

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (!url.pathname.startsWith('/api/')) {
        await serveStatic(options.publicDir, url.pathname, req.method ?? 'GET', res);
        return;
      }
      const match = router.match(req.method ?? 'GET', url.pathname);
      if (match.kind === 'not-found') throw new NotFoundError('Няма такъв адрес в API-то.');
      if (match.kind === 'method-not-allowed') throw new AppError(405, 'Този метод не е позволен тук.');

      const cookies = parseCookies(req.headers.cookie);
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
      const token = bearer ?? cookies[SESSION_COOKIE];
      const ctx: Context = {
        params: match.params,
        query: url.searchParams,
        body: req.method === 'GET' ? {} : await readJsonBody(req),
        cookies,
        token,
        user: await services.auth.userForToken(token),
      };
      send(res, await match.handler(ctx));
    } catch (error) {
      if (error instanceof AppError) {
        send(res, { status: error.status, body: { error: error.message } });
      } else {
        // Log the message, never the request body: it may hold a password or a prompt.
        log(`Unhandled error on ${req.method} ${url.pathname}: ${(error as Error).message}`);
        send(res, { status: 500, body: { error: 'Нещо се обърка на сървъра. Опитай отново след малко.' } });
      }
    }
  };
}

/**
 * Every state-changing API call must be JSON. A plain HTML form on another site
 * cannot send application/json without a CORS preflight, which we never allow,
 * so together with SameSite cookies this closes CSRF.
 */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const type = req.headers['content-type'] ?? '';
  if (!type.startsWith('application/json')) {
    throw new AppError(415, 'Заявката трябва да е във формат JSON.');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new AppError(413, 'Заявката е твърде голяма.');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ValidationError('Заявката не е валиден JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ValidationError('Заявката трябва да е JSON обект.');
  }
  return parsed as Record<string, unknown>;
}

function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string | string[]> = { ...SECURITY_HEADERS, 'cache-control': 'no-store' };
  if (reply.cookies?.length) headers['set-cookie'] = reply.cookies;
  if (reply.redirect) headers.location = reply.redirect;
  if (reply.body === undefined) {
    res.writeHead(reply.status, headers).end();
    return;
  }
  headers['content-type'] = 'application/json; charset=utf-8';
  res.writeHead(reply.status, headers).end(JSON.stringify(reply.body));
}

async function serveStatic(publicDir: string, pathname: string, method: string, res: ServerResponse) {
  if (method !== 'GET' && method !== 'HEAD') throw new AppError(405, 'Този метод не е позволен тук.');
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const root = normalize(publicDir + sep);
  const file = normalize(join(root, relative));
  // Refuse anything that escapes the public folder, such as /../.env
  if (!file.startsWith(root)) throw new NotFoundError('Няма такава страница.');
  let content: Buffer;
  try {
    content = await readFile(file);
  } catch {
    throw new NotFoundError('Няма такава страница.');
  }
  res
    .writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    })
    .end(method === 'HEAD' ? undefined : content);
}
