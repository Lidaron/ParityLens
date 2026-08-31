import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dataNodeDefaultOpen,
  dataValueWithRuntimeNames,
  pairRuntimeFieldKeys,
} from '../../src/ParityLens.Web/wwwroot/data-tree-options.js';

test('runtime field keys auto-match across camel and snake casing', () => {
  assert.deepEqual(pairRuntimeFieldKeys(
    { maxRetries: 3, retryPolicy: 'fixed' },
    { max_retries: 3, retry_policy: 'fixed' }), [
    { baseline: 'maxRetries', candidate: 'max_retries' },
    { baseline: 'retryPolicy', candidate: 'retry_policy' },
  ]);
});

test('exact field keys take precedence over casing matches', () => {
  const pairs = pairRuntimeFieldKeys(
    { retryPolicy: 'fixed', retry_policy: 'legacy' },
    { retryPolicy: 'fixed' });

  assert.deepEqual(
    pairs.find(pair => pair.baseline === 'retryPolicy'),
    { baseline: 'retryPolicy', candidate: 'retryPolicy' });
  assert.deepEqual(
    pairs.find(pair => pair.baseline === 'retry_policy'),
    { baseline: 'retry_policy', candidate: null });
});

test('changed subfields expand every ancestor regardless of depth', () => {
  assert.equal(dataNodeDefaultOpen({
    depth: 4,
    descendantChanges: 1,
    expandChangedSubfields: true,
    status: 'changed',
  }), true);
});

test('branches without changed subfields default to collapsed', () => {
  assert.equal(dataNodeDefaultOpen({
    depth: 0,
    descendantChanges: 0,
    expandChangedSubfields: true,
    status: 'unchanged',
  }), false);
});

test('a branch changed only by its own field name stays collapsed', () => {
  assert.equal(dataNodeDefaultOpen({
    depth: 2,
    descendantChanges: 0,
    expandChangedSubfields: true,
    status: 'changed',
  }), false);
});

test('legacy shape expansion remains available outside changed-subfield mode', () => {
  assert.equal(dataNodeDefaultOpen({
    depth: 3,
    descendantChanges: 0,
    status: 'changed',
    expandShapeDifferences: true,
    shapeMismatchAncestor: true,
  }), true);
});

test('scalar shape mismatches stay collapsed in every automatic expansion mode', () => {
  assert.equal(dataNodeDefaultOpen({
    depth: 0,
    descendantChanges: 1,
    expandChangedSubfields: true,
    status: 'changed',
    expandShapeDifferences: true,
    shapeMismatch: true,
    scalarShapeMismatch: true,
  }), false);
});

test('serialized node values use original runtime field names', () => {
  const value = {
    'json:display_name': 'Ada',
    'json:addresses': [{ 'json:postal_code': '12345' }],
  };
  const displayValue = dataValueWithRuntimeNames(value, {
    '$.json:profile.json:display_name': '$.Profile.DisplayName',
    '$.json:profile.json:addresses': '$.Profile.Addresses',
    '$.json:profile.json:addresses[0].json:postal_code': '$.Profile.Addresses[0].PostalCode',
  }, '$.json:profile');

  assert.deepEqual(displayValue, {
    DisplayName: 'Ada',
    Addresses: [{ PostalCode: '12345' }],
  });
  assert.equal(Object.hasOwn(value, 'json:display_name'), true);
});