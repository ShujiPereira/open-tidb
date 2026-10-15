import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizeAttributes,
  sanitizeAttribute,
  sanitizeKey,
  sanitizeValue,
  AttributeValidationError,
} from '../src/index.js';

describe('sanitizeKey', () => {
  it('passes through a simple ascii key', () => {
    assert.equal(sanitizeKey('http.method'), 'http.method');
  });

  it('passes through a unicode key', () => {
    assert.equal(sanitizeKey('méthode'), 'méthode');
  });

  it('rejects non-string keys', () => {
    assert.throws(
      () => sanitizeKey(/** @type {unknown} */ (123)),
      (e) => e instanceof AttributeValidationError && /must be a string/.test(e.message),
    );
  });

  it('rejects empty keys', () => {
    assert.throws(
      () => sanitizeKey(''),
      AttributeValidationError,
    );
  });

  it('rejects keys with whitespace', () => {
    assert.throws(
      () => sanitizeKey('has space'),
      AttributeValidationError,
    );
  });

  it('rejects keys with control characters', () => {
    assert.throws(
      () => sanitizeKey('a\u0001b'),
      AttributeValidationError,
    );
  });

  it('rejects keys over 255 characters', () => {
    assert.throws(
      () => sanitizeKey('k'.repeat(256)),
      AttributeValidationError,
    );
    // boundary: 255 is ok
    assert.equal(sanitizeKey('k'.repeat(255)).length, 255);
  });
});

describe('sanitizeValue', () => {
  it('passes through strings including empty', () => {
    assert.equal(sanitizeValue('hello'), 'hello');
    assert.equal(sanitizeValue(''), '');
  });

  it('passes through booleans', () => {
    assert.equal(sanitizeValue(true), true);
    assert.equal(sanitizeValue(false), false);
  });

  it('passes through finite numbers', () => {
    assert.equal(sanitizeValue(0), 0);
    assert.equal(sanitizeValue(-1.5), -1.5);
    assert.equal(sanitizeValue(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  });

  it('rejects NaN', () => {
    assert.throws(
      () => sanitizeValue(NaN),
      (e) => e instanceof AttributeValidationError && /NaN/.test(e.message),
    );
  });

  it('rejects Infinity', () => {
    assert.throws(
      () => sanitizeValue(Infinity),
      AttributeValidationError,
    );
    assert.throws(
      () => sanitizeValue(-Infinity),
      AttributeValidationError,
    );
  });

  it('rejects top-level null', () => {
    assert.throws(
      () => sanitizeValue(null),
      (e) => e instanceof AttributeValidationError && /top level/.test(e.message),
    );
  });

  it('rejects objects', () => {
    assert.throws(
      () => sanitizeValue({ a: 1 }),
      (e) => e instanceof AttributeValidationError && /object/.test(e.message),
    );
  });

  it('rejects undefined', () => {
    assert.throws(
      () => sanitizeValue(undefined),
      AttributeValidationError,
    );
  });

  it('rejects functions', () => {
    assert.throws(
      () => sanitizeValue(() => {}),
      AttributeValidationError,
    );
  });

  it('rejects symbols', () => {
    assert.throws(
      () => sanitizeValue(Symbol('s')),
      AttributeValidationError,
    );
  });

  it('accepts empty arrays', () => {
    assert.deepEqual(sanitizeValue([]), []);
  });

  it('accepts homogeneous string arrays', () => {
    assert.deepEqual(sanitizeValue(['a', 'b', 'c']), ['a', 'b', 'c']);
  });

  it('accepts homogeneous number arrays', () => {
    assert.deepEqual(sanitizeValue([1, 2, 3]), [1, 2, 3]);
  });

  it('accepts homogeneous boolean arrays', () => {
    assert.deepEqual(sanitizeValue([true, false, true]), [true, false, true]);
  });

  it('rejects mixed-type arrays', () => {
    assert.throws(
      () => sanitizeValue(['a', 1]),
      (e) => e instanceof AttributeValidationError && /mixed/.test(e.message),
    );
  });

  it('rejects nested arrays', () => {
    assert.throws(
      () => sanitizeValue([[1, 2], [3]]),
      (e) => e instanceof AttributeValidationError && /Nested/.test(e.message),
    );
  });

  it('tolerates null elements inside arrays', () => {
    assert.deepEqual(sanitizeValue(['a', null, 'b']), ['a', null, 'b']);
  });

  it('rejects arrays containing objects', () => {
    assert.throws(
      () => sanitizeValue(['a', { b: 1 }]),
      AttributeValidationError,
    );
  });
});

describe('sanitizeAttribute', () => {
  it('returns {key, value} with validated contents', () => {
    const result = sanitizeAttribute('http.status_code', 200);
    assert.deepEqual(result, { key: 'http.status_code', value: 200 });
  });

  it('preserves array values', () => {
    const result = sanitizeAttribute('tags', ['x', 'y']);
    assert.deepEqual(result, { key: 'tags', value: ['x', 'y'] });
  });
});

describe('sanitizeAttributes', () => {
  it('returns a fresh object with validated pairs', () => {
    const input = { 'http.method': 'GET', 'http.status_code': 200, 'ok': true };
    const out = sanitizeAttributes(input);
    assert.deepEqual(out, input);
    // distinct instance: mutating out must not touch input
    out['http.method'] = 'POST';
    assert.equal(input['http.method'], 'GET');
  });

  it('accepts a Map input', () => {
    const input = new Map([
      ['a', 1],
      ['b', 'two'],
    ]);
    assert.deepEqual(sanitizeAttributes(input), { a: 1, b: 'two' });
  });

  it('preserves insertion order from a Map', () => {
    const input = new Map([
      ['z', 1],
      ['a', 2],
      ['m', 3],
    ]);
    const out = sanitizeAttributes(input);
    assert.deepEqual(Object.keys(out), ['z', 'a', 'm']);
  });

  it('rejects null input', () => {
    assert.throws(
      () => sanitizeAttributes(null),
      AttributeValidationError,
    );
  });

  it('rejects array input', () => {
    assert.throws(
      () => sanitizeAttributes([['a', 1]]),
      AttributeValidationError,
    );
  });

  it('rejects a non-object input', () => {
    assert.throws(
      () => sanitizeAttributes('not-an-object'),
      AttributeValidationError,
    );
  });

  it('propagates the first validation error encountered', () => {
    const input = { 'good': 1, 'bad key': 2 };
    assert.throws(
      () => sanitizeAttributes(input),
      AttributeValidationError,
    );
  });

  it('handles the empty object', () => {
    assert.deepEqual(sanitizeAttributes({}), {});
  });

  it('does not read inherited properties', () => {
    // Be explicit: we do not expect callers to pass objects with interesting
    // prototypes, but the implementation guards against it. We construct an
    // object whose prototype has an extra key to confirm that key is ignored.
    const proto = { leaked: 'should-not-appear' };
    const obj = Object.create(proto);
    obj.kept = 1;
    const out = sanitizeAttributes(obj);
    assert.deepEqual(out, { kept: 1 });
  });
});
