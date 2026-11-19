import { loading, type Remote } from './remote.js';
import type { Availability, Booking, Lab, SuggestionResult, User } from './types.js';

export type Route = 'calendar' | 'mine' | 'approvals' | 'admin' | 'login';

export type SuggestionState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'success'; result: SuggestionResult };

export interface AppState {
  /** null while we do not know yet whether the visitor is signed in. */
  session: Remote<User | null>;
  route: Route;
  date: string;
  availability: Remote<Availability>;
  selected: { labId: number; hour: number } | null;
  busy: boolean;
  formError: string | null;
  flash: { kind: 'success' | 'error'; text: string } | null;
  suggestion: SuggestionState;
  mine: Remote<Booking[]>;
  pending: Remote<Booking[]>;
  labs: Remote<Lab[]>;
  mcpToken: string | null;
  loginMode: 'login' | 'register';
}

export function initialState(date: string): AppState {
  return {
    session: loading(),
    route: 'calendar',
    date,
    availability: loading(),
    selected: null,
    busy: false,
    formError: null,
    flash: null,
    suggestion: { kind: 'idle' },
    mine: loading(),
    pending: loading(),
    labs: loading(),
    mcpToken: null,
    loginMode: 'login',
  };
}

const ROUTES: Route[] = ['calendar', 'mine', 'approvals', 'admin', 'login'];

/** "#/mine" → "mine"; anything unknown → the calendar. A login error travels as ?error=. */
export function parseHash(hash: string): { route: Route; error: string | null } {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const route = (ROUTES as string[]).includes(path) ? (path as Route) : 'calendar';
  return { route, error: new URLSearchParams(query).get('error') };
}

/** Which screens a role may open. The server checks again; this only hides links. */
export function allowedRoutes(user: User | null): Route[] {
  if (!user) return ['login'];
  const routes: Route[] = ['calendar', 'mine'];
  if (user.role === 'teacher' || user.role === 'admin') routes.push('approvals');
  if (user.role === 'admin') routes.push('admin');
  return routes;
}
