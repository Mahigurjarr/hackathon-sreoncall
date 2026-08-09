import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { requireTenantType } from '../middleware/tenantType.middleware';
import { ObservabilityConnection } from '../models/observability-connection.model';
import { RumApplication } from '../models/rum-application.model';

const router = Router();
const INGEST_URL = process.env.INGEST_URL || 'https://ingest.sreoncall.com';
const snippetFrameworkSchema = z.enum(['html', 'nextjs', 'react', 'vite']).default('html');

router.use(requireTenantType('consumer', 'provider', 'standalone'));

const createSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must contain only lowercase letters, numbers, and hyphens'),
  display_name: z.string().trim().min(1).max(120),
});

function serializeApplication(app: any) {
  return {
    id: app._id?.toString() ?? app.id,
    slug: app.slug,
    display_name: app.display_name,
    status: app.status,
    created_at: app.created_at,
    updated_at: app.updated_at,
  };
}

function escapeJsString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function buildHtmlSnippet(ingestUrl: string, appName: string): string {
  const safeUrl = escapeJsString(ingestUrl);
  const safeAppName = escapeJsString(appName);
  return `<script src="https://unpkg.com/@grafana/faro-web-sdk/dist/bundle/faro-web-sdk.iife.js"></script>
<script>
(function initSREonCallFaro() {
  function start() {
    if (!window.GrafanaFaroWebSdk || !window.GrafanaFaroWebSdk.initializeFaro) return false;

    window.GrafanaFaroWebSdk.initializeFaro({
      url: '${safeUrl}',
      app: { name: '${safeAppName}', version: '1.0.0' },
      instrumentations: window.GrafanaFaroWebSdk.getWebInstrumentations
        ? window.GrafanaFaroWebSdk.getWebInstrumentations()
        : undefined,
    });
    return true;
  }

  if (start()) return;

  var tries = 0;
  var timer = setInterval(function () {
    tries += 1;
    if (start() || tries > 50) clearInterval(timer);
  }, 100);
})();
</script>`;
}

function buildNextJsSnippet(ingestUrl: string, appName: string): string {
  const safeUrl = escapeJsString(ingestUrl);
  const safeAppName = escapeJsString(appName);
  return `import Script from 'next/script';

<Script
  src="https://unpkg.com/@grafana/faro-web-sdk/dist/bundle/faro-web-sdk.iife.js"
  strategy="beforeInteractive"
/>
<Script id="sreoncall-faro-init" strategy="afterInteractive">
  {\`
    (() => {
      function start() {
        if (!window.GrafanaFaroWebSdk || !window.GrafanaFaroWebSdk.initializeFaro) return false;

        window.GrafanaFaroWebSdk.initializeFaro({
          url: '${safeUrl}',
          app: { name: '${safeAppName}', version: '1.0.0' },
          instrumentations: window.GrafanaFaroWebSdk.getWebInstrumentations
            ? window.GrafanaFaroWebSdk.getWebInstrumentations()
            : undefined,
        });
        return true;
      }

      if (start()) return;

      let tries = 0;
      const timer = setInterval(() => {
        tries += 1;
        if (start() || tries > 50) clearInterval(timer);
      }, 100);
    })();
  \`}
</Script>`;
}

function buildReactSnippet(ingestUrl: string, appName: string): string {
  const safeUrl = escapeJsString(ingestUrl);
  const safeAppName = escapeJsString(appName);
  return `import { useEffect } from 'react';

export function SREonCallRUM() {
  useEffect(() => {
    const src = 'https://unpkg.com/@grafana/faro-web-sdk/dist/bundle/faro-web-sdk.iife.js';

    function start() {
      if (!window.GrafanaFaroWebSdk || !window.GrafanaFaroWebSdk.initializeFaro) return false;

      window.GrafanaFaroWebSdk.initializeFaro({
        url: '${safeUrl}',
        app: { name: '${safeAppName}', version: '1.0.0' },
        instrumentations: window.GrafanaFaroWebSdk.getWebInstrumentations
          ? window.GrafanaFaroWebSdk.getWebInstrumentations()
          : undefined,
      });
      return true;
    }

    if (start()) return;

    const existing = document.querySelector('script[data-sreoncall-faro="true"]');
    const script = existing || document.createElement('script');

    if (!existing) {
      script.src = src;
      script.async = true;
      script.dataset.sreoncallFaro = 'true';
      document.head.appendChild(script);
    }

    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (start() || tries > 50) window.clearInterval(timer);
    }, 100);

    return () => window.clearInterval(timer);
  }, []);

  return null;
}`;
}

function buildViteSnippet(ingestUrl: string, appName: string): string {
  return `<!-- Add this to index.html -->\n${buildHtmlSnippet(ingestUrl, appName)}`;
}

function buildSnippet(framework: z.infer<typeof snippetFrameworkSchema>, ingestUrl: string, appName: string): string {
  switch (framework) {
    case 'nextjs':
      return buildNextJsSnippet(ingestUrl, appName);
    case 'react':
      return buildReactSnippet(ingestUrl, appName);
    case 'vite':
      return buildViteSnippet(ingestUrl, appName);
    case 'html':
    default:
      return buildHtmlSnippet(ingestUrl, appName);
  }
}

async function ensureManagedRum(req: Request, res: Response): Promise<boolean> {
  const tenantId = String((req as any).tenantId);
  const conn = await ObservabilityConnection.findOne({
    tenant_id: tenantId,
    status: { $in: ['connected', 'pending'] },
  }).sort({ created_at: -1 });

  if (conn?.mode === 'byos') {
    res.status(400).json({
      error: 'RUM application targeting is not supported for BYOS observability connections yet',
    });
    return false;
  }

  return true;
}

router.get('/', rbac('metrics:read'), async (req: Request, res: Response) => {
  const tenantId = String((req as any).tenantId);
  const conn = await ObservabilityConnection.findOne({
    tenant_id: tenantId,
    status: { $in: ['connected', 'pending'] },
  }).sort({ created_at: -1 });

  if (conn?.mode === 'byos') {
    res.json({ data: [] });
    return;
  }

  const apps = await RumApplication.find({ tenant_id: tenantId, status: 'active' }).sort({ created_at: -1 });
  res.json({ data: apps.map(serializeApplication) });
});

router.post('/', rbac('observability-connections:create'), async (req: Request, res: Response) => {
  if (!(await ensureManagedRum(req, res))) return;

  const tenantId = String((req as any).tenantId);
  const body = createSchema.parse(req.body);

  try {
    const app = await RumApplication.create({
      tenant_id: tenantId,
      slug: body.slug,
      display_name: body.display_name,
      status: 'active',
    });
    res.status(201).json({ data: serializeApplication(app) });
  } catch (err: any) {
    if (err?.code === 11000) {
      res.status(409).json({ error: 'An application with this slug already exists for this tenant' });
      return;
    }
    throw err;
  }
});

router.delete('/:id', rbac('observability-connections:update'), async (req: Request, res: Response) => {
  if (!(await ensureManagedRum(req, res))) return;

  const tenantId = String((req as any).tenantId);
  const app = await RumApplication.findOneAndDelete({
    _id: req.params['id'],
    tenant_id: tenantId,
  });

  if (!app) {
    res.status(404).json({ error: 'RUM application not found' });
    return;
  }

  res.status(204).send();
});

router.get('/:id/snippet', rbac('metrics:read'), async (req: Request, res: Response) => {
  if (!(await ensureManagedRum(req, res))) return;

  const tenantId = String((req as any).tenantId);
  const app = await RumApplication.findOne({
    _id: req.params['id'],
    tenant_id: tenantId,
    status: 'active',
  });

  if (!app) {
    res.status(404).json({ error: 'RUM application not found' });
    return;
  }

  const appName = `${tenantId}::${app.slug}`;
  const framework = snippetFrameworkSchema.parse(req.query.framework);
  const ingestUrl = `${INGEST_URL}/v1/faro/`;
  const snippet = buildSnippet(framework, ingestUrl, appName);

  res.json({
    data: {
      id: app._id.toString(),
      slug: app.slug,
      display_name: app.display_name,
      app_name: appName,
      framework,
      ingest_url: ingestUrl,
      snippet,
      limitations: [
        'Origins are not enforced server-side in v1.',
        'Anyone with the snippet can send events using this app name.',
      ],
    },
  });
});

export default router;
