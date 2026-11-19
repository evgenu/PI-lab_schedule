import type { Repos } from '../repos/types.js';
import { AuthService, type Clock } from './auth.js';
import { BookingService } from './bookings.js';
import { LabService } from './labs.js';

/** The whole service layer, wired once and shared by the HTTP server and the MCP server. */
export interface Services {
  auth: AuthService;
  labs: LabService;
  bookings: BookingService;
}

export function createServices(
  repos: Repos,
  options: { clock?: Clock } = {},
): Services {
  const clock = options.clock ?? (() => new Date());
  return {
    auth: new AuthService(repos.users, repos.sessions, clock),
    labs: new LabService(repos.labs, repos.bookings, repos.users, clock),
    bookings: new BookingService(repos.labs, repos.bookings, clock),
  };
}
