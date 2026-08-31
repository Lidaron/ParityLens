export function fieldKey(item) {
  return item.scope === 'type'
    ? [item.runtimeId, 'type', item.ownerTypeSymbol, standardFieldPath(item.memberPath)].join('|')
    : [item.runtimeId, 'function', item.functionSymbol, item.direction, standardFieldPath(item.path)].join('|');
}

export function standardFieldName(name) {
  return String(name ?? '')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

export function standardFieldPath(path) {
  return String(path ?? '').replace(/\["((?:\\.|[^"\\])*)"\]/g, (_, encodedName) => {
    const name = JSON.parse(`"${encodedName}"`);
    return `[${JSON.stringify(standardFieldName(name))}]`;
  });
}

export function uniqueBy(items, keySelector) {
  return [...new Map(items.map(item => [keySelector(item), item])).values()];
}

export function newScenario(items = []) {
  let index = items.length + 1;
  while (items.some(item => item.id === `scenario.new-${index}`)) index++;
  return {
    id: `scenario.new-${index}`,
    name: 'New scenario',
    summary: 'Describe the response behavior this scenario exercises.',
    tone: 'neutral',
    response: {
      statusCode: 200,
      version: '1.1',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      bodyText: '{}',
    },
  };
}

export function setScenarioResponseEnabled(scenario, enabled, previousResponse = null) {
  return {
    ...scenario,
    response: enabled
      ? scenario.response ?? previousResponse ?? {
        statusCode: 200,
        version: '1.1',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        bodyText: '{}',
      }
      : null,
  };
}

export function replaceDictionaryEntry(dictionary, index, name, value) {
  const entries = Object.entries(dictionary ?? {});
  if (index < 0 || index >= entries.length) return { ...dictionary };
  if (entries.some(([existingName], existingIndex) => existingIndex !== index && existingName === name)) return { ...dictionary };
  entries[index] = [name, value];
  return Object.fromEntries(entries);
}

export function moveItem(items, index, destination) {
  if (index < 0 || index >= items.length || destination < 0 || destination >= items.length) return [...items];
  const result = [...items];
  const [item] = result.splice(index, 1);
  result.splice(destination, 0, item);
  return result;
}

export function newEntity(items = []) {
  let index = items.length + 1;
  while (items.some(item => item.id === `entity.new-${index}`)) index++;
  return {
    id: `entity.new-${index}`,
    name: 'New entity',
    icon: 'box',
    operations: [],
  };
}

export function newOperation(entity, layers = []) {
  const operations = entity?.operations ?? [];
  let index = operations.length + 1;
  while (operations.some(item => item.id === `operation.new-${index}`)) index++;
  const id = `operation.new-${index}`;
  return {
    id,
    name: 'New operation',
    method: 'GET',
    route: '/',
    responseShape: 'entity',
    description: 'Describe the SDK operation.',
    parameterSchema: [
      { id: 'tenant', label: 'Tenant', source: 'tenant', kind: 'string', required: true },
      { id: 'token', label: 'Token fixture', source: 'token', kind: 'secret', required: true },
    ],
    rootFunction: {
      id: `${entity?.id ?? 'entity'}.${id}`,
      layerId: layers[0]?.id ?? '',
      role: 'step',
      aliases: { csharp: [], rust: [] },
      endpoints: [],
    },
    artifact: {
      invocation: {
        tenant: 'contoso.test',
        token: 'parity-harness-placeholder-token',
        querySelect: [],
        arguments: {},
      },
      request: {
        method: 'GET',
        pathContains: '',
        pathAliases: {},
        headers: {},
        body: null,
      },
      response: {
        statusCode: 200,
        version: '1.1',
        headers: { 'content-type': 'application/json' },
        body: null,
      },
    },
  };
}

const invocationParameterDefinitions = [
  { id: 'tenant', label: 'Tenant', source: 'tenant', kind: 'string', required: true },
  { id: 'token', label: 'Token fixture', source: 'token', kind: 'secret', required: true },
  { id: 'keyKind', label: 'Key kind', source: 'keyKind', kind: 'string' },
  { id: 'key', label: 'Key', source: 'key', kind: 'string' },
  { id: 'queryFilter', label: 'Filter', source: 'queryFilter', kind: 'string' },
  { id: 'queryPropertySet', label: 'Property set', source: 'queryPropertySet', kind: 'string' },
  { id: 'queryTop', label: 'Top', source: 'queryTop', kind: 'integer' },
  { id: 'querySkip', label: 'Skip', source: 'querySkip', kind: 'integer' },
  { id: 'queryExpand', label: 'Expand', source: 'queryExpand', kind: 'string' },
  { id: 'querySelect', label: 'Select properties', source: 'querySelect', kind: 'string-list' },
  { id: 'queryOrderBy', label: 'Order by', source: 'queryOrderBy', kind: 'string-list' },
];

export function operationParameterSchema(operation) {
  const invocation = operation?.artifact?.invocation ?? {};
  const explicit = operation?.parameterSchema ?? [];
  const definitions = explicit.length
    ? explicit
    : invocationParameterDefinitions.filter(definition => Object.hasOwn(invocation, definition.source));
  const definedSources = new Set(definitions.map(definition => definition.source));
  const custom = Object.entries(invocation.arguments ?? {})
    .filter(([id]) => !definedSources.has(`arguments.${id}`))
    .map(([id, value]) => ({
      id,
      label: humanizeIdentifier(id),
      source: `arguments.${id}`,
      kind: parameterKind(value),
      required: true,
    }));

  return [...definitions, ...custom]
    .map(definition => ({
      ...definition,
      required: definition.required === true,
      value: parameterValue(invocation, definition.source),
    }));
}

export function operationRequestView(operation) {
  const request = operation?.artifact?.request ?? {};
  const pathMatchers = Object.entries(request.pathAliases ?? {});
  if (request.pathContains) pathMatchers.unshift(['default', request.pathContains]);
  return {
    method: request.method ?? operation?.method ?? 'GET',
    route: operation?.route ?? '/',
    pathMatchers,
    headers: Object.entries(request.headers ?? {}),
    body: request.body ?? undefined,
  };
}

function parameterValue(invocation, source) {
  if (!source.startsWith('arguments.')) return invocation[source];
  return invocation.arguments?.[source.slice('arguments.'.length)];
}

function parameterKind(value) {
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return 'string-list';
  if (Number.isInteger(value)) return 'integer';
  if (typeof value === 'boolean') return 'boolean';
  if (value !== null && typeof value === 'object') return 'json';
  return 'string';
}

function humanizeIdentifier(value) {
  const words = String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_.]+/g, ' ')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function parseJsonEditor(value) {
  try {
    return { valid: true, value: JSON.parse(value) };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

export function documentSymbolCatalog(document) {
  const fields = (document.fields ?? []).flatMap(field => (field.endpoints ?? []).map(endpoint => ({
    ...endpoint,
    fieldId: field.id,
  })));
  const enums = (document.enums ?? []).flatMap(pairing => (pairing.endpoints ?? []).map(endpoint => ({
    ...endpoint,
    flags: pairing.flags ?? false,
    members: (pairing.members ?? []).flatMap(member => {
      const symbol = member.symbols?.[endpoint.runtimeId];
      return symbol ? [{ symbol, name: symbol.split(/::|\./).at(-1), value: '?' }] : [];
    }),
  })));
  return mergeSymbolCatalog({ fields, enums });
}

export function mergeSymbolCatalog(...catalogs) {
  return {
    fields: uniqueBy(catalogs.flatMap(catalog => catalog?.fields ?? []), fieldKey),
    enums: uniqueBy(
      catalogs.flatMap(catalog => catalog?.enums ?? []),
      item => [item.runtimeId, item.symbol].join('|')),
  };
}

export function fieldEndpointChoices(field, inventoryFields, runtimeId) {
  const mapped = (field.endpoints ?? []).filter(item => item.runtimeId === runtimeId);
  const observed = (inventoryFields ?? []).filter(item => item.runtimeId === runtimeId);
  return uniqueBy([...mapped, ...observed], fieldKey);
}

export function impactfulFields(fields) {
  return (fields ?? []).filter(field =>
    (field.endpoints ?? []).length > 0 || field.excluded || !field.aliases);
}

export function fieldChoiceHierarchy(choices) {
  const groups = new Map();
  for (const choice of choices ?? []) {
    const contextKey = choice.scope === 'type'
      ? ['type', choice.ownerTypeSymbol].join('|')
      : ['function', choice.functionSymbol, choice.direction].join('|');
    if (!groups.has(contextKey)) {
      groups.set(contextKey, {
        key: contextKey,
        scope: choice.scope,
        ownerTypeSymbol: choice.ownerTypeSymbol,
        functionSymbol: choice.functionSymbol,
        direction: choice.direction,
        children: new Map(),
      });
    }
    const group = groups.get(contextKey);
    const path = choice.scope === 'type' ? choice.memberPath : choice.path;
    const segments = fieldPathSegments(path);
    let children = group.children;
    let node;
    for (const segment of segments) {
      if (!children.has(segment)) children.set(segment, { segment, choice: null, children: new Map() });
      node = children.get(segment);
      children = node.children;
    }
    if (!node) {
      node = { segment: '$', choice: null, children: new Map() };
      group.children.set('$', node);
    }
    node.choice = choice;
  }
  return [...groups.values()]
    .map(group => ({
      ...group,
      children: sortHierarchyNodes(group.children),
    }))
    .sort(compareFieldChoiceGroups);
}

function compareFieldChoiceGroups(left, right) {
  const scopeOrder = Number(left.scope !== 'type') - Number(right.scope !== 'type');
  if (scopeOrder !== 0) return scopeOrder;
  const labelOrder = fieldChoiceGroupLabel(left).localeCompare(fieldChoiceGroupLabel(right), undefined, {
    sensitivity: 'base',
    numeric: true,
  });
  if (labelOrder !== 0) return labelOrder;
  const leftSymbol = left.scope === 'type' ? left.ownerTypeSymbol : left.functionSymbol;
  const rightSymbol = right.scope === 'type' ? right.ownerTypeSymbol : right.functionSymbol;
  return String(leftSymbol).localeCompare(String(rightSymbol), undefined, { sensitivity: 'base', numeric: true });
}

function fieldChoiceGroupLabel(group) {
  const symbol = group.scope === 'type' ? group.ownerTypeSymbol : group.functionSymbol;
  const withoutGenericArguments = String(symbol ?? '').replace(/\[\[.*$/s, '').replace(/<.*$/s, '');
  const segments = withoutGenericArguments.split(/::|\./);
  return group.scope === 'type' ? segments.at(-1) : segments.slice(-2).join('::');
}

export function richPickerPlacement(trigger, viewport, preferredWidth, preferredHeight = 430) {
  const edge = 8;
  const gap = 4;
  const width = Math.min(Math.max(trigger.width, preferredWidth), viewport.width - edge * 2);
  const left = Math.min(Math.max(edge, trigger.left), viewport.width - width - edge);
  const below = viewport.height - trigger.bottom - gap - edge;
  const above = trigger.top - gap - edge;
  const opensAbove = below < 220 && above > below;
  const availableHeight = opensAbove ? above : below;
  return {
    left,
    width,
    maxHeight: Math.max(120, Math.min(preferredHeight, availableHeight)),
    top: opensAbove ? null : trigger.bottom + gap,
    bottom: opensAbove ? viewport.height - trigger.top + gap : null,
    opensAbove,
  };
}

export function validationProblemTarget(message) {
  const entityPath = String(message ?? '').match(/^\$\.entities\[([^\]]+)\](?:\.operations\[([^\]]+)\])?/);
  if (entityPath) {
    const entityIndex = entityPath[1].startsWith('@') ? Number(entityPath[1].slice(1)) : null;
    const operationIndex = entityPath[2]?.startsWith('@') ? Number(entityPath[2].slice(1)) : null;
    return {
      section: 'entities',
      collection: 'entities',
      pairingId: Number.isInteger(entityIndex) ? null : entityPath[1],
      itemIndex: Number.isInteger(entityIndex) ? entityIndex : null,
      operationId: Number.isInteger(operationIndex) ? null : entityPath[2] ?? null,
      operationIndex: Number.isInteger(operationIndex) ? operationIndex : null,
    };
  }
  const path = String(message ?? '').match(/^\$\.([a-zA-Z-]+)(?:\[([^\]]+)\])?/);
  if (!path) return { section: 'source', collection: undefined, pairingId: null, itemIndex: null };
  const collection = path[1];
  const section = ['scenarios', 'fields', 'enums', 'functions', 'layers'].includes(collection) ? collection : 'source';
  let pairingId = path[2] ?? null;
  if (!pairingId) {
    const quotedId = String(message).match(/(?:item|id) '([^']+)'/);
    pairingId = quotedId?.[1] ?? null;
  }
  const itemIndex = pairingId?.startsWith('@') ? Number(pairingId.slice(1)) : null;
  if (itemIndex !== null) pairingId = null;
  return { section, collection, pairingId, itemIndex: Number.isInteger(itemIndex) ? itemIndex : null };
}

function fieldPathSegments(path = '$') {
  if (path === '$') return ['$'];
  const segments = [];
  const pattern = /\["((?:\\.|[^"])*)"\]|\[\*\]/g;
  for (const match of path.matchAll(pattern)) {
    segments.push(match[0] === '[*]' ? '[*]' : JSON.parse(`"${match[1]}"`));
  }
  return segments.length ? segments : [path];
}

function sortHierarchyNodes(nodes) {
  return [...nodes.values()]
    .sort((left, right) => left.segment.localeCompare(right.segment))
    .map(node => ({ ...node, children: sortHierarchyNodes(node.children) }));
}

export function enumEndpointChoices(item, itemIndex, pairings, inventoryEnums, runtimeId) {
  const current = (item.endpoints ?? []).find(endpoint => endpoint.runtimeId === runtimeId)?.symbol;
  const paired = new Set((pairings ?? [])
    .filter((_, index) => index !== itemIndex)
    .flatMap(pairing => pairing.endpoints ?? [])
    .filter(endpoint => endpoint.runtimeId === runtimeId)
    .map(endpoint => endpoint.symbol));
  return uniqueBy([
    ...(current ? [{ runtimeId, symbol: current }] : []),
    ...(inventoryEnums ?? []).filter(choice => choice.runtimeId === runtimeId && !paired.has(choice.symbol)),
  ], choice => choice.symbol);
}

export function enumMemberChoices(item, memberIndex, inventoryEnums, runtimeId) {
  const type = (item.endpoints ?? []).find(endpoint => endpoint.runtimeId === runtimeId)?.symbol;
  const catalog = (inventoryEnums ?? []).find(entry => entry.runtimeId === runtimeId && entry.symbol === type);
  const current = item.members?.[memberIndex]?.symbols?.[runtimeId];
  const paired = new Set((item.members ?? [])
    .filter((_, index) => index !== memberIndex)
    .map(member => member.symbols?.[runtimeId])
    .filter(Boolean));
  return uniqueBy([
    ...(current ? [{ symbol: current, name: current.split(/::|\./).at(-1), value: '?' }] : []),
    ...(catalog?.members ?? []).filter(choice => !paired.has(choice.symbol)),
  ], choice => choice.symbol);
}