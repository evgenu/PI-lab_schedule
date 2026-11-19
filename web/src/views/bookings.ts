import { STATUS_LABELS, formatDate, formatSlot } from '../format.js';
import { html, type SafeHtml } from '../html.js';
import { renderRemote } from '../remote.js';
import type { AppState } from '../state.js';
import type { Booking } from '../types.js';

function bookingLine(b: Booking): SafeHtml {
  return html`<p><strong>${b.labName}</strong></p>
    <p>${formatDate(b.date)}, ${formatSlot(b.hour)}</p>
    ${b.purpose ? html`<p class="muted">${b.purpose}</p>` : ''}`;
}

export function renderMine(state: Pick<AppState, 'mine' | 'busy' | 'mcpToken'>): SafeHtml {
  return html`<section aria-labelledby="mine-title" class="stack">
    <h1 id="mine-title">Моите резервации</h1>
    ${renderRemote(state.mine, {
      loadingLabel: 'Зареждаме резервациите ти…',
      retryAction: 'reload-mine',
      isEmpty: (list: Booking[]) => list.length === 0,
      empty: html`<p>Още нямаш резервации.</p><p><a href="#/calendar">Виж свободните лаборатории</a></p>`,
      success: (list: Booking[]) => html`<ul class="booking-list">
        ${list.map(
          (b) => html`<li class="card booking">
            <div>${bookingLine(b)}</div>
            <div class="booking-side">
              <span class="status status-${b.status}">${STATUS_LABELS[b.status]}</span>
              ${b.status === 'pending' || b.status === 'approved'
                ? html`<button type="button" class="button button-secondary" id="cancel-${b.id}" data-action="cancel" data-id="${b.id}"
                    ${state.busy ? 'disabled' : ''}>Анулирай</button>`
                : ''}
            </div>
          </li>`,
        )}
      </ul>`,
    })}
    <section class="card stack" aria-labelledby="mcp-title">
      <h2 id="mcp-title" class="subtitle">Достъп за AI агент (MCP)</h2>
      <p class="muted">Токенът дава на агента точно твоите права. Пази го като парола.</p>
      ${state.mcpToken
        ? html`<label class="field"><span>Токен (показва се само веднъж)</span>
            <input id="mcp-token" readonly value="${state.mcpToken}"></label>`
        : html`<button type="button" class="button button-secondary" id="create-token" data-action="create-token">Създай токен</button>`}
    </section>
  </section>`;
}

export function renderApprovals(state: Pick<AppState, 'pending' | 'busy'>): SafeHtml {
  return html`<section aria-labelledby="approvals-title" class="stack">
    <h1 id="approvals-title">Резервации за одобрение</h1>
    ${renderRemote(state.pending, {
      loadingLabel: 'Зареждаме чакащите резервации…',
      retryAction: 'reload-pending',
      isEmpty: (list: Booking[]) => list.length === 0,
      empty: html`<p>Няма резервации, които чакат решение.</p>`,
      success: (list: Booking[]) => html`<ul class="booking-list">
        ${list.map(
          (b) => html`<li class="card booking">
            <div>${bookingLine(b)}</div>
            <div class="booking-side actions">
              <button type="button" class="button button-primary" id="approve-${b.id}" data-action="approve" data-id="${b.id}" ${state.busy ? 'disabled' : ''}>Одобри</button>
              <button type="button" class="button button-danger" id="reject-${b.id}" data-action="reject" data-id="${b.id}" ${state.busy ? 'disabled' : ''}>Откажи</button>
            </div>
          </li>`,
        )}
      </ul>`,
    })}
  </section>`;
}
