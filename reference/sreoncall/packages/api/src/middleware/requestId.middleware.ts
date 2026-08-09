import { Request, Response, NextFunction } from 'express';
import { trace } from '@opentelemetry/api';
import { v4 as uuidv4 } from 'uuid';

export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const existing = req.headers['x-request-id'];
  req.requestId = (typeof existing === 'string' && existing) ? existing : uuidv4();
  _res.setHeader('X-Request-Id', req.requestId);

  // Tag the active OTel span (created by Express auto-instrumentation) with
  // the request ID so it appears in Tempo's span attributes and can be used
  // to cross-reference logs with traces.
  const span = trace.getActiveSpan();
  if (span) {
    span.setAttribute('request.id', req.requestId);
  }

  next();
}
