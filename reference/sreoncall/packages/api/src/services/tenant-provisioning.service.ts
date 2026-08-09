import {
  Route53Client,
  ChangeResourceRecordSetsCommand,
  GetChangeCommand,
  ChangeAction,
} from '@aws-sdk/client-route-53';
import { StringCodec } from 'nats';
import { getConfig } from '../config/index';
import { getJetStream } from '../config/nats';
import { logger } from '../utils/logger';

const sc = StringCodec();

export interface TenantProvisioningPayload {
  tenant_id: string;
  slug: string;
  action: 'create' | 'delete';
  timestamp: string;
}

export async function publishTenantProvisioningEvent(
  payload: TenantProvisioningPayload,
): Promise<void> {
  try {
    const js = getJetStream();
    await js.publish(`tenants.${payload.action}d`, sc.encode(JSON.stringify(payload)));
    logger.info('Published tenant provisioning event', {
      slug: payload.slug,
      action: payload.action,
    });
  } catch (err: any) {
    logger.error('Failed to publish tenant provisioning event', {
      slug: payload.slug,
      action: payload.action,
      error: err.message,
    });
  }
}

// ─── Route53 DNS ──────────────────────────────────────────────────────────────

function getRoute53Client(): Route53Client {
  const cfg = getConfig();
  return new Route53Client({
    region: cfg.AWS_REGION,
    credentials:
      cfg.AWS_ACCESS_KEY_ID && cfg.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: cfg.AWS_ACCESS_KEY_ID,
            secretAccessKey: cfg.AWS_SECRET_ACCESS_KEY,
          }
        : undefined,
  });
}

export async function upsertSubdomainDns(slug: string): Promise<void> {
  const cfg = getConfig();
  if (!cfg.ROUTE53_HOSTED_ZONE_ID) {
    throw new Error('ROUTE53_HOSTED_ZONE_ID not configured');
  }
  if (!cfg.TENANT_INGRESS_TARGET_IP) {
    throw new Error('TENANT_INGRESS_TARGET_IP not configured');
  }

  const fqdn = `${slug}.${cfg.TENANT_BASE_DOMAIN}`;
  const client = getRoute53Client();

  const command = new ChangeResourceRecordSetsCommand({
    HostedZoneId: cfg.ROUTE53_HOSTED_ZONE_ID,
    ChangeBatch: {
      Comment: `Auto-provisioned for tenant ${slug}`,
      Changes: [
        {
          Action: ChangeAction.UPSERT,
          ResourceRecordSet: {
            Name: fqdn,
            Type: 'A',
            TTL: 300,
            ResourceRecords: [{ Value: cfg.TENANT_INGRESS_TARGET_IP }],
          },
        },
      ],
    },
  });

  const result = await client.send(command);
  const changeId = result.ChangeInfo?.Id?.replace(/^\/change\//, '');
  logger.info('Route53 upsert submitted', { fqdn, changeId });

  // Wait until INSYNC (or up to 90s) so the LE challenge has a chance to succeed
  if (changeId) {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const status = await client.send(new GetChangeCommand({ Id: changeId }));
      if (status.ChangeInfo?.Status === 'INSYNC') {
        logger.info('Route53 change INSYNC', { fqdn, changeId });
        return;
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    logger.warn('Route53 change still PENDING after 90s — continuing anyway', { fqdn, changeId });
  }
}

export async function deleteSubdomainDns(slug: string): Promise<void> {
  const cfg = getConfig();
  if (!cfg.ROUTE53_HOSTED_ZONE_ID) {
    throw new Error('ROUTE53_HOSTED_ZONE_ID not configured');
  }
  if (!cfg.TENANT_INGRESS_TARGET_IP) {
    throw new Error('TENANT_INGRESS_TARGET_IP not configured');
  }

  const fqdn = `${slug}.${cfg.TENANT_BASE_DOMAIN}`;
  const client = getRoute53Client();

  try {
    await client.send(
      new ChangeResourceRecordSetsCommand({
        HostedZoneId: cfg.ROUTE53_HOSTED_ZONE_ID,
        ChangeBatch: {
          Comment: `Auto-deprovisioned for tenant ${slug}`,
          Changes: [
            {
              Action: ChangeAction.DELETE,
              ResourceRecordSet: {
                Name: fqdn,
                Type: 'A',
                TTL: 300,
                ResourceRecords: [{ Value: cfg.TENANT_INGRESS_TARGET_IP }],
              },
            },
          ],
        },
      }),
    );
    logger.info('Route53 record deleted', { fqdn });
  } catch (err: any) {
    if (err.name === 'InvalidChangeBatch' && /not found/i.test(err.message || '')) {
      logger.info('Route53 record already absent', { fqdn });
      return;
    }
    throw err;
  }
}

// ─── alygrp-ingress UI ────────────────────────────────────────────────────────

interface IngressSite {
  server_name: string;
  upstream: string;
  client_max_body_size?: string;
  use_letsencrypt?: boolean;
  keepalive?: number;
  [k: string]: unknown;
}

interface IngressConfigBody {
  config: {
    nginx_sites: IngressSite[];
    [k: string]: unknown;
  };
}

async function fetchIngressConfig(): Promise<IngressConfigBody['config']> {
  const cfg = getConfig();
  if (!cfg.TENANT_INGRESS_UI_URL) {
    throw new Error('TENANT_INGRESS_UI_URL not configured');
  }
  const res = await fetch(`${cfg.TENANT_INGRESS_UI_URL}/api/config`);
  if (!res.ok) {
    throw new Error(`Ingress UI /api/config returned ${res.status}`);
  }
  const body = (await res.json()) as IngressConfigBody;
  return body.config;
}

async function saveIngressConfig(config: IngressConfigBody['config']): Promise<void> {
  const cfg = getConfig();
  const res = await fetch(`${cfg.TENANT_INGRESS_UI_URL}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ingress UI /api/config save failed: ${res.status} ${text}`);
  }
}

async function issueCertViaIngress(fqdn: string): Promise<void> {
  const cfg = getConfig();
  if (!cfg.TENANT_INGRESS_UI_URL) {
    throw new Error('TENANT_INGRESS_UI_URL not configured');
  }
  const res = await fetch(`${cfg.TENANT_INGRESS_UI_URL}/api/issue-cert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain: fqdn }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ingress UI /api/issue-cert failed: ${res.status} ${text}`);
  }
  logger.info('Let\'s Encrypt cert issued', { fqdn });
}

async function runAnsiblePlaybook(): Promise<void> {
  const cfg = getConfig();
  const res = await fetch(`${cfg.TENANT_INGRESS_UI_URL}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: true }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ingress UI /api/run failed: ${res.status} ${text}`);
  }

  // Poll status until done or timeout (12 min — cert issuance can take a while)
  const deadline = Date.now() + 12 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10_000));
    const statusRes = await fetch(`${cfg.TENANT_INGRESS_UI_URL}/api/run/status`);
    if (!statusRes.ok) continue;
    const body = (await statusRes.json()) as {
      lastRun: { running: boolean; exitCode: number | null };
    };
    if (!body.lastRun.running) {
      if (body.lastRun.exitCode !== 0) {
        throw new Error(`Ansible playbook exited with code ${body.lastRun.exitCode}`);
      }
      logger.info('Ansible playbook completed successfully');
      return;
    }
  }
  throw new Error('Ansible playbook timed out after 12 minutes');
}

export async function addTenantToIngress(slug: string): Promise<void> {
  const cfg = getConfig();
  if (!cfg.TENANT_INGRESS_UPSTREAM) {
    throw new Error('TENANT_INGRESS_UPSTREAM not configured');
  }
  const fqdn = `${slug}.${cfg.TENANT_BASE_DOMAIN}`;

  const ingressConfig = await fetchIngressConfig();
  const sites = (ingressConfig.nginx_sites ?? []) as IngressSite[];

  if (sites.some((s) => s.server_name === fqdn)) {
    logger.info('Ingress already has site for tenant — skipping add', { fqdn });
    return;
  }

  sites.push({
    server_name: fqdn,
    upstream: cfg.TENANT_INGRESS_UPSTREAM,
    client_max_body_size: '64m',
    use_letsencrypt: true,
    keepalive: 16,
  });

  await saveIngressConfig({ ...ingressConfig, nginx_sites: sites });
  logger.info('Ingress config updated with new tenant site', { fqdn });

  await runAnsiblePlaybook();
}

export async function removeTenantFromIngress(slug: string): Promise<void> {
  const cfg = getConfig();
  const fqdn = `${slug}.${cfg.TENANT_BASE_DOMAIN}`;

  const ingressConfig = await fetchIngressConfig();
  const sites = (ingressConfig.nginx_sites ?? []) as IngressSite[];

  const filtered = sites.filter((s) => s.server_name !== fqdn);
  if (filtered.length === sites.length) {
    logger.info('Ingress has no site for tenant — nothing to remove', { fqdn });
    return;
  }

  await saveIngressConfig({ ...ingressConfig, nginx_sites: filtered });
  logger.info('Ingress config updated to remove tenant site', { fqdn });

  await runAnsiblePlaybook();
}

// ─── End-to-end orchestration ─────────────────────────────────────────────────

export async function provisionTenant(slug: string): Promise<void> {
  const cfg = getConfig();
  if (!cfg.TENANT_PROVISIONING_ENABLED) {
    logger.info('Tenant provisioning disabled — skipping', { slug });
    return;
  }

  const fqdn = `${slug}.${cfg.TENANT_BASE_DOMAIN}`;
  logger.info('Tenant provisioning started', { slug, fqdn });

  // DNS first so the LE HTTP-01 challenge resolves by the time we issue the cert
  await upsertSubdomainDns(slug);
  await addTenantToIngress(slug);

  // Ansible deploys the self-signed placeholder + HTTP-01 webroot; the LE cert
  // step runs as its own endpoint because the in-playbook certbot step can be
  // interrupted by the playbook's own "Restart ingress UI" handler.
  try {
    await issueCertViaIngress(fqdn);
  } catch (err: any) {
    logger.error('Cert issuance failed — tenant subdomain is up but using self-signed cert', {
      slug,
      fqdn,
      error: err.message,
    });
  }

  logger.info('Tenant provisioning complete', { slug, fqdn });
}

export async function deprovisionTenant(slug: string): Promise<void> {
  const cfg = getConfig();
  if (!cfg.TENANT_PROVISIONING_ENABLED) {
    logger.info('Tenant provisioning disabled — skipping', { slug });
    return;
  }

  const fqdn = `${slug}.${cfg.TENANT_BASE_DOMAIN}`;
  logger.info('Tenant deprovisioning started', { slug, fqdn });

  // Remove ingress first so we stop serving traffic, then drop DNS
  try {
    await removeTenantFromIngress(slug);
  } catch (err: any) {
    logger.error('Failed to remove tenant from ingress — continuing with DNS removal', {
      slug,
      error: err.message,
    });
  }
  await deleteSubdomainDns(slug);

  logger.info('Tenant deprovisioning complete', { slug, fqdn });
}

