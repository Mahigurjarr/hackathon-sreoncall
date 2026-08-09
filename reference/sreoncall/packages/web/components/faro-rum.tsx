'use client';

import Script from 'next/script';

const FARO_SDK_SRC =
  'https://unpkg.com/@grafana/faro-web-sdk/dist/bundle/faro-web-sdk.iife.js';

const FARO_APP_NAME = process.env.NEXT_PUBLIC_FARO_APP_NAME || 'sreoncall-web';
const FARO_APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.1.0';
const FARO_URL_OVERRIDE = process.env.NEXT_PUBLIC_FARO_URL || '';
const FARO_DISABLED = process.env.NEXT_PUBLIC_DISABLE_RUM === 'true';

const faroBootstrap = `
(() => {
  if (${JSON.stringify(FARO_DISABLED)}) return;
  if (window.__sreoncallFaroInitialized) return;

  const hostname = window.location.hostname;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  let faroUrl = ${JSON.stringify(FARO_URL_OVERRIDE)};

  if (!faroUrl) {
    if (hostname.startsWith('dev-web.')) {
      faroUrl = window.location.origin.replace('dev-web.', 'dev-ingest.') + '/v1/faro/';
    } else if (!isLocal && hostname.endsWith('.sreoncall.com')) {
      faroUrl = 'https://ingest.sreoncall.com/v1/faro/';
    }
  }

  if (!faroUrl || !window.GrafanaFaroWebSdk?.initializeFaro) return;

  const instrumentations =
    typeof window.GrafanaFaroWebSdk.getWebInstrumentations === 'function'
      ? window.GrafanaFaroWebSdk.getWebInstrumentations()
      : undefined;

  window.GrafanaFaroWebSdk.initializeFaro({
    url: faroUrl,
    app: {
      name: ${JSON.stringify(FARO_APP_NAME)},
      version: ${JSON.stringify(FARO_APP_VERSION)},
      environment: hostname.startsWith('dev-web.') || isLocal ? 'development' : 'production',
    },
    instrumentations,
  });

  window.__sreoncallFaroInitialized = true;
})();
`;

export function FaroRum() {
  if (FARO_DISABLED) return null;

  return (
    <>
      <Script src={FARO_SDK_SRC} strategy="beforeInteractive" />
      <Script id="sreoncall-faro-init" strategy="beforeInteractive">
        {faroBootstrap}
      </Script>
    </>
  );
}
