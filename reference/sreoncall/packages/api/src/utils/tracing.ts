import { context, propagation, trace } from '@opentelemetry/api';

/** Returns the trace ID (32-char hex) of the currently active span, or undefined. */
export function getCurrentTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  if (!span) return undefined;
  const ctx = span.spanContext();
  if (!trace.isSpanContextValid(ctx)) return undefined;
  return ctx.traceId;
}

/** Returns the span ID (16-char hex) of the currently active span, or undefined. */
export function getCurrentSpanId(): string | undefined {
  const span = trace.getActiveSpan();
  if (!span) return undefined;
  const ctx = span.spanContext();
  if (!trace.isSpanContextValid(ctx)) return undefined;
  return ctx.spanId;
}

/**
 * Serialises the current trace context (W3C traceparent + tracestate) into a
 * plain object suitable for inclusion in NATS message headers or HTTP headers.
 */
export function injectTraceContext(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}

/**
 * Restores a trace context from a carrier (e.g. NATS message headers) and
 * runs `fn` as a child of that context.  The returned promise resolves with
 * whatever `fn` returns.
 */
export async function runWithExtractedContext<T>(
  carrier: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  const ctx = propagation.extract(context.active(), carrier);
  return context.with(ctx, fn);
}
