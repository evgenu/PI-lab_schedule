import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { UnauthorizedError } from '../src/domain/errors.js';
import { createApp } from '../src/http/app.js';
import type { OAuthProvider } from '../src/http/googleOAuth.js';
import type { ProviderProfile } from '../src/services/auth.js';
import { makeWorld, TOMORROW } from './helpers.js';

class FakeGoogle implements OAuthProvider {
  profile: ProviderProfile = { provider: 'google', subject: 'g-1', email: 'ana@tu-sofia.bg', emailVerified: true, name: 'Ana' };
  authUrl(state: string) {
    return `https://accounts.example/auth?state=${state}`;
  }
  async profileFromCode(code: string) {
    if (code === 'bad') throw new UnauthorizedError('Google отказа входа. Опитай отново.');
    if (code === 'crash') throw new Error('network down');
    return this.profile;
  }
}

let server: Server;
let base: string;
let world: Awaited<ReturnType<typeof makeWorld>>;
const google = new FakeGoogle();
const logs: string[] = [];

before(async () => {
  world = await makeWorld();
  const publicDir = await mkdtemp(join(tmpdir(), 'lab-public-'));
  await writeFile(join(publicDir, 'index.html'), '<!doctype html><title>t</title>');
  await writeFile(join(publicDir, 'app.css'), 'body{}');
  await writeFile(join(publicDir, 'blob.bin'), 'x');
  const app = createApp({ services: world.services, oauth: google, secureCookies: true, publicDir, log: (m) => logs.push(m) });
  server = createServer((req, res) => void app(req, res));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const json = (body: unknown, cookie?: string): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  body: JSON.stringify(body),
});
const sid = (res: Response) => /sid=([^;]+)/.exec(res.headers.getSetCookie().join('\n'))?.[1];
const cookieOf = (res: Response) => `sid=${sid(res)}`;

async function signIn(email: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/login`, json({ email, password: 'correct horse' }));
  assert.equal(res.status, 200);
  return cookieOf(res);
}

describe('sessions over HTTP', () => {
  test('AC-5 password sign-in sets an HttpOnly, SameSite, Secure cookie that /api/auth/me accepts', async () => {
    const res = await fetch(`${base}/api/auth/login`, json({ email: 'ana@tu-sofia.bg', password: 'correct horse' }));
    const setCookie = res.headers.getSetCookie()[0]!;
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.match(setCookie, /Secure/);
    const body = await res.json();
    assert.equal(body.user.email, 'ana@tu-sofia.bg');
    assert.equal(body.user.passwordHash, undefined, 'the hash never leaves the server');

    const me = await fetch(`${base}/api/auth/me`, { headers: { cookie: cookieOf(res) } });
    assert.equal((await me.json()).user.name, 'Ана');

    const out = await fetch(`${base}/api/auth/logout`, json({}, cookieOf(res)));
    assert.equal(out.status, 204);
    assert.match(out.headers.getSetCookie()[0]!, /Max-Age=0/);
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { cookie: cookieOf(res) } })).status, 401);
  });

  test('AC-5 Google sign-in ends in the same kind of session as the password', async () => {
    const start = await fetch(`${base}/api/auth/google`, { redirect: 'manual' });
    assert.equal(start.status, 302);
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    assert.match(start.headers.getSetCookie()[0]!, /oauth_state=.+Path=\/api\/auth/);

    const back = await fetch(`${base}/api/auth/google/callback?code=ok&state=${state}`, {
      redirect: 'manual',
      headers: { cookie: `oauth_state=${state}` },
    });
    assert.equal(back.status, 302);
    assert.equal(back.headers.get('location'), '/#/calendar');
    const me = await fetch(`${base}/api/auth/me`, { headers: { cookie: cookieOf(back) } });
    assert.equal((await me.json()).user.id, world.users.student.id, 'AC-3: linked to the password account');
  });

  test('AC-4 a callback with a wrong state, a refused code or an unverified e-mail goes back to the login with a sentence', async () => {
    const attempt = (query: string, cookie = 'oauth_state=s1') =>
      fetch(`${base}/api/auth/google/callback?${query}`, { redirect: 'manual', headers: { cookie } });

    const forged = await attempt('code=ok&state=other');
    assert.match(decodeURIComponent(forged.headers.get('location')!), /#\/login\?error=Входът с Google не завърши/);
    assert.equal(sid(forged), undefined);

    const refused = await attempt('code=bad&state=s1');
    assert.match(decodeURIComponent(refused.headers.get('location')!), /Google отказа входа/);

    google.profile = { ...google.profile, subject: 'g-2', email: 'boris@tu-sofia.bg', emailVerified: false };
    const unverified = await attempt('code=ok&state=s1');
    assert.match(decodeURIComponent(unverified.headers.get('location')!), /не е потвърдил имейла/);
    assert.equal(sid(unverified), undefined);

    const crashed = await attempt('code=crash&state=s1');
    assert.equal(crashed.status, 500);
  });

  test('AC-5 a Bearer token (as used by MCP clients) works like the cookie', async () => {
    const cookie = await signIn('ana@tu-sofia.bg');
    const tokenRes = await fetch(`${base}/api/auth/tokens`, json({}, cookie));
    assert.equal(tokenRes.status, 201);
    const { token } = await tokenRes.json();
    const me = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal((await me.json()).user.email, 'ana@tu-sofia.bg');
  });

  test('AC-6 register over HTTP: 201 with a session, then 409 for the same e-mail', async () => {
    const body = { email: 'nova@tu-sofia.bg', password: 'long enough', name: 'Нова' };
    const created = await fetch(`${base}/api/auth/register`, json(body));
    assert.equal(created.status, 201);
    assert.ok(sid(created));
    const again = await fetch(`${base}/api/auth/register`, json(body));
    assert.equal(again.status, 409);
    assert.match((await again.json()).error, /Вече има профил/);
  });
});

describe('the REST API', () => {
  test('AC-8 the booking flow over HTTP: calendar → book → approve → mine', async () => {
    const student = await signIn('boris@tu-sofia.bg');
    const teacher = await signIn('petrov@tu-sofia.bg');

    const day = await fetch(`${base}/api/availability?date=${TOMORROW}`, { headers: { cookie: student } });
    assert.equal(day.status, 200);
    assert.equal((await day.json()).labs.length, 2);

    const booked = await fetch(`${base}/api/bookings`, json({ labId: 1, date: TOMORROW, hour: 16, purpose: 'HTTP' }, student));
    assert.equal(booked.status, 201);
    const { booking } = await booked.json();
    assert.equal(booking.status, 'pending');

    const queue = await (await fetch(`${base}/api/bookings/pending`, { headers: { cookie: teacher } })).json();
    assert.ok(queue.bookings.some((b: { id: number }) => b.id === booking.id));

    const approved = await fetch(`${base}/api/bookings/${booking.id}/approve`, json({}, teacher));
    assert.equal((await approved.json()).booking.status, 'approved');

    const mine = await (await fetch(`${base}/api/bookings/mine`, { headers: { cookie: student } })).json();
    assert.equal(mine.bookings.find((b: { id: number }) => b.id === booking.id).status, 'approved');
  });

  test('AC-12 cancelling someone else’s booking over HTTP is 403 — the check is in the service, not the route', async () => {
    const owner = await signIn('ana@tu-sofia.bg');
    const stranger = await signIn('boris@tu-sofia.bg');
    const { booking } = await (await fetch(`${base}/api/bookings`, json({ labId: 2, date: TOMORROW, hour: 17 }, owner))).json();
    const refused = await fetch(`${base}/api/bookings/${booking.id}/cancel`, json({}, stranger));
    assert.equal(refused.status, 403);
    assert.equal((await fetch(`${base}/api/bookings/${booking.id}/cancel`, json({}, owner))).status, 200);
  });

  test('AC-13 rejecting over HTTP as a teacher of another lab is 403', async () => {
    const owner = await signIn('ana@tu-sofia.bg');
    const wrongTeacher = await signIn('ivanova@tu-sofia.bg');
    const { booking } = await (await fetch(`${base}/api/bookings`, json({ labId: 1, date: TOMORROW, hour: 18 }, owner))).json();
    assert.equal((await fetch(`${base}/api/bookings/${booking.id}/reject`, json({}, wrongTeacher))).status, 403);
  });

  test('AC-16 lab administration over HTTP', async () => {
    const admin = await signIn('admin@tu-sofia.bg');
    const student = await signIn('ana@tu-sofia.bg');
    const lab = { name: 'HTTP лаб', building: 'Блок 9', capacity: 5, description: '' };
    assert.equal((await fetch(`${base}/api/labs`, json(lab, student))).status, 403);
    const created = await fetch(`${base}/api/labs`, json(lab, admin));
    assert.equal(created.status, 201);
    const id = (await created.json()).lab.id;
    assert.equal((await fetch(`${base}/api/labs/${id}/supervisors`, json({ email: 'boris@tu-sofia.bg' }, admin))).status, 204);
    const labs = await (await fetch(`${base}/api/labs`)).json();
    assert.ok(labs.labs.some((l: { name: string }) => l.name === 'HTTP лаб'));
  });

  test('AC-17 the suggestion endpoint answers through the service', async () => {
    const student = await signIn('ana@tu-sofia.bg');
    const res = await fetch(`${base}/api/suggestions`, json({ text: 'за 2 души сутрин', date: TOMORROW }, student));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.source, 'fallback');
    assert.equal(typeof body.suggestion.labName, 'string');
  });

  test('AC-28 errors are a JSON sentence; unknown errors are a generic 500; writes must be JSON', async () => {
    const anonymous = await fetch(`${base}/api/bookings/mine`);
    assert.equal(anonymous.status, 401);
    assert.deepEqual(await anonymous.json(), { error: 'Влез в профила си, за да продължиш.' });

    const notJson = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=a&password=b',
    });
    assert.equal(notJson.status, 415);

    const broken = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
    assert.equal(broken.status, 400);
    const array = await fetch(`${base}/api/auth/login`, json([1, 2]));
    assert.equal(array.status, 400);
    const huge = await fetch(`${base}/api/auth/login`, json({ email: 'x'.repeat(20_000) }));
    assert.equal(huge.status, 413);
    const empty = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' } });
    assert.equal(empty.status, 401, 'an empty body is an empty object, then a normal refusal');

    assert.equal((await fetch(`${base}/api/nothing-here`)).status, 404);
    const wrongMethod = await fetch(`${base}/api/labs`, { method: 'DELETE' });
    assert.equal(wrongMethod.status, 405);
    assert.match((await wrongMethod.json()).error, /метод/);

    // A bug in a service: the user sees a sentence, the log gets the message, nobody sees a stack.
    const original = world.services.labs.listLabs;
    world.services.labs.listLabs = async () => {
      throw new Error('relation "labs" does not exist');
    };
    const crash = await fetch(`${base}/api/labs`);
    world.services.labs.listLabs = original;
    assert.equal(crash.status, 500);
    const text = await crash.text();
    assert.ok(!text.includes('relation'), 'no internals in the response');
    assert.match(JSON.parse(text).error, /Нещо се обърка/);
    assert.match(logs.at(-1)!, /relation "labs" does not exist/);
  });
});

describe('static files', () => {
  test('AC-28 serves the page with security headers and refuses to leave the public folder', async () => {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type')!, /text\/html/);
    assert.match(page.headers.get('content-security-policy')!, /default-src 'self'/);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    assert.match((await fetch(`${base}/app.css`)).headers.get('content-type')!, /text\/css/);
    assert.equal((await fetch(`${base}/blob.bin`)).headers.get('content-type'), 'application/octet-stream');
    const head = await fetch(`${base}/`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal((await fetch(`${base}/missing.js`)).status, 404);
    assert.equal((await fetch(`${base}/..%2F..%2Fetc%2Fpasswd`)).status, 404);
    assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405);
  });

  test('AC-28 without Google configured, the button lands on a readable login error', async () => {
    const app = createApp({ services: world.services, oauth: null, secureCookies: false, publicDir: '/nonexistent' });
    const plain = createServer((req, res) => void app(req, res));
    await new Promise<void>((resolve) => plain.listen(0, resolve));
    const url = `http://127.0.0.1:${(plain.address() as AddressInfo).port}`;
    const res = await fetch(`${url}/api/auth/google`, { redirect: 'manual' });
    assert.match(decodeURIComponent(res.headers.get('location')!), /не е настроен/);
    const callback = await fetch(`${url}/api/auth/google/callback?code=x&state=y`, { redirect: 'manual', headers: { cookie: 'oauth_state=y' } });
    assert.match(callback.headers.get('location')!, /#\/login\?error=/);
    const login = await fetch(`${url}/api/auth/login`, json({ email: 'ana@tu-sofia.bg', password: 'correct horse' }));
    assert.ok(!login.headers.getSetCookie()[0]!.includes('Secure'), 'no Secure flag on plain http');
    await new Promise<void>((resolve) => plain.close(() => resolve()));
  });
});
