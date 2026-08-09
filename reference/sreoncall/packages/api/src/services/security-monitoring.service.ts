import { logger } from '../utils/logger';

const MANAGED_MIMIR_URL = process.env.MANAGED_MIMIR_URL || 'http://10.10.1.21:9009';
const MANAGED_LOKI_URL  = process.env.MANAGED_LOKI_URL  || 'http://10.10.1.21:3100';
const QUERY_TIMEOUT_MS  = 15_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function queryPrometheus(query: string, orgId: string): Promise<number | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const url = `${MANAGED_MIMIR_URL}/prometheus/api/v1/query?query=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { 'X-Scope-OrgID': orgId },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const results: any[] = json?.data?.result ?? [];
    if (results.length === 0) return null;
    const val = parseFloat(results[0]?.value?.[1]);
    return isNaN(val) ? null : val;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function queryLoki(query: string, orgId: string): Promise<number> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const url = `${MANAGED_LOKI_URL}/loki/api/v1/query?query=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { 'X-Scope-OrgID': orgId },
      signal: controller.signal,
    });
    if (!res.ok) return 0;
    const json = (await res.json()) as any;
    const results: any[] = json?.data?.result ?? [];
    return results.length;
  } catch {
    return 0;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Interface ────────────────────────────────────────────────────────────────

export interface SecurityThreat {
  type: string;
  severity: 'critical' | 'high' | 'medium';
  title: string;
  description: string;
  metric_value: number;
  threshold: number;
  instance?: string;
}

// ─── Individual checks ────────────────────────────────────────────────────────

async function checkCryptominerCpu(tenantId: string, threats: SecurityThreat[]): Promise<void> {
  try {
    const query = `avg(rate(node_cpu_seconds_total{mode!="idle"}[5m])) by (instance) * 100`;
    const value = await queryPrometheus(query, tenantId);
    const threshold = 95;
    if (value !== null && value > threshold) {
      threats.push({
        type: 'cryptominer',
        severity: 'critical',
        title: 'Suspected Cryptominer: CPU Usage Critically High',
        description: `Sustained CPU utilization above ${threshold}% detected across all modes except idle. This pattern is consistent with cryptocurrency mining malware consuming host resources.`,
        metric_value: value,
        threshold,
      });
    }
  } catch (err: any) {
    logger.warn('Security check failed: cryptominer_cpu', { tenantId, error: err.message });
  }
}

async function checkOomKillStorm(tenantId: string, threats: SecurityThreat[]): Promise<void> {
  try {
    const query = `increase(node_vmstat_oom_kill[15m])`;
    const value = await queryPrometheus(query, tenantId);
    const threshold = 2;
    if (value !== null && value > threshold) {
      threats.push({
        type: 'oom_storm',
        severity: 'high',
        title: 'OOM Kill Storm Detected',
        description: `${Math.floor(value)} OOM kills recorded in the last 15 minutes (threshold: ${threshold}). Repeated out-of-memory kills indicate memory exhaustion, potential memory leak, or deliberate resource exhaustion attack.`,
        metric_value: value,
        threshold,
      });
    }
  } catch (err: any) {
    logger.warn('Security check failed: oom_kill_storm', { tenantId, error: err.message });
  }
}

async function checkProcessCountSpike(tenantId: string, threats: SecurityThreat[]): Promise<void> {
  try {
    const query = `node_procs_running`;
    const value = await queryPrometheus(query, tenantId);
    const threshold = 200;
    if (value !== null && value > threshold) {
      threats.push({
        type: 'process_count_spike',
        severity: 'high',
        title: 'Abnormal Process Count Spike',
        description: `${Math.floor(value)} processes currently running (threshold: ${threshold}). An unusually high number of running processes may indicate a fork bomb, malware spawning child processes, or a denial-of-service condition.`,
        metric_value: value,
        threshold,
      });
    }
  } catch (err: any) {
    logger.warn('Security check failed: process_count_spike', { tenantId, error: err.message });
  }
}

async function checkNetworkEgress(tenantId: string, threats: SecurityThreat[]): Promise<void> {
  try {
    const query = `max(rate(node_network_transmit_bytes_total{device!="lo"}[5m]))`;
    const value = await queryPrometheus(query, tenantId);
    const threshold = 100 * 1024 * 1024; // 100 MB/s
    if (value !== null && value > threshold) {
      threats.push({
        type: 'network_egress_spike',
        severity: 'high',
        title: 'Abnormal Network Egress Detected',
        description: `Network transmit rate of ${(value / 1024 / 1024).toFixed(1)} MB/s detected (threshold: 100 MB/s). Unusually high outbound traffic may indicate data exfiltration, a botnet command relay, or a compromised host being used for DDoS amplification.`,
        metric_value: value,
        threshold,
      });
    }
  } catch (err: any) {
    logger.warn('Security check failed: network_egress_spike', { tenantId, error: err.message });
  }
}

async function checkSshBruteForce(tenantId: string, threats: SecurityThreat[]): Promise<void> {
  try {
    const query = `sum(count_over_time({job="authlog"} |~ "Failed password|Invalid user" [5m]))`;
    const count = await queryLoki(query, tenantId);
    const threshold = 20;
    if (count > threshold) {
      threats.push({
        type: 'ssh_brute_force',
        severity: 'critical',
        title: 'SSH Brute Force Attack Detected',
        description: `${count} failed SSH authentication attempts in the last 5 minutes (threshold: ${threshold}). This pattern strongly indicates an active brute force or credential stuffing attack against SSH.`,
        metric_value: count,
        threshold,
      });
    }
  } catch (err: any) {
    logger.warn('Security check failed: ssh_brute_force', { tenantId, error: err.message });
  }
}

async function checkServiceRestartStorm(tenantId: string, threats: SecurityThreat[]): Promise<void> {
  try {
    const query = `max(changes(process_start_time_seconds[15m]))`;
    const value = await queryPrometheus(query, tenantId);
    const threshold = 3;
    if (value !== null && value > threshold) {
      threats.push({
        type: 'service_restart_storm',
        severity: 'medium',
        title: 'Service Restart Storm Detected',
        description: `${Math.floor(value)} service restarts detected in the last 15 minutes (threshold: ${threshold}). Repeated process restarts may indicate a crashlooping service, watchdog interference, or active exploitation causing service instability.`,
        metric_value: value,
        threshold,
      });
    }
  } catch (err: any) {
    logger.warn('Security check failed: service_restart_storm', { tenantId, error: err.message });
  }
}

async function checkConnectionSpike(tenantId: string, threats: SecurityThreat[]): Promise<void> {
  try {
    const query = `node_netstat_Tcp_CurrEstab`;
    const value = await queryPrometheus(query, tenantId);
    const threshold = 500;
    if (value !== null && value > threshold) {
      threats.push({
        type: 'connection_spike',
        severity: 'medium',
        title: 'TCP Connection Spike Detected',
        description: `${Math.floor(value)} established TCP connections detected (threshold: ${threshold}). An abnormally high number of concurrent connections may indicate a SYN flood, botnet C2 activity, or an application under DDoS attack.`,
        metric_value: value,
        threshold,
      });
    }
  } catch (err: any) {
    logger.warn('Security check failed: connection_spike', { tenantId, error: err.message });
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runSecurityChecks(tenantId: string): Promise<SecurityThreat[]> {
  const threats: SecurityThreat[] = [];

  await Promise.all([
    checkCryptominerCpu(tenantId, threats),
    checkOomKillStorm(tenantId, threats),
    checkProcessCountSpike(tenantId, threats),
    checkNetworkEgress(tenantId, threats),
    checkSshBruteForce(tenantId, threats),
    checkServiceRestartStorm(tenantId, threats),
    checkConnectionSpike(tenantId, threats),
  ]);

  if (threats.length > 0) {
    logger.info(`Security checks completed: ${threats.length} threat(s) detected`, {
      tenantId,
      types: threats.map((t) => t.type),
    });
  }

  return threats;
}
