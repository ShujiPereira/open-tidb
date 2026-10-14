/**
 * Public API for the open-tidb attribute sanitizer.
 *
 * Re-exports the public surface from core.js so consumers import from a single
 * entry point.
 */

export { sanitizeAttributes, AttributeValidationError } from './core.js';
export { sanitizeAttribute, sanitizeKey, sanitizeValue } from './core.js';
