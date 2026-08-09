import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';

const createAuditLogMock = vi.fn(async (..._args: any[]) => ({}));
vi.mock('../../services/audit.service', () => ({ createAuditLog: (...args: any[]) => createAuditLogMock(...args) }));

const listEscalationPoliciesMock = vi.fn(async (..._args: any[]) => ({
  data: [{ _id: new Types.ObjectId(), name: 'Sev1 escalation', status: 'active', steps: [{}, {}] }],
}));
vi.mock('../../services/escalation-policy.service', () => ({
  listEscalationPolicies: (...args: any[]) => listEscalationPoliciesMock(...args),
}));

const createProposalMock = vi.fn(async (...args: any[]) => ({ _id: new Types.ObjectId(), ...args[0] }));
vi.mock('../../services/mcp-proposal.service', () => ({
  createProposal: (...args: any[]) => createProposalMock(...args),
}));

const resolveObservabilityEndpointsMock = vi.fn(async (..._args: any[]) => ({
  metrics_url: 'https://metrics.example.com',
  orgId: 'org-1',
}));
const proxyObservabilityFetchMock = vi.fn(async (..._args: any[]): Promise<any> => ({
  status: 'success',
  data: { resultType: 'matrix', result: [] as any[] },
}));
vi.mock('../../routes/observability-proxy.routes', () => ({
  resolveEndpoints: (...args: any[]) => resolveObservabilityEndpointsMock(...args),
  proxyFetch: (...args: any[]) => proxyObservabilityFetchMock(...args),
}));

import { registerTools, McpToolContext } from '../tools';

function fakeServer() {
  const tools = new Map<string, { schema: any; handler: (args: any) => Promise<any> }>();
  return {
    registerTool: (name: string, schema: any, handler: any) => {
      tools.set(name, { schema, handler });
    },
    tools,
  } as any;
}

function ctxWithPermissions(permissions: string[]): McpToolContext {
  return {
    tenantId: new Types.ObjectId(),
    apiKeyId: new Types.ObjectId(),
    permissions,
    ip: '203.0.113.1',
    userAgent: 'mcp-inspector/1.0',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('registerTools — audit logging', () => {
  it('writes a success audit log entry and returns shaped data on an allowed call', async () => {
    const server = fakeServer();
    const ctx = ctxWithPermissions(['escalation:read']);
    registerTools(server, ctx);

    const result = await server.tools.get('list_escalation_policies').handler({});

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual([{ id: expect.any(String), name: 'Sev1 escalation', status: 'active', step_count: 2 }]);

    expect(createAuditLogMock).toHaveBeenCalledTimes(1);
    expect(createAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: ctx.tenantId,
        action: 'list_escalation_policies',
        resource_type: 'escalation_policy',
        result: 'success',
        actor: expect.objectContaining({ type: 'api_key', id: ctx.apiKeyId, ip: ctx.ip, user_agent: ctx.userAgent }),
      }),
    );
  });

  it('denies a call missing the required permission and still writes a failure audit log entry', async () => {
    const server = fakeServer();
    const ctx = ctxWithPermissions([]); // no permissions granted
    registerTools(server, ctx);

    const result = await server.tools.get('list_escalation_policies').handler({});

    expect(result.isError).toBe(true);
    expect(listEscalationPoliciesMock).not.toHaveBeenCalled();

    expect(createAuditLogMock).toHaveBeenCalledTimes(1);
    expect(createAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'list_escalation_policies', result: 'failure' }),
    );
  });

  it('logs a failure entry (and rethrows) when the underlying service throws', async () => {
    const server = fakeServer();
    const ctx = ctxWithPermissions(['escalation:read']);
    registerTools(server, ctx);
    listEscalationPoliciesMock.mockRejectedValueOnce(new Error('db down'));

    await expect(server.tools.get('list_escalation_policies').handler({})).rejects.toThrow('db down');

    expect(createAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'list_escalation_policies', result: 'failure' }),
    );
  });
});

describe('registerTools — propose_alert_rule', () => {
  it('creates a pending McpProposal instead of calling any creation service directly', async () => {
    const server = fakeServer();
    const ctx = ctxWithPermissions(['alert-rules:create']);
    registerTools(server, ctx);

    const result = await server.tools.get('propose_alert_rule').handler({
      name: 'High CPU',
      metric: 'cpu_pct',
      operator: 'gt',
      threshold: 90,
    });

    expect(createProposalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: ctx.tenantId,
        created_by_api_key_id: ctx.apiKeyId,
        tool_name: 'propose_alert_rule',
        target_type: 'alert_rule',
        payload: expect.objectContaining({
          name: 'High CPU',
          condition: { metric: 'cpu_pct', operator: 'gt', threshold: 90, window_minutes: undefined },
        }),
      }),
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe('pending');
  });

  it('is denied without alert-rules:create permission', async () => {
    const server = fakeServer();
    const ctx = ctxWithPermissions([]);
    registerTools(server, ctx);

    const result = await server.tools.get('propose_alert_rule').handler({
      name: 'High CPU',
      metric: 'cpu_pct',
      operator: 'gt',
      threshold: 90,
    });

    expect(result.isError).toBe(true);
    expect(createProposalMock).not.toHaveBeenCalled();
  });
});

describe('registerTools — query_metrics output cap', () => {
  it('passes through a small result set untouched', async () => {
    proxyObservabilityFetchMock.mockResolvedValueOnce({
      status: 'success',
      data: { resultType: 'matrix', result: [{ metric: { __name__: 'up' }, values: [[1, '1']] }] },
    });
    const server = fakeServer();
    const ctx = ctxWithPermissions(['metrics:read']);
    registerTools(server, ctx);

    const result = await server.tools.get('query_metrics').handler({ query: 'up' });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data.result).toHaveLength(1);
    expect(parsed.truncated_series).toBeUndefined();
  });

  it('caps an unbounded series count instead of returning it all', async () => {
    const manySeries = Array.from({ length: 250 }, (_, i) => ({
      metric: { instance: `host-${i}` },
      value: [1, '1'],
    }));
    proxyObservabilityFetchMock.mockResolvedValueOnce({
      status: 'success',
      data: { resultType: 'vector', result: manySeries },
    });
    const server = fakeServer();
    const ctx = ctxWithPermissions(['metrics:read']);
    registerTools(server, ctx);

    const result = await server.tools.get('query_metrics').handler({ query: '{__name__=~".+"}' });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data.result).toHaveLength(100);
    expect(parsed.truncated_series).toBe(true);
    expect(parsed.total_series).toBe(250);
  });

  it('caps an unbounded sample count within a single series to the most recent samples', async () => {
    const manySamples = Array.from({ length: 1000 }, (_, i) => [i, String(i)]);
    proxyObservabilityFetchMock.mockResolvedValueOnce({
      status: 'success',
      data: { resultType: 'matrix', result: [{ metric: { __name__: 'up' }, values: manySamples }] },
    });
    const server = fakeServer();
    const ctx = ctxWithPermissions(['metrics:read']);
    registerTools(server, ctx);

    const result = await server.tools.get('query_metrics').handler({ query: 'up', start: '0', end: '1000' });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data.result[0].values).toHaveLength(500);
    expect(parsed.data.result[0].values[0]).toEqual(manySamples[500]);
    expect(parsed.data.result[0].truncated_samples).toBe(true);
  });

  it('is denied without metrics:read permission', async () => {
    const server = fakeServer();
    const ctx = ctxWithPermissions([]);
    registerTools(server, ctx);

    const result = await server.tools.get('query_metrics').handler({ query: 'up' });

    expect(result.isError).toBe(true);
    expect(proxyObservabilityFetchMock).not.toHaveBeenCalled();
  });
});
