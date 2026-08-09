import { headers as natsHeaders } from 'nats';
import type { JetStreamClient, MsgHdrs, Msg, JsMsg } from 'nats';
import { injectTraceContext, runWithExtractedContext } from './tracing';

/**
 * Drop-in replacement for `js.publish(subject, data, opts?)` that injects the
 * current W3C trace context into the NATS message headers so downstream
 * workers can continue the same distributed trace.
 */
export async function tracedPublish(
  js: JetStreamClient,
  subject: string,
  data: Uint8Array,
  extraHeaders?: Record<string, string>,
): Promise<void> {
  const hdrs: MsgHdrs = natsHeaders();
  const carrier = injectTraceContext();
  for (const [k, v] of Object.entries({ ...carrier, ...extraHeaders })) {
    hdrs.set(k, v);
  }
  await js.publish(subject, data, { headers: hdrs });
}

/**
 * Extracts the W3C trace context from a NATS message's headers and runs `fn`
 * as a child of that context.  Call this at the top of every worker's message
 * handler so all spans, logs, and DB queries inside the handler belong to the
 * same distributed trace that originated the publish.
 *
 * Usage:
 *   await withMsgTraceContext(msg, async () => {
 *     // all code here is a child of the publishing request's trace
 *   });
 */
export async function withMsgTraceContext<T>(msg: Msg | JsMsg, fn: () => Promise<T>): Promise<T> {
  const carrier: Record<string, string> = {};
  if (msg.headers) {
    for (const key of ['traceparent', 'tracestate']) {
      const val = msg.headers.get(key);
      if (val) carrier[key] = val;
    }
  }
  return runWithExtractedContext(carrier, fn);
}
