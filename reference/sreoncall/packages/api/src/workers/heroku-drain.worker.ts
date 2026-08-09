import { AckPolicy, DeliverPolicy, JsMsg, ConsumerMessages } from 'nats';
import { getJetStream, getJetStreamManager } from '../config/nats';
import { getDefaultLabels, mergeLabels, enrichLogLine } from '../services/observability-labels.service';
import { logger } from '../utils/logger';

const LOKI_URL = process.env.MANAGED_LOKI_URL || 'http://10.10.1.21:3100';
const MIMIR_URL = process.env.MANAGED_MIMIR_URL || 'http://10.10.1.21:9009';

let consumer: ConsumerMessages | null = null;
let running = false;

interface ParsedLogLine {
  timestamp: string;
  hostname: string;
  appname: string;
  procid: string;
  message: string;
  emitter: 'app' | 'heroku';
  dyno: string | null;
}

interface HerokuMetric {
  name: string;
  value: number;
  unit: string;
  dyno: string;
  app: string;
  timestamp: string;
  errorCode?: string;
}

function normalizeHerokuMetric(rawName: string, rawValue: number, rawUnit: string): { name: string; value: number } {
  let name = `heroku_${rawName}`;
  let value = rawValue;

  switch (rawUnit.toLowerCase()) {
    case 'mb':
      value = rawValue * 1_048_576;
      if (!name.endsWith('_bytes')) name += '_bytes';
      break;
    case 'kb':
      value = rawValue * 1_024;
      if (!name.endsWith('_bytes')) name += '_bytes';
      break;
    case 'bytes':
    case 'byte':
      if (!name.endsWith('_bytes')) name += '_bytes';
      break;
    case '%':
      value = rawValue / 100;
      if (!name.endsWith('_ratio')) name += '_ratio';
      break;
    case 'pages':
      if (!name.endsWith('_total')) name += '_pages_total';
      break;
    default:
      break;
  }

  return { name, value };
}

function parseLogplexBody(body: string): ParsedLogLine[] {
  const lines: ParsedLogLine[] = [];
  const rawLines = body.split('\n').filter((l) => l.trim().length > 0);

  for (const raw of rawLines) {
    const syslogMsg = raw.replace(/^\d+\s+/, '');
    const match = syslogMsg.match(
      /^<\d+>\d*\s*(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S*)\s*-?\s*(.*)/s,
    );

    if (match) {
      const [, timestamp, hostname, appname, procid, , message] = match;
      const emitter: 'app' | 'heroku' = appname === 'heroku' ? 'heroku' : 'app';
      const dynoMatch = message.match(/dyno=(\S+)/);
      lines.push({ timestamp, hostname, appname, procid, message, emitter, dyno: dynoMatch?.[1] || null });
    }
  }
  return lines;
}

function extractHerokuMetrics(lines: ParsedLogLine[], appName: string): HerokuMetric[] {
  const metrics: HerokuMetric[] = [];

  for (const line of lines) {
    if (line.emitter !== 'heroku' && !line.procid.startsWith('heroku-')) continue;

    const sampleMatches = line.message.matchAll(/sample#([\w-]+)=([\d.]+)([A-Za-z%]*)/g);
    for (const [, rawNameRaw, valueStr, rawUnit] of sampleMatches) {
      const rawName = rawNameRaw.replace(/-/g, '_');
      const { name, value } = normalizeHerokuMetric(rawName, parseFloat(valueStr), rawUnit);
      metrics.push({ name, value, unit: rawUnit, dyno: line.dyno || 'unknown', app: appName, timestamp: line.timestamp });
    }

    const errorMatch = line.message.match(/at=error code=([A-Z]\d+)/);
    if (errorMatch) {
      metrics.push({
        name: 'heroku_errors_total',
        value: 1,
        unit: '',
        dyno: line.dyno || 'unknown',
        app: appName,
        timestamp: line.timestamp,
        errorCode: errorMatch[1],
      });
    }
  }

  return metrics;
}

function buildOTLPPayload(metrics: HerokuMetric[], tenantId: string): object {
  const byApp = new Map<string, Map<string, HerokuMetric[]>>();
  for (const m of metrics) {
    if (!byApp.has(m.app)) byApp.set(m.app, new Map());
    const byName = byApp.get(m.app)!;
    if (!byName.has(m.name)) byName.set(m.name, []);
    byName.get(m.name)!.push(m);
  }

  const resourceMetrics = [];
  for (const [app, byName] of byApp) {
    const otlpMetrics = [];
    for (const [metricName, dataPoints] of byName) {
      otlpMetrics.push({
        name: metricName,
        gauge: {
          dataPoints: dataPoints.map((dp) => {
            const tsMs = new Date(dp.timestamp).getTime();
            const attrs: object[] = [
              { key: 'dyno', value: { stringValue: dp.dyno } },
              { key: 'app', value: { stringValue: dp.app } },
              { key: 'source', value: { stringValue: 'heroku' } },
              { key: 'tenant_id', value: { stringValue: tenantId } },
            ];
            if (dp.errorCode) {
              attrs.push({ key: 'error_code', value: { stringValue: dp.errorCode } });
            }
            return {
              attributes: attrs,
              timeUnixNano: String((isNaN(tsMs) ? Date.now() : tsMs) * 1_000_000),
              asDouble: dp.value,
            };
          }),
        },
      });
    }

    resourceMetrics.push({
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: app } },
          { key: 'source', value: { stringValue: 'heroku' } },
          { key: 'tenant_id', value: { stringValue: tenantId } },
        ],
      },
      scopeMetrics: [{ metrics: otlpMetrics }],
    });
  }

  return { resourceMetrics };
}

async function ensureConsumer(): Promise<void> {
  const jsm = getJetStreamManager();
  try {
    await jsm.consumers.info('DRAIN', 'heroku-drain-processor');
  } catch {
    await jsm.consumers.add('DRAIN', {
      durable_name: 'heroku-drain-processor',
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      filter_subject: 'drain.heroku.>',
      max_deliver: 5,
      ack_wait: 30_000_000_000,
    });
    logger.info('Heroku drain consumer created');
  }
}

async function processMessage(msg: JsMsg): Promise<void> {
  try {
    const payload = JSON.parse(new TextDecoder().decode(msg.data));
    const { tenantId, appName, body } = payload;

    if (!tenantId || !body) {
      msg.ack();
      return;
    }

    const lines = parseLogplexBody(body);
    const herokuMetrics = extractHerokuMetrics(lines, appName || 'unknown');
    const customLabels = await getDefaultLabels(tenantId, 'heroku');

    const lokiStreams = lines.map((line) => ({
      stream: mergeLabels(
        {
          source: 'heroku',
          service_name: appName || 'unknown',
          app: appName || 'unknown',
          emitter: line.emitter,
          dyno: line.dyno || '',
          tenant_id: tenantId,
          job: 'heroku',
        },
        customLabels,
      ),
      values: [[
        `${new Date(line.timestamp).getTime() * 1_000_000}`,
        enrichLogLine(line.message, { procid: line.procid, hostname: line.hostname }),
      ]],
    }));

    if (lokiStreams.length > 0) {
      await fetch(`${LOKI_URL}/loki/api/v1/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Scope-OrgID': tenantId },
        body: JSON.stringify({ streams: lokiStreams }),
        signal: AbortSignal.timeout(5000),
      }).catch((err: any) => {
        logger.warn('Failed to push Heroku logs to Loki', { error: err.message, tenantId });
      });
    }

    if (herokuMetrics.length > 0) {
      await fetch(`${MIMIR_URL}/otlp/v1/metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Scope-OrgID': tenantId },
        body: JSON.stringify(buildOTLPPayload(herokuMetrics, tenantId)),
        signal: AbortSignal.timeout(5000),
      }).catch((err: any) => {
        logger.warn('Failed to push Heroku metrics to Mimir', { error: err.message, tenantId });
      });
    }

    logger.debug('Heroku drain processed', { tenantId, app: appName, lines: lines.length, metrics: herokuMetrics.length });
    msg.ack();
  } catch (err: any) {
    logger.error('Heroku drain worker failed to process message', { error: err.message, subject: msg.subject });
    if (msg.info.deliveryCount >= 5) {
      msg.term();
    } else {
      msg.nak(5000);
    }
  }
}

export async function startHerokuDrainWorker(): Promise<void> {
  if (running) return;

  await ensureConsumer();
  const js = getJetStream();
  running = true;

  consumer = await js.consumers.get('DRAIN', 'heroku-drain-processor').then((c) => c.consume());

  (async () => {
    for await (const msg of consumer!) {
      if (!running) break;
      await processMessage(msg);
    }
  })().catch((err) => {
    if (running) {
      logger.error('Heroku drain consumer error', { error: err.message });
    }
  });

  logger.info('Heroku drain worker started');
}

export async function stopHerokuDrainWorker(): Promise<void> {
  running = false;
  if (consumer) {
    consumer.stop();
    consumer = null;
  }
  logger.info('Heroku drain worker stopped');
}
