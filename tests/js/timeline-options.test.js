import assert from 'node:assert/strict';
import test from 'node:test';

import { traceServiceEndpointIndex } from '../../src/ParityLens.Web/wwwroot/timeline-options.js';

test('service endpoint placement follows the function role, not its ID', () => {
  const trace = [
    pair('renamed.request', 'step'),
    pair('any.boundary.name', 'serviceBoundary'),
    pair('renamed.response', 'step'),
  ];

  assert.equal(traceServiceEndpointIndex(trace, 'baseline'), 1);
});

test('old traces without a role place the service endpoint after the last event', () => {
  const trace = [
    pair('request', 'step'),
    pair('transport', 'step'),
    pair('response', 'step'),
  ];

  assert.equal(traceServiceEndpointIndex(trace, 'baseline'), 2);
  assert.equal(traceServiceEndpointIndex(trace, 'candidate'), 2);
});

function pair(id, functionRole) {
  const step = { data: { functionRole } };
  return { id, baseline: step, candidate: step };
}
