import { html, type SafeHtml } from '../html.js';
import { renderRemote } from '../remote.js';
import type { AppState } from '../state.js';
import type { Lab } from '../types.js';

export function renderAdmin(state: Pick<AppState, 'labs' | 'busy' | 'formError'>): SafeHtml {
  return html`<section aria-labelledby="admin-title" class="stack">
    <h1 id="admin-title">Администрация</h1>
    ${state.formError ? html`<p class="form-error" role="alert">${state.formError}</p>` : ''}
    <div class="grid-2">
      <form data-form="create-lab" class="card stack" aria-labelledby="new-lab-title">
        <h2 id="new-lab-title" class="subtitle">Нова лаборатория</h2>
        <label class="field"><span>Име</span><input id="lab-name" name="name" required maxlength="80"></label>
        <label class="field"><span>Сграда</span><input id="lab-building" name="building" required maxlength="80"></label>
        <label class="field"><span>Места</span><input id="lab-capacity" name="capacity" type="number" min="1" max="500" required></label>
        <label class="field"><span>Описание</span><textarea id="lab-description" name="description" rows="2" maxlength="300"></textarea></label>
        <button type="submit" class="button button-primary" id="create-lab-submit" ${state.busy ? 'disabled' : ''}>Добави</button>
      </form>
      <form data-form="assign" class="card stack" aria-labelledby="assign-title">
        <h2 id="assign-title" class="subtitle">Отговорен преподавател</h2>
        ${renderRemote(state.labs, {
          loadingLabel: 'Зареждаме лабораториите…',
          retryAction: 'reload-labs',
          isEmpty: (labs: Lab[]) => labs.length === 0,
          empty: html`<p>Първо добави лаборатория.</p>`,
          success: (labs: Lab[]) => html`<label class="field"><span>Лаборатория</span>
            <select id="assign-lab" name="labId" required>
              ${labs.map((lab) => html`<option value="${lab.id}">${lab.name}</option>`)}
            </select></label>`,
        })}
        <label class="field"><span>Имейл на преподавателя</span><input id="assign-email" name="email" type="email" required></label>
        <button type="submit" class="button button-primary" id="assign-submit" ${state.busy ? 'disabled' : ''}>Назначи</button>
      </form>
    </div>
  </section>`;
}
