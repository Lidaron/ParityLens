export function traceServiceEndpointIndex(trace, lane) {
  const serviceBoundaryIndex = trace.findIndex(pair =>
    pair[lane]?.data?.functionRole === 'serviceBoundary');
  if (serviceBoundaryIndex >= 0) return serviceBoundaryIndex;
  return Math.max(0, trace.length - 1);
}
