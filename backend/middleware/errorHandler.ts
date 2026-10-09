import { Request, Response, NextFunction } from 'express';

/**
 * Global error handler middleware
 * Catches all unhandled errors and returns consistent error responses
 */

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export class ApiError extends Error implements AppError {
  statusCode: number;
  isOperational: boolean;

  constructor(statusCode: number, message: string, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Common error factories
export class BadRequestError extends ApiError {
  constructor(message = 'Bad Request') {
    super(400, message);
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = 'Unauthorized') {
    super(401, message);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'Forbidden') {
    super(403, message);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Not Found') {
    super(404, message);
  }
}

export class ConflictError extends ApiError {
  constructor(message = 'Conflict') {
    super(409, message);
  }
}

export class InternalServerError extends ApiError {
  constructor(message = 'Internal Server Error') {
    super(500, message, false);
  }
}

/**
 * Global error handler
 */
export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  // Log error details for debugging
  if (statusCode >= 500) {
    console.error('[ERROR]', {
      method: req.method,
      path: req.path,
      statusCode,
      message,
      stack: err.stack,
      user: (req as any).user?.id,
    });
  }

  // Don't expose internal error details in production
  const isProduction = process.env.NODE_ENV === 'production';
  const responseMessage = isProduction && statusCode >= 500
    ? 'Internal Server Error'
    : message;

  res.status(statusCode).json({
    error: responseMessage,
    ...(err.isOperational === false && !isProduction && { stack: err.stack }),
  });
}

/**
 * Async handler wrapper - catches errors in async route handlers
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Not found handler - catches 404s
 */
export function notFoundHandler(req: Request, res: Response, next: NextFunction) {
  next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
}
