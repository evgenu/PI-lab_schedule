import type { Availability, Booking, Lab, SuggestionResult, User } from './types.js';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Turns any failed response into a sentence a person can read. Never shows raw JSON. */
export function readableError(data: unknown, status: number): string {
  const message = (data as { error?: unknown } | null)?.error;
  if (typeof message === 'string' && message.trim()) return message;
  if (status === 401) return 'Влез в профила си, за да продължиш.';
  if (status === 403) return 'Нямаш права за това действие.';
  if (status === 404) return 'Не намерихме това, което търсиш.';
  if (status === 429) return 'Твърде много заявки. Изчакай малко и опитай пак.';
  if (status >= 500) return 'Сървърът не отговаря в момента. Опитай отново след малко.';
  return 'Нещо се обърка. Опитай отново.';
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createApi(fetchImpl: FetchLike = (input, init) => fetch(input, init)) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(path, {
        method,
        credentials: 'same-origin',
        headers:
          method === 'GET'
            ? { accept: 'application/json' }
            : { accept: 'application/json', 'content-type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      });
    } catch {
      throw new ApiError('Няма връзка със сървъра. Провери интернета и опитай пак.', 0);
    }
    if (response.status === 204) return undefined as T;
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      // An empty or non-JSON body still gets a readable message below.
    }
    if (!response.ok) throw new ApiError(readableError(data, response.status), response.status);
    return data as T;
  }

  return {
    me: () => request<{ user: User }>('GET', '/api/auth/me'),
    login: (email: string, password: string) => request<{ user: User }>('POST', '/api/auth/login', { email, password }),
    register: (name: string, email: string, password: string) =>
      request<{ user: User }>('POST', '/api/auth/register', { name, email, password }),
    logout: () => request<void>('POST', '/api/auth/logout'),
    createToken: () => request<{ token: string }>('POST', '/api/auth/tokens'),
    labs: () => request<{ labs: Lab[] }>('GET', '/api/labs'),
    availability: (date: string) => request<Availability>('GET', `/api/availability?date=${encodeURIComponent(date)}`),
    mine: () => request<{ bookings: Booking[] }>('GET', '/api/bookings/mine'),
    pending: () => request<{ bookings: Booking[] }>('GET', '/api/bookings/pending'),
    book: (input: { labId: number; date: string; hour: number; purpose: string }) =>
      request<{ booking: Booking }>('POST', '/api/bookings', input),
    cancel: (id: number) => request<{ booking: Booking }>('POST', `/api/bookings/${id}/cancel`),
    approve: (id: number) => request<{ booking: Booking }>('POST', `/api/bookings/${id}/approve`),
    reject: (id: number) => request<{ booking: Booking }>('POST', `/api/bookings/${id}/reject`),
    suggest: (text: string, date: string) => request<SuggestionResult>('POST', '/api/suggestions', { text, date }),
    createLab: (input: { name: string; building: string; capacity: number; description: string }) =>
      request<{ lab: Lab }>('POST', '/api/labs', input),
    assignSupervisor: (labId: number, email: string) =>
      request<void>('POST', `/api/labs/${labId}/supervisors`, { email }),
  };
}

export type Api = ReturnType<typeof createApi>;
