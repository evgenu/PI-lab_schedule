import { html, type SafeHtml } from '../html.js';
import { allowedRoutes, type AppState } from '../state.js';
import { renderAdmin } from './admin.js';
import { renderApprovals, renderMine } from './bookings.js';
import { renderCalendar } from './calendar.js';
import { renderFlash, renderHeader } from './layout.js';
import { renderLogin } from './login.js';

/** The whole page as a pure function of the state. main.ts puts it on the screen. */
export function renderPage(state: AppState): SafeHtml {
  if (state.session.kind === 'loading') {
    return html`<main id="main" class="container"><p class="state state-loading" role="status"><span class="spinner" aria-hidden="true"></span>Зареждаме…</p></main>`;
  }
  if (state.session.kind === 'error') {
    return html`<main id="main" class="container"><div class="state state-error" role="alert">
      <p>${state.session.message}</p>
      <button type="button" class="button button-secondary" id="retry-session" data-action="reload-session">Опитай пак</button>
    </div></main>`;
  }
  const user = state.session.data;
  const route = allowedRoutes(user).includes(state.route) ? state.route : allowedRoutes(user)[0]!;
  const content = {
    login: () => renderLogin(state),
    calendar: () => renderCalendar(state),
    mine: () => renderMine(state),
    approvals: () => renderApprovals(state),
    admin: () => renderAdmin(state),
  }[route]();
  return html`<a class="skip-link" href="#main">Към съдържанието</a>
    ${renderHeader(user, route)}
    <main id="main" class="container" tabindex="-1">
      ${renderFlash(state.flash)}
      ${content}
    </main>`;
}
