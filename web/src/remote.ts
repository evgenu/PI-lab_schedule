import { html, type SafeHtml } from './html.js';

/** Data that comes from the server is always in exactly one of these states. */
export type Remote<T> =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'success'; data: T };

export const loading = <T>(): Remote<T> => ({ kind: 'loading' });
export const failed = <T>(message: string): Remote<T> => ({ kind: 'error', message });
export const loaded = <T>(data: T): Remote<T> => ({ kind: 'success', data });

export interface StateViews<T> {
  loadingLabel: string;
  isEmpty: (data: T) => boolean;
  empty: SafeHtml;
  success: (data: T) => SafeHtml;
  /** data-action of the retry button in the error state. */
  retryAction: string;
}

/**
 * The four states every screen has: loading, error, empty and success.
 * Screens render through this, so none of them can forget one.
 */
export function renderRemote<T>(remote: Remote<T>, views: StateViews<T>): SafeHtml {
  switch (remote.kind) {
    case 'loading':
      return html`<p class="state state-loading" role="status"><span class="spinner" aria-hidden="true"></span>${views.loadingLabel}</p>`;
    case 'error':
      return html`<div class="state state-error" role="alert">
        <p>${remote.message}</p>
        <button type="button" class="button button-secondary" id="retry-${views.retryAction}" data-action="${views.retryAction}">Опитай пак</button>
      </div>`;
    case 'success':
      return views.isEmpty(remote.data)
        ? html`<div class="state state-empty">${views.empty}</div>`
        : views.success(remote.data);
  }
}
