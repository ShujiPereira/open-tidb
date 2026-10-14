/**
 * Core implementation of the open-tidb attribute sanitizer.
 *
 * Validates and coerces key-value attribute pairs against the type rules from
 * the OpenTelemetry specification. The spec (Appendix: Attribute values) allows
 * string | boolean | number (64-bit float) | arrays of those | recursively
 * homogeneous arrays. Arrays must contain a single non-array primitive type.
 * Null values are only permitted inside arrays (where they are permitted but
 * not recommended); top-level null is rejected so callers learn about dropped
 * data immediately rather than silently.
 */

/**
 * Thrown when an attribute key or value cannot be coerced into a valid
 * OpenTelemetry attribute. Keeping a dedicated error type (instead of plain
 * Error) lets callers filter validation failures out of unexpected runtime
 * errors via instanceof.
 */
export class AttributeValidationError extends Error {
  /**
   * @param {string} message Human-readable description of the violation.
   */
  constructor(message) {
    super(message);
    this.name = 'AttributeValidationError';
  }
}

const MAX_KEY_LENGTH = 255;

/**
 * Validates a single attribute key.
 *
 * OpenTelemetry keys are non-empty Unicode strings up to 255 characters. We
 * restrict to printable characters and exclude whitespace because keys with
 * spaces or control characters are almost always caller bugs and they make
 * log aggregation painful. This is stricter than the spec; see README.
 *
 * @param {string} key
 * @returns {string} the validated key, unchanged.
 * @throws {AttributeValidationError}
 */
export function sanitizeKey(key) {
  if (typeof key !== 'string') {
    throw new AttributeValidationError(
      `Attribute key must be a string, got ${typeof key}`,
    );
  }
  if (key.length === 0) {
    throw new AttributeValidationError('Attribute key must not be empty');
  }
  if (key.length > MAX_KEY_LENGTH) {
    throw new AttributeValidationError(
      `Attribute key exceeds max length of ${MAX_KEY_LENGTH} (got ${key.length})`,
    );
  }
  // eslint-disable-next-line no-control-regex
  const disallowed = /[\u0000-\u001F\u007F-\u009F\s]/u;
  if (disallowed.test(key)) {
    throw new AttributeValidationError(
      `Attribute key contains whitespace or control characters: ${JSON.stringify(key)}`,
    );
  }
  return key;
}

/**
 * Validates and coerces a single primitive attribute value.
 *
 * Booleans and numbers pass through untouched. Finite numbers are allowed;
 * NaN and ±Infinity are rejected because they are not representable as
 * IEEE-754 double in the OTLP JSON encoding used by most collectors — a
 * collector will reject the entire batch, which is worse than dropping one
 * attribute. Strings pass through (including the empty string). Arrays and
 * null are handled by sanitizeValue, not here.
 *
 * @param {unknown} value
 * @returns {string|number|boolean}
 * @throws {AttributeValidationError}
 */
function sanitizePrimitive(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      throw new AttributeValidationError('Attribute value NaN is not representable in OTLP');
    }
    if (!Number.isFinite(value)) {
      throw new AttributeValidationError('Attribute value must be finite (Infinity rejected)');
    }
    return value;
  }
  const t = typeof value;
  throw new AttributeValidationError(
    `Attribute value has unsupported type: ${t}${t === 'object' ? ` (${value === null ? 'null' : Array.isArray(value) ? 'array' : 'object'})` : ''}`,
  );
}

/**
 * Validates an array attribute value.
 *
 * Empty arrays are allowed (they encode as a null array element). Non-empty
 * arrays must be homogeneous: every element the same primitive type, with no
 * nested arrays. Null elements inside arrays are permitted but flagged here
 * only by being accepted — the spec says they "should not" be emitted, but
 * rejecting them would break real callers whose SDKs already do this.
 *
 * @param {unknown[]} arr
 * @returns {(string|number|boolean|null)[]}
 * @throws {AttributeValidationError}
 */
function sanitizeArray(arr) {
  if (!Array.isArray(arr)) {
    // Should be unreachable; caller checks first.
    throw new AttributeValidationError('Expected array');
  }
  let elementType = null;
  /** @type {(string|number|boolean|null)[]} */
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const el = arr[i];
    if (el === null) {
      // Null array elements are tolerated by the spec; we pass them through
      // unchanged. Downstream collectors will drop them at export time.
      out.push(null);
      continue;
    }
    if (Array.isArray(el)) {
      throw new AttributeValidationError(
        `Nested arrays are not allowed in OpenTelemetry attributes (index ${i})`,
      );
    }
    const coerced = sanitizePrimitive(el);
    const t = typeof coerced;
    if (elementType === null) {
      elementType = t;
    } else if (t !== elementType) {
      throw new AttributeValidationError(
        `Array attribute has mixed element types: expected ${elementType}, got ${t} at index ${i}`,
      );
    }
    out.push(coerced);
  }
  return out;
}

/**
 * Validates and coerces a single attribute value (primitive or array).
 *
 * Top-level null is rejected: the OTel spec drops null attribute values
 * silently, but doing so here would hide a real bug in the caller. Returning
 * an explicit error is the safer default; callers who want "drop on null"
 * behaviour can catch the error and skip the key.
 *
 * @param {unknown} value
 * @returns {string|number|boolean|Array<string|number|boolean|null>}
 * @throws {AttributeValidationError}
 */
export function sanitizeValue(value) {
  if (value === null) {
    throw new AttributeValidationError(
      'Null attribute values are not allowed at top level; drop the key explicitly instead',
    );
  }
  if (Array.isArray(value)) {
    return sanitizeArray(value);
  }
  return sanitizePrimitive(value);
}

/**
 * Validates and coerces a single key-value pair.
 *
 * Returns a fresh object so the caller can safely mutate the result without
 * affecting the input.
 *
 * @param {string} key
 * @param {unknown} value
 * @returns {{key: string, value: string|number|boolean|Array<string|number|boolean|null>}}
 * @throws {AttributeValidationError}
 */
export function sanitizeAttribute(key, value) {
  const sanitizedKey = sanitizeKey(key);
  const sanitizedVal = sanitizeValue(value);
  return { key: sanitizedKey, value: sanitizedVal };
}

/**
 * Validates and coerces a bag of key-value attribute pairs.
 *
 * Iterating in insertion order (Map preserves it; plain objects do too for
 * string keys) keeps the output deterministic for a given input. Duplicate
 * keys in a plain object are naturally deduplicated by JS object semantics;
 * if the caller passes a Map with duplicate keys, the last one wins, which
 * matches the OTel SDK's own behaviour.
 *
 * @param {Record<string, unknown>|Map<string, unknown>} attributes
 * @returns {Record<string, string|number|boolean|Array<string|number|boolean|null>>}
 * @throws {AttributeValidationError}
 */
export function sanitizeAttributes(attributes) {
  if (attributes === null || typeof attributes !== 'object') {
    throw new AttributeValidationError(
      `Attributes must be a plain object or Map, got ${attributes === null ? 'null' : typeof attributes}`,
    );
  }
  if (Array.isArray(attributes)) {
    throw new AttributeValidationError('Attributes must not be an array');
  }

  /** @type {Record<string, string|number|boolean|Array<string|number|boolean|null>>} */
  const out = {};

  if (attributes instanceof Map) {
    for (const [key, value] of attributes) {
      const { key: k, value: v } = sanitizeAttribute(key, value);
      out[k] = v;
    }
  } else {
    // Plain object. for...in covers own and inherited enumerable string keys,
    // but attributes bags should not have meaningful prototype chain data —
    // guard with hasOwnProperty to be safe and explicit.
    for (const key of Object.keys(attributes)) {
      const value = attributes[key];
      const { key: k, value: v } = sanitizeAttribute(key, value);
      out[k] = v;
    }
  }

  return out;
}
