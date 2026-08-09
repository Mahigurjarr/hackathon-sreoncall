import http from 'http';
import https from 'https';
import { MonitoringIntegration, IMonitoringIntegration, IntegrationType } from '../models/monitoring-integration.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { logger } from '../utils/logger';
import { assertUrlSafe, SsrfError } from '../utils/ssrf-guard';

export interface CreateIntegrationInput {
  name: string;
  type: IntegrationType;
  endpoint_url: string;
  api_key?: string;
  extra_headers?: Record<string, string>;
}

export async function listIntegrations(tenantId: string) {
  const docs = await MonitoringIntegration.find({ tenant_id: tenantId }).sort({ name: 1 }).lean();
  return docs;
}

export async function getIntegrationById(tenantId: string, id: string) {
  const doc = await MonitoringIntegration.findOne({ _id: id, tenant_id: tenantId }).lean();
  if (!doc) throw AppError.notFound('Monitoring integration not found');
  return doc;
}

export async function createIntegration(tenantId: string, userId: string, input: CreateIntegrationInput) {
  const doc = await MonitoringIntegration.create({
    tenant_id: tenantId,
    created_by: userId,
    name: input.name,
    type: input.type,
    endpoint_url: input.endpoint_url,
    api_key: input.api_key ?? '',
    extra_headers: input.extra_headers ?? {},
  });
  return doc.toObject();
}

export async function updateIntegration(tenantId: string, id: string, input: Partial<CreateIntegrationInput>) {
  const doc = await MonitoringIntegration.findOneAndUpdate(
    { _id: id, tenant_id: tenantId },
    { $set: input },
    { new: true, lean: true },
  );
  if (!doc) throw AppError.notFound('Monitoring integration not found');
  return doc;
}

export async function deleteIntegration(tenantId: string, id: string) {
  const doc = await MonitoringIntegration.findOneAndDelete({ _id: id, tenant_id: tenantId });
  if (!doc) throw AppError.notFound('Monitoring integration not found');
}

// ─── Test connection ───────────────────────────────────────────────────────────

async function makeRequest(url: string, headers: Record<string, string>): Promise<{ ok: boolean; status: number; body: string }> {
  // SSRF protection: block requests to private/internal addresses
  try {
    await assertUrlSafe(url);
  } catch (err) {
    if (err instanceof SsrfError) {
      return { ok: false, status: 0, body: err.message };
    }
    return { ok: false, status: 0, body: (err as Error).message };
  }

  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers,
        timeout: 10000,
      };
      const req = lib.request(options, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ ok: (res.statusCode ?? 0) < 400, status: res.statusCode ?? 0, body }));
      });
      req.on('error', (e) => resolve({ ok: false, status: 0, body: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, body: 'Timeout' }); });
      req.end();
    } catch (e: any) {
      resolve({ ok: false, status: 0, body: e.message });
    }
  });
}

export async function testConnection(tenantId: string, id: string): Promise<{ success: boolean; message: string; latency_ms: number }> {
  const integration = await getIntegrationById(tenantId, id);
  const start = Date.now();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  // Build test URL based on integration type
  let testUrl = integration.endpoint_url;
  if (integration.api_key) {
    switch (integration.type) {
      case 'prometheus':
      case 'mimir':
        testUrl = `${integration.endpoint_url.replace(/\/$/, '')}/api/v1/query?query=up`;
        headers['Authorization'] = integration.api_key.startsWith('Bearer ')
          ? integration.api_key
          : `Bearer ${integration.api_key}`;
        break;
      case 'datadog':
        testUrl = `${integration.endpoint_url.replace(/\/$/, '')}/api/v1/validate`;
        headers['DD-API-KEY'] = integration.api_key;
        break;
      case 'newrelic':
        testUrl = `${integration.endpoint_url.replace(/\/$/, '')}/v2/applications.json`;
        headers['X-Api-Key'] = integration.api_key;
        break;
      case 'loki':
        testUrl = `${integration.endpoint_url.replace(/\/$/, '')}/ready`;
        if (integration.api_key) headers['Authorization'] = `Bearer ${integration.api_key}`;
        break;
      default:
        if (integration.api_key) headers['Authorization'] = `Bearer ${integration.api_key}`;
    }
  } else {
    // No API key - just hit health/ready endpoint
    switch (integration.type) {
      case 'prometheus':
      case 'mimir':
        testUrl = `${integration.endpoint_url.replace(/\/$/, '')}/-/ready`;
        break;
      case 'loki':
        testUrl = `${integration.endpoint_url.replace(/\/$/, '')}/ready`;
        break;
      default:
        testUrl = integration.endpoint_url;
    }
  }

  // Add extra headers
  Object.assign(headers, integration.extra_headers);

  const result = await makeRequest(testUrl, headers);
  const latency = Date.now() - start;
  const success = result.ok;

  await MonitoringIntegration.updateOne(
    { _id: id },
    {
      $set: {
        status: success ? 'connected' : 'error',
        last_tested_at: new Date(),
        error_message: success ? null : `HTTP ${result.status}: ${result.body.slice(0, 200)}`,
      },
    },
  );

  return {
    success,
    message: success ? `Connected (HTTP ${result.status})` : `Failed: HTTP ${result.status} — ${result.body.slice(0, 200)}`,
    latency_ms: latency,
  };
}

// ─── Proxy query ───────────────────────────────────────────────────────────────

export async function proxyQuery(
  tenantId: string,
  integrationId: string,
  queryPath: string,
  queryParams: Record<string, string>,
): Promise<{ data: any; status: number }> {
  const integration = await getIntegrationById(tenantId, integrationId);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (integration.api_key) {
    switch (integration.type) {
      case 'datadog':
        headers['DD-API-KEY'] = integration.api_key; break;
      case 'newrelic':
        headers['X-Api-Key'] = integration.api_key; break;
      default:
        headers['Authorization'] = integration.api_key.startsWith('Bearer ')
          ? integration.api_key
          : `Bearer ${integration.api_key}`;
    }
  }
  Object.assign(headers, integration.extra_headers);

  const qs = new URLSearchParams(queryParams).toString();
  const url = `${integration.endpoint_url.replace(/\/$/, '')}${queryPath}${qs ? '?' + qs : ''}`;

  const result = await makeRequest(url, headers);
  try {
    return { data: JSON.parse(result.body), status: result.status };
  } catch {
    return { data: result.body, status: result.status };
  }
}
