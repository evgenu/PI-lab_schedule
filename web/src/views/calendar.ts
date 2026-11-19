import { SLOT_LABELS, formatDate, formatSlot } from '../format.js';
import { html, type SafeHtml } from '../html.js';
import { renderRemote } from '../remote.js';
import type { AppState, SuggestionState } from '../state.js';
import type { Availability, Lab } from '../types.js';

type CalendarState = Pick<AppState, 'date' | 'availability' | 'selected' | 'busy' | 'formError' | 'suggestion'>;

export function renderCalendar(state: CalendarState): SafeHtml {
  return html`<section aria-labelledby="calendar-title" class="stack">
    <div class="toolbar">
      <h1 id="calendar-title">Свободни лаборатории</h1>
      <form data-form="date" class="inline-form">
        <label class="field field-inline"><span>Дата</span>
          <input type="date" id="date" name="date" value="${state.date}" required></label>
        <button type="submit" class="button button-secondary" id="date-submit">Покажи</button>
      </form>
    </div>
    ${renderSuggestionPanel(state.suggestion)}
    <h2 class="subtitle">${formatDate(state.date)}</h2>
    ${renderRemote(state.availability, {
      loadingLabel: 'Зареждаме календара…',
      retryAction: 'reload-availability',
      isEmpty: (a: Availability) => a.labs.length === 0,
      empty: html`<p>Все още няма добавени лаборатории.</p>`,
      success: (a: Availability) => html`<ul class="lab-list">${a.labs.map((day) => renderLabDay(day, state))}</ul>`,
    })}
    <p class="legend muted">
      <span class="chip chip-free">Свободно</span>
      <span class="chip chip-pending">Чака одобрение</span>
      <span class="chip chip-approved">Заето</span>
    </p>
  </section>`;
}

function renderLabDay(day: Availability['labs'][number], state: CalendarState): SafeHtml {
  const { lab, slots } = day;
  const selectedHour = state.selected?.labId === lab.id ? state.selected.hour : null;
  const freeCount = slots.filter((s) => s.state === 'free').length;
  return html`<li class="card lab">
    <div class="lab-head">
      <h3>${lab.name}</h3>
      <p class="muted">${lab.building} · ${lab.capacity} места · ${freeCount} свободни часа</p>
      ${lab.description ? html`<p>${lab.description}</p>` : ''}
    </div>
    <ul class="slots" aria-label="Часове в ${lab.name}">
      ${slots.map((slot) =>
        slot.state === 'free'
          ? html`<li><button type="button" class="chip chip-free" id="slot-${lab.id}-${slot.hour}"
                data-action="select-slot" data-lab="${lab.id}" data-hour="${slot.hour}"
                aria-pressed="${selectedHour === slot.hour}">
                ${formatSlot(slot.hour)}<span class="visually-hidden">, свободно</span></button></li>`
          : html`<li><span class="chip chip-${slot.state}">${formatSlot(slot.hour)}<span class="chip-note">${SLOT_LABELS[slot.state]}</span></span></li>`,
      )}
    </ul>
    ${selectedHour !== null ? renderBookingForm(lab, selectedHour, state) : ''}
  </li>`;
}

export function renderBookingForm(lab: Lab, hour: number, state: Pick<CalendarState, 'busy' | 'formError' | 'date'>): SafeHtml {
  return html`<form data-form="book" class="booking-form stack" aria-labelledby="book-title">
    <h4 id="book-title">Резервация: ${lab.name}, ${formatSlot(hour)}</h4>
    ${state.formError ? html`<p class="form-error" role="alert">${state.formError}</p>` : ''}
    <label class="field"><span>За какво ти е? (по желание)</span>
      <input id="purpose" name="purpose" maxlength="200" autocomplete="off"></label>
    <div class="actions">
      <button type="submit" class="button button-primary" id="book-submit" ${state.busy ? html`disabled aria-busy="true"` : ''}>
        ${state.busy ? 'Изпращаме…' : 'Изпрати за одобрение'}
      </button>
      <button type="button" class="button button-secondary" id="book-cancel" data-action="clear-slot">Откажи</button>
    </div>
  </form>`;
}

/** The model feature: it says when it is thinking, and says plainly when it failed. */
export function renderSuggestionPanel(suggestion: SuggestionState): SafeHtml {
  const thinking = suggestion.kind === 'loading';
  return html`<section class="card suggestion" aria-labelledby="suggest-title">
    <h2 id="suggest-title" class="subtitle">Опиши от какво имаш нужда</h2>
    <form data-form="suggest" class="stack">
      <label class="field"><span>Например: „тиха зала за 3 души в четвъртък следобед“</span>
        <textarea id="suggest-text" name="text" rows="2" maxlength="300" required></textarea></label>
      <button type="submit" class="button button-primary" id="suggest-submit" ${thinking ? html`disabled aria-busy="true"` : ''}>
        ${thinking ? 'Търсим…' : 'Предложи час'}
      </button>
    </form>
    <div class="suggestion-result" aria-live="polite">${renderSuggestionResult(suggestion)}</div>
  </section>`;
}

function renderSuggestionResult(suggestion: SuggestionState): SafeHtml {
  switch (suggestion.kind) {
    case 'idle':
      return html``;
    case 'loading':
      return html`<p class="state state-loading" role="status"><span class="spinner" aria-hidden="true"></span>Моделът мисли… Първата заявка може да отнеме до минута.</p>`;
    case 'error':
      return html`<p class="state state-error" role="alert">${suggestion.message}</p>`;
    case 'success': {
      const { source, suggestion: pick } = suggestion.result;
      const note =
        source === 'model'
          ? html`<p class="badge">Предложение от езиковия модел</p>`
          : html`<p class="badge badge-warning">Моделът не е достъпен в момента, затова предложението е по прости правила.</p>`;
      if (!pick) {
        return html`<div class="state state-empty">${note}<p>Няма свободен час за този ден. Опитай с друга дата.</p></div>`;
      }
      return html`<div class="state state-success">
        ${note}
        <p><strong>${pick.labName}</strong>, ${formatDate(pick.date)}, ${formatSlot(pick.hour)}</p>
        <p class="muted">${pick.reason}</p>
        <button type="button" class="button button-primary" id="use-suggestion" data-action="use-suggestion"
          data-lab="${pick.labId}" data-hour="${pick.hour}">Избери този час</button>
      </div>`;
    }
  }
}
