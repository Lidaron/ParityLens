import { standardFieldName } from './settings-options.js';

export { standardFieldName };

export function pairRuntimeFieldKeys(baseline, candidate) {
  const baselineKeys = Object.keys(baseline);
  const candidateKeys = Object.keys(candidate);
  const exactKeys = new Set(baselineKeys.filter(key => Object.hasOwn(candidate, key)));
  const unmatchedBaseline = baselineKeys.filter(key => !exactKeys.has(key));
  const unmatchedCandidate = candidateKeys.filter(key => !exactKeys.has(key));
  const baselineByStandardName = groupKeysByStandardName(unmatchedBaseline);
  const candidateByStandardName = groupKeysByStandardName(unmatchedCandidate);
  const pairedBaseline = new Set();
  const pairedCandidate = new Set();
  const pairs = [...exactKeys].map(key => ({ baseline: key, candidate: key }));

  for (const [standardName, keys] of baselineByStandardName) {
    const candidates = candidateByStandardName.get(standardName) ?? [];
    if (keys.length !== 1 || candidates.length !== 1) continue;
    pairs.push({ baseline: keys[0], candidate: candidates[0] });
    pairedBaseline.add(keys[0]);
    pairedCandidate.add(candidates[0]);
  }

  pairs.push(
    ...unmatchedBaseline.filter(key => !pairedBaseline.has(key)).map(key => ({ baseline: key, candidate: null })),
    ...unmatchedCandidate.filter(key => !pairedCandidate.has(key)).map(key => ({ baseline: null, candidate: key })));
  return pairs.sort((left, right) =>
    (left.baseline ?? left.candidate).localeCompare(right.baseline ?? right.candidate));
}

function groupKeysByStandardName(keys) {
  const groups = new Map();
  keys.forEach(key => {
    const standardName = standardFieldName(key);
    groups.set(standardName, [...(groups.get(standardName) ?? []), key]);
  });
  return groups;
}

export function dataNodeDefaultOpen({
  depth,
  descendantChanges,
  expandChangedSubfields = false,
  status,
  expandShapeDifferences = false,
  shapeMismatch = false,
  shapeMismatchAncestor = false,
  scalarShapeMismatch = false,
}) {
  if (scalarShapeMismatch) return false;
  if (expandChangedSubfields) return descendantChanges > 0;
  return depth === 0
    || ((status !== 'unchanged' && status !== 'excluded') && depth < 2)
    || (expandShapeDifferences && (shapeMismatch || shapeMismatchAncestor));
}

export function dataValueWithRuntimeNames(value, fieldPaths, fieldPath = '$') {
  if (Array.isArray(value)) {
    return value.map((item, index) => dataValueWithRuntimeNames(item, fieldPaths, `${fieldPath}[${index}]`));
  }
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const childPath = `${fieldPath}.${key}`;
    const runtimePath = fieldPaths?.[childPath];
    const runtimeName = runtimePath?.match(/\[[^\]]+\]$/)?.[0]
      ?? runtimePath?.slice(runtimePath.lastIndexOf('.') + 1);
    return [runtimeName || key, dataValueWithRuntimeNames(item, fieldPaths, childPath)];
  }));
}