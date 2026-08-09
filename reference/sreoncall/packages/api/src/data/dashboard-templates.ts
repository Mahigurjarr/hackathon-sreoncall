/**
 * Pre-built dashboard templates.
 * These are code-defined constants — instantiating creates a real Dashboard for the tenant.
 */

export interface DashboardTemplatePanel {
  id: string;
  title: string;
  type: 'line_chart' | 'bar_chart' | 'gauge' | 'stat' | 'table' | 'heatmap' | 'log_viewer' | 'trace_waterfall';
  grid: { x: number; y: number; w: number; h: number };
  query: string;
  options?: Record<string, unknown>;
  thresholds?: Array<{ value: number; color: string }>;
}

export interface DashboardTemplateVariable {
  name: string;
  label: string;
  type: 'query' | 'custom';
  source: {
    label_name?: string;
    values?: string[];
    /** Optional PromQL match selector — $varName tokens are substituted from current selections before the request */
    match_template?: string;
  };
  default: string[];
  multi: boolean;
}

export interface DashboardTemplate {
  template_id: string;
  category: string;
  name: string;
  description: string;
  panels: DashboardTemplatePanel[];
  variables?: DashboardTemplateVariable[];
  tags: string[];
  /** Only show when tenant has a connection matching this vendor (null = always show) */
  requires_vendor: string | null;
  /** Hide the platform-wide service/scope picker — use for dashboards that manage scope via their own variables */
  hide_scope?: boolean;
  /** Default time range for the dashboard (e.g. 'now-24h') */
  default_time_range?: string;
}

export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  // ── Infrastructure ──────────────────────────────────────────────────
  {
    template_id: 'infra-system-overview',
    category: 'Infrastructure',
    name: 'System Overview',
    description: 'CPU, Memory, Load average, Uptime, Disk IO, Network IO',
    tags: ['infrastructure', 'system'],
    requires_vendor: null,
    variables: [
      { name: 'instance', label: 'Instance', type: 'query', source: { label_name: 'instance' }, default: [], multi: true },
      { name: 'job',      label: 'Job',      type: 'query', source: { label_name: 'job' },      default: [], multi: true },
    ],
    panels: [
      { id: 'cpu', title: 'CPU Usage %', type: 'line_chart', grid: { x: 0, y: 0, w: 8, h: 4 }, query: 'avg(rate(node_cpu_seconds_total{mode!="idle",instance=~"$instance",job=~"$job"}[5m])) by (instance) * 100', thresholds: [{ value: 80, color: '#eab308' }, { value: 95, color: '#ef4444' }] },
      { id: 'memory', title: 'Memory Usage %', type: 'line_chart', grid: { x: 8, y: 0, w: 8, h: 4 }, query: '(1 - node_memory_MemAvailable_bytes{instance=~"$instance",job=~"$job"} / node_memory_MemTotal_bytes{instance=~"$instance",job=~"$job"}) * 100', thresholds: [{ value: 80, color: '#eab308' }, { value: 95, color: '#ef4444' }] },
      { id: 'load', title: 'Load Average (1m)', type: 'line_chart', grid: { x: 16, y: 0, w: 8, h: 4 }, query: 'node_load1{instance=~"$instance",job=~"$job"}' },
      { id: 'uptime', title: 'Uptime', type: 'stat', grid: { x: 0, y: 4, w: 8, h: 3 }, query: 'time() - node_boot_time_seconds{instance=~"$instance",job=~"$job"}' },
      { id: 'disk-io', title: 'Disk IO (read/write bytes/s)', type: 'line_chart', grid: { x: 8, y: 4, w: 8, h: 3 }, query: 'rate(node_disk_read_bytes_total{instance=~"$instance",job=~"$job"}[5m])' },
      { id: 'net-io', title: 'Network IO (bytes/s)', type: 'line_chart', grid: { x: 16, y: 4, w: 8, h: 3 }, query: 'rate(node_network_receive_bytes_total{instance=~"$instance",job=~"$job"}[5m])' },
    ],
  },
  {
    template_id: 'infra-network-overview',
    category: 'Infrastructure',
    name: 'Network Overview',
    description: 'Bandwidth, connections, packet errors, TCP retransmits',
    tags: ['infrastructure', 'network'],
    requires_vendor: null,
    panels: [
      { id: 'bandwidth-in', title: 'Bandwidth In (bytes/s)', type: 'line_chart', grid: { x: 0, y: 0, w: 12, h: 4 }, query: 'rate(node_network_receive_bytes_total[5m])' },
      { id: 'bandwidth-out', title: 'Bandwidth Out (bytes/s)', type: 'line_chart', grid: { x: 12, y: 0, w: 12, h: 4 }, query: 'rate(node_network_transmit_bytes_total[5m])' },
      { id: 'connections', title: 'TCP Connections', type: 'line_chart', grid: { x: 0, y: 4, w: 12, h: 4 }, query: 'node_netstat_Tcp_CurrEstab' },
      { id: 'errors', title: 'Packet Errors', type: 'line_chart', grid: { x: 12, y: 4, w: 12, h: 4 }, query: 'rate(node_network_receive_errs_total[5m]) + rate(node_network_transmit_errs_total[5m])' },
    ],
  },
  {
    template_id: 'infra-disk-storage',
    category: 'Infrastructure',
    name: 'Disk & Storage',
    description: 'IOPS, latency, space, errors',
    tags: ['infrastructure', 'disk'],
    requires_vendor: null,
    panels: [
      { id: 'disk-usage', title: 'Disk Usage %', type: 'gauge', grid: { x: 0, y: 0, w: 8, h: 4 }, query: '(1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100', thresholds: [{ value: 80, color: '#eab308' }, { value: 90, color: '#ef4444' }] },
      { id: 'iops', title: 'Disk IOPS', type: 'line_chart', grid: { x: 8, y: 0, w: 8, h: 4 }, query: 'rate(node_disk_reads_completed_total[5m]) + rate(node_disk_writes_completed_total[5m])' },
      { id: 'io-latency', title: 'IO Latency (ms)', type: 'line_chart', grid: { x: 16, y: 0, w: 8, h: 4 }, query: 'rate(node_disk_read_time_seconds_total[5m]) / rate(node_disk_reads_completed_total[5m]) * 1000' },
      { id: 'fs-free', title: 'Filesystem Free (bytes)', type: 'stat', grid: { x: 0, y: 4, w: 12, h: 3 }, query: 'node_filesystem_avail_bytes{mountpoint="/"}' },
      { id: 'io-errors', title: 'IO Errors', type: 'line_chart', grid: { x: 12, y: 4, w: 12, h: 3 }, query: 'rate(node_disk_io_time_weighted_seconds_total[5m])' },
    ],
  },

  // ── Application (Golden Signals) ────────────────────────────────────
  {
    template_id: 'app-red-metrics',
    category: 'Application',
    name: 'RED Metrics (Rate/Error/Duration)',
    description: 'Request rate, Error rate, Duration (p50/p95/p99), Saturation',
    tags: ['application', 'golden-signals', 'red'],
    requires_vendor: null,
    variables: [
      { name: 'service_name', label: 'Service',     type: 'query', source: { label_name: 'service_name' }, default: [], multi: true },
      { name: 'environment',  label: 'Environment', type: 'query', source: { label_name: 'environment' },  default: [], multi: true },
    ],
    panels: [
      { id: 'req-rate', title: 'Request Rate (req/s)', type: 'line_chart', grid: { x: 0, y: 0, w: 12, h: 4 }, query: 'sum(rate(http_requests_total{service_name=~"$service_name",environment=~"$environment"}[5m]))' },
      { id: 'error-rate', title: 'Error Rate (%)', type: 'line_chart', grid: { x: 12, y: 0, w: 12, h: 4 }, query: 'sum(rate(http_requests_total{code=~"5..",service_name=~"$service_name",environment=~"$environment"}[5m])) / sum(rate(http_requests_total{service_name=~"$service_name",environment=~"$environment"}[5m])) * 100', thresholds: [{ value: 1, color: '#eab308' }, { value: 5, color: '#ef4444' }] },
      { id: 'latency', title: 'Latency Percentiles (ms)', type: 'line_chart', grid: { x: 0, y: 4, w: 12, h: 4 }, query: 'histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{service_name=~"$service_name",environment=~"$environment"}[5m])) by (le)) * 1000' },
      { id: 'saturation', title: 'Process CPU Saturation (%)', type: 'line_chart', grid: { x: 12, y: 4, w: 12, h: 4 }, query: 'rate(process_cpu_seconds_total{service_name=~"$service_name",environment=~"$environment"}[5m]) * 100' },
    ],
  },
  {
    template_id: 'app-endpoint-perf',
    category: 'Application',
    name: 'Endpoint Performance',
    description: 'Per-endpoint latency, error rates, throughput, slow endpoints',
    tags: ['application', 'endpoints'],
    requires_vendor: null,
    panels: [
      { id: 'ep-latency', title: 'P99 Latency by Endpoint', type: 'line_chart', grid: { x: 0, y: 0, w: 12, h: 4 }, query: 'histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, handler)) * 1000' },
      { id: 'ep-errors', title: 'Error Rate by Endpoint', type: 'line_chart', grid: { x: 12, y: 0, w: 12, h: 4 }, query: 'sum(rate(http_requests_total{code=~"5.."}[5m])) by (handler) / sum(rate(http_requests_total[5m])) by (handler) * 100' },
      { id: 'ep-throughput', title: 'Throughput by Endpoint', type: 'bar_chart', grid: { x: 0, y: 4, w: 12, h: 4 }, query: 'sum(rate(http_requests_total[5m])) by (handler)' },
      { id: 'ep-slow', title: 'Slowest Endpoints (p99)', type: 'table', grid: { x: 12, y: 4, w: 12, h: 4 }, query: 'topk(10, histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, handler)) * 1000)' },
      { id: 'ep-p50', title: 'P50 Latency by Endpoint', type: 'line_chart', grid: { x: 0, y: 8, w: 12, h: 4 }, query: 'histogram_quantile(0.50, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, handler)) * 1000' },
      { id: 'ep-status', title: 'Response Codes Distribution', type: 'bar_chart', grid: { x: 12, y: 8, w: 12, h: 4 }, query: 'sum(rate(http_requests_total[5m])) by (code)' },
    ],
  },
  {
    template_id: 'app-error-analysis',
    category: 'Application',
    name: 'Error Analysis',
    description: 'Error rate by type, top errors, error timeline, error by service',
    tags: ['application', 'errors'],
    requires_vendor: null,
    panels: [
      { id: 'err-by-code', title: 'Error Rate by Status Code', type: 'line_chart', grid: { x: 0, y: 0, w: 12, h: 4 }, query: 'sum(rate(http_requests_total{code=~"[45].."}[5m])) by (code)' },
      { id: 'err-top', title: 'Top Error Endpoints', type: 'table', grid: { x: 12, y: 0, w: 12, h: 4 }, query: 'topk(10, sum(rate(http_requests_total{code=~"5.."}[5m])) by (handler))' },
      { id: 'err-timeline', title: 'Error Timeline', type: 'line_chart', grid: { x: 0, y: 4, w: 24, h: 4 }, query: 'sum(rate(http_requests_total{code=~"5.."}[5m]))' },
      { id: 'err-by-svc', title: 'Errors by Service', type: 'bar_chart', grid: { x: 0, y: 8, w: 12, h: 4 }, query: 'sum(rate(http_requests_total{code=~"5.."}[5m])) by (job)' },
      { id: 'err-4xx', title: '4xx Client Errors', type: 'line_chart', grid: { x: 12, y: 8, w: 12, h: 4 }, query: 'sum(rate(http_requests_total{code=~"4.."}[5m]))' },
    ],
  },

  // ── Kubernetes ──────────────────────────────────────────────────────
  {
    template_id: 'k8s-cluster-overview',
    category: 'Kubernetes',
    name: 'Cluster Overview',
    description: 'Nodes, pods, CPU/mem requests vs limits, API server, etcd',
    tags: ['kubernetes', 'cluster'],
    requires_vendor: null,
    variables: [
      { name: 'cluster',   label: 'Cluster',   type: 'query', source: { label_name: 'cluster' },   default: [], multi: true },
      { name: 'namespace', label: 'Namespace', type: 'query', source: { label_name: 'namespace' }, default: [], multi: true },
      { name: 'pod',       label: 'Pod',       type: 'query', source: { label_name: 'pod' },       default: [], multi: true },
    ],
    panels: [
      { id: 'nodes', title: 'Node Count', type: 'stat', grid: { x: 0, y: 0, w: 6, h: 3 }, query: 'count(kube_node_info{cluster=~"$cluster"})' },
      { id: 'pods', title: 'Running Pods', type: 'stat', grid: { x: 6, y: 0, w: 6, h: 3 }, query: 'count(kube_pod_status_phase{phase="Running",cluster=~"$cluster",namespace=~"$namespace",pod=~"$pod"})' },
      { id: 'cpu-req', title: 'CPU Requests vs Limits', type: 'line_chart', grid: { x: 12, y: 0, w: 12, h: 3 }, query: 'sum(kube_pod_container_resource_requests{resource="cpu",cluster=~"$cluster",namespace=~"$namespace",pod=~"$pod"})' },
      { id: 'mem-req', title: 'Memory Requests vs Limits', type: 'line_chart', grid: { x: 0, y: 3, w: 12, h: 4 }, query: 'sum(kube_pod_container_resource_requests{resource="memory",cluster=~"$cluster",namespace=~"$namespace",pod=~"$pod"})' },
      { id: 'api-latency', title: 'API Server Latency', type: 'line_chart', grid: { x: 12, y: 3, w: 12, h: 4 }, query: 'histogram_quantile(0.99, sum(rate(apiserver_request_duration_seconds_bucket{cluster=~"$cluster"}[5m])) by (le))' },
      { id: 'pod-restarts', title: 'Pod Restarts', type: 'line_chart', grid: { x: 0, y: 7, w: 8, h: 4 }, query: 'sum(increase(kube_pod_container_status_restarts_total{cluster=~"$cluster",namespace=~"$namespace",pod=~"$pod"}[1h])) by (namespace, pod)' },
      { id: 'pending', title: 'Pending Pods', type: 'stat', grid: { x: 8, y: 7, w: 8, h: 4 }, query: 'count(kube_pod_status_phase{phase="Pending",cluster=~"$cluster",namespace=~"$namespace"})' },
      { id: 'failed', title: 'Failed Pods', type: 'stat', grid: { x: 16, y: 7, w: 8, h: 4 }, query: 'count(kube_pod_status_phase{phase="Failed",cluster=~"$cluster",namespace=~"$namespace"})' },
    ],
  },
  {
    template_id: 'k8s-namespace-resources',
    category: 'Kubernetes',
    name: 'Namespace Resources',
    description: 'Per-namespace CPU, memory, pod count, network',
    tags: ['kubernetes', 'namespace'],
    requires_vendor: null,
    panels: [
      { id: 'ns-cpu', title: 'CPU by Namespace', type: 'line_chart', grid: { x: 0, y: 0, w: 12, h: 4 }, query: 'sum(rate(container_cpu_usage_seconds_total[5m])) by (namespace)' },
      { id: 'ns-mem', title: 'Memory by Namespace', type: 'line_chart', grid: { x: 12, y: 0, w: 12, h: 4 }, query: 'sum(container_memory_working_set_bytes) by (namespace)' },
      { id: 'ns-pods', title: 'Pods by Namespace', type: 'bar_chart', grid: { x: 0, y: 4, w: 12, h: 4 }, query: 'count(kube_pod_info) by (namespace)' },
      { id: 'ns-net-rx', title: 'Network RX by Namespace', type: 'line_chart', grid: { x: 12, y: 4, w: 6, h: 4 }, query: 'sum(rate(container_network_receive_bytes_total[5m])) by (namespace)' },
      { id: 'ns-net-tx', title: 'Network TX by Namespace', type: 'line_chart', grid: { x: 18, y: 4, w: 6, h: 4 }, query: 'sum(rate(container_network_transmit_bytes_total[5m])) by (namespace)' },
      { id: 'ns-limits', title: 'Resource Limits by Namespace', type: 'table', grid: { x: 0, y: 8, w: 24, h: 4 }, query: 'sum(kube_pod_container_resource_limits{resource="cpu"}) by (namespace)' },
    ],
  },
  {
    template_id: 'k8s-pod-health',
    category: 'Kubernetes',
    name: 'Pod Health',
    description: 'Restarts, OOMKills, pending pods, failed containers',
    tags: ['kubernetes', 'pods'],
    requires_vendor: null,
    panels: [
      { id: 'restarts', title: 'Container Restarts (1h)', type: 'table', grid: { x: 0, y: 0, w: 12, h: 4 }, query: 'topk(20, sum(increase(kube_pod_container_status_restarts_total[1h])) by (namespace, pod))' },
      { id: 'oom', title: 'OOM Killed Containers', type: 'stat', grid: { x: 12, y: 0, w: 12, h: 4 }, query: 'sum(kube_pod_container_status_last_terminated_reason{reason="OOMKilled"})' },
      { id: 'pending', title: 'Pending Pods', type: 'table', grid: { x: 0, y: 4, w: 12, h: 4 }, query: 'kube_pod_status_phase{phase="Pending"} == 1' },
      { id: 'not-ready', title: 'Not Ready Containers', type: 'table', grid: { x: 12, y: 4, w: 12, h: 4 }, query: 'kube_pod_container_status_ready == 0' },
      { id: 'cpu-usage', title: 'Top CPU Pods', type: 'table', grid: { x: 0, y: 8, w: 24, h: 4 }, query: 'topk(10, sum(rate(container_cpu_usage_seconds_total[5m])) by (namespace, pod))' },
    ],
  },

  // ── AWS ─────────────────────────────────────────────────────────────
  {
    template_id: 'aws-overview',
    category: 'AWS',
    name: 'AWS Overview',
    description: 'Multi-service summary across EC2, RDS, Lambda, ALB',
    tags: ['aws', 'cloud'],
    requires_vendor: 'cloudwatch',
    variables: [
      { name: 'region',     label: 'Region',     type: 'query', source: { label_name: 'region' },     default: [], multi: true },
      { name: 'account_id', label: 'Account ID', type: 'query', source: { label_name: 'account_id' }, default: [], multi: true },
    ],
    panels: [
      { id: 'ec2-cpu', title: 'EC2 Avg CPU', type: 'line_chart', grid: { x: 0, y: 0, w: 8, h: 4 }, query: 'avg(aws_ec2_cpuutilization_average{region=~"$region",account_id=~"$account_id"})' },
      { id: 'rds-conn', title: 'RDS Connections', type: 'line_chart', grid: { x: 8, y: 0, w: 8, h: 4 }, query: 'sum(aws_rds_database_connections_average{region=~"$region",account_id=~"$account_id"})' },
      { id: 'lambda-inv', title: 'Lambda Invocations', type: 'line_chart', grid: { x: 16, y: 0, w: 8, h: 4 }, query: 'sum(aws_lambda_invocations_sum{region=~"$region",account_id=~"$account_id"})' },
      { id: 'alb-reqs', title: 'ALB Request Count', type: 'line_chart', grid: { x: 0, y: 4, w: 8, h: 4 }, query: 'sum(aws_alb_request_count_sum{region=~"$region",account_id=~"$account_id"})' },
      { id: 'alb-5xx', title: 'ALB 5xx Errors', type: 'line_chart', grid: { x: 8, y: 4, w: 8, h: 4 }, query: 'sum(aws_alb_httpcode_target_5xx_count_sum{region=~"$region",account_id=~"$account_id"})', thresholds: [{ value: 10, color: '#ef4444' }] },
      { id: 'lambda-err', title: 'Lambda Errors', type: 'line_chart', grid: { x: 16, y: 4, w: 8, h: 4 }, query: 'sum(aws_lambda_errors_sum{region=~"$region",account_id=~"$account_id"})', thresholds: [{ value: 1, color: '#ef4444' }] },
      { id: 'rds-cpu', title: 'RDS CPU', type: 'line_chart', grid: { x: 0, y: 8, w: 8, h: 4 }, query: 'avg(aws_rds_cpuutilization_average{region=~"$region",account_id=~"$account_id"})' },
      { id: 'rds-free', title: 'RDS Free Storage (GB)', type: 'stat', grid: { x: 8, y: 8, w: 8, h: 4 }, query: 'aws_rds_free_storage_space_average{region=~"$region",account_id=~"$account_id"} / 1073741824' },
      { id: 'sqs-depth', title: 'SQS Queue Depth', type: 'line_chart', grid: { x: 16, y: 8, w: 8, h: 4 }, query: 'sum(aws_sqs_approximate_number_of_messages_visible_maximum{region=~"$region",account_id=~"$account_id"})' },
      { id: 'ec2-net', title: 'EC2 Network In/Out', type: 'line_chart', grid: { x: 0, y: 12, w: 24, h: 4 }, query: 'sum(aws_ec2_network_in_average{region=~"$region",account_id=~"$account_id"})' },
    ],
  },
  {
    template_id: 'aws-ec2-fleet',
    category: 'AWS',
    name: 'EC2 Fleet',
    description: 'CPU, network, disk, status checks across all instances',
    tags: ['aws', 'ec2'],
    requires_vendor: 'cloudwatch',
    panels: [
      { id: 'cpu-by-inst', title: 'CPU by Instance', type: 'line_chart', grid: { x: 0, y: 0, w: 12, h: 4 }, query: 'aws_ec2_cpuutilization_average' },
      { id: 'net-in', title: 'Network In by Instance', type: 'line_chart', grid: { x: 12, y: 0, w: 12, h: 4 }, query: 'aws_ec2_network_in_average' },
      { id: 'net-out', title: 'Network Out by Instance', type: 'line_chart', grid: { x: 0, y: 4, w: 12, h: 4 }, query: 'aws_ec2_network_out_average' },
      { id: 'disk-read', title: 'Disk Read Ops', type: 'line_chart', grid: { x: 12, y: 4, w: 12, h: 4 }, query: 'aws_ec2_disk_read_ops_average' },
      { id: 'status', title: 'Status Check Failed', type: 'stat', grid: { x: 0, y: 8, w: 12, h: 3 }, query: 'aws_ec2_status_check_failed_sum' },
      { id: 'credit', title: 'CPU Credit Balance', type: 'line_chart', grid: { x: 12, y: 8, w: 12, h: 3 }, query: 'aws_ec2_cpucredit_balance_average' },
    ],
  },
  {
    template_id: 'aws-rds-performance',
    category: 'AWS',
    name: 'RDS Performance',
    description: 'Connections, IOPS, latency, CPU, free storage, replication lag',
    tags: ['aws', 'rds'],
    requires_vendor: 'cloudwatch',
    panels: [
      { id: 'conn', title: 'Database Connections', type: 'line_chart', grid: { x: 0, y: 0, w: 8, h: 4 }, query: 'aws_rds_database_connections_average' },
      { id: 'read-iops', title: 'Read IOPS', type: 'line_chart', grid: { x: 8, y: 0, w: 8, h: 4 }, query: 'aws_rds_read_iops_average' },
      { id: 'write-iops', title: 'Write IOPS', type: 'line_chart', grid: { x: 16, y: 0, w: 8, h: 4 }, query: 'aws_rds_write_iops_average' },
      { id: 'read-lat', title: 'Read Latency (ms)', type: 'line_chart', grid: { x: 0, y: 4, w: 8, h: 4 }, query: 'aws_rds_read_latency_average * 1000' },
      { id: 'write-lat', title: 'Write Latency (ms)', type: 'line_chart', grid: { x: 8, y: 4, w: 8, h: 4 }, query: 'aws_rds_write_latency_average * 1000' },
      { id: 'cpu', title: 'CPU Utilization', type: 'line_chart', grid: { x: 16, y: 4, w: 8, h: 4 }, query: 'aws_rds_cpuutilization_average', thresholds: [{ value: 80, color: '#eab308' }, { value: 95, color: '#ef4444' }] },
      { id: 'free-storage', title: 'Free Storage (GB)', type: 'stat', grid: { x: 0, y: 8, w: 12, h: 3 }, query: 'aws_rds_free_storage_space_average / 1073741824' },
      { id: 'rep-lag', title: 'Replication Lag (s)', type: 'line_chart', grid: { x: 12, y: 8, w: 12, h: 3 }, query: 'aws_rds_replica_lag_average' },
    ],
  },

  // ── Kubernetes (continued) ──────────────────────────────────────────
  {
    template_id: 'k8s-deployment-rollouts',
    category: 'Kubernetes',
    name: 'Deployment Rollouts',
    description: 'Rollout progress, replica mismatches, update strategy, generation tracking',
    tags: ['kubernetes', 'deployments', 'rollouts'],
    requires_vendor: null,
    panels: [
      { id: 'replica-mismatch', title: 'Replica Mismatch (desired vs ready)', type: 'line_chart', grid: { x: 0, y: 0, w: 12, h: 4 }, query: 'kube_deployment_spec_replicas - kube_deployment_status_replicas_ready' },
      { id: 'unavailable', title: 'Unavailable Replicas', type: 'line_chart', grid: { x: 12, y: 0, w: 12, h: 4 }, query: 'kube_deployment_status_replicas_unavailable' },
      { id: 'update-gen', title: 'Observed vs Expected Generation', type: 'table', grid: { x: 0, y: 4, w: 12, h: 4 }, query: 'kube_deployment_metadata_generation - kube_deployment_status_observed_generation' },
      { id: 'rollout-ready', title: 'Deployments Fully Ready', type: 'stat', grid: { x: 12, y: 4, w: 12, h: 4 }, query: 'count(kube_deployment_status_replicas_ready == kube_deployment_spec_replicas)' },
    ],
  },
  {
    template_id: 'k8s-hpa-autoscaling',
    category: 'Kubernetes',
    name: 'HPA & Autoscaling',
    description: 'HPA current vs desired, scaling events, CPU/memory targets',
    tags: ['kubernetes', 'hpa', 'autoscaling'],
    requires_vendor: null,
    panels: [
      { id: 'hpa-replicas', title: 'HPA Current vs Desired Replicas', type: 'line_chart', grid: { x: 0, y: 0, w: 12, h: 4 }, query: 'kube_horizontalpodautoscaler_status_current_replicas' },
      { id: 'hpa-desired', title: 'HPA Desired Replicas', type: 'line_chart', grid: { x: 12, y: 0, w: 12, h: 4 }, query: 'kube_horizontalpodautoscaler_status_desired_replicas' },
      { id: 'hpa-at-max', title: 'HPAs at Max Capacity', type: 'stat', grid: { x: 0, y: 4, w: 12, h: 4 }, query: 'count(kube_horizontalpodautoscaler_status_current_replicas == kube_horizontalpodautoscaler_spec_max_replicas)' },
      { id: 'hpa-cpu-target', title: 'CPU Target Utilization', type: 'line_chart', grid: { x: 12, y: 4, w: 12, h: 4 }, query: 'kube_horizontalpodautoscaler_spec_target_metric' },
    ],
  },

  // ── Application (continued) ──────────────────────────────────────────
  {
    template_id: 'app-http-traffic',
    category: 'Application',
    name: 'HTTP Traffic Overview',
    description: 'Request volume, status codes, response sizes, methods breakdown',
    tags: ['application', 'http', 'traffic'],
    requires_vendor: null,
    panels: [
      { id: 'total-req', title: 'Total Request Rate', type: 'stat', grid: { x: 0, y: 0, w: 6, h: 3 }, query: 'sum(rate(http_requests_total[5m]))' },
      { id: 'success-rate', title: 'Success Rate (%)', type: 'gauge', grid: { x: 6, y: 0, w: 6, h: 3 }, query: 'sum(rate(http_requests_total{code=~"2.."}[5m])) / sum(rate(http_requests_total[5m])) * 100', thresholds: [{ value: 99, color: '#22c55e' }, { value: 95, color: '#eab308' }] },
      { id: 'status-dist', title: 'Status Code Distribution', type: 'bar_chart', grid: { x: 12, y: 0, w: 12, h: 3 }, query: 'sum(rate(http_requests_total[5m])) by (code)' },
      { id: 'methods', title: 'Requests by Method', type: 'bar_chart', grid: { x: 0, y: 3, w: 12, h: 4 }, query: 'sum(rate(http_requests_total[5m])) by (method)' },
      { id: 'resp-size', title: 'Response Size (bytes/s)', type: 'line_chart', grid: { x: 12, y: 3, w: 12, h: 4 }, query: 'sum(rate(http_response_size_bytes_sum[5m]))' },
      { id: 'req-by-svc', title: 'Requests by Service', type: 'line_chart', grid: { x: 0, y: 7, w: 24, h: 4 }, query: 'sum(rate(http_requests_total[5m])) by (job)' },
    ],
  },
  {
    template_id: 'app-jvm-runtime',
    category: 'Application',
    name: 'JVM / Runtime Metrics',
    description: 'Heap, GC, threads, open files — for Java/Node/Go processes',
    tags: ['application', 'jvm', 'runtime'],
    requires_vendor: null,
    panels: [
      { id: 'heap', title: 'Heap Memory Usage', type: 'line_chart', grid: { x: 0, y: 0, w: 12, h: 4 }, query: 'process_resident_memory_bytes' },
      { id: 'gc', title: 'GC Duration', type: 'line_chart', grid: { x: 12, y: 0, w: 12, h: 4 }, query: 'rate(go_gc_duration_seconds_sum[5m])' },
      { id: 'goroutines', title: 'Goroutines / Threads', type: 'line_chart', grid: { x: 0, y: 4, w: 12, h: 4 }, query: 'go_goroutines' },
      { id: 'open-fds', title: 'Open File Descriptors', type: 'line_chart', grid: { x: 12, y: 4, w: 12, h: 4 }, query: 'process_open_fds', thresholds: [{ value: 1000, color: '#eab308' }] },
      { id: 'cpu-process', title: 'Process CPU Usage', type: 'line_chart', grid: { x: 0, y: 8, w: 12, h: 4 }, query: 'rate(process_cpu_seconds_total[5m]) * 100' },
      { id: 'alloc', title: 'Memory Alloc Rate', type: 'line_chart', grid: { x: 12, y: 8, w: 12, h: 4 }, query: 'rate(go_memstats_alloc_bytes_total[5m])' },
    ],
  },

  // ── Database ─────────────────────────────────────────────────────────
  {
    template_id: 'db-postgres-overview',
    category: 'Database',
    name: 'PostgreSQL Overview',
    description: 'Connections, transactions, cache hit ratio, replication, locks, table sizes',
    tags: ['database', 'postgres'],
    requires_vendor: null,
    panels: [
      { id: 'conn-active', title: 'Active Connections', type: 'line_chart', grid: { x: 0, y: 0, w: 8, h: 4 }, query: 'pg_stat_activity_count{state="active"}' },
      { id: 'conn-idle', title: 'Idle Connections', type: 'line_chart', grid: { x: 8, y: 0, w: 8, h: 4 }, query: 'pg_stat_activity_count{state="idle"}' },
      { id: 'cache-hit', title: 'Cache Hit Ratio (%)', type: 'gauge', grid: { x: 16, y: 0, w: 8, h: 4 }, query: 'pg_stat_database_blks_hit / (pg_stat_database_blks_hit + pg_stat_database_blks_read) * 100', thresholds: [{ value: 99, color: '#22c55e' }, { value: 90, color: '#eab308' }] },
      { id: 'txn-rate', title: 'Transaction Rate', type: 'line_chart', grid: { x: 0, y: 4, w: 12, h: 4 }, query: 'rate(pg_stat_database_xact_commit[5m]) + rate(pg_stat_database_xact_rollback[5m])' },
      { id: 'rollbacks', title: 'Rollback Rate', type: 'line_chart', grid: { x: 12, y: 4, w: 12, h: 4 }, query: 'rate(pg_stat_database_xact_rollback[5m])', thresholds: [{ value: 1, color: '#ef4444' }] },
      { id: 'rep-lag', title: 'Replication Lag (bytes)', type: 'line_chart', grid: { x: 0, y: 8, w: 12, h: 4 }, query: 'pg_replication_lag' },
      { id: 'locks', title: 'Lock Count by Mode', type: 'bar_chart', grid: { x: 12, y: 8, w: 12, h: 4 }, query: 'pg_locks_count' },
    ],
  },
  {
    template_id: 'db-redis-overview',
    category: 'Database',
    name: 'Redis Overview',
    description: 'Memory, connections, ops/s, hit rate, evictions, keyspace',
    tags: ['database', 'redis'],
    requires_vendor: null,
    panels: [
      { id: 'memory', title: 'Memory Usage', type: 'line_chart', grid: { x: 0, y: 0, w: 8, h: 4 }, query: 'redis_memory_used_bytes' },
      { id: 'ops', title: 'Commands/s', type: 'line_chart', grid: { x: 8, y: 0, w: 8, h: 4 }, query: 'rate(redis_commands_processed_total[5m])' },
      { id: 'connections', title: 'Connected Clients', type: 'line_chart', grid: { x: 16, y: 0, w: 8, h: 4 }, query: 'redis_connected_clients' },
      { id: 'hit-rate', title: 'Cache Hit Rate (%)', type: 'gauge', grid: { x: 0, y: 4, w: 8, h: 4 }, query: 'redis_keyspace_hits_total / (redis_keyspace_hits_total + redis_keyspace_misses_total) * 100', thresholds: [{ value: 95, color: '#22c55e' }, { value: 80, color: '#eab308' }] },
      { id: 'evictions', title: 'Evictions', type: 'line_chart', grid: { x: 8, y: 4, w: 8, h: 4 }, query: 'rate(redis_evicted_keys_total[5m])', thresholds: [{ value: 1, color: '#ef4444' }] },
      { id: 'keys', title: 'Total Keys', type: 'stat', grid: { x: 16, y: 4, w: 8, h: 4 }, query: 'sum(redis_db_keys)' },
    ],
  },
  {
    template_id: 'db-mongodb-overview',
    category: 'Database',
    name: 'MongoDB Overview',
    description: 'Operations, connections, document metrics, replication, storage',
    tags: ['database', 'mongodb'],
    requires_vendor: null,
    panels: [
      { id: 'ops', title: 'Operations/s (insert, query, update, delete)', type: 'line_chart', grid: { x: 0, y: 0, w: 12, h: 4 }, query: 'rate(mongodb_op_counters_total[5m])' },
      { id: 'connections', title: 'Current Connections', type: 'line_chart', grid: { x: 12, y: 0, w: 12, h: 4 }, query: 'mongodb_connections{state="current"}' },
      { id: 'data-size', title: 'Data Size (bytes)', type: 'stat', grid: { x: 0, y: 4, w: 8, h: 4 }, query: 'mongodb_dbstats_dataSize' },
      { id: 'doc-ops', title: 'Document Operations', type: 'line_chart', grid: { x: 8, y: 4, w: 8, h: 4 }, query: 'rate(mongodb_mongod_metrics_document_total[5m])' },
      { id: 'rep-lag', title: 'Replication Lag (s)', type: 'line_chart', grid: { x: 16, y: 4, w: 8, h: 4 }, query: 'mongodb_mongod_replset_member_replication_lag' },
      { id: 'mem-resident', title: 'Memory Resident (MB)', type: 'line_chart', grid: { x: 0, y: 8, w: 12, h: 4 }, query: 'mongodb_memory{type="resident"} / 1048576' },
      { id: 'network', title: 'Network Bytes In/Out', type: 'line_chart', grid: { x: 12, y: 8, w: 12, h: 4 }, query: 'rate(mongodb_network_bytes_total[5m])' },
    ],
  },

  // ── Containers / Docker ──────────────────────────────────────────────
  {
    template_id: 'container-overview',
    category: 'Containers',
    name: 'Container Overview',
    description: 'CPU, memory, network, restarts across all containers',
    tags: ['containers', 'docker'],
    requires_vendor: null,
    panels: [
      { id: 'cpu-by-container', title: 'CPU Usage by Container', type: 'line_chart', grid: { x: 0, y: 0, w: 12, h: 4 }, query: 'sum(rate(container_cpu_usage_seconds_total{name!=""}[5m])) by (name)' },
      { id: 'mem-by-container', title: 'Memory Usage by Container', type: 'line_chart', grid: { x: 12, y: 0, w: 12, h: 4 }, query: 'container_memory_working_set_bytes{name!=""}' },
      { id: 'net-rx', title: 'Network RX by Container', type: 'line_chart', grid: { x: 0, y: 4, w: 12, h: 4 }, query: 'rate(container_network_receive_bytes_total{name!=""}[5m])' },
      { id: 'net-tx', title: 'Network TX by Container', type: 'line_chart', grid: { x: 12, y: 4, w: 12, h: 4 }, query: 'rate(container_network_transmit_bytes_total{name!=""}[5m])' },
      { id: 'restarts', title: 'Container Restarts', type: 'table', grid: { x: 0, y: 8, w: 12, h: 4 }, query: 'increase(kube_pod_container_status_restarts_total[1h])' },
      { id: 'throttle', title: 'CPU Throttled', type: 'line_chart', grid: { x: 12, y: 8, w: 12, h: 4 }, query: 'rate(container_cpu_cfs_throttled_seconds_total{name!=""}[5m])' },
    ],
  },

  // ── Logs ────────────────────────────────────────────────────────────
  {
    template_id: 'logs-overview',
    category: 'Logs',
    name: 'Log Overview',
    description: 'Volume by level, error rate, top sources, pattern detection',
    tags: ['logs', 'observability'],
    requires_vendor: null,
    panels: [
      { id: 'vol-level', title: 'Log Volume by Level', type: 'bar_chart', grid: { x: 0, y: 0, w: 12, h: 4 }, query: 'sum(count_over_time({job=~".+"}[5m])) by (level)' },
      { id: 'err-rate', title: 'Error Log Rate', type: 'line_chart', grid: { x: 12, y: 0, w: 12, h: 4 }, query: 'sum(count_over_time({level="error"}[5m]))' },
      { id: 'top-src', title: 'Top Log Sources', type: 'table', grid: { x: 0, y: 4, w: 12, h: 4 }, query: 'topk(10, sum(count_over_time({job=~".+"}[1h])) by (job))' },
      { id: 'recent', title: 'Recent Logs', type: 'log_viewer', grid: { x: 12, y: 4, w: 12, h: 4 }, query: '{job=~".+"}' },
    ],
  },
  {
    template_id: 'logs-error-tracking',
    category: 'Logs',
    name: 'Error Log Tracking',
    description: 'Error frequency, top error messages, error sources, error timeline',
    tags: ['logs', 'errors'],
    requires_vendor: null,
    panels: [
      { id: 'err-count', title: 'Error Count (5m buckets)', type: 'bar_chart', grid: { x: 0, y: 0, w: 12, h: 4 }, query: 'sum(count_over_time({level="error"}[5m]))' },
      { id: 'err-by-source', title: 'Errors by Source', type: 'bar_chart', grid: { x: 12, y: 0, w: 12, h: 4 }, query: 'sum(count_over_time({level="error"}[1h])) by (job)' },
      { id: 'err-logs', title: 'Recent Error Logs', type: 'log_viewer', grid: { x: 0, y: 4, w: 24, h: 5 }, query: '{level="error"}' },
      { id: 'warn-logs', title: 'Recent Warning Logs', type: 'log_viewer', grid: { x: 0, y: 9, w: 24, h: 5 }, query: '{level=~"warn|warning"}' },
    ],
  },

  // ── Networking ──────────────────────────────────────────────────────
  {
    template_id: 'net-ingress-overview',
    category: 'Networking',
    name: 'Ingress / Load Balancer',
    description: 'Request rate, errors, latency, connections for NGINX/Traefik/HAProxy',
    tags: ['networking', 'ingress', 'loadbalancer'],
    requires_vendor: null,
    panels: [
      { id: 'req-rate', title: 'Ingress Request Rate', type: 'line_chart', grid: { x: 0, y: 0, w: 12, h: 4 }, query: 'sum(rate(nginx_ingress_controller_requests[5m]))' },
      { id: 'error-rate', title: 'Ingress 5xx Rate', type: 'line_chart', grid: { x: 12, y: 0, w: 12, h: 4 }, query: 'sum(rate(nginx_ingress_controller_requests{status=~"5.."}[5m]))', thresholds: [{ value: 1, color: '#ef4444' }] },
      { id: 'latency', title: 'Request Duration p99', type: 'line_chart', grid: { x: 0, y: 4, w: 12, h: 4 }, query: 'histogram_quantile(0.99, sum(rate(nginx_ingress_controller_request_duration_seconds_bucket[5m])) by (le))' },
      { id: 'connections', title: 'Active Connections', type: 'line_chart', grid: { x: 12, y: 4, w: 12, h: 4 }, query: 'nginx_ingress_controller_nginx_process_connections{state="active"}' },
      { id: 'by-host', title: 'Requests by Host', type: 'bar_chart', grid: { x: 0, y: 8, w: 12, h: 4 }, query: 'sum(rate(nginx_ingress_controller_requests[5m])) by (host)' },
      { id: 'by-status', title: 'Response Status Distribution', type: 'bar_chart', grid: { x: 12, y: 8, w: 12, h: 4 }, query: 'sum(rate(nginx_ingress_controller_requests[5m])) by (status)' },
    ],
  },
  {
    template_id: 'net-dns-overview',
    category: 'Networking',
    name: 'CoreDNS / DNS',
    description: 'DNS query rate, latency, errors, cache hit ratio',
    tags: ['networking', 'dns', 'coredns'],
    requires_vendor: null,
    panels: [
      { id: 'query-rate', title: 'DNS Query Rate', type: 'line_chart', grid: { x: 0, y: 0, w: 12, h: 4 }, query: 'sum(rate(coredns_dns_requests_total[5m]))' },
      { id: 'latency', title: 'DNS Latency p99', type: 'line_chart', grid: { x: 12, y: 0, w: 12, h: 4 }, query: 'histogram_quantile(0.99, sum(rate(coredns_dns_request_duration_seconds_bucket[5m])) by (le))' },
      { id: 'errors', title: 'DNS Errors', type: 'line_chart', grid: { x: 0, y: 4, w: 12, h: 4 }, query: 'sum(rate(coredns_dns_responses_total{rcode=~"SERVFAIL|NXDOMAIN"}[5m])) by (rcode)' },
      { id: 'cache-hit', title: 'Cache Hit Ratio', type: 'gauge', grid: { x: 12, y: 4, w: 12, h: 4 }, query: 'sum(rate(coredns_cache_hits_total[5m])) / (sum(rate(coredns_cache_hits_total[5m])) + sum(rate(coredns_cache_misses_total[5m]))) * 100' },
    ],
  },

  // ── Message Queues ──────────────────────────────────────────────────
  {
    template_id: 'mq-nats-overview',
    category: 'Message Queues',
    name: 'NATS / JetStream',
    description: 'Connections, messages in/out, subscriptions, slow consumers',
    tags: ['messaging', 'nats', 'jetstream'],
    requires_vendor: null,
    panels: [
      { id: 'connections', title: 'NATS Connections', type: 'line_chart', grid: { x: 0, y: 0, w: 8, h: 4 }, query: 'nats_varz_connections' },
      { id: 'msg-in', title: 'Messages In/s', type: 'line_chart', grid: { x: 8, y: 0, w: 8, h: 4 }, query: 'rate(nats_varz_in_msgs[5m])' },
      { id: 'msg-out', title: 'Messages Out/s', type: 'line_chart', grid: { x: 16, y: 0, w: 8, h: 4 }, query: 'rate(nats_varz_out_msgs[5m])' },
      { id: 'subscriptions', title: 'Active Subscriptions', type: 'stat', grid: { x: 0, y: 4, w: 8, h: 3 }, query: 'nats_varz_subscriptions' },
      { id: 'slow-consumers', title: 'Slow Consumers', type: 'stat', grid: { x: 8, y: 4, w: 8, h: 3 }, query: 'nats_varz_slow_consumers', thresholds: [{ value: 1, color: '#ef4444' }] },
      { id: 'bytes', title: 'Data Rate (bytes/s)', type: 'line_chart', grid: { x: 16, y: 4, w: 8, h: 3 }, query: 'rate(nats_varz_in_bytes[5m])' },
    ],
  },
  {
    template_id: 'mq-rabbitmq-overview',
    category: 'Message Queues',
    name: 'RabbitMQ Overview',
    description: 'Queue depth, publish/consume rates, connections, memory',
    tags: ['messaging', 'rabbitmq'],
    requires_vendor: null,
    panels: [
      { id: 'queue-depth', title: 'Queue Messages Ready', type: 'line_chart', grid: { x: 0, y: 0, w: 12, h: 4 }, query: 'rabbitmq_queue_messages_ready' },
      { id: 'publish-rate', title: 'Publish Rate', type: 'line_chart', grid: { x: 12, y: 0, w: 12, h: 4 }, query: 'rate(rabbitmq_channel_messages_published_total[5m])' },
      { id: 'consume-rate', title: 'Consume Rate', type: 'line_chart', grid: { x: 0, y: 4, w: 12, h: 4 }, query: 'rate(rabbitmq_channel_messages_delivered_total[5m])' },
      { id: 'connections', title: 'Connections', type: 'line_chart', grid: { x: 12, y: 4, w: 12, h: 4 }, query: 'rabbitmq_connections' },
      { id: 'memory', title: 'Memory Used', type: 'line_chart', grid: { x: 0, y: 8, w: 12, h: 4 }, query: 'rabbitmq_process_resident_memory_bytes' },
      { id: 'unacked', title: 'Unacknowledged Messages', type: 'line_chart', grid: { x: 12, y: 8, w: 12, h: 4 }, query: 'rabbitmq_queue_messages_unacked' },
    ],
  },

  // ── SLO ─────────────────────────────────────────────────────────────
  {
    template_id: 'slo-dashboard',
    category: 'SLO',
    name: 'SLO Dashboard',
    description: 'All SLOs with burn rates, error budgets, compliance trend',
    tags: ['slo', 'reliability'],
    requires_vendor: null,
    variables: [
      { name: 'service_name', label: 'Service', type: 'query', source: { label_name: 'service_name' }, default: [], multi: true },
    ],
    panels: [
      { id: 'slo-avail', title: 'Availability SLO', type: 'gauge', grid: { x: 0, y: 0, w: 8, h: 4 }, query: '1 - sum(rate(http_requests_total{code=~"5..",service_name=~"$service_name"}[30d])) / sum(rate(http_requests_total{service_name=~"$service_name"}[30d]))', thresholds: [{ value: 0.999, color: '#22c55e' }, { value: 0.99, color: '#eab308' }] },
      { id: 'slo-latency', title: 'Latency SLO (p99 < 500ms)', type: 'gauge', grid: { x: 8, y: 0, w: 8, h: 4 }, query: 'histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{service_name=~"$service_name"}[30d])) by (le)) * 1000' },
      { id: 'burn-rate', title: 'Error Budget Burn Rate', type: 'line_chart', grid: { x: 16, y: 0, w: 8, h: 4 }, query: 'sum(rate(http_requests_total{code=~"5..",service_name=~"$service_name"}[1h])) / sum(rate(http_requests_total{service_name=~"$service_name"}[1h]))' },
      { id: 'budget-remain', title: 'Error Budget Remaining', type: 'stat', grid: { x: 0, y: 4, w: 12, h: 3 }, query: '1 - (sum(increase(http_requests_total{code=~"5..",service_name=~"$service_name"}[30d])) / sum(increase(http_requests_total{service_name=~"$service_name"}[30d]))) / (1 - 0.999)' },
      { id: 'compliance', title: 'SLO Compliance (30d)', type: 'line_chart', grid: { x: 12, y: 4, w: 12, h: 3 }, query: '1 - sum(rate(http_requests_total{code=~"5..",service_name=~"$service_name"}[1d])) / sum(rate(http_requests_total{service_name=~"$service_name"}[1d]))' },
      { id: 'slo-table', title: 'All SLOs', type: 'table', grid: { x: 0, y: 7, w: 24, h: 4 }, query: 'slo_compliance_ratio{service_name=~"$service_name"}' },
    ],
  },

  // ── On-Call / Incident ───────────────────────────────────────────────
  {
    template_id: 'oncall-overview',
    category: 'On-Call',
    name: 'On-Call Overview',
    description: 'Alert volume, MTTA, MTTR, incident frequency, escalation stats',
    tags: ['oncall', 'incidents', 'alerts'],
    requires_vendor: null,
    panels: [
      { id: 'alert-vol', title: 'Alert Volume (1h buckets)', type: 'bar_chart', grid: { x: 0, y: 0, w: 12, h: 4 }, query: 'sum(increase(alerts_total[1h]))' },
      { id: 'open-incidents', title: 'Open Incidents', type: 'stat', grid: { x: 12, y: 0, w: 6, h: 4 }, query: 'sum(incidents_active_total)' },
      { id: 'mtta', title: 'Mean Time to Acknowledge', type: 'stat', grid: { x: 18, y: 0, w: 6, h: 4 }, query: 'avg(incident_time_to_acknowledge_seconds)' },
      { id: 'mttr', title: 'Mean Time to Resolve', type: 'stat', grid: { x: 0, y: 4, w: 8, h: 3 }, query: 'avg(incident_time_to_resolve_seconds)' },
      { id: 'escalations', title: 'Escalation Rate', type: 'line_chart', grid: { x: 8, y: 4, w: 8, h: 3 }, query: 'sum(increase(escalations_total[1h]))' },
      { id: 'by-severity', title: 'Incidents by Severity', type: 'bar_chart', grid: { x: 16, y: 4, w: 8, h: 3 }, query: 'sum(incidents_active_total) by (severity)' },
    ],
  },
  // ── SNMP / Network Devices ──────────────────────────────────────────
  {
    template_id: 'snmp-device-overview',
    category: 'SNMP',
    name: 'Network Device Overview',
    description: 'Device inventory, uptime, CPU, memory, interface summary across all SNMP devices',
    tags: ['snmp', 'network', 'devices'],
    requires_vendor: null,
    panels: [
      { id: 'device-count', title: 'Total Devices', type: 'stat', grid: { x: 0, y: 0, w: 6, h: 3 }, query: 'count(last_over_time(snmp_device_info[2h]))' },
      { id: 'total-interfaces', title: 'Total Interfaces', type: 'stat', grid: { x: 6, y: 0, w: 6, h: 3 }, query: 'sum(last_over_time(snmp_device_interface_count[2h]))' },
      { id: 'bgp-peers', title: 'BGP Peers Established', type: 'stat', grid: { x: 12, y: 0, w: 6, h: 3 }, query: 'sum(last_over_time(snmp_bgp_peer_established_count[2h]))' },
      { id: 'lldp-neighbors', title: 'LLDP Neighbors', type: 'stat', grid: { x: 18, y: 0, w: 6, h: 3 }, query: 'sum(last_over_time(snmp_lldp_neighbor_count[2h]))' },
      { id: 'cpu-top', title: 'Top CPU Devices', type: 'table', grid: { x: 0, y: 3, w: 12, h: 5 }, query: 'topk(10, avg by (device, sysname) (snmp_cpu_load_percent))' },
      { id: 'uptime', title: 'Device Uptime', type: 'table', grid: { x: 12, y: 3, w: 12, h: 5 }, query: 'sort_desc(last_over_time(snmp_device_uptime_seconds[2h]) / 86400)' },
      { id: 'oper-status', title: 'Interfaces Down', type: 'table', grid: { x: 0, y: 8, w: 24, h: 4 }, query: 'snmp_interface_oper_status == 2' },
    ],
  },
  {
    template_id: 'snmp-interface-traffic',
    category: 'SNMP',
    name: 'Interface Traffic',
    description: 'Bandwidth utilization, errors, and packet rates for SNMP-monitored interfaces',
    tags: ['snmp', 'network', 'interfaces', 'bandwidth'],
    requires_vendor: null,
    panels: [
      { id: 'traffic-in', title: 'Inbound Traffic (bits/s)', type: 'line_chart', grid: { x: 0, y: 0, w: 12, h: 4 }, query: 'topk(10, rate(snmp_interface_hc_in_octets_total[5m]) * 8)' },
      { id: 'traffic-out', title: 'Outbound Traffic (bits/s)', type: 'line_chart', grid: { x: 12, y: 0, w: 12, h: 4 }, query: 'topk(10, rate(snmp_interface_hc_out_octets_total[5m]) * 8)' },
      { id: 'util-pct', title: 'Interface Utilization %', type: 'line_chart', grid: { x: 0, y: 4, w: 24, h: 4 }, query: 'topk(10, (rate(snmp_interface_hc_in_octets_total[5m]) * 8 / (snmp_interface_highspeed_mbps * 1e6)) * 100)', thresholds: [{ value: 70, color: '#eab308' }, { value: 90, color: '#ef4444' }] },
      { id: 'errors-in', title: 'Input Errors/s', type: 'line_chart', grid: { x: 0, y: 8, w: 12, h: 4 }, query: 'topk(10, rate(snmp_interface_in_errors_total[5m]))', thresholds: [{ value: 10, color: '#eab308' }, { value: 100, color: '#ef4444' }] },
      { id: 'errors-out', title: 'Output Errors/s', type: 'line_chart', grid: { x: 12, y: 8, w: 12, h: 4 }, query: 'topk(10, rate(snmp_interface_out_errors_total[5m]))', thresholds: [{ value: 10, color: '#eab308' }, { value: 100, color: '#ef4444' }] },
      { id: 'pkts-in', title: 'Inbound Packets/s', type: 'line_chart', grid: { x: 0, y: 12, w: 12, h: 4 }, query: 'topk(10, rate(snmp_interface_hc_in_ucast_pkts_total[5m]))' },
      { id: 'pkts-out', title: 'Outbound Packets/s', type: 'line_chart', grid: { x: 12, y: 12, w: 12, h: 4 }, query: 'topk(10, rate(snmp_interface_hc_out_ucast_pkts_total[5m]))' },
    ],
  },
  {
    template_id: 'snmp-bgp-overview',
    category: 'SNMP',
    name: 'BGP Peering',
    description: 'BGP peer states, update rates, and session stability',
    tags: ['snmp', 'network', 'bgp', 'routing'],
    requires_vendor: null,
    panels: [
      { id: 'total-peers', title: 'Total BGP Peers', type: 'stat', grid: { x: 0, y: 0, w: 6, h: 3 }, query: 'sum(last_over_time(snmp_bgp_peer_count[2h]))' },
      { id: 'established', title: 'Established Peers', type: 'stat', grid: { x: 6, y: 0, w: 6, h: 3 }, query: 'sum(last_over_time(snmp_bgp_peer_established_count[2h]))' },
      { id: 'down-peers', title: 'Peers Not Established', type: 'stat', grid: { x: 12, y: 0, w: 6, h: 3 }, query: 'count(snmp_bgp_peer_state != 6)', thresholds: [{ value: 1, color: '#ef4444' }] },
      { id: 'state-changes', title: 'State Changes (10m)', type: 'stat', grid: { x: 18, y: 0, w: 6, h: 3 }, query: 'sum(changes(snmp_bgp_peer_state[10m]))', thresholds: [{ value: 1, color: '#eab308' }] },
      { id: 'peer-state', title: 'Peer State Over Time', type: 'line_chart', grid: { x: 0, y: 3, w: 24, h: 5 }, query: 'snmp_bgp_peer_state' },
      { id: 'updates-in', title: 'BGP Updates In/s', type: 'line_chart', grid: { x: 0, y: 8, w: 12, h: 4 }, query: 'rate(snmp_bgp_peer_in_updates_total[5m])' },
      { id: 'updates-out', title: 'BGP Updates Out/s', type: 'line_chart', grid: { x: 12, y: 8, w: 12, h: 4 }, query: 'rate(snmp_bgp_peer_out_updates_total[5m])' },
    ],
  },
  {
    template_id: 'snmp-environment',
    category: 'SNMP',
    name: 'Device Environment',
    description: 'Temperature, fan speed, power sensors across network devices',
    tags: ['snmp', 'network', 'environment', 'temperature'],
    requires_vendor: null,
    panels: [
      { id: 'temperature', title: 'Temperature (°C)', type: 'line_chart', grid: { x: 0, y: 0, w: 12, h: 5 }, query: 'snmp_sensor_temperature_celsius', thresholds: [{ value: 55, color: '#eab308' }, { value: 70, color: '#ef4444' }] },
      { id: 'fan-rpm', title: 'Fan Speed (RPM)', type: 'line_chart', grid: { x: 12, y: 0, w: 12, h: 5 }, query: 'snmp_sensor_fan_rpm' },
      { id: 'voltage', title: 'Voltage (DC)', type: 'line_chart', grid: { x: 0, y: 5, w: 12, h: 4 }, query: 'snmp_sensor_voltage_dc' },
      { id: 'power', title: 'Power (Watts)', type: 'line_chart', grid: { x: 12, y: 5, w: 12, h: 4 }, query: 'snmp_sensor_power_watts' },
      { id: 'chassis-info', title: 'Chassis Info', type: 'table', grid: { x: 0, y: 9, w: 24, h: 4 }, query: 'last_over_time(snmp_entity_chassis_info[2h])' },
    ],
  },

  // ── eBPF Auto-Instrumented (Beyla) ───────────────────────────────
  {
    template_id: 'ebpf-service-overview',
    category: 'eBPF',
    name: 'eBPF Service Overview',
    description: 'Auto-instrumented RED metrics from Grafana Beyla — request rate, error rate, latency by service',
    tags: ['ebpf', 'beyla', 'red', 'auto-instrumented'],
    requires_vendor: null,
    panels: [
      { id: 'req-rate', title: 'Request Rate by Service (req/s)', type: 'line_chart', grid: { x: 0, y: 0, w: 12, h: 4 }, query: 'sum(rate(http_server_request_duration_seconds_count[5m])) by (service_name)' },
      { id: 'error-rate', title: 'Error Rate by Service (%)', type: 'line_chart', grid: { x: 12, y: 0, w: 12, h: 4 }, query: 'sum(rate(http_server_request_duration_seconds_count{http_response_status_code=~"5.."}[5m])) by (service_name) / sum(rate(http_server_request_duration_seconds_count[5m])) by (service_name) * 100', thresholds: [{ value: 1, color: '#eab308' }, { value: 5, color: '#ef4444' }] },
      { id: 'latency-p99', title: 'P99 Latency by Service (ms)', type: 'line_chart', grid: { x: 0, y: 4, w: 8, h: 4 }, query: 'histogram_quantile(0.99, sum(rate(http_server_request_duration_seconds_bucket[5m])) by (le, service_name)) * 1000' },
      { id: 'latency-p50', title: 'P50 Latency by Service (ms)', type: 'line_chart', grid: { x: 8, y: 4, w: 8, h: 4 }, query: 'histogram_quantile(0.50, sum(rate(http_server_request_duration_seconds_bucket[5m])) by (le, service_name)) * 1000' },
      { id: 'active-reqs', title: 'Active Requests', type: 'stat', grid: { x: 16, y: 4, w: 8, h: 4 }, query: 'sum(http_server_active_requests) by (service_name)' },
      { id: 'top-endpoints', title: 'Top Endpoints by Throughput', type: 'table', grid: { x: 0, y: 8, w: 12, h: 4 }, query: 'topk(20, sum(rate(http_server_request_duration_seconds_count[5m])) by (http_route, service_name))' },
      { id: 'grpc-rate', title: 'gRPC Request Rate by Service', type: 'line_chart', grid: { x: 12, y: 8, w: 12, h: 4 }, query: 'sum(rate(rpc_server_duration_seconds_count[5m])) by (service_name)' },
    ],
  },
  {
    template_id: 'ebpf-trace-explorer',
    category: 'eBPF',
    name: 'eBPF Trace Explorer',
    description: 'Distributed traces captured by Beyla eBPF — latency heatmap, slowest traces, errors',
    tags: ['ebpf', 'beyla', 'traces', 'auto-instrumented'],
    requires_vendor: null,
    panels: [
      { id: 'duration-heatmap', title: 'Trace Duration Heatmap', type: 'heatmap', grid: { x: 0, y: 0, w: 24, h: 5 }, query: 'sum(rate(http_server_request_duration_seconds_bucket[5m])) by (le)' },
      { id: 'slow-traces', title: 'Slowest Traces', type: 'trace_waterfall', grid: { x: 0, y: 5, w: 24, h: 5 }, query: '{ duration > 1s } | select(resource.service.name, name, duration, status)' },
      { id: 'error-traces', title: 'Error Traces by Service', type: 'table', grid: { x: 0, y: 10, w: 12, h: 4 }, query: '{ status = error } | select(resource.service.name, name, status)' },
      { id: 'trace-count', title: 'Trace Count by Service', type: 'bar_chart', grid: { x: 12, y: 10, w: 12, h: 4 }, query: 'sum(rate(traces_spanmetrics_calls_total[5m])) by (service_name)' },
    ],
  },
  {
    template_id: 'k8s-pvc-storage',
    category: 'Kubernetes',
    name: 'PVC & Storage',
    description: 'PersistentVolumeClaim usage, capacity, available space, and inode tracking',
    tags: ['kubernetes', 'pvc', 'storage'],
    requires_vendor: null,
    panels: [
      { id: 'pvc-usage', title: 'PVC Usage % by Claim', type: 'gauge', grid: { x: 0, y: 0, w: 12, h: 4 }, query: 'kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes * 100', thresholds: [{ value: 80, color: '#eab308' }, { value: 90, color: '#ef4444' }] },
      { id: 'pvc-capacity', title: 'PVC Capacity by Namespace', type: 'bar_chart', grid: { x: 12, y: 0, w: 12, h: 4 }, query: 'sum(kubelet_volume_stats_capacity_bytes) by (namespace, persistentvolumeclaim)' },
      { id: 'pvc-available', title: 'PVC Available Space', type: 'table', grid: { x: 0, y: 4, w: 12, h: 4 }, query: 'kubelet_volume_stats_available_bytes' },
      { id: 'pvc-nearing', title: 'PVCs Nearing Capacity (>80%)', type: 'table', grid: { x: 12, y: 4, w: 12, h: 4 }, query: 'kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes * 100 > 80', thresholds: [{ value: 80, color: '#eab308' }, { value: 90, color: '#ef4444' }] },
      { id: 'pvc-inodes', title: 'Inode Usage %', type: 'line_chart', grid: { x: 0, y: 8, w: 24, h: 4 }, query: 'kubelet_volume_stats_inodes_used / kubelet_volume_stats_inodes * 100', thresholds: [{ value: 80, color: '#eab308' }, { value: 95, color: '#ef4444' }] },
    ],
  },
  {
    template_id: 'k8s-audit-log',
    category: 'Kubernetes',
    name: 'Audit Logs',
    description: 'Kubernetes API server audit events — who did what, failed requests, resource modifications',
    tags: ['kubernetes', 'audit', 'security'],
    requires_vendor: null,
    panels: [
      { id: 'audit-by-user', title: 'Audit Events by User', type: 'bar_chart', grid: { x: 0, y: 0, w: 12, h: 4 }, query: 'sum(count_over_time({job="kubernetes-audit"} | json [5m])) by (user_username)' },
      { id: 'audit-by-verb', title: 'Audit Events by Verb', type: 'bar_chart', grid: { x: 12, y: 0, w: 12, h: 4 }, query: 'sum(count_over_time({job="kubernetes-audit"} | json [5m])) by (verb)' },
      { id: 'audit-errors', title: 'Failed Requests (4xx/5xx)', type: 'line_chart', grid: { x: 0, y: 4, w: 24, h: 4 }, query: 'sum(count_over_time({job="kubernetes-audit"} | json | responseStatus_code >= 400 [5m]))' },
      { id: 'audit-timeline', title: 'Audit Event Timeline', type: 'log_viewer', grid: { x: 0, y: 8, w: 24, h: 5 }, query: '{job="kubernetes-audit"} | json | line_format "{{.verb}} {{.objectRef_resource}}/{{.objectRef_name}} by {{.user_username}}"' },
    ],
  },

  // ── Deep Trace Analytics (Odigos) ────────────────────────────────
  {
    template_id: 'deep-trace-analytics',
    category: 'eBPF',
    name: 'Deep Trace Analytics',
    description: 'Rich application traces from Odigos — span counts, DB query durations, HTTP client calls, error spans',
    tags: ['odigos', 'traces', 'deep-instrumentation', 'apm'],
    requires_vendor: null,
    panels: [
      { id: 'span-count', title: 'Span Count by Service & Operation', type: 'bar_chart', grid: { x: 0, y: 0, w: 12, h: 4 }, query: 'sum(rate(traces_spanmetrics_calls_total[5m])) by (service_name, span_name)' },
      { id: 'db-duration', title: 'DB Query P99 Duration by Service (ms)', type: 'line_chart', grid: { x: 12, y: 0, w: 12, h: 4 }, query: 'histogram_quantile(0.99, sum(rate(db_client_operation_duration_seconds_bucket[5m])) by (le, service_name)) * 1000' },
      { id: 'http-client', title: 'Outbound HTTP Client Calls by Service', type: 'line_chart', grid: { x: 0, y: 4, w: 12, h: 4 }, query: 'sum(rate(http_client_request_duration_seconds_count[5m])) by (service_name, http_route)' },
      { id: 'error-spans', title: 'Error Spans by Service', type: 'line_chart', grid: { x: 12, y: 4, w: 12, h: 4 }, query: 'sum(rate(traces_spanmetrics_calls_total{status_code="STATUS_CODE_ERROR"}[5m])) by (service_name)', thresholds: [{ value: 1, color: '#eab308' }, { value: 10, color: '#ef4444' }] },
      { id: 'span-duration', title: 'Span Duration P99 by Operation (ms)', type: 'table', grid: { x: 0, y: 8, w: 24, h: 4 }, query: 'topk(20, histogram_quantile(0.99, sum(rate(traces_spanmetrics_duration_seconds_bucket[5m])) by (le, service_name, span_name)) * 1000)' },
    ],
  },

  // ── Continuous Profiling ─────────────────────────────────────────
  {
    template_id: 'profiling-overview',
    category: 'eBPF',
    name: 'Profiling Overview',
    description: 'CPU profiling data from Pyroscope eBPF — top consumers, profile counts',
    tags: ['profiling', 'pyroscope', 'ebpf', 'cpu'],
    requires_vendor: null,
    panels: [
      { id: 'cpu-by-service', title: 'Top CPU Consumers by Service', type: 'bar_chart', grid: { x: 0, y: 0, w: 12, h: 4 }, query: 'sum(rate(process_cpu_seconds_total[5m])) by (service_name)' },
      { id: 'profile-count', title: 'Profiles Received Over Time', type: 'line_chart', grid: { x: 12, y: 0, w: 12, h: 4 }, query: 'sum(rate(pyroscope_profiles_received_total[5m]))' },
      { id: 'goroutines', title: 'Goroutine Count by Service (Go)', type: 'line_chart', grid: { x: 0, y: 4, w: 12, h: 4 }, query: 'sum(go_goroutines) by (service_name)' },
      { id: 'alloc-rate', title: 'Memory Allocation Rate by Service', type: 'line_chart', grid: { x: 12, y: 4, w: 12, h: 4 }, query: 'sum(rate(go_memstats_alloc_bytes_total[5m])) by (service_name)' },
    ],
  },

  // ── LLM Observability ────────────────────────────────────────────
  {
    template_id: 'llm-observability',
    category: 'AI',
    name: 'LLM Observability',
    description: 'AI/LLM API call monitoring — token usage, cost estimation, latency, errors by model and service',
    tags: ['llm', 'ai', 'genai', 'tokens', 'cost'],
    requires_vendor: null,
    panels: [
      { id: 'token-usage', title: 'Token Usage by Model (input vs output)', type: 'bar_chart', grid: { x: 0, y: 0, w: 12, h: 4 }, query: 'sum(rate(gen_ai_duration_seconds_count[5m])) by (gen_ai_request_model)' },
      { id: 'latency', title: 'LLM Latency P99 by Model (s)', type: 'line_chart', grid: { x: 12, y: 0, w: 12, h: 4 }, query: 'histogram_quantile(0.99, sum(rate(gen_ai_duration_seconds_bucket[5m])) by (le, gen_ai_request_model))' },
      { id: 'req-rate', title: 'LLM Request Rate by Service', type: 'line_chart', grid: { x: 0, y: 4, w: 12, h: 4 }, query: 'sum(rate(gen_ai_duration_seconds_count[5m])) by (service_name)' },
      { id: 'errors', title: 'LLM Error Rate by Provider', type: 'line_chart', grid: { x: 12, y: 4, w: 12, h: 4 }, query: 'sum(rate(gen_ai_duration_seconds_count{status_code="STATUS_CODE_ERROR"}[5m])) by (gen_ai_system)', thresholds: [{ value: 1, color: '#eab308' }, { value: 10, color: '#ef4444' }] },
      { id: 'top-consumers', title: 'Top LLM Consumers by Service', type: 'table', grid: { x: 0, y: 8, w: 12, h: 4 }, query: 'topk(10, sum(rate(gen_ai_duration_seconds_count[5m])) by (service_name))' },
      { id: 'latency-p50', title: 'LLM Latency P50 by Model (s)', type: 'line_chart', grid: { x: 12, y: 8, w: 12, h: 4 }, query: 'histogram_quantile(0.50, sum(rate(gen_ai_duration_seconds_bucket[5m])) by (le, gen_ai_request_model))' },
    ],
  },

  // ── Kubernetes Full Observability ────────────────────────────────
  {
    template_id: 'k8s-full-observability',
    category: 'Kubernetes',
    name: 'K8s Full Observability',
    description: 'Complete K8s view — cluster health, nodes, namespaces, pods, workloads, networking, storage, and control plane in one dashboard',
    tags: ['kubernetes', 'cluster', 'observability'],
    requires_vendor: null,
    hide_scope: true,
    default_time_range: 'now-24h',
    variables: [
      { name: 'cluster',   label: 'Cluster',   type: 'query', source: { label_name: 'cluster' },                                                                                                                          default: [], multi: false },
      { name: 'node',      label: 'Node',      type: 'query', source: { label_name: 'node',      match_template: 'kube_pod_info{cluster=~"$cluster"}' },                                                        default: [], multi: true },
      { name: 'namespace', label: 'Namespace', type: 'query', source: { label_name: 'namespace', match_template: 'kube_pod_info{cluster=~"$cluster"}' },                                                        default: [], multi: true },
      { name: 'pod',       label: 'Pod',       type: 'query', source: { label_name: 'pod',       match_template: 'kube_pod_info{cluster=~"$cluster",namespace=~"$namespace"}' },                               default: [], multi: true },
      { name: 'container', label: 'Container', type: 'query', source: { label_name: 'container', match_template: 'kube_pod_container_info{cluster=~"$cluster",namespace=~"$namespace",pod=~"$pod"}' },         default: [], multi: true },
    ],
    panels: [
      // Cluster Summary
      { id: 'kfo-nodes-total',   title: 'Total Nodes',    type: 'stat', grid: { x: 0,  y: 0,  w: 4, h: 3 }, query: 'count(kube_node_info{cluster=~"$cluster"})' },
      { id: 'kfo-nodes-ready',   title: 'Nodes Ready',    type: 'stat', grid: { x: 4,  y: 0,  w: 4, h: 3 }, query: 'count(kube_node_status_condition{condition="Ready",status="true",cluster=~"$cluster"})' },
      { id: 'kfo-pods-running',  title: 'Pods Running',   type: 'stat', grid: { x: 8,  y: 0,  w: 4, h: 3 }, query: 'sum(kube_pod_status_phase{phase="Running",cluster=~"$cluster",namespace=~"$namespace"})' },
      { id: 'kfo-pods-pending',  title: 'Pods Pending',   type: 'stat', grid: { x: 12, y: 0,  w: 4, h: 3 }, query: 'sum(kube_pod_status_phase{phase="Pending",cluster=~"$cluster",namespace=~"$namespace"})', thresholds: [{ value: 1, color: '#f97316' }] },
      { id: 'kfo-pods-failed',   title: 'Pods Failed',    type: 'stat', grid: { x: 16, y: 0,  w: 4, h: 3 }, query: 'sum(kube_pod_status_phase{phase="Failed",cluster=~"$cluster",namespace=~"$namespace"})', thresholds: [{ value: 1, color: '#ef4444' }] },
      { id: 'kfo-restarts-stat', title: 'Restarts (1h)',  type: 'stat', grid: { x: 20, y: 0,  w: 4, h: 3 }, query: 'sum(increase(kube_pod_container_status_restarts_total{cluster=~"$cluster",namespace=~"$namespace"}[1h]))', thresholds: [{ value: 5, color: '#eab308' }, { value: 20, color: '#ef4444' }] },
      // Cluster CPU & Memory
      { id: 'kfo-cluster-cpu', title: 'CPU Usage by Namespace',    type: 'line_chart', grid: { x: 0,  y: 3,  w: 12, h: 5 }, query: 'sum(rate(container_cpu_usage_seconds_total{cluster=~"$cluster",namespace=~"$namespace",pod=~"$pod",container!=""}[5m])) by (namespace)' },
      { id: 'kfo-cluster-mem', title: 'Memory Usage by Namespace', type: 'line_chart', grid: { x: 12, y: 3,  w: 12, h: 5 }, query: 'sum(container_memory_working_set_bytes{cluster=~"$cluster",namespace=~"$namespace",pod=~"$pod",container!=""}) by (namespace)' },
      // Node Metrics
      { id: 'kfo-node-cpu',    title: 'Node CPU %',              type: 'line_chart', grid: { x: 0,  y: 8,  w: 12, h: 5 }, query: '100 - (avg by (node) (rate(node_cpu_seconds_total{mode="idle",cluster=~"$cluster",node=~"$node"}[5m])) * 100)' },
      { id: 'kfo-node-mem',    title: 'Node Memory %',           type: 'line_chart', grid: { x: 12, y: 8,  w: 12, h: 5 }, query: '100 * (1 - (node_memory_MemAvailable_bytes{cluster=~"$cluster",node=~"$node"} / node_memory_MemTotal_bytes{cluster=~"$cluster",node=~"$node"}))' },
      { id: 'kfo-node-disk',   title: 'Node Disk I/O (bytes/s)', type: 'line_chart', grid: { x: 0,  y: 13, w: 12, h: 4 }, query: 'sum by (node) (rate(node_disk_io_time_seconds_total{cluster=~"$cluster",node=~"$node"}[5m]))' },
      { id: 'kfo-node-net-rx', title: 'Node Network RX (bytes/s)', type: 'line_chart', grid: { x: 12, y: 13, w: 6,  h: 4 }, query: 'sum by (node) (rate(node_network_receive_bytes_total{cluster=~"$cluster",node=~"$node"}[5m]))' },
      { id: 'kfo-node-net-tx', title: 'Node Network TX (bytes/s)', type: 'line_chart', grid: { x: 18, y: 13, w: 6,  h: 4 }, query: 'sum by (node) (rate(node_network_transmit_bytes_total{cluster=~"$cluster",node=~"$node"}[5m]))' },
      // Namespace Resources
      { id: 'kfo-ns-cpu',  title: 'CPU by Namespace',    type: 'bar_chart', grid: { x: 0,  y: 17, w: 8, h: 4 }, query: 'sum(rate(container_cpu_usage_seconds_total{cluster=~"$cluster",namespace=~"$namespace",container!=""}[5m])) by (namespace)' },
      { id: 'kfo-ns-mem',  title: 'Memory by Namespace', type: 'bar_chart', grid: { x: 8,  y: 17, w: 8, h: 4 }, query: 'sum(container_memory_working_set_bytes{cluster=~"$cluster",namespace=~"$namespace",container!=""}) by (namespace)' },
      { id: 'kfo-ns-pods', title: 'Pods by Namespace',   type: 'bar_chart', grid: { x: 16, y: 17, w: 8, h: 4 }, query: 'count(kube_pod_info{cluster=~"$cluster",namespace=~"$namespace"}) by (namespace)' },
      // Pod Details
      { id: 'kfo-pod-cpu',      title: 'Top 10 CPU Pods',          type: 'line_chart', grid: { x: 0,  y: 21, w: 12, h: 5 }, query: 'topk(10, sum(rate(container_cpu_usage_seconds_total{cluster=~"$cluster",namespace=~"$namespace",pod=~"$pod",container!=""}[5m])) by (pod, namespace))' },
      { id: 'kfo-pod-mem',      title: 'Top 10 Memory Pods',        type: 'line_chart', grid: { x: 12, y: 21, w: 12, h: 5 }, query: 'topk(10, sum(container_memory_working_set_bytes{cluster=~"$cluster",namespace=~"$namespace",pod=~"$pod",container!=""}) by (pod, namespace))' },
      { id: 'kfo-restarts-tbl', title: 'Container Restarts (1h)',   type: 'table',      grid: { x: 0,  y: 26, w: 12, h: 5 }, query: 'topk(20, sum(increase(kube_pod_container_status_restarts_total{cluster=~"$cluster",namespace=~"$namespace",pod=~"$pod"}[1h])) by (namespace, pod, container))' },
      { id: 'kfo-oom',          title: 'OOMKilled Containers',      type: 'stat',       grid: { x: 12, y: 26, w: 6,  h: 2 }, query: 'sum(kube_pod_container_status_last_terminated_reason{reason="OOMKilled",cluster=~"$cluster",namespace=~"$namespace"})', thresholds: [{ value: 1, color: '#ef4444' }] },
      { id: 'kfo-not-ready',    title: 'Not Ready Pods',            type: 'stat',       grid: { x: 18, y: 26, w: 6,  h: 2 }, query: 'count(kube_pod_status_ready{condition="false",cluster=~"$cluster",namespace=~"$namespace"} == 1)', thresholds: [{ value: 1, color: '#f97316' }] },
      // Pod Networking
      { id: 'kfo-pod-net-rx', title: 'Pod Network RX (bytes/s)', type: 'line_chart', grid: { x: 0,  y: 31, w: 12, h: 4 }, query: 'sum(rate(container_network_receive_bytes_total{cluster=~"$cluster",namespace=~"$namespace",pod=~"$pod"}[5m])) by (pod, namespace)' },
      { id: 'kfo-pod-net-tx', title: 'Pod Network TX (bytes/s)', type: 'line_chart', grid: { x: 12, y: 31, w: 12, h: 4 }, query: 'sum(rate(container_network_transmit_bytes_total{cluster=~"$cluster",namespace=~"$namespace",pod=~"$pod"}[5m])) by (pod, namespace)' },
      // Control Plane
      { id: 'kfo-api-latency', title: 'API Server Latency p99 (s)', type: 'line_chart', grid: { x: 0,  y: 35, w: 12, h: 4 }, query: 'histogram_quantile(0.99, sum(rate(apiserver_request_duration_seconds_bucket{cluster=~"$cluster"}[5m])) by (le, verb))' },
      { id: 'kfo-api-errors',  title: 'API Server 5xx Error Rate',  type: 'line_chart', grid: { x: 12, y: 35, w: 12, h: 4 }, query: 'sum(rate(apiserver_request_total{cluster=~"$cluster",code=~"5.."}[5m])) by (verb, resource)', thresholds: [{ value: 1, color: '#ef4444' }] },
      // Workloads
      { id: 'kfo-deploy-unavail', title: 'Deployments with Unavailable Replicas', type: 'table', grid: { x: 0,  y: 39, w: 12, h: 4 }, query: 'kube_deployment_status_replicas_unavailable{cluster=~"$cluster",namespace=~"$namespace"} > 0' },
      { id: 'kfo-hpa-at-max',    title: 'HPAs at Max Capacity',                   type: 'stat',  grid: { x: 12, y: 39, w: 6,  h: 4 }, query: 'count(kube_horizontalpodautoscaler_status_current_replicas{cluster=~"$cluster"} == kube_horizontalpodautoscaler_spec_max_replicas{cluster=~"$cluster"})', thresholds: [{ value: 1, color: '#f97316' }] },
      { id: 'kfo-pvc-usage',     title: 'PVC Usage %',                             type: 'gauge', grid: { x: 18, y: 39, w: 6,  h: 4 }, query: 'kubelet_volume_stats_used_bytes{cluster=~"$cluster",namespace=~"$namespace"} / kubelet_volume_stats_capacity_bytes{cluster=~"$cluster",namespace=~"$namespace"} * 100', thresholds: [{ value: 80, color: '#eab308' }, { value: 95, color: '#ef4444' }] },
      // Pod Resource Requests & Limits
      { id: 'kfo-pod-cpu-req',      title: 'Pod CPU Requests (cores)',            type: 'table',      grid: { x: 0,  y: 43, w: 12, h: 6 }, query: 'sum by (pod, namespace, container) (kube_pod_container_resource_requests{resource="cpu",cluster=~"$cluster",namespace=~"$namespace",pod=~"$pod"})' },
      { id: 'kfo-pod-cpu-lim',      title: 'Pod CPU Limits (cores)',              type: 'table',      grid: { x: 12, y: 43, w: 12, h: 6 }, query: 'sum by (pod, namespace, container) (kube_pod_container_resource_limits{resource="cpu",cluster=~"$cluster",namespace=~"$namespace",pod=~"$pod"})' },
      { id: 'kfo-pod-cpu-util-lim', title: 'Pod CPU Limit Utilization %',         type: 'table',      grid: { x: 0,  y: 49, w: 12, h: 6 }, query: '100 * sum by (pod, namespace) (rate(container_cpu_usage_seconds_total{cluster=~"$cluster",namespace=~"$namespace",pod=~"$pod",container!=""}[5m])) / sum by (pod, namespace) (kube_pod_container_resource_limits{resource="cpu",cluster=~"$cluster",namespace=~"$namespace",pod=~"$pod"})', thresholds: [{ value: 80, color: '#eab308' }, { value: 95, color: '#ef4444' }] },
      { id: 'kfo-pod-cpu-util-req', title: 'Pod CPU Request Utilization %',       type: 'table',      grid: { x: 12, y: 49, w: 12, h: 6 }, query: '100 * sum by (pod, namespace) (rate(container_cpu_usage_seconds_total{cluster=~"$cluster",namespace=~"$namespace",pod=~"$pod",container!=""}[5m])) / sum by (pod, namespace) (kube_pod_container_resource_requests{resource="cpu",cluster=~"$cluster",namespace=~"$namespace",pod=~"$pod"})' },
      { id: 'kfo-pod-mem-req',      title: 'Pod Memory Requests (bytes)',          type: 'table',      grid: { x: 0,  y: 55, w: 12, h: 6 }, query: 'sum by (pod, namespace, container) (kube_pod_container_resource_requests{resource="memory",cluster=~"$cluster",namespace=~"$namespace",pod=~"$pod"})' },
      { id: 'kfo-pod-mem-lim',      title: 'Pod Memory Limits (bytes)',            type: 'table',      grid: { x: 12, y: 55, w: 12, h: 6 }, query: 'sum by (pod, namespace, container) (kube_pod_container_resource_limits{resource="memory",cluster=~"$cluster",namespace=~"$namespace",pod=~"$pod"})' },
      { id: 'kfo-pod-mem-util-lim', title: 'Pod Memory Limit Utilization %',       type: 'table',      grid: { x: 0,  y: 61, w: 12, h: 6 }, query: '100 * sum by (pod, namespace) (container_memory_working_set_bytes{cluster=~"$cluster",namespace=~"$namespace",pod=~"$pod",container!=""}) / sum by (pod, namespace) (kube_pod_container_resource_limits{resource="memory",cluster=~"$cluster",namespace=~"$namespace",pod=~"$pod"})', thresholds: [{ value: 80, color: '#eab308' }, { value: 95, color: '#ef4444' }] },
      { id: 'kfo-pod-mem-util-req', title: 'Pod Memory Request Utilization %',     type: 'bar_chart',  grid: { x: 12, y: 61, w: 12, h: 6 }, query: '100 * sum by (pod, namespace) (container_memory_working_set_bytes{cluster=~"$cluster",namespace=~"$namespace",pod=~"$pod",container!=""}) / sum by (pod, namespace) (kube_pod_container_resource_requests{resource="memory",cluster=~"$cluster",namespace=~"$namespace",pod=~"$pod"})' },
    ],
  },

  // ── Real User Monitoring (Faro) ──────────────────────────────────
  {
    template_id: 'rum-overview',
    category: 'RUM',
    name: 'Real User Monitoring',
    description: 'Browser performance — Core Web Vitals, JS errors, page load times, sessions',
    tags: ['rum', 'faro', 'browser', 'web-vitals'],
    requires_vendor: null,
    panels: [
      { id: 'lcp', title: 'Largest Contentful Paint (LCP)', type: 'gauge', grid: { x: 0, y: 0, w: 8, h: 4 }, query: 'avg(browser_web_vitals_lcp_milliseconds)', thresholds: [{ value: 2500, color: '#eab308' }, { value: 4000, color: '#ef4444' }] },
      { id: 'inp', title: 'Interaction to Next Paint (INP)', type: 'gauge', grid: { x: 8, y: 0, w: 8, h: 4 }, query: 'avg(browser_web_vitals_inp_milliseconds)', thresholds: [{ value: 200, color: '#eab308' }, { value: 500, color: '#ef4444' }] },
      { id: 'cls', title: 'Cumulative Layout Shift (CLS)', type: 'gauge', grid: { x: 16, y: 0, w: 8, h: 4 }, query: 'avg(browser_web_vitals_cls)', thresholds: [{ value: 0.1, color: '#eab308' }, { value: 0.25, color: '#ef4444' }] },
      { id: 'js-errors', title: 'JS Error Rate', type: 'line_chart', grid: { x: 0, y: 4, w: 12, h: 4 }, query: 'sum(rate(browser_errors_total[5m]))' },
      { id: 'page-load', title: 'Page Load Time by URL (ms)', type: 'table', grid: { x: 12, y: 4, w: 12, h: 4 }, query: 'topk(20, avg(browser_page_load_milliseconds) by (url_path))' },
      { id: 'sessions', title: 'Active Sessions Over Time', type: 'line_chart', grid: { x: 0, y: 8, w: 12, h: 4 }, query: 'sum(rate(browser_sessions_total[5m]))' },
      { id: 'browsers', title: 'Sessions by Browser', type: 'bar_chart', grid: { x: 12, y: 8, w: 12, h: 4 }, query: 'sum(browser_sessions_total) by (browser_name)' },
    ],
  },
];

/** Group templates by category */
export function getTemplatesByCategory(templates: DashboardTemplate[]): Record<string, DashboardTemplate[]> {
  const groups: Record<string, DashboardTemplate[]> = {};
  for (const t of templates) {
    if (!groups[t.category]) groups[t.category] = [];
    groups[t.category].push(t);
  }
  return groups;
}
