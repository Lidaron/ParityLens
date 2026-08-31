export function selectedStepRuntimeFacts(execution, step) {
  const outcome = step?.data?.outcome;
  return {
    version: execution.version,
    outcome: step ? outcome?.id ?? step.status : 'Not executed',
    outcomeFailed: outcome?.kind === 'failure',
    duration: step ? `${step.durationMs} ms` : '\u2014',
    layer: step?.data?.layerName ?? '\u2014',
  };
}

export function selectedStepTraceCounts(trace) {
  return {
    alignedSteps: trace.length,
    capturedSpans: trace.reduce(
      (count, pair) => count + Number(Boolean(pair.baseline)) + Number(Boolean(pair.candidate)),
      0),
  };
}