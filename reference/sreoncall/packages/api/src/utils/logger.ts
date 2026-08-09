import winston from 'winston';
import { trace } from '@opentelemetry/api';

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

// Automatically inject traceId + spanId from the active OTel span into every
// log entry so logs in Loki/Grafana can be correlated with traces in Tempo.
const traceContextFormat = winston.format((info) => {
  const span = trace.getActiveSpan();
  if (span) {
    const ctx = span.spanContext();
    if (trace.isSpanContextValid(ctx)) {
      info.traceId = ctx.traceId;
      info.spanId = ctx.spanId;
    }
  }
  return info;
})();

const devFormat = combine(
  traceContextFormat,
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ timestamp, level, message, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    if (stack) {
      return `${timestamp} ${level}: ${message}\n${stack}${metaStr}`;
    }
    return `${timestamp} ${level}: ${message}${metaStr}`;
  })
);

const prodFormat = combine(
  traceContextFormat,
  timestamp(),
  errors({ stack: true }),
  json()
);

const isProduction = process.env.NODE_ENV === 'production';

export const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  format: isProduction ? prodFormat : devFormat,
  defaultMeta: { service: 'sreoncall-api' },
  transports: [new winston.transports.Console()],
  exitOnError: false,
});
