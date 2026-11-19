import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ApiError, createApi, readableError } from '../web/src/api.js';
import { formatDate, formatSlot, todayInSofia } from '../web/src/format.js';
import { escapeHtml, html } from '../web/src/html.js';
import { failed, loaded, loading, renderRemote } from '../web/src/remote.js';
import { allowedRoutes, initialState, parseHash, type AppState } from '../web/src/state.js';
import type { Availability, Booking, Lab, User } from '../web/src/types.js';
import { renderAdmin } from '../web/src/views/admin.js';
import { renderApprovals, renderMine } from '../web/src/views/bookings.js';
import { renderBookingForm, renderCalendar, renderSuggestionPanel } from '../web/src/views/calendar.js';
import { renderPage } from '../web/src/views/page.js';

const student: User = { id: 1, email: 'ana@tu-sofia.bg', name: 'Ана', role: 'student' };
const teacher: User = { ...student, id: 2, name: 'Петров', role: 'teacher' };
const admin: User = { ...student, id: 3, name: 'Админ', role: 'admin' };
const lab: Lab = { id: 1, name: 'Мрежи', building: 'Блок 1', capacity: 20, description: 'Cisco' };
const availability: Availability = {
  date: '2026-11-20',
  hours: [8, 9, 10],
  labs: [{ lab, slots: [{ hour: 8, state: 'past' }, { hour: 9, state: 'free' }, { hour: 10, state: 'pending' }] }],
};
const booking: Booking = { id: 7, labId: 1, labName: 'Мрежи', userId: 1, date: '2026-11-20', hour: 9, purpose: 'Проект', status: 'pending' };

const stateWith = (patch: Partial<AppState>): AppState => ({ ...initialState('2026-11-20'), session: loaded(student), ...patch });
const page = (patch: Partial<AppState>) => renderPage(stateWith(patch)).value;

describe('the four states', () => {
  test('AC-24 renderRemote has a loading, an error, an empty and a success state', () => {
    const views = {
      loadingLabel: 'Зареждаме…',
      retryAction: 'reload-x',
      isEmpty: (d: number[]) => d.length === 0,
      empty: html`<p>Празно</p>`,
      success: (d: number[]) => html`<p>${d.length} неща</p>`,
    };
    assert.match(renderRemote(loading<number[]>(), views).value, /role="status".*Зареждаме…/s);
    const error = renderRemote(failed<number[]>('Сървърът не отговаря.'), views).value;
    assert.match(error, /role="alert"/);
    assert.match(error, /Сървърът не отговаря\./);
    assert.match(error, /data-action="reload-x"/);
    assert.match(renderRemote(loaded<number[]>([]), views).value, /state-empty.*Празно/s);
    assert.match(renderRemote(loaded([1, 2]), views).value, /2 неща/);
  });

  test('AC-24 every data screen renders all four states', () => {
    const screens: { route: AppState['route']; key: 'availability' | 'mine' | 'pending' | 'labs'; user: User; empty: unknown; full: unknown; emptyText: RegExp; fullText: RegExp }[] = [
      { route: 'calendar', key: 'availability', user: student, empty: { ...availability, labs: [] }, full: availability, emptyText: /няма добавени лаборатории/, fullText: /Мрежи/ },
      { route: 'mine', key: 'mine', user: student, empty: [], full: [booking], emptyText: /Още нямаш резервации/, fullText: /Чака одобрение/ },
      { route: 'approvals', key: 'pending', user: teacher, empty: [], full: [booking], emptyText: /Няма резервации, които чакат/, fullText: /Одобри/ },
      { route: 'admin', key: 'labs', user: admin, empty: [], full: [lab], emptyText: /Първо добави лаборатория/, fullText: /<option value="1">Мрежи/ },
    ];
    for (const s of screens) {
      const base = { route: s.route, session: loaded(s.user) };
      assert.match(page({ ...base, [s.key]: loading() }), /state-loading/, `${s.route} loading`);
      assert.match(page({ ...base, [s.key]: failed('Няма връзка със сървъра.') }), /role="alert">\s*<p>Няма връзка със сървъра\.<\/p>/, `${s.route} error`);
      assert.match(page({ ...base, [s.key]: loaded(s.empty) }), s.emptyText, `${s.route} empty`);
      assert.match(page({ ...base, [s.key]: loaded(s.full) }), s.fullText, `${s.route} success`);
    }
  });

  test('AC-24 the whole page has its own loading and error state while the session is checked', () => {
    assert.match(renderPage(initialState('2026-11-20')).value, /Зареждаме…/);
    const error = renderPage({ ...initialState('2026-11-20'), session: failed('Сървърът не отговаря в момента.') }).value;
    assert.match(error, /Сървърът не отговаря в момента\./);
    assert.match(error, /data-action="reload-session"/);
  });

  test('AC-24 API errors become sentences, never raw JSON', async () => {
    assert.equal(readableError({ error: 'Този час вече е зает.' }, 409), 'Този час вече е зает.');
    assert.equal(readableError({ message: 'raw' }, 401), 'Влез в профила си, за да продължиш.');
    assert.equal(readableError(null, 403), 'Нямаш права за това действие.');
    assert.equal(readableError(null, 404), 'Не намерихме това, което търсиш.');
    assert.equal(readableError(null, 429), 'Твърде много заявки. Изчакай малко и опитай пак.');
    assert.equal(readableError({ error: '  ' }, 502), 'Сървърът не отговаря в момента. Опитай отново след малко.');
    assert.equal(readableError('<html>', 418), 'Нещо се обърка. Опитай отново.');

    const calls: { url: string; init?: RequestInit }[] = [];
    const api = createApi(async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/logout')) return new Response(null, { status: 204 });
      if (url.includes('availability')) return new Response('<html>Bad gateway</html>', { status: 502 });
      if (url.includes('cancel')) return Response.json({ error: 'Можеш да отказваш само своите резервации.' }, { status: 403 });
      return Response.json({ user: student });
    });
    assert.equal((await api.me()).user.name, 'Ана');
    assert.equal(await api.logout(), undefined);
    await assert.rejects(api.availability('2026-11-20'), (e: ApiError) => e.status === 502 && /Сървърът не отговаря/.test(e.message));
    await assert.rejects(api.cancel(5), /само своите/);
    const post = calls.find((c) => c.url.includes('cancel'))!;
    assert.equal((post.init!.headers as Record<string, string>)['content-type'], 'application/json');
    assert.equal(post.init!.body, '{}');

    const offline = createApi(async () => {
      throw new TypeError('Failed to fetch');
    });
    await assert.rejects(offline.labs(), (e: ApiError) => e.status === 0 && /Няма връзка/.test(e.message));
  });

  test('AC-24 every API method calls the right endpoint', async () => {
    const seen: string[] = [];
    const api = createApi(async (url, init) => {
      seen.push(`${init?.method} ${url}`);
      return Response.json({});
    });
    await Promise.all([
      api.login('a', 'b'), api.register('n', 'a', 'b'), api.createToken(), api.labs(), api.mine(), api.pending(),
      api.book({ labId: 1, date: 'd', hour: 9, purpose: '' }), api.approve(1), api.reject(1), api.suggest('t', 'd'),
      api.createLab({ name: 'n', building: 'b', capacity: 1, description: '' }), api.assignSupervisor(1, 'e'),
    ]);
    assert.deepEqual(seen.sort(), [
      'GET /api/bookings/mine', 'GET /api/bookings/pending', 'GET /api/labs', 'POST /api/auth/login', 'POST /api/auth/register',
      'POST /api/auth/tokens', 'POST /api/bookings', 'POST /api/bookings/1/approve', 'POST /api/bookings/1/reject',
      'POST /api/labs', 'POST /api/labs/1/supervisors', 'POST /api/suggestions',
    ]);
  });
});

describe('the model feature in the UI', () => {
  test('AC-26 the suggestion panel shows that it is working, and disables the button', () => {
    const panel = renderSuggestionPanel({ kind: 'loading' }).value;
    assert.match(panel, /Моделът мисли…/);
    assert.match(panel, /aria-busy="true"/);
    assert.match(panel, /aria-live="polite"/);
  });

  test('AC-26 it says plainly when the model failed and the fallback answered', () => {
    const fallback = renderSuggestionPanel({
      kind: 'success',
      result: { source: 'fallback', suggestion: { labId: 1, labName: 'Мрежи', date: '2026-11-20', hour: 9, reason: 'Свободна е.' } },
    }).value;
    assert.match(fallback, /Моделът не е достъпен в момента/);
    assert.match(fallback, /data-action="use-suggestion"\s+data-lab="1" data-hour="9"/);

    const model = renderSuggestionPanel({
      kind: 'success',
      result: { source: 'model', suggestion: { labId: 1, labName: 'Мрежи', date: '2026-11-20', hour: 9, reason: 'Тиха е.' } },
    }).value;
    assert.match(model, /Предложение от езиковия модел/);
    assert.match(model, /09:00–10:00/);

    const none = renderSuggestionPanel({ kind: 'success', result: { source: 'model', suggestion: null } }).value;
    assert.match(none, /Няма свободен час/);
    assert.match(renderSuggestionPanel({ kind: 'error', message: 'Опиши с поне 3 знака.' }).value, /role="alert">Опиши/);
    assert.match(renderSuggestionPanel({ kind: 'idle' }).value, /Предложи час/);
  });
});

describe('views', () => {
  test('AC-7 the calendar shows free slots as buttons and taken ones as text labels, not colour alone', () => {
    const out = renderCalendar({ ...stateWith({}), availability: loaded(availability) }).value;
    assert.match(out, /<button type="button" class="chip chip-free" id="slot-1-9"/);
    assert.match(out, /chip-pending">10:00–11:00<span class="chip-note">Чака одобрение/);
    assert.match(out, /chip-past">08:00–09:00<span class="chip-note">Минало/);
    assert.match(out, /1 свободни часа/);
  });

  test('AC-8 selecting a slot opens the booking form; busy and error states show', () => {
    const selected = renderCalendar({ ...stateWith({}), availability: loaded(availability), selected: { labId: 1, hour: 9 } }).value;
    assert.match(selected, /aria-pressed="true"/);
    assert.match(selected, /Резервация: Мрежи, 09:00–10:00/);
    const busy = renderBookingForm(lab, 9, { busy: true, formError: 'Този час вече е зает.', date: '2026-11-20' }).value;
    assert.match(busy, /Изпращаме…/);
    assert.match(busy, /role="alert">Този час вече е зает\./);
  });

  test('AC-12 my bookings offer cancel only for active ones; MCP token is shown once', () => {
    const list = [booking, { ...booking, id: 8, status: 'cancelled' as const, purpose: '' }];
    const out = renderMine({ mine: loaded(list), busy: true, mcpToken: null }).value;
    assert.match(out, /id="cancel-7"/);
    assert.ok(!out.includes('id="cancel-8"'));
    assert.match(out, /disabled>Анулирай/);
    assert.match(out, /data-action="create-token"/);
    assert.match(renderMine({ mine: loaded([]), busy: false, mcpToken: 'tok-123' }).value, /readonly value="tok-123"/);
    assert.match(renderApprovals({ pending: loaded([booking]), busy: true }).value, /data-action="reject" data-id="7" disabled/);
  });

  test('AC-16 the admin screen and the login screen', () => {
    assert.match(renderAdmin({ labs: loaded([lab]), busy: false, formError: 'Капацитетът трябва да е цяло число.' }).value, /role="alert">Капацитетът/);
    const login = page({ session: loaded(null), route: 'login', formError: 'Грешен имейл или парола.' });
    assert.match(login, /role="alert">Грешен имейл или парола\./);
    assert.match(login, /href="\/api\/auth\/google"/);
    assert.match(login, /autocomplete="current-password"/);
    const register = page({ session: loaded(null), route: 'login', loginMode: 'register', busy: true });
    assert.match(register, /autocomplete="new-password"/);
    assert.match(register, /Изчакай…/);
  });

  test('AC-13 navigation follows the role, and a forbidden route falls back', () => {
    assert.deepEqual(allowedRoutes(null), ['login']);
    assert.deepEqual(allowedRoutes(student), ['calendar', 'mine']);
    assert.deepEqual(allowedRoutes(teacher), ['calendar', 'mine', 'approvals']);
    assert.deepEqual(allowedRoutes(admin), ['calendar', 'mine', 'approvals', 'admin']);
    const asStudent = page({ route: 'admin', availability: loaded(availability) });
    assert.match(asStudent, /calendar-title/, 'a student asking for #/admin gets the calendar');
    assert.ok(!asStudent.includes('href="#/admin"'));
    assert.match(page({ route: 'calendar', session: loaded(admin) }), /href="#\/admin"/);
    assert.match(page({ route: 'mine', mine: loaded([]) }), /href="#\/mine" class="nav-link" aria-current="page"/);
    assert.match(page({ session: loaded(null), route: 'calendar' }), /login-title/, 'signed out → login');
    const flash = page({ flash: { kind: 'error', text: 'Неуспешно.' } });
    assert.match(flash, /flash-error" role="alert"/);
    assert.match(page({ flash: { kind: 'success', text: 'Готово.' } }), /flash-success" role="status"/);
  });

  test('AC-24 hash routes parse, with the login error carried along', () => {
    assert.deepEqual(parseHash('#/mine'), { route: 'mine', error: null });
    assert.deepEqual(parseHash(''), { route: 'calendar', error: null });
    assert.deepEqual(parseHash('#/nope'), { route: 'calendar', error: null });
    assert.deepEqual(parseHash('#/login?error=%D0%93%D1%80%D0%B5%D1%88%D0%BA%D0%B0'), { route: 'login', error: 'Грешка' });
  });
});

describe('safety of rendered text', () => {
  test('AC-24 values are escaped, so a lab name cannot inject markup', () => {
    assert.equal(escapeHtml(`<img src=x onerror="alert('x')">&`), '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;');
    const evil = { ...lab, name: '<script>steal()</script>' };
    const out = renderCalendar({ ...stateWith({}), availability: loaded({ ...availability, labs: [{ ...availability.labs[0]!, lab: evil }] }) }).value;
    assert.ok(!out.includes('<script>'));
    assert.equal(html`${null}${undefined}${false}${0}${['a', html`<b>`]}`.toString(), '0a<b>');
  });

  test('AC-24 dates and hours are formatted for people', () => {
    assert.equal(formatSlot(9), '09:00–10:00');
    assert.match(formatDate('2026-11-20'), /20 ноември 2026/);
    assert.equal(todayInSofia(new Date('2026-11-19T22:30:00Z')), '2026-11-20');
  });
});
