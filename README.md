# open-tidb

Validates and coerces key-value attribute pairs against OpenTelemetry semantic type constraints, returning a clean object you can hand to an exporter or log line.

## Usage

```js
import { sanitizeAttributes, sanitizeAttribute, sanitizeValue, sanitizeKey, AttributeValidationError } from 'open-tidb';

// Sanitize a whole bag of attributes at once.
const clean = sanitizeAttributes({
  'http.method': 'GET',
  'http.status_code': 200,
  'retry.count': 3,
  'tags': ['auth', 'cache'],
  'enabled': true,
});
// clean === { 'http.method': 'GET', 'http.status_code': 200, 'retry.count': 3, 'tags': ['auth', 'cache'], 'enabled': true }

// Sanitize one pair.
const one = sanitizeAttribute('user.id', 42);
// one === { key: 'user.id', value: 42 }

// Invalid input throws AttributeValidationError.
try {
  sanitizeAttributes({ 'bad key': NaN });
} catch (e) {
  if (e instanceof AttributeValidationError) {
    // handle validation failure
  } else {
    throw e;
  }
}
```

The exports are: `sanitizeAttributes`, `sanitizeAttribute`, `sanitizeValue`, `sanitizeKey`, and the `AttributeValidationError` class. `sanitizeAttributes` accepts a plain object or a `Map` and returns a fresh plain object — the input is never mutated.

## Why this exists

OpenTelemetry attribute values must be `string | boolean | number | homogeneous array of those`. Exporters and collectors enforce this late, often by dropping the entire batch when they hit a bad value. This library checks early, at the call site where the bad value was produced, so you find out about the problem immediately and can fix the caller rather than losing telemetry downstream.

A few deliberate trade-offs:

- **Top-level `null` is rejected**, even though the OTel spec permits null values to be silently dropped. Dropping is the wrong default here — it hides bugs. If you want drop-on-null behaviour, catch `AttributeValidationError` and skip the key yourself.
- **`NaN` and `±Infinity` are rejected.** They are not representable in the OTLP JSON encoding most collectors use, so emitting them risks an entire batch being rejected on export.
- **Attribute keys must not contain whitespace or control characters.** This is stricter than the spec (which only caps length at 255 and requires non-empty). Keys with spaces are almost always caller bugs and they break log grepping; rejecting them up front is worth the strictness.
- **Null elements inside arrays are tolerated**, not rejected. Real SDKs emit them, the spec says they "should not" be present, and rejecting them would break those callers. They pass through unchanged.

## Edge you will hit

If you pass a value that is a plain `object` (not an array), a `function`, a `symbol`, or `undefined`, it will throw. These are not representable as OTel attribute values and there is no useful coercion. Wrap structured data in a JSON string yourself before attributing it, rather than relying on this library to guess.
