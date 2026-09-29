import { randomBytes } from 'node:crypto';

export function generateNonce(): string {
  return randomBytes(32).toString('hex');
}

export function buildCsp(params: { cspSource: string; nonce: string }): string {
  return `default-src 'none'; script-src 'nonce-${params.nonce}'; style-src ${params.cspSource} 'unsafe-inline'; img-src ${params.cspSource}; font-src ${params.cspSource}`;
}

export function fillGraphHtml(
  template: string,
  params: {
    csp: string;
    nonce: string;
    resolveAsset: (filename: string) => string;
  }
): string {
  const withSecurity = template
    .replace('__PA_HUB_CSP__', params.csp)
    .replace(/__PA_HUB_NONCE__/g, params.nonce);

  return withSecurity.replace(
    /data-replace (src|href)="[^"]+"/g,
    match => {
      const [, attribute, filename] =
        /^data-replace (src|href)="([^"]+)"$/.exec(match)!;
      return `${attribute}="${params.resolveAsset(filename)}"`;
    }
  );
}
