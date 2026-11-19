import type { ModelClient } from '../model/client.js';
import type { Repos } from '../repos/types.js';
import { AuthService, type Clock } from './auth.js';
import { BookingService } from './bookings.js';
import { LabService } from './labs.js';
import { SuggestionService } from './suggestions.js';

/** The whole service layer, wired once and shared by the HTTP server and the MCP server. */
export interface Services {
  auth: AuthService;
  labs: LabService;
  bookings: BookingService;
  suggestions: SuggestionService;
}

export function createServices(
  repos: Repos,
  options: { model?: ModelClient | null; modelTimeoutMs?: number; clock?: Clock; log?: (m: string) => void } = {},
): Services {
  const clock = options.clock ?? (() => new Date());
  const labs = new LabService(repos.labs, repos.bookings, repos.users, clock);
  return {
    auth: new AuthService(repos.users, repos.sessions, clock),
    labs,
    bookings: new BookingService(repos.labs, repos.bookings, clock),
    suggestions: new SuggestionService(labs, options.model ?? null, options.modelTimeoutMs ?? 8_000, options.log),
  };
}
