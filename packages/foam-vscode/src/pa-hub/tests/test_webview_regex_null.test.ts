import { expect, it, vi } from 'vitest';
import { fillGraphHtml } from '../webview-security';

const INNER_PATTERN = '^data-replace (src|href)="([^"]+)"$';

it('test_webview_regex_null', () => {
  const originalExec = RegExp.prototype.exec;
  vi.spyOn(RegExp.prototype, 'exec').mockImplementation(function (
    this: RegExp,
    input: string
  ) {
    if (this.source === INNER_PATTERN) {
      return null;
    }

    return originalExec.call(this, input);
  });

  const template = '<script data-replace src="./main.js"></script>';

  expect(
    fillGraphHtml(template, {
      csp: 'CSP_VALUE',
      nonce: 'NONCE',
      resolveAsset: () => {
        throw new Error('resolveAsset should not be called');
      },
    })
  ).toBe(template);

  vi.restoreAllMocks();
});
