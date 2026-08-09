import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';
import { getCurrentTraceId } from '../utils/tracing';

export class AppError extends Error {
  public readonly status: number;
  public readonly type: string;
  public readonly detail: string;
  public readonly errors?: any[];

  public readonly title: string;

  constructor(status: number, title: string, detail: string, type?: string, errors?: any[]) {
    super(detail);
    this.status = status;
    this.title = title;
    this.type = type || `https://sreoncall.io/problems/${title.toLowerCase().replace(/\s+/g, '-')}`;
    this.detail = detail;
    this.errors = errors;
    Object.setPrototypeOf(this, AppError.prototype);
  }

  /** Alias for `status` — convenience for code that checks err.statusCode */
  get statusCode(): number {
    return this.status;
  }

  static badRequest(detail: string, errors?: any[]): AppError {
    return new AppError(400, 'Bad Request', detail, undefined, errors);
  }

  static unauthorized(detail = 'Authentication required.'): AppError {
    return new AppError(401, 'Unauthorized', detail);
  }

  static forbidden(detail = 'Insufficient permissions.'): AppError {
    return new AppError(403, 'Forbidden', detail);
  }

  static notFound(resource = 'Resource'): AppError {
    return new AppError(404, 'Not Found', `${resource} not found.`);
  }

  static conflict(detail: string): AppError {
    return new AppError(409, 'Conflict', detail);
  }

  static unprocessable(detail: string, errors?: any[]): AppError {
    return new AppError(422, 'Unprocessable Entity', detail, undefined, errors);
  }

  static paymentRequired(detail: string): AppError {
    return new AppError(402, 'Payment Required', detail);
  }
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  // traceId is the internal OTel/Tempo correlation handle. It is logged
  // server-side for cross-referencing but MUST NOT leak in external response
  // bodies (finding-010 / finding-006-C, pentest 2026-06-11) — doing so hands
  // an attacker a direct pointer into internal observability infrastructure.
  // The opaque per-request `instance` (requestId) is the customer-facing
  // support reference instead.
  const traceId = getCurrentTraceId();

  // Zod validation errors
  if (err instanceof ZodError) {
    const validationErrors = err.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }));

    res.status(422).json({
      type: 'https://sreoncall.io/problems/validation-error',
      title: 'Validation Error',
      status: 422,
      detail: 'Request validation failed.',
      errors: validationErrors,
      instance: req.requestId,
    });
    return;
  }

  // Application errors
  if (err instanceof AppError) {
    const body: any = {
      type: err.type,
      title: err.title,
      status: err.status,
      detail: err.detail,
      instance: req.requestId,
    };
    if (err.errors) {
      body.errors = err.errors;
    }

    if (err.status >= 500) {
      logger.error('Application error', {
        error: err.title,
        status: err.status,
        requestId: req.requestId,
        traceId,
        stack: err.stack,
      });
    }

    res.status(err.status).json(body);
    return;
  }

  // Mongoose validation errors
  if (err.name === 'ValidationError') {
    res.status(422).json({
      type: 'https://sreoncall.io/problems/validation-error',
      title: 'Validation Error',
      status: 422,
      detail: err.message,
      instance: req.requestId,
    });
    return;
  }

  // Mongoose CastError (invalid ObjectId, etc.)
  if (err.name === 'CastError') {
    const field = (err as any).path || 'id';
    res.status(400).json({
      type: 'https://sreoncall.io/problems/bad-request',
      title: 'Bad Request',
      status: 400,
      detail: `Invalid value for ${field}.`,
      instance: req.requestId,
    });
    return;
  }

  // Mongoose duplicate key error
  if ((err as any).code === 11000) {
    const keyValue = (err as any).keyValue || {};
    const fields = Object.keys(keyValue).join(', ');
    res.status(409).json({
      type: 'https://sreoncall.io/problems/duplicate-key',
      title: 'Conflict',
      status: 409,
      detail: `Duplicate value for field(s): ${fields}`,
      instance: req.requestId,
    });
    return;
  }

  // Catch-all for unexpected errors
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    requestId: req.requestId,
    traceId,
  });

  res.status(500).json({
    type: 'https://sreoncall.io/problems/internal-server-error',
    title: 'Internal Server Error',
    status: 500,
    detail: 'An unexpected error occurred.',
    instance: req.requestId,
    ...(traceId && { traceId }),
  });
}
