import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const exporter = new OTLPTraceExporter({
  // Override with OTEL_EXPORTER_OTLP_ENDPOINT env var in production.
  // Tempo OTLP HTTP port is 4318; the query port (3200) is different.
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces',
  // Tempo runs in multi-tenant mode — every ingest request needs this header.
  // Must match MANAGED_LGTM_ORG_ID in observability-proxy.routes.ts so the
  // traces UI queries the same org bucket that spans are written into.
  headers: {
    'X-Scope-OrgID': process.env.MANAGED_LGTM_ORG_ID ?? 'sreoncall',
  },
});

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'sreoncall-api',
    [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '0.1.0',
    'deployment.environment': process.env.NODE_ENV ?? 'development',
  }),
  traceExporter: exporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      // fs instrumentation creates a span for every file read — too noisy
      '@opentelemetry/instrumentation-fs': { enabled: false },
      // dns instrumentation rarely adds signal
      '@opentelemetry/instrumentation-dns': { enabled: false },
    }),
  ],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown().catch(() => {});
});
