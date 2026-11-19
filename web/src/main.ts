// The only file that touches the DOM. Everything it shows comes from renderPage(state).
import { ApiError, createApi } from './api.js';
import { todayInSofia } from './format.js';
import { failed, loaded, loading } from './remote.js';
import { initialState, parseHash, type AppState } from './state.js';
import { renderPage } from './views/page.js';

const api = createApi();
const root = document.getElementById('app') as HTMLElement;
let state: AppState = initialState(todayInSofia());

const messageOf = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Нещо се обърка. Опитай отново.';

function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  render();
}

/** Re-renders, keeping what the user typed and where the keyboard focus was. */
function render(): void {
  const focusedId = document.activeElement?.id;
  const values = new Map<string, string>();
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select').forEach((el) => {
    if (el.id && !el.hasAttribute('readonly') && el.type !== 'password') values.set(el.id, el.value);
  });
  root.innerHTML = renderPage(state).value;
  values.forEach((value, id) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el && id !== 'date') el.value = value;
  });
  if (focusedId) document.getElementById(focusedId)?.focus();
}

const focus = (id: string) => document.getElementById(id)?.focus();

async function load<K extends 'availability' | 'mine' | 'pending' | 'labs'>(key: K, fetcher: () => Promise<AppState[K] extends infer R ? (R extends { kind: 'success'; data: infer D } ? D : never) : never>) {
  setState({ [key]: loading() } as Partial<AppState>);
  try {
    setState({ [key]: loaded(await fetcher()) } as Partial<AppState>);
  } catch (error) {
    setState({ [key]: failed(messageOf(error)) } as Partial<AppState>);
  }
}

const loadAvailability = () => load('availability', () => api.availability(state.date));
const loadMine = () => load('mine', async () => (await api.mine()).bookings);
const loadPending = () => load('pending', async () => (await api.pending()).bookings);
const loadLabs = () => load('labs', async () => (await api.labs()).labs);

async function loadSession(): Promise<void> {
  setState({ session: loading() });
  try {
    setState({ session: loaded((await api.me()).user) });
  } catch (error) {
    setState({ session: error instanceof ApiError && error.status === 401 ? loaded(null) : failed(messageOf(error)) });
  }
  onRoute(false);
}

function onRoute(moveFocus = true): void {
  const { route, error } = parseHash(location.hash);
  setState({ route, selected: null, formError: error, flash: null });
  if (state.session.kind !== 'success' || !state.session.data) return;
  if (route === 'calendar') void loadAvailability();
  if (route === 'mine') void loadMine();
  if (route === 'approvals') void loadPending();
  if (route === 'admin') void loadLabs();
  if (moveFocus) focus('main');
}

/** Runs a change, shows the outcome as a sentence, then reloads the list it touched. */
async function runAction(action: () => Promise<unknown>, success: string, reload: () => Promise<void>) {
  setState({ busy: true, flash: null });
  try {
    await action();
    setState({ busy: false, flash: { kind: 'success', text: success } });
  } catch (error) {
    setState({ busy: false, flash: { kind: 'error', text: messageOf(error) } });
  }
  await reload();
}

function selectSlot(labId: number, hour: number): void {
  setState({ selected: { labId, hour }, formError: null });
  focus('purpose');
}

root.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!target) return;
  const id = Number(target.dataset.id);
  switch (target.dataset.action) {
    case 'logout':
      void api.logout().finally(() => {
        state = { ...initialState(todayInSofia()), session: loaded(null) };
        location.hash = '#/login';
        render();
      });
      break;
    case 'dismiss-flash':
      setState({ flash: null });
      break;
    case 'toggle-login':
      setState({ loginMode: state.loginMode === 'login' ? 'register' : 'login', formError: null });
      focus('email');
      break;
    case 'select-slot':
    case 'use-suggestion':
      selectSlot(Number(target.dataset.lab), Number(target.dataset.hour));
      break;
    case 'clear-slot': {
      const previous = state.selected;
      setState({ selected: null, formError: null });
      if (previous) focus(`slot-${previous.labId}-${previous.hour}`);
      break;
    }
    case 'cancel':
      void runAction(() => api.cancel(id), 'Резервацията е анулирана.', loadMine);
      break;
    case 'approve':
      void runAction(() => api.approve(id), 'Резервацията е одобрена.', loadPending);
      break;
    case 'reject':
      void runAction(() => api.reject(id), 'Резервацията е отхвърлена и часът е свободен отново.', loadPending);
      break;
    case 'create-token':
      api.createToken().then(
        ({ token }) => {
          setState({ mcpToken: token });
          focus('mcp-token');
        },
        (error) => setState({ flash: { kind: 'error', text: messageOf(error) } }),
      );
      break;
    case 'reload-availability':
      void loadAvailability();
      break;
    case 'reload-mine':
      void loadMine();
      break;
    case 'reload-pending':
      void loadPending();
      break;
    case 'reload-labs':
      void loadLabs();
      break;
    case 'reload-session':
      void loadSession();
      break;
  }
});

root.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  const data = new FormData(form);
  const get = (key: string) => String(data.get(key) ?? '').trim();

  switch (form.dataset.form) {
    case 'login':
    case 'register': {
      setState({ busy: true, formError: null });
      try {
        const password = String(data.get('password') ?? '');
        const { user } =
          form.dataset.form === 'login'
            ? await api.login(get('email'), password)
            : await api.register(get('name'), get('email'), password);
        setState({ busy: false, session: loaded(user) });
        location.hash = '#/calendar';
      } catch (error) {
        setState({ busy: false, formError: messageOf(error) });
        focus('email');
      }
      break;
    }
    case 'date': {
      const date = get('date');
      if (!date) return;
      setState({ date, selected: null, suggestion: { kind: 'idle' } });
      await loadAvailability();
      break;
    }
    case 'book': {
      if (!state.selected) return;
      setState({ busy: true, formError: null });
      try {
        await api.book({ ...state.selected, date: state.date, purpose: get('purpose') });
        setState({
          busy: false,
          selected: null,
          flash: { kind: 'success', text: 'Заявката е изпратена. Тя чака одобрение от отговорния преподавател.' },
        });
        await loadAvailability();
        focus('dismiss-flash');
      } catch (error) {
        setState({ busy: false, formError: messageOf(error) });
        focus('purpose');
      }
      break;
    }
    case 'suggest': {
      const text = get('text');
      if (text.length < 3) {
        setState({ suggestion: { kind: 'error', message: 'Опиши от какво имаш нужда с поне 3 знака.' } });
        return;
      }
      setState({ suggestion: { kind: 'loading' } });
      try {
        setState({ suggestion: { kind: 'success', result: await api.suggest(text, state.date) } });
      } catch (error) {
        setState({ suggestion: { kind: 'error', message: messageOf(error) } });
      }
      break;
    }
    case 'create-lab':
      await runAction(
        async () => {
          await api.createLab({
            name: get('name'),
            building: get('building'),
            capacity: Number(get('capacity')),
            description: get('description'),
          });
          form.reset();
        },
        'Лабораторията е добавена.',
        loadLabs,
      );
      break;
    case 'assign':
      await runAction(
        () => api.assignSupervisor(Number(get('labId')), get('email')),
        'Преподавателят е назначен за лабораторията.',
        loadLabs,
      );
      break;
  }
});

window.addEventListener('hashchange', () => {
  // "#main" is the skip link; only "#/..." are screens.
  if (location.hash === '' || location.hash.startsWith('#/')) onRoute();
});

void loadSession();
