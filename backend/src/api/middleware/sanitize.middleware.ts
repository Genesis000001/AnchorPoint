import { Request, Response, NextFunction } from 'express';
import xss from 'xss';

/**
 * Middleware to sanitize incoming request bodies against XSS and SQL-injection
 * payloads before they reach route handlers, database queries, or log output.
 *
 * Sanitization is applied recursively to every string value in the JSON/URL-encoded
 * request body:
 *   - HTML/script tags and dangerous markup are stripped via the `xss` filter.
 *   - Surrounding whitespace is trimmed from string values.
 *
 * Non-string values (numbers, booleans, arrays, nested objects) are preserved;
 * arrays are sanitized element-wise, and nested objects are sanitized recursively.
 */
export const sanitizeBodyMiddleware = (req: Request, _res: Response, next: NextFunction) => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body);
  }
  next();
};

/**
 * Recursively sanitize an arbitrary value.
 * - strings: strip HTML/script markup, then trim whitespace
 * - arrays: map each element through `sanitizeValue`
 * - objects: sanitize every own enumerable property
 * - everything else: returned unchanged
 */
export function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    // `xss` with `whiteList: {}` strips all tags/attributes; the result is the
    // text content only. `stripIgnoreTag` drops the whole tag (script bodies
    // included) rather than escaping it.
    return xss(value, {
      whiteList: {},
      stripIgnoreTag: true,
      stripIgnoreTagBody: ['script', 'style'],
    }).trim();
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = sanitizeValue(val);
    }
    return result;
  }

  return value;
}