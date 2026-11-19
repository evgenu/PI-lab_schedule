import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

/**
 * The contrast tool: WCAG 2.1 relative luminance and contrast ratio,
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio. Results were cross-checked
 * with the WebAIM Contrast Checker (https://webaim.org/resources/contrastchecker/).
 */
export function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

async function tokens(): Promise<Record<string, string>> {
  const css = await readFile('public/styles/tokens.css', 'utf8');
  return Object.fromEntries([...css.matchAll(/--(color-[a-z-]+):\s*(#[0-9a-f]{3,6})/gi)].map((m) => [m[1]!, m[2]!]));
}

/** Every pair of text on background that the stylesheet actually uses. */
const PAIRS: [text: string, background: string][] = [
  ['color-text', 'color-bg'],
  ['color-text', 'color-surface'],
  ['color-text-muted', 'color-bg'],
  ['color-text-muted', 'color-surface'],
  ['color-primary', 'color-surface'],
  ['color-primary', 'color-bg'],
  ['color-on-primary', 'color-primary'],
  ['color-on-primary', 'color-primary-hover'],
  ['color-on-danger', 'color-danger'],
  ['color-free-text', 'color-free-bg'],
  ['color-pending-text', 'color-pending-bg'],
  ['color-approved-text', 'color-approved-bg'],
  ['color-past-text', 'color-past-bg'],
  ['color-error-text', 'color-error-bg'],
  ['color-success-text', 'color-success-bg'],
  ['color-warning-text', 'color-warning-bg'],
];

describe('design tokens', () => {
  test('AC-25 the contrast formula matches known values', () => {
    assert.equal(contrast('#000000', '#ffffff').toFixed(1), '21.0');
    assert.equal(contrast('#fff', '#fff').toFixed(1), '1.0');
    assert.equal(contrast('#767676', '#ffffff').toFixed(2), '4.54'); // WebAIM's classic AA grey
  });

  test('AC-25 every text/background token pair has at least 4.5:1 contrast', async () => {
    const t = await tokens();
    for (const [text, background] of PAIRS) {
      assert.ok(t[text] && t[background], `missing token ${text} or ${background}`);
      const ratio = contrast(t[text]!, t[background]!);
      assert.ok(ratio >= 4.5, `${text} on ${background} is ${ratio.toFixed(2)}:1`);
    }
  });

  test('AC-25 the focus outline is visible against the page (3:1 for non-text)', async () => {
    const t = await tokens();
    assert.ok(contrast(t['color-focus']!, t['color-bg']!) >= 3);
    assert.ok(contrast(t['color-focus']!, t['color-surface']!) >= 3);
  });

  test('AC-25 app.css takes colour, spacing, type and radius only from tokens', async () => {
    const css = await readFile('public/styles/app.css', 'utf8');
    const checked = css
      .replace(/\/\*[\s\S]*?\*\//g, '') // comments
      .replace(/@media[^{]+/g, '') // breakpoints cannot use custom properties
      .replace(/\.visually-hidden\s*\{[^}]*\}/, ''); // the standard 1px clip pattern
    const raw = checked.match(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\b\d*\.?\d+(px|rem|em)\b/gi);
    assert.equal(raw, null, `raw values in app.css: ${raw?.join(', ')}`);
    assert.match(css, /:focus-visible\s*\{\s*outline: var\(--focus-width\) solid var\(--color-focus\)/);
  });

  test('AC-25 layout has no fixed widths that could force horizontal scrolling at 380px', async () => {
    const css = await readFile('public/styles/app.css', 'utf8');
    assert.match(css, /\.slots\s*\{[^}]*flex-wrap: wrap/, 'hour chips wrap');
    assert.match(css, /overflow-wrap: anywhere/, 'long words break');
    const layout = css.replace(/\.visually-hidden\s*\{[^}]*\}/, '');
    assert.ok(!/(?<![-\w])width:\s*\d+(\.\d+)?(px|rem|em)/.test(layout), 'no fixed widths (percentages and max-width are fine)');
    const html = await readFile('public/index.html', 'utf8');
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.match(html, /<html lang="bg">/);
  });
});
