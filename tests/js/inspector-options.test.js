import assert from 'node:assert/strict';
import test from 'node:test';

import { selectedStepRuntimeFacts, selectedStepTraceCounts } from '../../src/ParityLens.Web/wwwroot/inspector-options.js';

test('selected step facts use trace-local values instead of run-level HTTP status', () => {
  const facts = selectedStepRuntimeFacts(
    { version: 'C# 8.0.3', statusCode: 503 },
    {
      durationMs: 7,
      status: 'ok',
      data: {
        layerName: 'Request construction',
        outcome: { id: 'outcome.ok', kind: 'success' },
      },
    });

  assert.deepEqual(facts, {
    version: 'C# 8.0.3',
    outcome: 'outcome.ok',
    outcomeFailed: false,
    duration: '7 ms',
    layer: 'Request construction',
  });
  assert.equal('statusCode' in facts, false);
});

test('a runtime without the selected step has no borrowed step values', () => {
  assert.deepEqual(selectedStepRuntimeFacts({ version: 'Rust 0.2.2', statusCode: 200 }, null), {
    version: 'Rust 0.2.2',
    outcome: 'Not executed',
    outcomeFailed: false,
    duration: '\u2014',
    layer: '\u2014',
  });
});

test('trace counts distinguish aligned pairs from captured runtime spans', () => {
  assert.deepEqual(selectedStepTraceCounts([
    { baseline: {}, candidate: {} },
    { baseline: {}, candidate: null },
    { baseline: null, candidate: {} },
  ]), {
    alignedSteps: 3,
    capturedSpans: 4,
  });
});