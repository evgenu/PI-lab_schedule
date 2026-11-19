import { ROLE_LABELS } from '../format.js';
import { html, type SafeHtml } from '../html.js';
import { allowedRoutes, type AppState, type Route } from '../state.js';
import type { User } from '../types.js';

const NAV_LABELS: Record<Route, string> = {
  calendar: 'Календар',
  mine: 'Моите резервации',
  approvals: 'За одобрение',
  admin: 'Администрация',
  login: 'Вход',
};

export function renderHeader(user: User | null, route: Route): SafeHtml {
  const links = user ? allowedRoutes(user) : [];
  return html`<header class="header">
    <div class="header-inner">
      <a class="brand" href="#/calendar">Лаборатории ТУ</a>
      ${user
        ? html`<nav aria-label="Основна навигация">
            <ul class="nav">
              ${links.map(
                (r) => html`<li><a href="#/${r}" class="nav-link" ${r === route ? html`aria-current="page"` : ''}>${NAV_LABELS[r]}</a></li>`,
              )}
            </ul>
          </nav>
          <div class="user">
            <span class="user-name">${user.name} <span class="muted">(${ROLE_LABELS[user.role]})</span></span>
            <button type="button" class="button button-secondary" id="logout" data-action="logout">Изход</button>
          </div>`
        : ''}
    </div>
  </header>`;
}

export function renderFlash(flash: AppState['flash']): SafeHtml {
  if (!flash) return html``;
  return html`<div class="flash flash-${flash.kind}" role="${flash.kind === 'error' ? 'alert' : 'status'}">
    <p>${flash.text}</p>
    <button type="button" class="button button-ghost" id="dismiss-flash" data-action="dismiss-flash" aria-label="Затвори съобщението">×</button>
  </div>`;
}
