import { Router, Request, Response } from 'express';

const router = Router();

const INGEST_URL = process.env.INGEST_URL || 'https://ingest.sreoncall.com';

const INSTALL_SCRIPT = `#!/usr/bin/env bash
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

# ── Install Beyla ──
install_beyla() {
  if [[ "\$INSTALL_BEYLA" != "true" ]]; then
    return 0
  fi

  if command -v beyla &>/dev/null; then
    echo "  Beyla already installed"
    return 0
  fi

  if [[ "\$OS" == "macos" ]]; then
    echo "  WARNING: Cannot install Beyla on macOS. Skipping."
    INSTALL_BEYLA=false
    return 0
  fi

  echo "  Installing Grafana Beyla..."
  # Beyla is distributed via GitHub releases only (tar.gz, not apt/yum/deb/rpm).
  local arch
  arch=\$(uname -m)
  case "\$arch" in
    x86_64)  arch="amd64" ;;
    aarch64) arch="arm64" ;;
    *)
      echo "  WARNING: Unsupported architecture \$arch. Skipping Beyla."
      INSTALL_BEYLA=false
      return 0
      ;;
  esac

  local beyla_ver
  beyla_ver=\$(curl -sf --max-time 15 https://api.github.com/repos/grafana/beyla/releases/latest | grep -oP '"tag_name": "\\K[^"]+') || {
    echo "  WARNING: Could not fetch Beyla release version. Skipping."
    INSTALL_BEYLA=false
    return 0
  }

  local tmp
  tmp=\$(mktemp /tmp/beyla.XXXXXX.tar.gz)
  curl -sfL --max-time 300 -o "\$tmp" \\
    "https://github.com/grafana/beyla/releases/download/\${beyla_ver}/beyla-linux-\${arch}-\${beyla_ver}.tar.gz" || {
    echo "  WARNING: Could not download Beyla. Skipping."
    INSTALL_BEYLA=false
    rm -f "\$tmp"
    # Remove stale unit file so systemd doesn't try to start a missing binary
    sudo rm -f /etc/systemd/system/beyla.service
    sudo systemctl daemon-reload
    return 0
  }

  sudo tar -xzf "\$tmp" -C /usr/local/bin beyla
  sudo chmod +x /usr/local/bin/beyla
  rm -f "\$tmp"
  echo "  Beyla \$beyla_ver installed"
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
ExecStart=/usr/local/bin/beyla --config /etc/beyla/config.yml
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
    { __path__ = "/var/log/syslog",        job = "syslog",  instance = constants.hostname },
    { __path__ = "/var/log/messages",      job = "syslog",  instance = constants.hostname },
    { __path__ = "/var/log/auth.log",      job = "authlog", instance = constants.hostname },
    { __path__ = "/var/log/secure",        job = "authlog", instance = constants.hostname },
    { __path__ = "/var/log/kern.log",      job = "kernlog", instance = constants.hostname },
    { __path__ = "/var/log/nginx/*.log",   job = "nginx",   instance = constants.hostname },
    { __path__ = "/var/log/apache2/*.log", job = "apache",  instance = constants.hostname },
    { __path__ = "/var/log/httpd/*.log",   job = "apache",  instance = constants.hostname },
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
    replacement   = "${1}"
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

detect_os
check_ebpf_compat
install_alloy
install_beyla
setup_docker
write_config
write_beyla_config
start_service
start_beyla
`;

// GET /agent/install.sh — public, no auth required
router.get('/install.sh', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="install.sh"');
  res.send(INSTALL_SCRIPT);
});

export default router;
