'use client';

import { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ChevronRight,
  ChevronLeft,
  Server,
  Database,
  Plug,
  Trash2,
  RefreshCw,
  Plus,
  Key,
  Loader2,
  Terminal,
  Monitor,
  Container,
  Cloud,
  Shield,
  CheckCircle2,
  X,
  Pencil,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LabelsEditor } from '@/components/observability/LabelsEditor';
import { HerokuDrainMigrateModal } from '@/components/observability/HerokuDrainMigrateModal';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { useSession } from 'next-auth/react';
import {
  useObservabilityConnections,
  useCreateConnection,
  useDeleteConnection,
  useHealthCheckConnection,
  ObservabilityConnection,
} from '@/lib/hooks/useObservabilityConnections';
import {
  useIngestionTokens,
  useCreateIngestionToken,
  useRevokeIngestionToken,
} from '@/lib/hooks/useIngestionTokens';
import {
  useRUMApplications,
  useCreateRUMApplication,
  useDeleteRUMApplication,
  useRUMApplicationSnippet,
  RUMApplication,
} from '@/lib/hooks/useRUMApplications';
import { useLgtmHealth } from '@/lib/hooks/useObservabilityProxy';
import { useAssetsSummary, AssetsSummary } from '@/lib/hooks/useAssets';

type ConnectionMode = 'managed' | 'byos' | 'third_party';
type Platform = 'linux' | 'docker' | 'kubernetes' | 'macos';
type RUMSnippetFramework = 'html' | 'nextjs' | 'react' | 'vite';

const MODES: {
  id: ConnectionMode;
  title: string;
  icon: typeof Server;
  description: string;
  tags: string[];
}[] = [
  {
    id: 'managed',
    title: 'SREonCall Managed LGTM',
    icon: Server,
    description:
      'Install the SREonCall agent on your hosts. We operate Mimir + Loki + Tempo. Metrics, logs, and traces flow automatically.',
    tags: ['Metrics', 'Logs', 'Traces', '1-command install'],
  },
  {
    id: 'byos',
    title: 'Bring Your Own Stack (BYOS)',
    icon: Database,
    description:
      'Already running Prometheus/Mimir/Loki/Tempo? Provide endpoints + auth. SREonCall proxies queries to your stack.',
    tags: ['Prometheus', 'Loki', 'Tempo', 'Vault creds'],
  },
  {
    id: 'third_party',
    title: 'Third-Party Integration',
    icon: Plug,
    description:
      'Connect Datadog, New Relic, CloudWatch, Splunk, Elastic, GCP Monitoring, or Azure Monitor via API pull or webhook.',
    tags: ['Datadog', 'New Relic', 'CloudWatch', 'Azure', 'GCP', 'Elastic'],
  },
];

const PLATFORMS: { id: Platform; label: string; icon: typeof Monitor; description: string }[] = [
  { id: 'linux', label: 'Linux', icon: Terminal, description: 'Ubuntu, Debian, CentOS, RHEL, Fedora, Rocky' },
  { id: 'docker', label: 'Docker', icon: Container, description: 'Container, Docker Compose, ECS' },
  { id: 'kubernetes', label: 'Kubernetes', icon: Cloud, description: 'Helm chart, DaemonSet, any K8s cluster' },
  { id: 'macos', label: 'macOS', icon: Monitor, description: 'Local dev, Homebrew' },
];

type CloudProvider = 'aws' | 'gcp' | 'azure' | 'scaleway' | 'digitalocean' | 'heroku' | 'supabase' | 'vercel';

const CLOUD_PROVIDERS: {
  id: CloudProvider;
  name: string;
  description: string;
  vendor: string;
  color: string;
}[] = [
  {
    id: 'aws',
    name: 'Amazon Web Services',
    description: 'Connect CloudWatch metrics, logs, and X-Ray traces from your AWS accounts.',
    vendor: 'cloudwatch',
    color: '#FF9900',
  },
  {
    id: 'gcp',
    name: 'Google Cloud Platform',
    description: 'Import Cloud Monitoring metrics, Cloud Logging, and Cloud Trace data.',
    vendor: 'gcp_monitoring',
    color: '#4285F4',
  },
  {
    id: 'azure',
    name: 'Microsoft Azure',
    description: 'Pull Azure Monitor metrics, Log Analytics, and Application Insights data.',
    vendor: 'azure_monitor',
    color: '#0078D4',
  },
  {
    id: 'scaleway',
    name: 'Scaleway',
    description: 'Discover Instances, Kubernetes Kapsule, managed databases, serverless, and more.',
    vendor: 'scaleway',
    color: '#4F0599',
  },
  {
    id: 'digitalocean',
    name: 'DigitalOcean',
    description: 'Discover Droplets, DOKS clusters, managed databases, App Platform, and more.',
    vendor: 'digitalocean',
    color: '#0080FF',
  },
];

const PAAS_PROVIDERS: typeof CLOUD_PROVIDERS = [
  {
    id: 'heroku',
    name: 'Heroku',
    description: 'Discover apps, dynos, add-ons, PostgreSQL. Set up log drains and OTel traces for Rails/Node.js.',
    vendor: 'heroku',
    color: '#430098',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    description: 'Discover projects, PostgreSQL databases, auth configuration, and connection pooling.',
    vendor: 'supabase',
    color: '#3ECF8E',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    description: 'Discover projects, deployments, custom domains, and serverless functions.',
    vendor: 'vercel',
    color: '#000000',
  },
];

const AWS_REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-central-2',
  'eu-north-1', 'eu-south-1', 'eu-south-2',
  'ap-southeast-1', 'ap-southeast-2', 'ap-southeast-3', 'ap-southeast-4',
  'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3',
  'ap-south-1', 'ap-south-2', 'ap-east-1',
  'sa-east-1', 'ca-central-1', 'ca-west-1',
  'me-south-1', 'me-central-1', 'af-south-1', 'il-central-1',
];

const SCW_REGIONS = [
  { value: 'fr-par', label: 'Paris, France (fr-par)' },
  { value: 'nl-ams', label: 'Amsterdam, Netherlands (nl-ams)' },
  { value: 'pl-waw', label: 'Warsaw, Poland (pl-waw)' },
];

const POLLING_INTERVALS = [
  { value: '1m', label: 'Every 1 minute' },
  { value: '5m', label: 'Every 5 minutes' },
  { value: '15m', label: 'Every 15 minutes' },
];

const PROVIDER_RECOMMENDATIONS: Record<CloudProvider, { alerts: string[]; dashboards: string[] }> = {
  aws: {
    alerts: ['EC2 CPU > 90%', 'RDS connections > 80%', 'Lambda error rate > 5%', 'ELB 5xx spike', 'S3 4xx errors'],
    dashboards: ['EC2 Overview', 'RDS Performance', 'Lambda Invocations', 'ELB Traffic', 'Billing Summary'],
  },
  scaleway: {
    alerts: ['Instance CPU > 80%', 'Managed DB connections > 90%', 'Kapsule pod restarts > 5', 'LB 5xx spike', 'Redis memory > 85%'],
    dashboards: ['Scaleway Infrastructure Overview', 'Instances Fleet Health', 'Managed Databases', 'Kubernetes Kapsule', 'Serverless Overview'],
  },
  digitalocean: {
    alerts: ['Droplet CPU > 80%', 'Managed DB connections > 90%', 'DOKS pod restarts > 5', 'LB 5xx spike', 'Redis memory > 85%'],
    dashboards: ['DigitalOcean Infrastructure Overview', 'Droplets Fleet Health', 'Managed Databases', 'DOKS Health', 'App Platform & Functions'],
  },
  gcp: {
    alerts: ['GCE CPU > 90%', 'Cloud SQL connections > 80%', 'Cloud Functions errors > 5%', 'Load Balancer 5xx spike'],
    dashboards: ['Compute Engine Overview', 'Cloud SQL Performance', 'Cloud Functions', 'Load Balancer Traffic'],
  },
  azure: {
    alerts: ['VM CPU > 90%', 'SQL Database DTU > 80%', 'Function App errors > 5%', 'App Gateway 5xx spike'],
    dashboards: ['Virtual Machines Overview', 'SQL Database Performance', 'Function Apps', 'Application Gateway'],
  },
  heroku: {
    alerts: ['Dyno memory quota exceeded (R14)', 'Request timeout (H12)', 'Boot timeout (R10)', 'PostgreSQL connections > 80%', 'Worker queue latency > 60s'],
    dashboards: ['Heroku Apps Overview', 'Dyno Performance', 'PostgreSQL Health', 'Worker Queues', 'Error Rate & Response Time'],
  },
  supabase: {
    alerts: ['Database connections > 80%', 'Auth error rate > 5%', 'Disk usage > 90%', 'Realtime connections > 80%'],
    dashboards: ['Supabase Overview', 'Database Performance', 'Auth & Users', 'Realtime Connections'],
  },
  vercel: {
    alerts: ['Deployment failure', 'Build time > 5 min', 'Function errors > 5%', 'Edge latency P99 > 500ms'],
    dashboards: ['Vercel Overview', 'Deployment History', 'Edge Performance', 'Serverless Functions'],
  },
};

export default function ConnectStack() {
  const [selectedMode, setSelectedMode] = useState<ConnectionMode>('managed');
  const [platform, setPlatform] = useState<Platform>('linux');
  const [copied, setCopied] = useState<string | null>(null);
  const [showNewToken, setShowNewToken] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [selectedTokenForInstall, setSelectedTokenForInstall] = useState<string | null>(null);
  const [showRumAppModal, setShowRumAppModal] = useState(false);
  const [selectedRumAppId, setSelectedRumAppId] = useState<string | null>(null);
  const [rumSnippetFramework, setRumSnippetFramework] = useState<RUMSnippetFramework>('html');

  // Cloud wizard
  const [cloudWizardProvider, setCloudWizardProvider] = useState<CloudProvider | null>(null);

  // BYOS form
  const [byosMetrics, setByosMetrics] = useState('');
  const [byosLogs, setByosLogs] = useState('');
  const [byosTraces, setByosTraces] = useState('');
  const [byosName, setByosName] = useState('');

  // Third-party form
  const [tpVendor, setTpVendor] = useState('datadog');
  const [tpName, setTpName] = useState('');

  // Auth
  const { data: session } = useSession();
  const tenantId = (session?.user as any)?.tenantId || '<TENANT_ID>';

  // API hooks
  const { data: connsData, isLoading: connsLoading } = useObservabilityConnections();
  const connections = connsData?.data ?? [];
  const createConnection = useCreateConnection();
  const deleteConnection = useDeleteConnection();
  const healthCheck = useHealthCheckConnection();
  const { data: assetsSummaryData } = useAssetsSummary();
  const { data: tokensData } = useIngestionTokens();
  const { data: rumAppsData } = useRUMApplications();
  const tokens = tokensData?.data ?? [];
  const rumApps = rumAppsData?.data ?? [];
  const activeTokens = tokens.filter((t) => !t.revoked_at);
  const createToken = useCreateIngestionToken();
  const revokeToken = useRevokeIngestionToken();
  const createRumApplication = useCreateRUMApplication();
  const deleteRumApplication = useDeleteRUMApplication();
  const { data: selectedRumSnippet, isLoading: rumSnippetLoading } = useRUMApplicationSnippet(selectedRumAppId, rumSnippetFramework);
  const { data: lgtmHealth } = useLgtmHealth();

  const appOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://app.sreoncall.com';
  const INGEST_URL = appOrigin.replace('dev-web.', 'dev-ingest.').replace('app.', 'ingest.');
  const latestConnection = connections[0] ?? null;
  const rumAppsSupported = latestConnection?.mode !== 'byos';

  // The token to use in install commands — either just-created or placeholder
  const apiKey = createdToken || selectedTokenForInstall || '<SRE_TOKEN>';
  const hasApiKey = apiKey !== '<SRE_TOKEN>' || activeTokens.length > 0;

  // ── Install commands per platform ──

  function getInstallCommand(p: Platform): string {
    switch (p) {
      case 'linux':
        return `# Installs Alloy (metrics + logs) + Beyla (eBPF auto-instrumentation)
# Add --no-ebpf to skip Beyla (e.g., on kernels < 5.8)
SRE_TOKEN=${apiKey} SRE_TENANT_ID=${tenantId} \\
  bash -c "$(curl -sSL ${appOrigin}/api/v1/agent/install.sh)"`;

      case 'docker':
        return `docker run -d \\
  --name sreoncall-agent \\
  --restart always \\
  --pid host --net host \\
  -v /:/host/root:ro \\
  -v /sys:/host/sys:ro \\
  -v /proc:/host/proc:ro \\
  -v /var/log:/var/log:ro \\
  -v /var/run/docker.sock:/var/run/docker.sock:ro \\
  -e SRE_TOKEN=${apiKey} \\
  -e SRE_TENANT_ID=${tenantId} \\
  -e SRE_INGEST_URL=${INGEST_URL} \\
  grafana/alloy:latest run \\
    --server.http.listen-addr=0.0.0.0:12345 \\
    /etc/alloy/config.alloy`;

      case 'kubernetes':
        return `# Install SREonCall Agent (Alloy + Beyla eBPF)
helm repo add sreoncall https://charts.sreoncall.com
helm repo update
helm install sreoncall-agent sreoncall/sreoncall-agent \\
  --set global.tenantId=${tenantId} \\
  --set global.ingestionToken=${apiKey} \\
  --namespace sreoncall-agent --create-namespace

# To disable eBPF auto-instrumentation:
# helm install sreoncall-agent sreoncall/sreoncall-agent \\
#   --set global.tenantId=${tenantId} \\
#   --set global.ingestionToken=${apiKey} \\
#   --set beyla.enabled=false \\
#   --namespace sreoncall-agent --create-namespace`;

      case 'macos':
        return `# Installs Alloy (metrics + logs). eBPF not supported on macOS.
SRE_TOKEN=${apiKey} SRE_TENANT_ID=${tenantId} \\
  bash -c "$(curl -sSL ${appOrigin}/api/v1/agent/install.sh)"`;

      default:
        return '';
    }
  }

  // ── Install script (for download) ──
  const SETUP_SCRIPT = `#!/usr/bin/env bash
# ============================================================
# SREonCall Agent Installer
# Installs Grafana Alloy, configures it, and starts the service.
# Auto-detects Docker and configures container log collection.
# Auto-detects internal networks and uses direct LGTM endpoint.
# Supports: Ubuntu, Debian, CentOS, RHEL, Fedora, Rocky, macOS
# ============================================================
set -euo pipefail

SRE_TOKEN="\${SRE_TOKEN:?ERROR: SRE_TOKEN is required. Get one from Observability > Connect.}"
SRE_TENANT_ID="\${SRE_TENANT_ID:?ERROR: SRE_TENANT_ID is required.}"
SRE_INGEST_URL="\${SRE_INGEST_URL:-${INGEST_URL}}"
INSTALL_BEYLA=true

# Parse flags
for arg in "\$@"; do
  case "\$arg" in
    --no-ebpf) INSTALL_BEYLA=false ;;
  esac
done

echo ""
echo "  SREonCall Agent Installer"
echo "  ========================="
echo "  Tenant:  \$SRE_TENANT_ID"
echo "  Ingest:  \$SRE_INGEST_URL"
echo ""

# ── Detect OS ──
HAS_DOCKER=false
detect_os() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=\$ID
  elif [ -f /etc/redhat-release ]; then
    OS="rhel"
  elif [[ "\$OSTYPE" == "darwin"* ]]; then
    OS="macos"
  else
    OS="unknown"
  fi
  echo "  OS: \$OS"

  # Detect Docker
  if command -v docker &>/dev/null && docker info &>/dev/null; then
    HAS_DOCKER=true
    echo "  Docker: detected"
  else
    echo "  Docker: not detected"
  fi

  # Auto-detect internal network — if we can reach 10.10.1.21:4318 directly,
  # use it instead of the external URL (avoids hairpin NAT issues)
  if [[ "\$SRE_INGEST_URL" == "${INGEST_URL}" ]]; then
    if curl -so /dev/null --connect-timeout 2 http://10.10.1.21:4318/v1/metrics 2>/dev/null; then
      SRE_INGEST_URL="http://10.10.1.21:4318"
      echo "  Network: internal (using direct LGTM endpoint)"
    else
      echo "  Network: external"
    fi
  fi
}

# ── Check eBPF compatibility ──
check_ebpf_compat() {
  if [[ "\$INSTALL_BEYLA" != "true" ]]; then
    echo "  eBPF: skipped (--no-ebpf flag)"
    return 0
  fi

  if [[ "\$OS" == "macos" ]]; then
    INSTALL_BEYLA=false
    echo "  eBPF: skipped (macOS not supported)"
    return 0
  fi

  # Check kernel >= 5.8
  KERN_VER=\$(uname -r | grep -oE '^[0-9]+\\.[0-9]+')
  KERN_MAJOR=\$(echo "\$KERN_VER" | cut -d. -f1)
  KERN_MINOR=\$(echo "\$KERN_VER" | cut -d. -f2)
  if [[ "\$KERN_MAJOR" -lt 5 ]] || [[ "\$KERN_MAJOR" -eq 5 && "\$KERN_MINOR" -lt 8 ]]; then
    INSTALL_BEYLA=false
    echo "  eBPF: WARNING — kernel \$KERN_VER < 5.8, Beyla requires 5.8+. Skipping."
    return 0
  fi

  # Check BTF support
  if [[ ! -f /sys/kernel/btf/vmlinux ]]; then
    INSTALL_BEYLA=false
    echo "  eBPF: WARNING — BTF not available (/sys/kernel/btf/vmlinux missing). Skipping."
    return 0
  fi

  echo "  eBPF: compatible (kernel \$KERN_VER, BTF available)"
}

# ── Install Alloy ──
install_alloy() {
  if command -v alloy &>/dev/null; then
    echo "  Alloy already installed"
    return 0
  fi

  echo "  Installing Grafana Alloy..."
  case "\$OS" in
    ubuntu|debian|pop)
      sudo mkdir -p /etc/apt/keyrings
      curl -sSL https://apt.grafana.com/gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/grafana.gpg 2>/dev/null
      echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" | sudo tee /etc/apt/sources.list.d/grafana.list >/dev/null
      sudo apt-get update -qq && sudo apt-get install -y -qq alloy >/dev/null
      ;;
    centos|rhel|fedora|rocky|alma)
      sudo tee /etc/yum.repos.d/grafana.repo >/dev/null <<YUMEOF
[grafana]
name=Grafana OSS
baseurl=https://rpm.grafana.com
gpgcheck=1
gpgkey=https://rpm.grafana.com/gpg.key
enabled=1
YUMEOF
      sudo yum install -y alloy >/dev/null 2>&1 || sudo dnf install -y alloy >/dev/null 2>&1
      ;;
    macos)
      if command -v brew &>/dev/null; then
        brew install grafana/grafana/alloy 2>/dev/null
      else
        echo "  ERROR: Homebrew required. Install from https://brew.sh"
        exit 1
      fi
      ;;
    *)
      echo "  ERROR: Unsupported OS. Install Alloy manually: https://grafana.com/docs/alloy/latest/"
      exit 1
      ;;
  esac
  echo "  Alloy installed"
}

# ── Install Beyla ──
install_beyla() {
  if [[ "\$INSTALL_BEYLA" != "true" ]]; then
    return 0
  fi

  if command -v beyla &>/dev/null; then
    echo "  Beyla already installed"
    return 0
  fi

  echo "  Installing Grafana Beyla..."
  case "\$OS" in
    ubuntu|debian|pop)
      sudo apt-get install -y -qq beyla >/dev/null
      ;;
    centos|rhel|fedora|rocky|alma)
      sudo yum install -y beyla >/dev/null 2>&1 || sudo dnf install -y beyla >/dev/null 2>&1
      ;;
    *)
      echo "  WARNING: Cannot install Beyla on this OS. Skipping."
      INSTALL_BEYLA=false
      return 0
      ;;
  esac
  echo "  Beyla installed"
}

# ── Setup Docker integration (Docker API-based, no root, no restart) ──
setup_docker() {
  if [[ "\$HAS_DOCKER" != "true" ]]; then
    return 0
  fi

  echo "  Configuring Docker log collection..."

  # Add alloy user to docker group for Docker socket access (read-only API)
  sudo usermod -aG docker alloy 2>/dev/null || true
  echo "    Added alloy to docker group"

  # No Docker daemon changes needed — reads logs via Docker API
  # Works with any log driver (json-file, journald, local, etc.)
  # Zero downtime, zero container restarts
}

# ── Write config ──
write_config() {
  echo "  Writing config..."
  sudo mkdir -p /etc/alloy
  sudo chown -R alloy:alloy /var/lib/alloy 2>/dev/null || true

  # ── Base config (system metrics + system logs + OTLP receiver) ──
  sudo tee /etc/alloy/config.alloy >/dev/null <<'ALLOYEOF'
// SREonCall Agent — auto-configured
// Collects: system metrics, system logs, app telemetry (OTLP), Docker container logs

// ── OTLP exporter (all signals) ──
otelcol.exporter.otlphttp "sreoncall" {
  client {
    endpoint = "SREONCALL_INGEST_URL"
    headers  = {
      "X-Scope-OrgID" = "SREONCALL_TENANT_ID",
      "Authorization"  = "Bearer SREONCALL_TOKEN",
    }
  }
}

// ── System Metrics ──
prometheus.exporter.unix "system" { }
prometheus.scrape "node" {
  targets         = prometheus.exporter.unix.system.targets
  forward_to      = [otelcol.receiver.prometheus.default.receiver]
  scrape_interval = "15s"
}
otelcol.receiver.prometheus "default" {
  output { metrics = [otelcol.processor.batch.default.input] }
}

// ── System Logs ──
local.file_match "syslogs" {
  path_targets = [
    { __path__ = "/var/log/syslog",      job = "syslog" },
    { __path__ = "/var/log/messages",     job = "syslog" },
    { __path__ = "/var/log/auth.log",     job = "authlog" },
    { __path__ = "/var/log/secure",       job = "authlog" },
    { __path__ = "/var/log/kern.log",     job = "kernlog" },
    { __path__ = "/var/log/nginx/*.log",  job = "nginx" },
    { __path__ = "/var/log/apache2/*.log", job = "apache" },
    { __path__ = "/var/log/httpd/*.log",  job = "apache" },
  ]
}
loki.source.file "syslogs" {
  targets    = local.file_match.syslogs.targets
  forward_to = [otelcol.receiver.loki.default.receiver]
}
otelcol.receiver.loki "default" {
  output { logs = [otelcol.processor.batch.default.input] }
}

// ── App Telemetry (OTLP receiver for OTel-instrumented services) ──
otelcol.receiver.otlp "default" {
  grpc { endpoint = "0.0.0.0:4317" }
  http { endpoint = "0.0.0.0:4318" }
  output {
    metrics = [otelcol.processor.batch.default.input]
    logs    = [otelcol.processor.batch.default.input]
    traces  = [otelcol.processor.batch.default.input]
  }
}

// ── Continuous Profiling via eBPF → Pyroscope ──
pyroscope.ebpf "default" {
  forward_to   = [pyroscope.write.sreoncall.receiver]
  targets_only = false
}

pyroscope.write "sreoncall" {
  endpoint {
    url = "SREONCALL_INGEST_URL/v1/pyroscope"
    headers = {
      "X-Scope-OrgID" = "SREONCALL_TENANT_ID",
      "Authorization"  = "Bearer SREONCALL_TOKEN",
    }
  }
}

// ── Batch processor + export ──
otelcol.processor.batch "default" {
  timeout = "5s"
  send_batch_size = 1024
  output {
    metrics = [otelcol.exporter.otlphttp.sreoncall.input]
    logs    = [otelcol.exporter.otlphttp.sreoncall.input]
    traces  = [otelcol.exporter.otlphttp.sreoncall.input]
  }
}
ALLOYEOF

  # ── Append Docker log collection if Docker is detected ──
  if [[ "\$HAS_DOCKER" == "true" ]]; then
    sudo tee -a /etc/alloy/config.alloy >/dev/null <<'DOCKEREOF'

// ── Docker Container Logs (via Docker API — no root, no daemon changes) ──
// Reads logs through the Docker socket. Works with any log driver.
// Zero downtime — no container or Docker restarts required.
discovery.docker "containers" {
  host = "unix:///var/run/docker.sock"
}
discovery.relabel "docker" {
  targets = discovery.docker.containers.targets
  rule {
    source_labels = ["__meta_docker_container_name"]
    target_label  = "container"
  }
  rule {
    source_labels = ["__meta_docker_container_name"]
    regex         = "/?[a-z]+-(.+)-[0-9]+"
    target_label  = "service_name"
    replacement   = "\${1}"
  }
  rule {
    replacement  = "docker"
    target_label = "job"
  }
}
loki.source.docker "containers" {
  host    = "unix:///var/run/docker.sock"
  targets = discovery.relabel.docker.output
  forward_to = [loki.process.docker_level.receiver]
}
loki.process "docker_level" {
  stage.regex {
    expression = "(?i)\\\\s(?P<level>ERROR|WARN|INFO|DEBUG|TRACE|FATAL)\\\\s"
  }
  stage.regex {
    expression = "trace_id=(?P<trace_id>[a-f0-9]{16,32})"
  }
  stage.labels {
    values = { "level" = "", "trace_id" = "" }
  }
  forward_to = [otelcol.receiver.loki.docker.receiver]
}
otelcol.receiver.loki "docker" {
  output { logs = [otelcol.processor.batch.default.input] }
}
DOCKEREOF
    echo "    Docker log collection configured (Docker API-based, zero downtime)"
  fi

  sudo sed -i "s|SREONCALL_TENANT_ID|\$SRE_TENANT_ID|g" /etc/alloy/config.alloy
  sudo sed -i "s|SREONCALL_INGEST_URL|\$SRE_INGEST_URL|g" /etc/alloy/config.alloy
  sudo sed -i "s|SREONCALL_TOKEN|\$SRE_TOKEN|g" /etc/alloy/config.alloy
  echo "  Config written to /etc/alloy/config.alloy"
}

# ── Write Beyla config ──
write_beyla_config() {
  if [[ "\$INSTALL_BEYLA" != "true" ]]; then
    return 0
  fi

  echo "  Writing Beyla config..."
  sudo mkdir -p /etc/beyla
  sudo tee /etc/beyla/config.yml >/dev/null <<'BEYLAEOF'
otel_metrics_export:
  endpoint: http://localhost:4317
  interval: 15s
otel_traces_export:
  endpoint: http://localhost:4317
discovery:
  services:
    - open_ports: 80,443,3000,5000,8000,8080,8443,9090
routes:
  unmatch: heuristic
attributes:
  kubernetes:
    enable: false
BEYLAEOF
  echo "  Beyla config written to /etc/beyla/config.yml"
}

# ── Start ──
start_service() {
  echo "  Starting agent..."
  if [[ "\$OS" == "macos" ]]; then
    brew services start grafana/grafana/alloy 2>/dev/null || true
  else
    sudo systemctl daemon-reload
    sudo systemctl enable alloy >/dev/null 2>&1
    sudo systemctl restart alloy
  fi

  sleep 2
  if command -v systemctl &>/dev/null && systemctl is-active alloy >/dev/null 2>&1; then
    echo ""
    echo "  SREonCall agent is running!"
    echo "  Metrics and logs will appear within 30 seconds."
    if [[ "\$INSTALL_BEYLA" == "true" ]]; then
      echo "  eBPF auto-instrumentation active — HTTP/gRPC metrics and traces collected."
    fi
    if [[ "\$HAS_DOCKER" == "true" ]]; then
      echo "  Docker detected — container logs collected via Docker API."
      echo "  No container restarts needed."
    fi
    echo ""
  elif [[ "\$OS" == "macos" ]]; then
    echo ""
    echo "  SREonCall agent started (macOS)."
    echo ""
  else
    echo ""
    echo "  WARNING: Agent may not have started. Check: sudo journalctl -u alloy -f"
    echo ""
  fi
}

# ── Start Beyla ──
start_beyla() {
  if [[ "\$INSTALL_BEYLA" != "true" ]]; then
    return 0
  fi

  echo "  Starting Beyla..."

  # Create systemd unit if it doesn't exist
  if [[ ! -f /etc/systemd/system/beyla.service ]]; then
    sudo tee /etc/systemd/system/beyla.service >/dev/null <<'BEYLAUNITEOF'
[Unit]
Description=Grafana Beyla eBPF Auto-Instrumentation
After=network-online.target alloy.service
Wants=network-online.target
Requires=alloy.service

[Service]
ExecStart=/usr/bin/beyla --config /etc/beyla/config.yml
Restart=on-failure
RestartSec=10
User=root

[Install]
WantedBy=multi-user.target
BEYLAUNITEOF
  fi

  sudo systemctl daemon-reload
  sudo systemctl enable beyla >/dev/null 2>&1
  sudo systemctl restart beyla

  sleep 2
  if systemctl is-active beyla >/dev/null 2>&1; then
    echo "  Beyla is running"
  else
    echo "  WARNING: Beyla may not have started. Check: sudo journalctl -u beyla -f"
  fi
}

detect_os
check_ebpf_compat
install_alloy
install_beyla
setup_docker
write_config
write_beyla_config
start_service
start_beyla`;

  function handleCopy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    toast.success(`${label} copied`);
    setTimeout(() => setCopied(null), 2000);
  }

  function handleDownloadScript() {
    const blob = new Blob([SETUP_SCRIPT], { type: 'text/x-shellscript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sreoncall-install.sh';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Downloaded sreoncall-install.sh');
  }

  async function handleCreateConnection() {
    try {
      if (selectedMode === 'managed') {
        await createConnection.mutateAsync({ name: 'Managed LGTM', mode: 'managed' });
      } else if (selectedMode === 'byos') {
        await createConnection.mutateAsync({
          name: byosName || 'BYOS Connection',
          mode: 'byos',
          endpoints: { metrics_url: byosMetrics, logs_url: byosLogs, traces_url: byosTraces },
        });
      } else {
        await createConnection.mutateAsync({
          name: tpName || `${tpVendor.charAt(0).toUpperCase() + tpVendor.slice(1)} Integration`,
          mode: 'third_party',
          vendor: tpVendor,
        });
      }
      toast.success('Connection created');
    } catch {
      toast.error('Failed to create connection');
    }
  }

  async function handleCreateToken() {
    if (!newTokenName.trim()) return;
    try {
      // Auto-create a managed connection if none exists yet
      if (connections.length === 0) {
        await createConnection.mutateAsync({ name: 'Managed LGTM', mode: 'managed' });
      }

      const result = await createToken.mutateAsync({
        name: newTokenName,
        scopes: ['metrics:write', 'logs:write', 'traces:write'],
      });
      const token = (result as any).data?.token ?? null;
      setCreatedToken(token);
      setSelectedTokenForInstall(token);
      setNewTokenName('');
      setShowNewToken(false);
      toast.success('Ingestion token created');
    } catch {
      toast.error('Failed to create ingestion token');
    }
  }

  return (
    <div className="space-y-10 px-6 py-10 lg:px-8 max-w-[1400px] mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Connect Your Stack</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Choose how observability data reaches SREonCall — modes can be combined
        </p>
      </div>

      {/* LGTM Health Status */}
      {lgtmHealth && (
        <div className={cn(
          'flex items-center gap-4 rounded-xl border px-5 py-4',
          lgtmHealth.status === 'ok'
            ? 'border-emerald-500/20 bg-emerald-500/5'
            : 'border-red-500/20 bg-red-500/5',
        )}>
          <span className={cn(
            'h-2.5 w-2.5 rounded-full shrink-0',
            lgtmHealth.status === 'ok'
              ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,163,74,0.5)]'
              : 'bg-red-500 shadow-[0_0_6px_rgba(220,38,38,0.5)]',
          )} />
          <span className="text-[13px] font-semibold text-foreground">
            Central LGTM Stack: {lgtmHealth.status === 'ok' ? 'All Healthy' : 'Degraded'}
          </span>
          <div className="flex items-center gap-4 ml-auto text-[11px] text-muted-foreground">
            {Object.entries(lgtmHealth.services).map(([name, svc]) => (
              <span key={name} className="flex items-center gap-1.5">
                <span className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  svc.status === 'ok' ? 'bg-emerald-500' : 'bg-red-500',
                )} />
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Cloud Quick Start */}
      <div>
        <div className="mb-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">Cloud Providers</h2>
          <p className="text-sm text-foreground/80 mt-1.5">
            Connect your cloud account in minutes with a guided wizard
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CLOUD_PROVIDERS.map((cp) => (
            <button
              key={cp.id}
              onClick={() => setCloudWizardProvider(cp.id)}
              className="group text-left rounded-xl border border-border bg-card p-5 transition-all hover:border-[#FF6B2B]/40 hover:bg-[#FF6B2B]/5 hover:shadow-[0_2px_12px_rgba(255,107,43,0.08)]"
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-lg shrink-0"
                  style={{ backgroundColor: `${cp.color}15` }}
                >
                  <Cloud className="h-5 w-5" style={{ color: cp.color }} />
                </div>
                <span className="text-sm font-semibold text-foreground">{cp.name}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mb-4 min-h-[2.5rem]">{cp.description}</p>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#FF6B2B] group-hover:gap-2.5 transition-all">
                Connect <ChevronRight className="h-3.5 w-3.5" />
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* PaaS & Third-Party Platforms */}
      <div>
        <div className="mb-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">PaaS &amp; Third-Party Platforms</h2>
          <p className="text-sm text-foreground/80 mt-1.5">
            Discover apps, dynos, and managed services from PaaS providers
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PAAS_PROVIDERS.map((cp) => (
            <button
              key={cp.id}
              onClick={() => setCloudWizardProvider(cp.id)}
              className="group text-left rounded-xl border border-border bg-card p-5 transition-all hover:border-[#FF6B2B]/40 hover:bg-[#FF6B2B]/5 hover:shadow-[0_2px_12px_rgba(255,107,43,0.08)]"
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-lg shrink-0"
                  style={{ backgroundColor: `${cp.color}15` }}
                >
                  <Cloud className="h-5 w-5" style={{ color: cp.color }} />
                </div>
                <span className="text-sm font-semibold text-foreground">{cp.name}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mb-4 min-h-[2.5rem]">{cp.description}</p>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#FF6B2B] group-hover:gap-2.5 transition-all">
                Connect <ChevronRight className="h-3.5 w-3.5" />
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Cloud Wizard Modal */}
      {cloudWizardProvider && (
        <CloudWizardModal
          provider={cloudWizardProvider}
          createConnection={createConnection}
          onClose={() => setCloudWizardProvider(null)}
        />
      )}

      {/* Mode selection */}
      <div>
        <div className="mb-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">Ingestion Mode</h2>
          <p className="text-sm text-foreground/80 mt-1.5">
            How telemetry is collected and stored — modes can be combined per host
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {MODES.map((mode) => {
            const Icon = mode.icon;
            const isSelected = selectedMode === mode.id;
            return (
              <button
                key={mode.id}
                onClick={() => setSelectedMode(mode.id)}
                className={cn(
                  'text-left rounded-xl border p-5 transition-all',
                  isSelected
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/20 shadow-[0_2px_12px_rgba(255,107,43,0.08)]'
                    : 'border-border bg-card hover:border-muted-foreground/30',
                )}
              >
                <div className="flex items-center gap-3 mb-3">
                  <Icon className={cn('h-5 w-5 shrink-0', isSelected ? 'text-primary' : 'text-muted-foreground')} />
                  <span className="text-sm font-semibold text-foreground">{mode.title}</span>
                  {isSelected && (
                    <span className="ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                      <Check className="h-3 w-3 text-white" />
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed mb-4 min-h-[2.5rem]">{mode.description}</p>
                <div className="flex flex-wrap gap-1.5">
                  {mode.tags.map((tag) => (
                    <span key={tag} className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {tag}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ═══ Managed LGTM: Agent Install ═══ */}
      {selectedMode === 'managed' && (
        <>
          {/* Step 1: API Key */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-white text-[11px] font-bold mt-0.5">1</span>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-foreground">Create an Ingestion Token</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Create an ingestion token to authenticate your agent. Each host uses this token to push metrics, logs, and traces.
                  </p>

                  {/* Existing tokens */}
                  {activeTokens.length > 0 && !createdToken && (
                    <div className="mt-4 space-y-3">
                      {activeTokens.map((tok) => (
                        <div
                          key={tok.id}
                          className={cn(
                            'flex items-center gap-3 w-full rounded-lg border p-3 text-left transition-colors',
                            'border-border',
                          )}
                        >
                          <Key className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-foreground">{tok.name}</div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">{tok.scopes.join(', ')}</div>
                          </div>
                          <span className="text-[10px] text-muted-foreground">sre_ingest_...{tok.id.slice(-6)}</span>
                        </div>
                      ))}
                      <p className="text-[10px] text-muted-foreground">
                        Existing tokens can&apos;t be revealed. Create a new one to use in the install command.
                      </p>
                    </div>
                  )}

                  {/* Created token display */}
                  {createdToken && (
                    <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Check className="h-4 w-4 text-[#16A34A]" />
                        <span className="text-xs font-bold text-[#16A34A]">Ingestion token created — it&apos;s embedded in the install commands below</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-[11px] font-mono text-foreground bg-muted px-2.5 py-1.5 rounded break-all select-all">
                          {createdToken}
                        </code>
                        <Button variant="outline" size="sm" className="shrink-0 h-7" onClick={() => handleCopy(createdToken, 'Ingestion token')}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                      <p className="text-[10px] text-[#A16207] mt-2">Save this — it won&apos;t be shown again.</p>
                    </div>
                  )}

                  {/* Create new token */}
                  {!createdToken && (
                    <div className="mt-4">
                      {showNewToken ? (
                        <div className="flex items-center gap-2">
                          <input
                            value={newTokenName}
                            onChange={(e) => setNewTokenName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleCreateToken()}
                            placeholder="Token name (e.g., production-vm, staging-cluster)"
                            className="flex-1 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
                            autoFocus
                          />
                          <Button size="sm" onClick={handleCreateToken} disabled={createToken.isPending || !newTokenName.trim()}>
                            {createToken.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Create'}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setShowNewToken(false)}>Cancel</Button>
                        </div>
                      ) : (
                        <Button onClick={() => setShowNewToken(true)}>
                          <Key className="h-4 w-4 mr-2" /> Create Ingestion Token
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Step 2: Choose Platform + Install Command */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-start gap-3">
                <span className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold mt-0.5',
                  hasApiKey ? 'bg-primary text-white' : 'bg-border text-muted-foreground',
                )}>2</span>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-foreground">Install the agent</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Choose your platform and run the command. The agent collects CPU, memory, disk, network metrics + system logs + OTLP traces.
                  </p>

                  {/* Platform tabs */}
                  <div className="mt-4 flex items-center gap-1.5">
                    {PLATFORMS.map((p) => {
                      const Icon = p.icon;
                      return (
                        <button
                          key={p.id}
                          onClick={() => setPlatform(p.id)}
                          className={cn(
                            'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                            platform === p.id
                              ? 'bg-primary/10 text-primary border border-primary/20'
                              : 'text-muted-foreground hover:bg-muted/50 border border-transparent',
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {p.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Platform description */}
                  <div className="mt-1.5 text-[11px] text-muted-foreground">
                    {PLATFORMS.find((p) => p.id === platform)?.description}
                  </div>

                  {/* Install command */}
                  <div className="mt-4">
                    {!hasApiKey && (
                      <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2.5 mb-3">
                        <span className="text-[11px] text-[#A16207] font-medium">
                          Create an ingestion token above first — it will be embedded in the command automatically.
                        </span>
                      </div>
                    )}
                    <div className="rounded-lg bg-[#0d1117] border border-border p-4 overflow-x-auto">
                      <pre className="text-[12px] font-mono text-[#16A34A] leading-relaxed whitespace-pre">
{getInstallCommand(platform)}
                      </pre>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopy(getInstallCommand(platform), 'Command')}
                        disabled={!hasApiKey}
                      >
                        {copied === 'Command' ? <Check className="h-3 w-3 mr-1 text-[#16A34A]" /> : <Copy className="h-3 w-3 mr-1" />}
                        {copied === 'Command' ? 'Copied' : 'Copy Command'}
                      </Button>
                      {platform === 'linux' && (
                        <Button variant="outline" size="sm" onClick={handleDownloadScript} disabled={!hasApiKey}>
                          <Download className="h-3 w-3 mr-1" /> Download install.sh
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* What gets collected */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-start gap-3">
                <span className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold mt-0.5',
                  hasApiKey ? 'bg-primary text-white' : 'bg-border text-muted-foreground',
                )}>3</span>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-foreground">Verify data is flowing</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Once the agent is running, check each signal type to confirm data is arriving.
                  </p>
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    <a href="/observability/metrics" className="rounded-lg border border-border p-4 hover:border-primary/30 transition-colors block">
                      <div className="text-xs font-semibold text-foreground mb-1">Metrics</div>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">CPU, memory, disk, network, load average. Run <code className="text-primary">up</code> in Metrics Explorer.</p>
                    </a>
                    <a href="/observability/logs" className="rounded-lg border border-border p-4 hover:border-primary/30 transition-colors block">
                      <div className="text-xs font-semibold text-foreground mb-1">Logs</div>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">syslog, auth.log, kern.log, nginx, apache. Search in Log Viewer.</p>
                    </a>
                    <a href="/observability/traces" className="rounded-lg border border-border p-4 hover:border-primary/30 transition-colors block">
                      <div className="text-xs font-semibold text-foreground mb-1">Traces</div>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">OTLP receiver on :4317 (gRPC) and :4318 (HTTP). Instrument your app to send traces.</p>
                    </a>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* eBPF Auto-Instrumentation Status */}
          {selectedMode === 'managed' && connections.length > 0 && (
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">eBPF Auto-Instrumentation</h3>
                </div>
                <p className="text-xs text-muted-foreground mb-2 leading-relaxed">
                  Beyla automatically instruments HTTP, gRPC, SQL, Redis, and Kafka traffic using eBPF.
                  Continuous CPU profiling is also collected automatically.
                  No code changes required. Services are discovered automatically.
                </p>
                <div className="text-xs text-muted-foreground">
                  To opt out, use <code className="text-primary font-mono">--no-ebpf</code> (Linux) or{' '}
                  <code className="text-primary font-mono">beyla.enabled=false</code> (Helm).
                </div>
              </CardContent>
            </Card>
          )}

          {/* Odigos Deep Tracing */}
          {selectedMode === 'managed' && connections.length > 0 && (
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-3">
                  <Plug className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">Odigos Deep Tracing</h3>
                  <Badge variant="outline" className="text-xs">Optional</Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                  Rich application traces for Java, Python, Node.js, .NET (OTel SDK injection) and Go (eBPF).
                  Captures internal function calls, DB queries with parameters, middleware spans, and HTTP client calls.
                </p>
                <div className="grid grid-cols-5 gap-2 mb-3">
                  {['Java', 'Python', 'Node.js', '.NET', 'Go'].map((lang) => (
                    <div key={lang} className="text-center px-2 py-1.5 rounded-lg border border-border bg-muted">
                      <span className="text-xs text-foreground">{lang}</span>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {lang === 'Go' ? 'eBPF' : 'SDK'}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-border bg-[#0d1117] p-3">
                  <p className="text-[10px] text-muted-foreground mb-1">Enable with Helm:</p>
                  <code className="text-xs text-primary font-mono break-all">
                    helm upgrade sreoncall-agent sreoncall/sreoncall-agent --set odigos.enabled=true --set &quot;odigos.instrumentedNamespaces=&#123;default,production&#125;&quot;
                  </code>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">
                  Pods in instrumented namespaces will be restarted to inject the OTel agent.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Browser Monitoring (RUM) */}
          {selectedMode === 'managed' && connections.length > 0 && rumAppsSupported && (
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-3">
                  <Monitor className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">Browser Monitoring (RUM)</h3>
                  <Badge variant="outline" className="text-xs">Optional</Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                  Register external apps, generate a Faro snippet for each one, and then switch between them on the RUM page.
                  Origin enforcement is not available in this v1 flow.
                </p>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="text-[11px] text-muted-foreground">
                    {rumApps.length} registered app{rumApps.length === 1 ? '' : 's'}
                  </div>
                  <Button size="sm" onClick={() => setShowRumAppModal(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    Add Application
                  </Button>
                </div>

                {rumApps.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-4 text-center">
                    <p className="text-xs text-muted-foreground">
                      No external RUM apps registered yet. Create one to generate a tenant-scoped Faro snippet.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {rumApps.map((app) => {
                      const isSelected = selectedRumAppId === app.id;
                      return (
                        <div key={app.id} className="rounded-lg border border-border p-3">
                          <div className="flex items-center gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-semibold text-foreground">{app.display_name}</div>
                              <div className="text-[11px] text-muted-foreground font-mono">{app.slug}</div>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedRumAppId(app.id)}
                            >
                              <Copy className="h-3.5 w-3.5 mr-1.5" />
                              {isSelected ? 'Snippet Open' : 'View Snippet'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                if (confirm(`Delete RUM application "${app.display_name}"?`)) {
                                  deleteRumApplication.mutate(app.id, {
                                    onSuccess: () => {
                                      toast.success('RUM application deleted');
                                      if (selectedRumAppId === app.id) setSelectedRumAppId(null);
                                    },
                                    onError: () => toast.error('Failed to delete RUM application'),
                                  });
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-[#DC2626]" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {selectedRumAppId && (
                  <div className="mt-4 rounded-lg border border-border bg-[#0d1117] p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <p className="text-[10px] text-muted-foreground">Generated snippet</p>
                        <select
                          value={rumSnippetFramework}
                          onChange={(e) => setRumSnippetFramework(e.target.value as RUMSnippetFramework)}
                          className="rounded border border-border bg-[#111827] px-2 py-1 text-[10px] text-foreground outline-none"
                        >
                          <option value="html">HTML</option>
                          <option value="nextjs">Next.js</option>
                          <option value="react">React</option>
                          <option value="vite">Vite</option>
                        </select>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7"
                        disabled={!selectedRumSnippet?.data?.snippet}
                        onClick={() => {
                          if (selectedRumSnippet?.data?.snippet) {
                            handleCopy(selectedRumSnippet.data.snippet, 'RUM snippet');
                          }
                        }}
                      >
                        <Copy className="h-3 w-3 mr-1" />
                        Copy
                      </Button>
                    </div>
                    {rumSnippetLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <>
                        <code className="block whitespace-pre-wrap break-all text-xs text-primary font-mono">
                          {selectedRumSnippet?.data?.snippet || ''}
                        </code>
                        <p className="mt-2 text-[10px] text-muted-foreground">
                          Ingest URL: {selectedRumSnippet?.data?.ingest_url || `${INGEST_URL}/v1/faro/`}
                        </p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Target: {selectedRumSnippet?.data?.framework?.toUpperCase() || rumSnippetFramework.toUpperCase()}
                        </p>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* BYOS config */}
      {selectedMode === 'byos' && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="text-sm font-semibold text-foreground">BYOS Configuration</div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">Connection Name</label>
                <input value={byosName} onChange={(e) => setByosName(e.target.value)} placeholder="My Prometheus Stack" className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">Prometheus / Mimir Endpoint</label>
                <input value={byosMetrics} onChange={(e) => setByosMetrics(e.target.value)} placeholder="https://prometheus.yourcompany.com" className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground font-mono outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">Loki Endpoint</label>
                <input value={byosLogs} onChange={(e) => setByosLogs(e.target.value)} placeholder="https://loki.yourcompany.com" className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground font-mono outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">Tempo Endpoint (optional)</label>
                <input value={byosTraces} onChange={(e) => setByosTraces(e.target.value)} placeholder="https://tempo.yourcompany.com" className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground font-mono outline-none focus:border-primary" />
              </div>
            </div>
            <Button onClick={handleCreateConnection} disabled={createConnection.isPending}>
              {createConnection.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Save Connection
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Third-party config */}
      {selectedMode === 'third_party' && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="text-sm font-semibold text-foreground">Third-Party Integration</div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">Connection Name</label>
                <input value={tpName} onChange={(e) => setTpName(e.target.value)} placeholder="My Datadog" className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">Provider</label>
                <select value={tpVendor} onChange={(e) => setTpVendor(e.target.value)} className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground outline-none focus:border-primary">
                  <option value="datadog">Datadog</option>
                  <option value="new_relic">New Relic</option>
                  <option value="cloudwatch">CloudWatch</option>
                  <option value="splunk">Splunk</option>
                  <option value="elastic">Elastic</option>
                  <option value="gcp_monitoring">GCP Monitoring</option>
                  <option value="azure_monitor">Azure Monitor</option>
                </select>
              </div>
            </div>
            <Button onClick={handleCreateConnection} disabled={createConnection.isPending}>
              {createConnection.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Save Connection
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Existing Connections */}
      <ConnectionsList
        connections={connections}
        connsLoading={connsLoading}
        healthCheck={healthCheck}
        deleteConnection={deleteConnection}
        assetsSummaryData={assetsSummaryData}
      />

      {/* API Keys */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">
              <Key className="inline h-4 w-4 mr-1.5" />
              Ingestion Tokens
            </h3>
            <span className="text-[11px] text-muted-foreground">{activeTokens.length} active</span>
          </div>
          {tokens.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-4">
              No ingestion tokens yet. Create one in the install section above.
            </p>
          ) : (
            <div className="space-y-3">
              {tokens.map((tok) => (
                <div key={tok.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                  <Key className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-foreground">{tok.name}</span>
                    <span className="text-[10px] text-muted-foreground ml-2">
                      {tok.scopes.join(', ')}
                      {tok.revoked_at && <span className="text-[#DC2626] ml-1">REVOKED</span>}
                      {tok.last_used_at && ` \u00B7 Last used ${new Date(tok.last_used_at).toLocaleDateString()}`}
                    </span>
                  </div>
                  {!tok.revoked_at && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2"
                      onClick={() => {
                        if (confirm('Revoke this token? Agents using it will stop sending data.')) {
                          revokeToken.mutate(tok.id, { onSuccess: () => toast.success('Token revoked') });
                        }
                      }}
                    >
                      <span className="text-[10px] text-[#DC2626]">Revoke</span>
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {showRumAppModal && (
        <CreateRumApplicationModal
          onClose={() => setShowRumAppModal(false)}
          createRumApplication={createRumApplication}
          onCreated={(app) => {
            setSelectedRumAppId(app.id);
            setShowRumAppModal(false);
            toast.success('RUM application created');
          }}
        />
      )}
    </div>
  );
}

function CreateRumApplicationModal({
  onClose,
  createRumApplication,
  onCreated,
}: {
  onClose: () => void;
  createRumApplication: ReturnType<typeof useCreateRUMApplication>;
  onCreated: (app: RUMApplication) => void;
}) {
  const [slug, setSlug] = useState('');
  const [displayName, setDisplayName] = useState('');

  async function handleCreate() {
    try {
      const result = await createRumApplication.mutateAsync({
        slug: slug.trim().toLowerCase(),
        display_name: displayName.trim(),
      });
      onCreated(result.data);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create RUM application');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-semibold text-foreground">Add RUM Application</h3>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">Display Name</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Customer Storefront"
              className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">Slug</label>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="customer-storefront"
              className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground font-mono outline-none focus:border-primary"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Lowercase letters, numbers, and hyphens only.
            </p>
          </div>
          <div className="rounded-lg border border-dashed border-border p-3 text-[11px] text-muted-foreground">
            The generated snippet will identify the app with a tenant-prefixed Faro app name and send data to the shared ingest URL.
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-border">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={createRumApplication.isPending || !displayName.trim() || !slug.trim()}
          >
            {createRumApplication.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Create App
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Cloud Connect Wizard Modal ──

function getCloudAccountId(conn: ObservabilityConnection): string | null {
  const creds = (conn.config as any)?.credentials;
  if (!creds) return null;
  const provider = (conn.config as any)?.cloud_provider;
  if (provider === 'aws') return creds.account_id || creds.role_arn || null;
  if (provider === 'gcp') return creds.project_id || null;
  if (provider === 'azure') return creds.tenant_id || null;
  if (provider === 'scaleway') return creds.project_id || null;
  if (provider === 'heroku') return creds.api_key ? 'Heroku Account' : null;
  if (provider === 'digitalocean') return null;
  return null;
}

function EditConnectionModal({
  conn,
  onClose,
}: {
  conn: ObservabilityConnection;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(conn.name);
  const [metricsUrl, setMetricsUrl] = useState(conn.endpoints?.metrics_url || '');
  const [logsUrl, setLogsUrl] = useState(conn.endpoints?.logs_url || '');
  const [tracesUrl, setTracesUrl] = useState(conn.endpoints?.traces_url || '');
  const [vendor, setVendor] = useState(conn.vendor || '');
  const [labels, setLabels] = useState<Record<string, string>>(conn.default_labels || {});
  const [showMigrateModal, setShowMigrateModal] = useState(false);
  const cloudProvider = (conn.config as any)?.cloud_provider as string | undefined;

  async function handleSave() {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { name: name.trim(), default_labels: labels };
      if (conn.mode === 'byos') {
        payload.endpoints = { metrics_url: metricsUrl, logs_url: logsUrl, traces_url: tracesUrl };
      }
      if (conn.mode === 'third_party' && vendor) {
        payload.vendor = vendor;
      }
      await api.patch(`/api/v1/observability-connections/${conn.id}`, payload);
      qc.invalidateQueries({ queryKey: ['observability-connections'] });
      toast.success('Connection updated');
      onClose();
    } catch {
      toast.error('Failed to update connection');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-semibold text-foreground">Edit Connection</h3>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">Connection Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">Mode</label>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[11px]">{conn.mode}</Badge>
              {conn.vendor && <Badge variant="outline" className="text-[11px]">{conn.vendor}</Badge>}
              {(conn.config as any)?.cloud_provider && (
                <Badge variant="outline" className="text-[11px]">{(conn.config as any).cloud_provider}</Badge>
              )}
            </div>
          </div>

          {conn.mode === 'byos' && (
            <>
              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">Prometheus / Mimir Endpoint</label>
                <input
                  value={metricsUrl}
                  onChange={(e) => setMetricsUrl(e.target.value)}
                  placeholder="https://prometheus.yourcompany.com"
                  className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground font-mono outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">Loki Endpoint</label>
                <input
                  value={logsUrl}
                  onChange={(e) => setLogsUrl(e.target.value)}
                  placeholder="https://loki.yourcompany.com"
                  className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground font-mono outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">Tempo Endpoint (optional)</label>
                <input
                  value={tracesUrl}
                  onChange={(e) => setTracesUrl(e.target.value)}
                  placeholder="https://tempo.yourcompany.com"
                  className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground font-mono outline-none focus:border-primary"
                />
              </div>
            </>
          )}

          {conn.mode === 'third_party' && !(conn.config as any)?.cloud_provider && (
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">Provider</label>
              <select
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
              >
                <option value="datadog">Datadog</option>
                <option value="new_relic">New Relic</option>
                <option value="cloudwatch">CloudWatch</option>
                <option value="splunk">Splunk</option>
                <option value="elastic">Elastic</option>
                <option value="gcp_monitoring">GCP Monitoring</option>
                <option value="azure_monitor">Azure Monitor</option>
                <option value="scaleway">Scaleway</option>
                <option value="digitalocean">DigitalOcean</option>
                <option value="heroku">Heroku</option>
                <option value="supabase">Supabase</option>
                <option value="vercel">Vercel</option>
              </select>
            </div>
          )}

          {conn.status && (
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">Status</label>
              <div className="flex items-center gap-2">
                <span className={cn(
                  'h-2 w-2 rounded-full',
                  conn.status === 'connected' ? 'bg-emerald-500' : conn.status === 'error' ? 'bg-red-500' : 'bg-yellow-500',
                )} />
                <span className="text-xs text-foreground">{conn.status}</span>
                {conn.health_check_message && (
                  <span className="text-[11px] text-muted-foreground">— {conn.health_check_message}</span>
                )}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border p-3">
            <LabelsEditor value={labels} onChange={setLabels} disabled={saving} />
          </div>

          {cloudProvider === 'heroku' && (
            <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
              <div>
                <div className="text-xs font-semibold text-foreground">Drain URL migration</div>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                  Rewrite legacy shared drain URLs to per-app URLs so every Heroku
                  app surfaces as its own <code className="text-primary">service_name</code>.
                  Previews first; foreign drains (Papertrail, Datadog, etc.) are never touched.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setShowMigrateModal(true)}
              >
                Migrate drain URLs
              </Button>
            </div>
          )}
        </div>

        {showMigrateModal && (
          <HerokuDrainMigrateModal
            connectionId={conn.id}
            connectionName={conn.name}
            onClose={() => setShowMigrateModal(false)}
          />
        )}

        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-border">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}

function ConnectionsList({
  connections,
  connsLoading,
  healthCheck,
  deleteConnection,
  assetsSummaryData,
}: {
  connections: ObservabilityConnection[];
  connsLoading: boolean;
  healthCheck: ReturnType<typeof useHealthCheckConnection>;
  deleteConnection: ReturnType<typeof useDeleteConnection>;
  assetsSummaryData: AssetsSummary | undefined;
}) {
  const [editingConn, setEditingConn] = useState<ObservabilityConnection | null>(null);

  return (
    <>
      {editingConn && (
        <EditConnectionModal conn={editingConn} onClose={() => setEditingConn(null)} />
      )}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-sm font-semibold text-foreground">Active Connections</h3>
            <span className="text-[11px] font-medium text-muted-foreground">{connections.length} total</span>
          </div>
          {connsLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : connections.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-10">
              No connections yet. Install the agent on a host to get started.
            </p>
          ) : (
            <div className="space-y-2.5">
              {connections.map((conn) => {
                const cloudId = getCloudAccountId(conn);
                const provider = (conn.config as any)?.cloud_provider as string | undefined;
                return (
                  <div key={conn.id} className="flex items-center gap-4 rounded-lg border border-border p-4 transition-colors hover:bg-muted/30">
                    <span className={cn(
                      'h-2.5 w-2.5 rounded-full shrink-0',
                      conn.status === 'connected' ? 'bg-emerald-500' : conn.status === 'error' ? 'bg-red-500' : 'bg-yellow-500',
                    )} />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold text-foreground">{conn.name}</span>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {conn.mode} {conn.vendor ? `\u00B7 ${conn.vendor}` : ''} &middot; {conn.status}
                        {cloudId && (
                          <span className="font-mono"> &middot; {cloudId}</span>
                        )}
                        {conn.health_check_message ? ` \u00B7 ${conn.health_check_message}` : ''}
                        {assetsSummaryData && provider && (assetsSummaryData.provider_counts?.[provider] ?? 0) > 0
                          ? ` \u00B7 ${assetsSummaryData.provider_counts[provider]} resources`
                          : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingConn(conn)}
                        title="Edit connection"
                      >
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => healthCheck.mutate(conn.id, {
                          onSuccess: () => toast.success('Health check completed'),
                          onError: () => toast.error('Health check failed'),
                        })}
                        disabled={healthCheck.isPending}
                        title="Health check"
                      >
                        <RefreshCw className={cn('h-3.5 w-3.5 text-muted-foreground', healthCheck.isPending && 'animate-spin')} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (confirm('Delete this connection and all its discovered resources?')) {
                            deleteConnection.mutate(conn.id, {
                              onSuccess: () => toast.success('Connection deleted'),
                            });
                          }
                        }}
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-[#DC2626]" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function CloudWizardModal({
  provider,
  createConnection,
  onClose,
}: {
  provider: CloudProvider;
  createConnection: ReturnType<typeof useCreateConnection>;
  onClose: () => void;
}) {
  const [step, setStep] = useState(1);
  const [success, setSuccess] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState<{
    services: { service_type: string; display_name: string; count: number; details: string }[];
    asset_count: number;
    recommended_alerts: string[];
    recommended_dashboards: string[];
  } | null>(null);

  // Step 1: Auth fields
  const [awsAuthMode, setAwsAuthMode] = useState<'role' | 'keys'>('role');
  const [roleArn, setRoleArn] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [awsRegion, setAwsRegion] = useState('us-east-1');
  const [gcpProjectId, setGcpProjectId] = useState('');
  const [gcpServiceAccountJson, setGcpServiceAccountJson] = useState('');
  const [azureTenantId, setAzureTenantId] = useState('');
  const [azureClientId, setAzureClientId] = useState('');
  const [azureClientSecret, setAzureClientSecret] = useState('');
  const [azureSubscriptionId, setAzureSubscriptionId] = useState('');
  const [scwSecretKey, setScwSecretKey] = useState('');
  const [scwProjectId, setScwProjectId] = useState('');
  const [scwRegion, setScwRegion] = useState('fr-par');
  const [doApiToken, setDoApiToken] = useState('');
  const [doSpacesKey, setDoSpacesKey] = useState('');
  const [doSpacesSecret, setDoSpacesSecret] = useState('');
  const [doSpacesRegion, setDoSpacesRegion] = useState('nyc3');
  const [herokuApiKey, setHerokuApiKey] = useState('');
  const [supabaseAccessToken, setSupabaseAccessToken] = useState('');
  const [vercelApiToken, setVercelApiToken] = useState('');
  const [vercelTeamId, setVercelTeamId] = useState('');

  const [validatingCreds, setValidatingCreds] = useState(false);

  // Step 2: Config
  const [connectionName, setConnectionName] = useState('');
  const [pollingInterval, setPollingInterval] = useState('5m');
  const [autoAlerts, setAutoAlerts] = useState(true);
  const [autoDashboards, setAutoDashboards] = useState(true);
  const [defaultLabels, setDefaultLabels] = useState<Record<string, string>>({});

  const cp = CLOUD_PROVIDERS.find((c) => c.id === provider) || PAAS_PROVIDERS.find((c) => c.id === provider)!;
  const recs = PROVIDER_RECOMMENDATIONS[provider];

  const { data: dialogSession } = useSession();
  const dialogTenantId = (dialogSession?.user as any)?.tenantId || '<TENANT_ID>';
  const drainToken = useMemo(
    () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10),
    [],
  );
  const ingestHost =
    typeof window !== 'undefined' && window.location.hostname.startsWith('dev-web.')
      ? window.location.origin.replace('dev-web.', 'dev-ingest.')
      : 'https://ingest.sreoncall.com';
  const vercelDrainUrl = `${ingestHost}/api/v1/webhooks/vercel/logs/${dialogTenantId}/${drainToken}`;
  const supabaseDrainUrl = `${ingestHost}/api/v1/webhooks/supabase/logs/${dialogTenantId}/${drainToken}`;

  function isStep1Valid(): boolean {
    if (provider === 'aws') {
      return awsAuthMode === 'role' ? roleArn.trim().length > 0 : accessKeyId.trim().length > 0 && secretAccessKey.trim().length > 0;
    }
    if (provider === 'gcp') {
      return gcpProjectId.trim().length > 0 || gcpServiceAccountJson.trim().length > 0;
    }
    if (provider === 'scaleway') {
      return scwSecretKey.trim().length > 0 && scwProjectId.trim().length > 0;
    }
    if (provider === 'digitalocean') {
      return doApiToken.trim().length > 0;
    }
    if (provider === 'heroku') {
      return herokuApiKey.trim().length > 0;
    }
    if (provider === 'supabase') {
      return supabaseAccessToken.trim().length > 0;
    }
    if (provider === 'vercel') {
      return vercelApiToken.trim().length > 0;
    }
    return (
      azureTenantId.trim().length > 0 &&
      azureClientId.trim().length > 0 &&
      azureClientSecret.trim().length > 0 &&
      azureSubscriptionId.trim().length > 0
    );
  }

  async function handleConnect() {
    try {
      // Build credentials config based on provider
      const credentials: Record<string, string> = {};
      if (provider === 'aws') {
        if (awsAuthMode === 'keys') {
          credentials.access_key_id = accessKeyId;
          credentials.secret_access_key = secretAccessKey;
        } else {
          credentials.role_arn = roleArn;
        }
        credentials.region = awsRegion;
      } else if (provider === 'gcp') {
        if (gcpProjectId) credentials.project_id = gcpProjectId;
        if (gcpServiceAccountJson) credentials.service_account_json = gcpServiceAccountJson;
      } else if (provider === 'scaleway') {
        credentials.secret_key = scwSecretKey;
        credentials.project_id = scwProjectId;
        credentials.region = scwRegion;
      } else if (provider === 'digitalocean') {
        credentials.api_token = doApiToken;
        if (doSpacesKey) credentials.spaces_key = doSpacesKey;
        if (doSpacesSecret) credentials.spaces_secret = doSpacesSecret;
        if (doSpacesKey) credentials.spaces_region = doSpacesRegion;
      } else if (provider === 'heroku') {
        credentials.api_key = herokuApiKey;
      } else if (provider === 'supabase') {
        credentials.access_token = supabaseAccessToken;
      } else if (provider === 'vercel') {
        credentials.api_token = vercelApiToken;
        if (vercelTeamId) credentials.team_id = vercelTeamId;
      } else if (provider === 'azure') {
        credentials.tenant_id = azureTenantId;
        credentials.client_id = azureClientId;
        credentials.client_secret = azureClientSecret;
        credentials.subscription_id = azureSubscriptionId;
      }

      const result: any = await createConnection.mutateAsync({
        name: connectionName.trim() || `${cp.name} Integration`,
        mode: 'third_party',
        vendor: cp.vendor,
        config: {
          cloud_provider: provider,
          credentials,
          drain_token: ['heroku', 'supabase', 'vercel'].includes(provider) ? drainToken : undefined,
          enforce_drain_token: ['heroku', 'supabase', 'vercel'].includes(provider),
          polling_interval: pollingInterval,
          auto_alerts: autoAlerts,
          auto_dashboards: autoDashboards,
        },
        default_labels: Object.keys(defaultLabels).length > 0 ? defaultLabels : undefined,
      });
      if (result?.discovery) {
        setDiscoveryResult(result.discovery);
      }
      setSuccess(true);
    } catch {
      toast.error('Failed to create connection');
    }
  }

  const inputClass = 'w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground outline-none focus:border-primary';
  const labelClass = 'text-xs font-medium uppercase tracking-wider text-muted-foreground block mb-1.5';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-lg rounded-2xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ backgroundColor: `${cp.color}15` }}
            >
              <Cloud className="h-4 w-4" style={{ color: cp.color }} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">Connect {cp.name}</h2>
              <p className="text-[11px] text-muted-foreground">
                {success ? 'Connected successfully' : `Step ${step} of 3`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-muted transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Step indicators */}
        {!success && (
          <div className="flex items-center gap-2 px-6 pt-4">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center gap-2 flex-1">
                <div
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors',
                    s < step ? 'bg-emerald-500 text-white' : s === step ? 'bg-[#FF6B2B] text-white' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {s < step ? <Check className="h-3 w-3" /> : s}
                </div>
                <span className={cn('text-[11px] font-medium', s === step ? 'text-foreground' : 'text-muted-foreground')}>
                  {s === 1 ? 'Authenticate' : s === 2 ? 'Configure' : 'Confirm'}
                </span>
                {s < 3 && <div className={cn('flex-1 h-px', s < step ? 'bg-emerald-500' : 'bg-border')} />}
              </div>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="px-6 py-5">
          {/* ── Step 1: Authenticate ── */}
          {step === 1 && !success && (
            <div className="space-y-4">
              {provider === 'aws' && (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <button
                      onClick={() => setAwsAuthMode('role')}
                      className={cn(
                        'flex-1 rounded-lg border px-3 py-2.5 text-xs font-medium transition-all text-left',
                        awsAuthMode === 'role'
                          ? 'border-[#FF6B2B]/30 bg-[#FF6B2B]/5 text-foreground'
                          : 'border-border text-muted-foreground hover:border-muted-foreground/30',
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Shield className="h-3.5 w-3.5" />
                        <span className="font-semibold">IAM Role</span>
                        <span className="ml-auto rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-[#16A34A] uppercase">Recommended</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">Cross-account role — no long-lived credentials</p>
                    </button>
                    <button
                      onClick={() => setAwsAuthMode('keys')}
                      className={cn(
                        'flex-1 rounded-lg border px-3 py-2.5 text-xs font-medium transition-all text-left',
                        awsAuthMode === 'keys'
                          ? 'border-[#FF6B2B]/30 bg-[#FF6B2B]/5 text-foreground'
                          : 'border-border text-muted-foreground hover:border-muted-foreground/30',
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Key className="h-3.5 w-3.5" />
                        <span className="font-semibold">Access Keys</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">IAM user access key and secret</p>
                    </button>
                  </div>

                  {awsAuthMode === 'role' ? (
                    <div className="space-y-3">
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Create an IAM role in your AWS account using the policy below, then set the trust relationship to allow SREonCall to assume it. Paste the resulting Role ARN here.
                      </p>

                      {/* IAM Policy snippet */}
                      <div className="rounded-lg border border-border bg-muted/30">
                        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            IAM Policy JSON
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const policy = JSON.stringify({
                                Version: '2012-10-17',
                                Statement: [
                                  {
                                    Sid: 'SREonCallReadOnly',
                                    Effect: 'Allow',
                                    Action: [
                                      'cloudwatch:Describe*',
                                      'cloudwatch:Get*',
                                      'cloudwatch:List*',
                                      'logs:Describe*',
                                      'logs:Get*',
                                      'logs:FilterLogEvents',
                                      'ec2:Describe*',
                                      'rds:Describe*',
                                      'rds:ListTagsForResource',
                                      'elasticloadbalancing:Describe*',
                                      'lambda:List*',
                                      'lambda:Get*',
                                      'eks:List*',
                                      'eks:Describe*',
                                      's3:ListAllMyBuckets',
                                      's3:GetBucketLocation',
                                      'sns:List*',
                                      'sqs:List*',
                                      'sqs:GetQueue*',
                                      'tag:GetResources',
                                    ],
                                    Resource: '*',
                                  },
                                ],
                              }, null, 2);
                              navigator.clipboard.writeText(policy);
                              toast.success('IAM policy copied');
                            }}
                            className="text-[10px] font-medium text-primary hover:underline flex items-center gap-1"
                          >
                            <Copy className="h-3 w-3" /> Copy
                          </button>
                        </div>
                        <pre className="px-3 py-2 text-[10px] font-mono text-foreground/80 overflow-x-auto max-h-[180px] overflow-y-auto leading-relaxed">{`{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "SREonCallReadOnly",
    "Effect": "Allow",
    "Action": [
      "cloudwatch:Describe*",
      "cloudwatch:Get*",
      "cloudwatch:List*",
      "logs:Describe*",
      "logs:Get*",
      "logs:FilterLogEvents",
      "ec2:Describe*",
      "rds:Describe*",
      "elasticloadbalancing:Describe*",
      "lambda:List*",
      "lambda:Get*",
      "eks:List*",
      "eks:Describe*",
      "s3:ListAllMyBuckets",
      "s3:GetBucketLocation",
      "sns:List*",
      "sqs:List*",
      "tag:GetResources"
    ],
    "Resource": "*"
  }]
}`}</pre>
                      </div>

                      {/* Trust relationship snippet */}
                      <div className="rounded-lg border border-border bg-muted/30">
                        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Trust Relationship
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const trust = JSON.stringify({
                                Version: '2012-10-17',
                                Statement: [{
                                  Effect: 'Allow',
                                  Principal: { AWS: 'arn:aws:iam::234438862968:root' },
                                  Action: 'sts:AssumeRole',
                                  Condition: {
                                    StringEquals: { 'sts:ExternalId': 'sreoncall-tenant' },
                                  },
                                }],
                              }, null, 2);
                              navigator.clipboard.writeText(trust);
                              toast.success('Trust relationship copied');
                            }}
                            className="text-[10px] font-medium text-primary hover:underline flex items-center gap-1"
                          >
                            <Copy className="h-3 w-3" /> Copy
                          </button>
                        </div>
                        <pre className="px-3 py-2 text-[10px] font-mono text-foreground/80 overflow-x-auto leading-relaxed">{`{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "AWS": "arn:aws:iam::234438862968:root" },
    "Action": "sts:AssumeRole",
    "Condition": {
      "StringEquals": { "sts:ExternalId": "sreoncall-tenant" }
    }
  }]
}`}</pre>
                      </div>

                      <div>
                        <label className={labelClass}>Role ARN</label>
                        <input
                          value={roleArn}
                          onChange={(e) => setRoleArn(e.target.value)}
                          placeholder="arn:aws:iam::123456789012:role/SREonCallReadOnly"
                          className={cn(inputClass, 'font-mono')}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <label className={labelClass}>Access Key ID</label>
                        <input
                          value={accessKeyId}
                          onChange={(e) => setAccessKeyId(e.target.value)}
                          placeholder="AKIA..."
                          className={cn(inputClass, 'font-mono')}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Secret Access Key</label>
                        <input
                          type="password"
                          value={secretAccessKey}
                          onChange={(e) => setSecretAccessKey(e.target.value)}
                          placeholder="Enter secret access key"
                          className={cn(inputClass, 'font-mono')}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Region</label>
                        <select
                          value={awsRegion}
                          onChange={(e) => setAwsRegion(e.target.value)}
                          className={inputClass}
                        >
                          {AWS_REGIONS.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </>
              )}

              {provider === 'gcp' && (
                <div className="space-y-3">
                  <div>
                    <label className={labelClass}>Project ID</label>
                    <input
                      value={gcpProjectId}
                      onChange={(e) => setGcpProjectId(e.target.value)}
                      placeholder="my-gcp-project-123"
                      className={cn(inputClass, 'font-mono')}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Service Account JSON (optional if Project ID is provided)</label>
                    <textarea
                      value={gcpServiceAccountJson}
                      onChange={(e) => setGcpServiceAccountJson(e.target.value)}
                      placeholder='{"type": "service_account", "project_id": "...", ...}'
                      rows={4}
                      className={cn(inputClass, 'font-mono resize-none')}
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Paste the contents of your service account key JSON file, or upload the file.
                    </p>
                  </div>
                </div>
              )}

              {provider === 'azure' && (
                <div className="space-y-3">
                  <div>
                    <label className={labelClass}>Tenant ID</label>
                    <input
                      value={azureTenantId}
                      onChange={(e) => setAzureTenantId(e.target.value)}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      className={cn(inputClass, 'font-mono')}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Client ID (Application ID)</label>
                    <input
                      value={azureClientId}
                      onChange={(e) => setAzureClientId(e.target.value)}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      className={cn(inputClass, 'font-mono')}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Client Secret</label>
                    <input
                      type="password"
                      value={azureClientSecret}
                      onChange={(e) => setAzureClientSecret(e.target.value)}
                      placeholder="Enter client secret"
                      className={cn(inputClass, 'font-mono')}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Subscription ID</label>
                    <input
                      value={azureSubscriptionId}
                      onChange={(e) => setAzureSubscriptionId(e.target.value)}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      className={cn(inputClass, 'font-mono')}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Create an App Registration in Azure AD with <code className="text-primary">Reader</code> (or <code className="text-primary">Monitoring Reader</code>) role on your subscription.
                  </p>
                </div>
              )}

              {provider === 'scaleway' && (
                <div className="space-y-3">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Create an IAM API key in your Scaleway console (<code className="text-primary">console.scaleway.com → IAM → API Keys</code>) with at least <code className="text-primary">read-only</code> access to the project you want to monitor.
                  </p>
                  <div>
                    <label className={labelClass}>Secret Key</label>
                    <input
                      type="password"
                      value={scwSecretKey}
                      onChange={(e) => setScwSecretKey(e.target.value)}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      className={cn(inputClass, 'font-mono')}
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">The secret key shown once at API key creation.</p>
                  </div>
                  <div>
                    <label className={labelClass}>Project ID</label>
                    <input
                      value={scwProjectId}
                      onChange={(e) => setScwProjectId(e.target.value)}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      className={cn(inputClass, 'font-mono')}
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">Found under Project Settings in the Scaleway console.</p>
                  </div>
                  <div>
                    <label className={labelClass}>Region</label>
                    <select
                      value={scwRegion}
                      onChange={(e) => setScwRegion(e.target.value)}
                      className={inputClass}
                    >
                      {SCW_REGIONS.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {provider === 'digitalocean' && (
                <div className="space-y-3">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Create a Personal Access Token in your DigitalOcean account (<code className="text-primary">API → Tokens → Generate New Token</code>) with <code className="text-primary">Read</code> scope.
                  </p>
                  <div>
                    <label className={labelClass}>API Token</label>
                    <input
                      type="password"
                      value={doApiToken}
                      onChange={(e) => setDoApiToken(e.target.value)}
                      placeholder="dop_v1_..."
                      className={cn(inputClass, 'font-mono')}
                    />
                  </div>
                  <div className="rounded-lg border border-border p-3 space-y-3">
                    <p className="text-[11px] font-medium text-foreground">Spaces (Object Storage) — Optional</p>
                    <p className="text-[10px] text-muted-foreground">Provide Spaces credentials to discover buckets. Generate a Spaces access key under <code className="text-primary">API → Spaces Keys</code>.</p>
                    <div>
                      <label className={labelClass}>Spaces Access Key</label>
                      <input
                        value={doSpacesKey}
                        onChange={(e) => setDoSpacesKey(e.target.value)}
                        placeholder="your-spaces-access-key"
                        className={cn(inputClass, 'font-mono')}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Spaces Secret Key</label>
                      <input
                        type="password"
                        value={doSpacesSecret}
                        onChange={(e) => setDoSpacesSecret(e.target.value)}
                        placeholder="Enter Spaces secret key"
                        className={cn(inputClass, 'font-mono')}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Spaces Region</label>
                      <select
                        value={doSpacesRegion}
                        onChange={(e) => setDoSpacesRegion(e.target.value)}
                        className={inputClass}
                      >
                        {['nyc3', 'sfo3', 'ams3', 'sgp1', 'fra1', 'blr1', 'tor1', 'syd1'].map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {provider === 'heroku' && (
                <div className="space-y-3">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Generate an API key in your Heroku account (<code className="text-primary">Account Settings → API Key</code>) or create an OAuth token via the CLI: <code className="text-primary">heroku authorizations:create</code>.
                  </p>
                  <div>
                    <label className={labelClass}>API Key</label>
                    <input
                      type="password"
                      value={herokuApiKey}
                      onChange={(e) => setHerokuApiKey(e.target.value)}
                      placeholder="HRKU-..."
                      className={cn(inputClass, 'font-mono')}
                    />
                  </div>
                  <div className="rounded-lg border border-dashed border-border p-3">
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      After connecting, set up a <strong>log drain</strong> to stream logs and runtime metrics to SREonCall. We will provide the drain URL after connection is established.
                    </p>
                  </div>
                </div>
              )}

              {provider === 'supabase' && (
                <div className="space-y-3">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Create a Personal Access Token in your Supabase dashboard (<code className="text-primary">Account → Access Tokens → Generate New Token</code>).
                  </p>
                  <div>
                    <label className={labelClass}>Access Token</label>
                    <input
                      type="password"
                      value={supabaseAccessToken}
                      onChange={(e) => setSupabaseAccessToken(e.target.value)}
                      placeholder="sbp_..."
                      className={cn(inputClass, 'font-mono')}
                    />
                  </div>
                  <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      <strong>Log Drain</strong> (Team / Enterprise): in your Supabase project go to <code className="text-primary">Settings → Log Drains → Add destination</code>, choose <strong>HTTP</strong>, and paste:
                    </p>
                    <div className="flex items-center gap-1">
                      <code className="flex-1 text-[10px] text-primary bg-muted px-2 py-1 rounded break-all font-mono">{supabaseDrainUrl}</code>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2"
                        onClick={() => {
                          navigator.clipboard.writeText(supabaseDrainUrl);
                          toast.success('Drain URL copied');
                        }}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {provider === 'vercel' && (
                <div className="space-y-3">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Create an Access Token in your Vercel account (<code className="text-primary">Settings → Tokens → Create Token</code>). For team projects, provide the Team ID.
                  </p>
                  <div>
                    <label className={labelClass}>API Token</label>
                    <input
                      type="password"
                      value={vercelApiToken}
                      onChange={(e) => setVercelApiToken(e.target.value)}
                      placeholder="Enter Vercel access token"
                      className={cn(inputClass, 'font-mono')}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Team ID (Optional)</label>
                    <input
                      value={vercelTeamId}
                      onChange={(e) => setVercelTeamId(e.target.value)}
                      placeholder="team_..."
                      className={cn(inputClass, 'font-mono')}
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">Required for team-owned projects. Find in Team Settings → General.</p>
                  </div>
                  <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      <strong>Log Drain</strong>: in Vercel go to <code className="text-primary">Team Settings → Log Drains → Add</code>, pick <strong>JSON</strong> or <strong>NDJSON</strong>, and paste this endpoint:
                    </p>
                    <div className="flex items-center gap-1">
                      <code className="flex-1 text-[10px] text-primary bg-muted px-2 py-1 rounded break-all font-mono">{vercelDrainUrl}</code>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2"
                        onClick={() => {
                          navigator.clipboard.writeText(vercelDrainUrl);
                          toast.success('Drain URL copied');
                        }}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Configure ── */}
          {step === 2 && !success && (
            <div className="space-y-4">
              <div>
                <label className={labelClass}>Connection Name</label>
                <input
                  value={connectionName}
                  onChange={(e) => setConnectionName(e.target.value)}
                  placeholder={`${cp.name} Integration`}
                  className={inputClass}
                />
                <p className="text-[10px] text-muted-foreground mt-1">A friendly name to identify this connection</p>
              </div>
              <div>
                <label className={labelClass}>Polling Interval</label>
                <select
                  value={pollingInterval}
                  onChange={(e) => setPollingInterval(e.target.value)}
                  className={inputClass}
                >
                  {POLLING_INTERVALS.map((pi) => (
                    <option key={pi.value} value={pi.value}>{pi.label}</option>
                  ))}
                </select>
              </div>

              <div className="rounded-lg border border-border p-3">
                <LabelsEditor value={defaultLabels} onChange={setDefaultLabels} />
              </div>

              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoAlerts}
                  onChange={(e) => setAutoAlerts(e.target.checked)}
                  className="h-4 w-4 rounded border-border accent-[#FF6B2B]"
                />
                <div>
                  <span className="text-xs font-medium text-foreground">Auto-enable recommended alerts</span>
                  <p className="text-[10px] text-muted-foreground">Pre-configured alert rules for common issues</p>
                </div>
              </label>

              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoDashboards}
                  onChange={(e) => setAutoDashboards(e.target.checked)}
                  className="h-4 w-4 rounded border-border accent-[#FF6B2B]"
                />
                <div>
                  <span className="text-xs font-medium text-foreground">Create standard dashboards</span>
                  <p className="text-[10px] text-muted-foreground">Ready-to-use dashboards for your cloud services</p>
                </div>
              </label>

              {autoAlerts && (
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[11px] font-semibold text-foreground mb-2">Recommended Alerts</div>
                  <div className="flex flex-wrap gap-1.5">
                    {recs.alerts.map((a) => (
                      <span key={a} className="rounded bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-[#DC2626]">{a}</span>
                    ))}
                  </div>
                </div>
              )}

              {autoDashboards && (
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[11px] font-semibold text-foreground mb-2">Standard Dashboards</div>
                  <div className="flex flex-wrap gap-1.5">
                    {recs.dashboards.map((d) => (
                      <span key={d} className="rounded bg-[#2563EB]/10 px-2 py-0.5 text-[10px] font-medium text-[#2563EB]">{d}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Confirm ── */}
          {step === 3 && !success && (
            <div className="space-y-4">
              <div className="text-xs font-semibold text-foreground mb-2">Connection Summary</div>
              <div className="rounded-lg border border-border divide-y divide-border">
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-[11px] text-muted-foreground">Name</span>
                  <span className="text-[11px] font-medium text-foreground">{connectionName.trim() || `${cp.name} Integration`}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-[11px] text-muted-foreground">Provider</span>
                  <span className="text-[11px] font-medium text-foreground">{cp.name}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-[11px] text-muted-foreground">Auth Method</span>
                  <span className="text-[11px] font-medium text-foreground">
                    {provider === 'aws' && (awsAuthMode === 'role' ? 'IAM Role' : 'Access Keys')}
                    {provider === 'gcp' && (gcpServiceAccountJson ? 'Service Account JSON' : 'Project ID')}
                    {provider === 'azure' && 'App Registration'}
                    {provider === 'scaleway' && `IAM API Key · ${scwRegion}`}
                    {provider === 'digitalocean' && `Personal Access Token${doSpacesKey ? ' + Spaces Key' : ''}`}
                    {provider === 'heroku' && 'API Key'}
                    {provider === 'supabase' && 'Personal Access Token'}
                    {provider === 'vercel' && `Access Token${vercelTeamId ? ' + Team ID' : ''}`}
                  </span>
                </div>
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-[11px] text-muted-foreground">Polling Interval</span>
                  <span className="text-[11px] font-medium text-foreground">
                    {POLLING_INTERVALS.find((pi) => pi.value === pollingInterval)?.label}
                  </span>
                </div>
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-[11px] text-muted-foreground">Auto Alerts</span>
                  <span className={cn('text-[11px] font-medium', autoAlerts ? 'text-[#16A34A]' : 'text-muted-foreground')}>
                    {autoAlerts ? `${recs.alerts.length} rules` : 'Disabled'}
                  </span>
                </div>
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-[11px] text-muted-foreground">Dashboards</span>
                  <span className={cn('text-[11px] font-medium', autoDashboards ? 'text-[#2563EB]' : 'text-muted-foreground')}>
                    {autoDashboards ? `${recs.dashboards.length} dashboards` : 'Disabled'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ── Success State ── */}
          {success && (
            <div className="py-4">
              <div className="flex items-center justify-center mb-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
                  <CheckCircle2 className="h-7 w-7 text-[#16A34A]" />
                </div>
              </div>
              <h3 className="text-sm font-bold text-foreground mb-1 text-center">{cp.name} Connected</h3>

              {discoveryResult && discoveryResult.asset_count > 0 ? (
                <>
                  <p className="text-xs text-muted-foreground mb-4 text-center">
                    Discovered <span className="font-semibold text-foreground">{discoveryResult.asset_count} resources</span> in your {cp.name} account:
                  </p>
                  <div className="rounded-lg border border-border divide-y divide-border mb-4 max-h-[200px] overflow-y-auto">
                    {discoveryResult.services.filter((s) => s.count > 0).map((svc) => (
                      <div key={svc.service_type} className="flex items-center justify-between px-3 py-2">
                        <span className="text-xs text-foreground">{svc.display_name}</span>
                        <span className="text-xs font-mono text-muted-foreground">{svc.details}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground mb-5 text-center">
                  Connection saved. Resources will be discovered in the next polling cycle.
                </p>
              )}

              {['heroku', 'supabase', 'vercel'].includes(provider) && (
                <div className="rounded-lg border border-dashed border-border p-3 mb-4 space-y-2">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Configure the provider log drain with this SREonCall endpoint to start ingesting tenant-scoped logs.
                  </p>
                  <div className="flex items-center gap-1">
                    <code className="flex-1 text-[10px] text-primary bg-muted px-2 py-1 rounded break-all font-mono">
                      {provider === 'heroku' ? `${ingestHost}/api/v1/webhooks/heroku/logs/${dialogTenantId}/${drainToken}/<your-app-name>` : provider === 'supabase' ? supabaseDrainUrl : vercelDrainUrl}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2"
                      onClick={() => {
                        const url = provider === 'heroku'
                          ? `${ingestHost}/api/v1/webhooks/heroku/logs/${dialogTenantId}/${drainToken}/<your-app-name>`
                          : provider === 'supabase'
                            ? supabaseDrainUrl
                            : vercelDrainUrl;
                        navigator.clipboard.writeText(url);
                        toast.success('Drain URL copied');
                      }}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-center gap-2 flex-wrap">
                <a
                  href="/observability"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF6B2B] px-3 py-2 text-xs font-semibold text-white hover:bg-[#E85D1C] transition-colors"
                >
                  View Infrastructure <ChevronRight className="h-3 w-3" />
                </a>
                <a
                  href="/services/review"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                >
                  Review Discovered Services <ChevronRight className="h-3 w-3" />
                </a>
                <a
                  href="/observability/metrics"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                >
                  Metrics Explorer <ChevronRight className="h-3 w-3" />
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!success && (
          <div className="flex items-center justify-between border-t border-border px-6 py-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => (step === 1 ? onClose() : setStep(step - 1))}
            >
              <ChevronLeft className="h-3 w-3 mr-1" />
              {step === 1 ? 'Cancel' : 'Back'}
            </Button>

            {step < 3 ? (
              <Button
                size="sm"
                onClick={async () => {
                  if (step === 1) {
                    // Validate credentials before proceeding
                    setValidatingCreds(true);
                    try {
                      const credentials: Record<string, string> = {};
                      if (provider === 'aws') {
                        if (awsAuthMode === 'keys') {
                          credentials.access_key_id = accessKeyId;
                          credentials.secret_access_key = secretAccessKey;
                        } else {
                          credentials.role_arn = roleArn;
                        }
                        credentials.region = awsRegion;
                      } else if (provider === 'gcp') {
                        if (gcpProjectId) credentials.project_id = gcpProjectId;
                        if (gcpServiceAccountJson) credentials.service_account_json = gcpServiceAccountJson;
                      } else if (provider === 'scaleway') {
                        credentials.secret_key = scwSecretKey;
                        credentials.project_id = scwProjectId;
                        credentials.region = scwRegion;
                      } else if (provider === 'digitalocean') {
                        credentials.api_token = doApiToken;
                      } else if (provider === 'heroku') {
                        credentials.api_key = herokuApiKey;
                      } else if (provider === 'supabase') {
                        credentials.access_token = supabaseAccessToken;
                      } else if (provider === 'vercel') {
                        credentials.api_token = vercelApiToken;
                        if (vercelTeamId) credentials.team_id = vercelTeamId;
                      } else if (provider === 'azure') {
                        credentials.tenant_id = azureTenantId;
                        credentials.client_id = azureClientId;
                        credentials.client_secret = azureClientSecret;
        credentials.subscription_id = azureSubscriptionId;
                      }
                      await api.post('/api/v1/observability-connections/validate-credentials', {
                        cloud_provider: provider,
                        credentials,
                      });
                      toast.success('Credentials validated successfully');
                      setStep(2);
                    } catch (err: any) {
                      toast.error(err?.message || 'Invalid credentials. Please check and try again.');
                    } finally {
                      setValidatingCreds(false);
                    }
                  } else {
                    setStep(step + 1);
                  }
                }}
                disabled={(step === 1 && (!isStep1Valid() || validatingCreds))}
              >
                {validatingCreds ? (
                  <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Validating...</>
                ) : (
                  <>{step === 1 ? 'Validate & Next' : 'Next'}<ChevronRight className="h-3 w-3 ml-1" /></>
                )}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleConnect}
                disabled={createConnection.isPending}
              >
                {createConnection.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <Cloud className="h-3 w-3 mr-1" />
                )}
                Connect
              </Button>
            )}
          </div>
        )}

        {success && (
          <div className="flex items-center justify-center border-t border-border px-6 py-4">
            <Button size="sm" variant="outline" onClick={onClose}>
              Done
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
