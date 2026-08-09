'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Radio,
  Trash2,
  Copy,
  ArrowLeft,
  Loader2,
  Activity,
  Server,
  Plus,
  X,
  Settings2,
  Download,
  FileText,
  Shield,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useSnmpTrappers, SnmpTrapper } from '@/lib/hooks/useSnmpTrappers';
import { useDeleteSnmpTrapper } from '@/lib/hooks/useSnmpTrappers';

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSeconds = Math.floor((now - then) / 1000);
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function StatusDot({ status }: { status: SnmpTrapper['status'] }) {
  const colorMap = {
    online: 'bg-green-500',
    offline: 'bg-red-500',
    degraded: 'bg-yellow-500',
  };
  const labelMap = {
    online: 'Online',
    offline: 'Offline',
    degraded: 'Degraded',
  };
  return (
    <span className="flex items-center gap-2">
      <span className={`inline-block h-2 w-2 rounded-full ${colorMap[status]}`} />
      <span className="text-sm">{labelMap[status]}</span>
    </span>
  );
}

// ── Config Generator Types ───────────────────────────────────────────────────

interface TrapRule {
  name: string;
  trap_oid: string;
  varbind_key: string;
  varbind_pattern: string;
  severity: number;
  title_template: string;
  labels: string;
  drop: boolean;
}

const WELL_KNOWN_OIDS: { label: string; oid: string }[] = [
  { label: 'linkDown', oid: '1.3.6.1.6.3.1.1.5.3' },
  { label: 'linkUp', oid: '1.3.6.1.6.3.1.1.5.4' },
  { label: 'coldStart', oid: '1.3.6.1.6.3.1.1.5.1' },
  { label: 'warmStart', oid: '1.3.6.1.6.3.1.1.5.2' },
  { label: 'authenticationFailure', oid: '1.3.6.1.6.3.1.1.5.5' },
  { label: 'Cisco config change', oid: '1.3.6.1.4.1.9.9.43.2.*' },
  { label: 'Cisco syslog', oid: '1.3.6.1.4.1.9.9.41.2.*' },
  { label: 'BGP state change', oid: '1.3.6.1.2.1.15.7.*' },
  { label: 'All traps (catch-all)', oid: '*' },
];

const EMPTY_RULE: TrapRule = {
  name: '',
  trap_oid: '',
  varbind_key: '',
  varbind_pattern: '',
  severity: 3,
  title_template: '',
  labels: '',
  drop: false,
};

export default function SnmpTrapperPage() {
  const [trapperToDelete, setTrapperToDelete] = useState<string | null>(null);
  const { data, isLoading } = useSnmpTrappers();
  const deleteTrapper = useDeleteSnmpTrapper();
  const trappers = data?.data ?? [];

  // ── Config Generator State ─────────────────────────────────────────────
  const [endpoint, setEndpoint] = useState('https://app.sreoncall.com');
  const [apiToken, setApiToken] = useState('');
  const [heartbeatInterval, setHeartbeatInterval] = useState('60');
  const [listenAddress, setListenAddress] = useState('0.0.0.0:162');
  const [communityStrings, setCommunityStrings] = useState('public');
  const [snmpVersion, setSnmpVersion] = useState<'v2c' | 'v3'>('v2c');
  const [v3Username, setV3Username] = useState('');
  const [v3AuthProtocol, setV3AuthProtocol] = useState('SHA');
  const [v3PrivProtocol, setV3PrivProtocol] = useState('AES');
  const [webUiAddress, setWebUiAddress] = useState('127.0.0.1:8080');
  const [webUiAuthEnabled, setWebUiAuthEnabled] = useState(false);
  const [correlationWindow, setCorrelationWindow] = useState('5');
  const [maxGroupSize, setMaxGroupSize] = useState('10000');
  const [retention, setRetention] = useState('7');
  const [maxSize, setMaxSize] = useState('1');
  const [rules, setRules] = useState<TrapRule[]>([
    {
      name: 'Link Down Critical',
      trap_oid: '1.3.6.1.6.3.1.1.5.3',
      varbind_key: 'ifAlias',
      varbind_pattern: 'uplink-*',
      severity: 1,
      title_template: 'Link Down: {{.ifDescr}} on {{.sysName}}',
      labels: 'network,link-down,critical',
      drop: false,
    },
    {
      name: 'Default catch-all',
      trap_oid: '*',
      varbind_key: '',
      varbind_pattern: '',
      severity: 4,
      title_template: 'SNMP Trap: {{.trapOID}} from {{.sourceIP}}',
      labels: 'snmp',
      drop: false,
    },
  ]);

  function addRule() {
    setRules([...rules, { ...EMPTY_RULE, name: `Rule ${rules.length + 1}` }]);
  }

  function updateRule(index: number, field: keyof TrapRule, value: string | number | boolean) {
    setRules(rules.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  function removeRule(index: number) {
    setRules(rules.filter((_, i) => i !== index));
  }

  // ── Generate YAML ──────────────────────────────────────────────────────
  const generatedYaml = useMemo(() => {
    const lines: string[] = [
      '# SREonCall SNMP Trapper Configuration',
      '# Generated from SREonCall UI',
      '',
      'sreoncall:',
      `  endpoint: "${endpoint}"`,
      `  api_token: "${apiToken || '<YOUR_INGESTION_TOKEN>'}"`,
      `  heartbeat_interval: ${heartbeatInterval}s`,
      '',
      'trap_receiver:',
      `  listen_address: "${listenAddress}"`,
      `  community_strings: [${communityStrings.split(',').map(s => `"${s.trim()}"`).join(', ')}]`,
    ];

    if (snmpVersion === 'v3') {
      lines.push(
        '  v3_users:',
        `    - username: "${v3Username || 'sreoncall'}"`,
        `      auth_protocol: "${v3AuthProtocol}"`,
        '      auth_passphrase: "${SNMP_AUTH_PASS}"',
        `      priv_protocol: "${v3PrivProtocol}"`,
        '      priv_passphrase: "${SNMP_PRIV_PASS}"',
      );
    }

    lines.push(
      '',
      'web_ui:',
      `  listen_address: "${webUiAddress}"`,
      '  auth:',
      `    enabled: ${webUiAuthEnabled}`,
    );
    if (webUiAuthEnabled) {
      lines.push(
        '    username: "admin"',
        '    password: "${WEB_UI_PASSWORD}"',
      );
    }

    lines.push(
      '',
      'mibs:',
      '  directories:',
      '    - /etc/snmp-trapper/mibs/standard',
      '    - /etc/snmp-trapper/mibs/vendor    # Place your vendor MIBs here',
      '',
      'correlation:',
      `  window: ${correlationWindow}m`,
      `  max_group_size: ${maxGroupSize}`,
      '  grouping_keys: [enterprise_oid, specific_trap]',
      '',
      'rules:',
    );

    for (const rule of rules) {
      lines.push(`  - name: "${rule.name}"`);
      lines.push('    match:');
      lines.push(`      trap_oid: "${rule.trap_oid}"`);
      if (rule.varbind_key && rule.varbind_pattern) {
        lines.push(`      varbinds: { ${rule.varbind_key}: "${rule.varbind_pattern}" }`);
      }
      if (rule.drop) {
        lines.push('    action:');
        lines.push('      drop: true');
      } else {
        lines.push('    action:');
        lines.push(`      severity: ${rule.severity}`);
        lines.push(`      title_template: "${rule.title_template}"`);
        if (rule.labels) {
          lines.push(`      labels: [${rule.labels.split(',').map(l => l.trim()).join(', ')}]`);
        }
      }
      lines.push('');
    }

    lines.push(
      'storage:',
      '  path: /var/lib/snmp-trapper/',
      `  retention: ${retention}d`,
      `  max_size: ${maxSize}GB`,
    );

    return lines.join('\n');
  }, [
    endpoint, apiToken, heartbeatInterval, listenAddress, communityStrings,
    snmpVersion, v3Username, v3AuthProtocol, v3PrivProtocol,
    webUiAddress, webUiAuthEnabled, correlationWindow, maxGroupSize,
    retention, maxSize, rules,
  ]);

  const installCommand = `curl -sSL ${endpoint}/api/v1/snmp-trappers/install.sh | SRE_TOKEN="${apiToken || '<token>'}" SRE_ENDPOINT="${endpoint}" sudo bash`;

  const dockerCommand = `docker run -d \\
  --name snmp-trapper \\
  -p 162:162/udp \\
  -p 8080:8080 \\
  -v ./config.yaml:/etc/snmp-trapper/config.yaml:ro \\
  -v ./vendor-mibs:/etc/snmp-trapper/mibs/vendor:ro \\
  --restart unless-stopped \\
  ghcr.io/alyssumgroup/sreoncall-snmp-trapper:latest`;

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => toast.success('Copied to clipboard'));
  }

  function downloadConfig() {
    const blob = new Blob([generatedYaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'config.yaml';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDelete() {
    if (!trapperToDelete) return;
    try {
      await deleteTrapper.mutateAsync(trapperToDelete);
      toast.success('SNMP trapper removed');
      setTrapperToDelete(null);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete trapper');
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <Link
          href="/settings/integrations"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Integrations
        </Link>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Radio className="h-5 w-5" />
          SNMP Trap Collectors
        </h2>
        <p className="text-sm text-muted-foreground">
          Deploy on-premise agents to receive SNMP traps and forward correlated alerts to SREonCall. Only outbound HTTPS is required — no inbound firewall rules needed.
        </p>
      </div>

      {/* ── Configuration Generator ─────────────────────────────────────── */}
      <Card>
        <CardContent className="p-4 space-y-5">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Configuration Generator</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Configure your SNMP trapper agent below. The generated YAML config can be downloaded and placed at <code className="text-xs bg-muted px-1 rounded">/etc/snmp-trapper/config.yaml</code> on the target server.
          </p>

          {/* Connection Settings */}
          <div className="space-y-3 rounded-lg border border-border p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">SREonCall Connection</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Endpoint URL</label>
                <Input
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="https://acum.sreoncall.com"
                />
                <p className="text-[11px] text-muted-foreground">Your SREonCall tenant URL</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">API Token (Ingestion Token)</label>
                <Input
                  type="password"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  placeholder="sre_trap_..."
                />
                <p className="text-[11px] text-muted-foreground">
                  Create an ingestion token with <code className="text-[11px] bg-muted px-1 rounded">traps:write</code> scope
                </p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Heartbeat Interval (seconds)</label>
                <Input
                  type="number"
                  value={heartbeatInterval}
                  onChange={(e) => setHeartbeatInterval(e.target.value)}
                  min="10"
                  max="300"
                />
              </div>
            </div>
          </div>

          {/* SNMP Receiver Settings */}
          <div className="space-y-3 rounded-lg border border-border p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">SNMP Trap Receiver</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Listen Address</label>
                <Input
                  value={listenAddress}
                  onChange={(e) => setListenAddress(e.target.value)}
                  placeholder="0.0.0.0:162"
                />
                <p className="text-[11px] text-muted-foreground">UDP address:port for incoming traps</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">SNMP Version</label>
                <Select value={snmpVersion} onChange={(e) => setSnmpVersion(e.target.value as 'v2c' | 'v3')}>
                  <option value="v2c">SNMPv2c (Community String)</option>
                  <option value="v3">SNMPv3 (USM Authentication)</option>
                </Select>
              </div>
              {snmpVersion === 'v2c' ? (
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-foreground">Community Strings</label>
                  <Input
                    value={communityStrings}
                    onChange={(e) => setCommunityStrings(e.target.value)}
                    placeholder="public, telecom-rw"
                  />
                  <p className="text-[11px] text-muted-foreground">Comma-separated list of accepted community strings</p>
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">SNMPv3 Username</label>
                    <Input value={v3Username} onChange={(e) => setV3Username(e.target.value)} placeholder="sreoncall" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">Auth Protocol</label>
                    <Select value={v3AuthProtocol} onChange={(e) => setV3AuthProtocol(e.target.value)}>
                      <option value="MD5">MD5</option>
                      <option value="SHA">SHA</option>
                      <option value="SHA256">SHA-256</option>
                      <option value="SHA512">SHA-512</option>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">Privacy Protocol</label>
                    <Select value={v3PrivProtocol} onChange={(e) => setV3PrivProtocol(e.target.value)}>
                      <option value="DES">DES</option>
                      <option value="AES">AES</option>
                      <option value="AES192">AES-192</option>
                      <option value="AES256">AES-256</option>
                    </Select>
                  </div>
                  <div className="md:col-span-2 rounded bg-muted/50 p-2">
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Shield className="h-3 w-3" />
                      Auth and privacy passphrases are set via environment variables: <code className="bg-muted px-1 rounded">SNMP_AUTH_PASS</code> and <code className="bg-muted px-1 rounded">SNMP_PRIV_PASS</code>
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Web UI & Correlation */}
          <div className="space-y-3 rounded-lg border border-border p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Agent Settings</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Web UI Address</label>
                <Input value={webUiAddress} onChange={(e) => setWebUiAddress(e.target.value)} placeholder="127.0.0.1:8080" />
                <p className="text-[11px] text-muted-foreground">Diagnostic dashboard</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Correlation Window (min)</label>
                <Input type="number" value={correlationWindow} onChange={(e) => setCorrelationWindow(e.target.value)} min="1" max="60" />
                <p className="text-[11px] text-muted-foreground">Group traps within this window</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Max Group Size</label>
                <Input type="number" value={maxGroupSize} onChange={(e) => setMaxGroupSize(e.target.value)} min="10" max="100000" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Storage Retention (days)</label>
                <Input type="number" value={retention} onChange={(e) => setRetention(e.target.value)} min="1" max="90" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Max Storage Size (GB)</label>
                <Input type="number" value={maxSize} onChange={(e) => setMaxSize(e.target.value)} min="1" max="100" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Web UI Auth</label>
                <Select value={webUiAuthEnabled ? 'yes' : 'no'} onChange={(e) => setWebUiAuthEnabled(e.target.value === 'yes')}>
                  <option value="no">Disabled (local access only)</option>
                  <option value="yes">Basic Auth Enabled</option>
                </Select>
              </div>
            </div>
          </div>

          {/* Trap Rules */}
          <div className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Trap Rules (first match wins)</h4>
              <Button size="sm" variant="outline" onClick={addRule}>
                <Plus className="mr-1 h-3 w-3" /> Add Rule
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Define how SNMP traps are processed. Each trap is matched against rules top-to-bottom; the first matching rule determines the action. Use &quot;drop&quot; to silently discard noisy traps.
            </p>
            <div className="space-y-3">
              {rules.map((rule, idx) => (
                <div key={idx} className="relative rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Rule {idx + 1}</span>
                    <button
                      className="rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      onClick={() => removeRule(idx)}
                      title="Remove rule"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <label className="text-[11px] text-muted-foreground">Rule Name</label>
                      <Input
                        value={rule.name}
                        onChange={(e) => updateRule(idx, 'name', e.target.value)}
                        placeholder="Link Down Critical"
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-muted-foreground">Trap OID (or pattern)</label>
                      <div className="flex gap-1">
                        <Input
                          value={rule.trap_oid}
                          onChange={(e) => updateRule(idx, 'trap_oid', e.target.value)}
                          placeholder="1.3.6.1.6.3.1.1.5.3"
                          className="h-8 text-xs font-mono flex-1"
                        />
                        <Select
                          className="h-8 text-xs w-auto"
                          value=""
                          onChange={(e) => {
                            if (e.target.value) updateRule(idx, 'trap_oid', e.target.value);
                          }}
                        >
                          <option value="">Pick...</option>
                          {WELL_KNOWN_OIDS.map((o) => (
                            <option key={o.oid} value={o.oid}>{o.label}</option>
                          ))}
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-muted-foreground">Action</label>
                      <Select
                        value={rule.drop ? 'drop' : 'forward'}
                        onChange={(e) => updateRule(idx, 'drop', e.target.value === 'drop')}
                        className="h-8 text-xs"
                      >
                        <option value="forward">Forward to SREonCall</option>
                        <option value="drop">Drop (silence)</option>
                      </Select>
                    </div>
                  </div>
                  {!rule.drop && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <label className="text-[11px] text-muted-foreground">Severity</label>
                        <Select
                          value={String(rule.severity)}
                          onChange={(e) => updateRule(idx, 'severity', Number(e.target.value))}
                          className="h-8 text-xs"
                        >
                          <option value="1">1 - Critical</option>
                          <option value="2">2 - High</option>
                          <option value="3">3 - Medium</option>
                          <option value="4">4 - Low</option>
                          <option value="5">5 - Info</option>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] text-muted-foreground">Title Template</label>
                        <Input
                          value={rule.title_template}
                          onChange={(e) => updateRule(idx, 'title_template', e.target.value)}
                          placeholder="Link Down: {{.ifDescr}} on {{.sysName}}"
                          className="h-8 text-xs font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] text-muted-foreground">Labels (comma-separated)</label>
                        <Input
                          value={rule.labels}
                          onChange={(e) => updateRule(idx, 'labels', e.target.value)}
                          placeholder="network, link-down"
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                  )}
                  {/* Optional varbind filter */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[11px] text-muted-foreground">Varbind Filter Key (optional)</label>
                      <Input
                        value={rule.varbind_key}
                        onChange={(e) => updateRule(idx, 'varbind_key', e.target.value)}
                        placeholder="ifAlias"
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-muted-foreground">Varbind Filter Pattern (glob)</label>
                      <Input
                        value={rule.varbind_pattern}
                        onChange={(e) => updateRule(idx, 'varbind_pattern', e.target.value)}
                        placeholder="uplink-*"
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Generated Config Output */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Generated config.yaml</h4>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => copyToClipboard(generatedYaml)}>
                  <Copy className="mr-1 h-3 w-3" /> Copy YAML
                </Button>
                <Button size="sm" variant="outline" onClick={downloadConfig}>
                  <Download className="mr-1 h-3 w-3" /> Download
                </Button>
              </div>
            </div>
            <pre className="rounded-lg border border-border bg-[#0D1117] p-4 text-xs font-mono text-green-400 overflow-x-auto max-h-80 overflow-y-auto">
              {generatedYaml}
            </pre>
          </div>
        </CardContent>
      </Card>

      {/* ── Deployment Commands ──────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Deploy</h3>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Option 1: Docker (recommended)</p>
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted p-3">
              <pre className="flex-1 text-xs font-mono text-foreground whitespace-pre-wrap">{dockerCommand}</pre>
              <Button size="sm" variant="ghost" onClick={() => copyToClipboard(dockerCommand)} className="shrink-0">
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Option 2: Install Script (systemd)</p>
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted p-3">
              <code className="flex-1 break-all text-xs font-mono text-foreground">{installCommand}</code>
              <Button size="sm" variant="ghost" onClick={() => copyToClipboard(installCommand)} className="shrink-0">
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Registered Trappers ──────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Registered Trappers</h3>
          {trappers.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {trappers.length}
            </Badge>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : trappers.length === 0 ? (
              <div className="flex h-32 items-center justify-center flex-col gap-2">
                <Radio className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  No SNMP trap collectors registered yet.
                </p>
                <p className="text-xs text-muted-foreground">
                  Deploy the snmp-trapper agent on your network — it will auto-register on first heartbeat.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Name / Hostname
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Version
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Trap Rate (/sec)
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Active Correlations
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Last Heartbeat
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {trappers.map((trapper) => (
                      <tr key={trapper.id} className="transition-colors hover:bg-muted/50">
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-foreground">{trapper.name}</div>
                          <div className="text-xs text-muted-foreground">{trapper.hostname}</div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusDot status={trapper.status} />
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {trapper.version}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {trapper.trap_rate}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {trapper.active_correlations}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {formatRelativeTime(trapper.last_heartbeat_at)}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setTrapperToDelete(trapper.id)}
                            title="Delete trapper"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!trapperToDelete}
        onClose={() => setTrapperToDelete(null)}
        onConfirm={handleDelete}
        title="Delete SNMP Trapper"
        description="Are you sure you want to remove this SNMP trap collector? It will stop forwarding traps to SREonCall."
        confirmLabel="Delete"
        variant="destructive"
        isLoading={deleteTrapper.isPending}
      />
    </div>
  );
}
