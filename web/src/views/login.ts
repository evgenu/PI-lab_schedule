import { html, type SafeHtml } from '../html.js';
import type { AppState } from '../state.js';

export function renderLogin(state: Pick<AppState, 'loginMode' | 'busy' | 'formError'>): SafeHtml {
  const register = state.loginMode === 'register';
  return html`<section class="card narrow" aria-labelledby="login-title">
    <h1 id="login-title">${register ? 'Регистрация' : 'Вход'}</h1>
    <p class="muted">Резервирай лаборатория за час. Преподавателят одобрява заявката.</p>
    ${state.formError ? html`<p class="form-error" role="alert">${state.formError}</p>` : ''}
    <form data-form="${register ? 'register' : 'login'}" class="stack" novalidate>
      ${register
        ? html`<label class="field"><span>Име</span>
            <input id="name" name="name" autocomplete="name" required maxlength="100"></label>`
        : ''}
      <label class="field"><span>Имейл</span>
        <input id="email" name="email" type="email" autocomplete="email" required></label>
      <label class="field"><span>Парола${register ? ' (поне 8 знака)' : ''}</span>
        <input id="password" name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" required minlength="8"></label>
      <button type="submit" class="button button-primary" id="login-submit" ${state.busy ? html`disabled aria-busy="true"` : ''}>
        ${state.busy ? 'Изчакай…' : register ? 'Създай профил' : 'Влез'}
      </button>
    </form>
    <div class="divider"><span>или</span></div>
    <a class="button button-secondary full" href="/api/auth/google" id="google-login">Влез с Google</a>
    <p class="switch">
      ${register ? 'Имаш профил?' : 'Нямаш профил?'}
      <button type="button" class="link-button" id="toggle-login" data-action="toggle-login">
        ${register ? 'Влез' : 'Регистрирай се'}
      </button>
    </p>
  </section>`;
}
