import assert from 'node:assert/strict';
import test from 'node:test';

import {
  documentSymbolCatalog,
  enumEndpointChoices,
  enumMemberChoices,
  fieldChoiceHierarchy,
  fieldEndpointChoices,
  fieldKey,
  impactfulFields,
  mergeSymbolCatalog,
  moveItem,
  newEntity,
  newOperation,
  newScenario,
  operationParameterSchema,
  operationRequestView,
  parseJsonEditor,
  replaceDictionaryEntry,
  richPickerPlacement,
  setScenarioResponseEnabled,
  standardFieldName,
  standardFieldPath,
  validationProblemTarget,
} from '../../src/ParityLens.Web/wwwroot/settings-options.js';

test('field choices include every observed path for the runtime', () => {
  const mapped = field('csharp', 'type', 'MappedOwner', '$["mapped"]', 'field.current', 'run-1');
  const correlatedElsewhere = field('csharp', 'type', 'OtherOwner', '$["other"]', 'field.other', 'run-2');
  const uncorrelated = field('csharp', 'function', 'DynamicOwner', '$["new"]', null, 'run-3');
  const rust = field('rust', 'type', 'RustOwner', '$["mapped"]', 'field.current', 'run-1');
  const definition = { id: 'field.current', endpoints: [mapped] };

  const beforeInventory = fieldEndpointChoices(definition, [], 'csharp');
  const choices = fieldEndpointChoices(definition, [correlatedElsewhere, uncorrelated, rust], 'csharp');

  assert.deepEqual(beforeInventory.map(fieldKey), [fieldKey(mapped)]);
  assert.deepEqual(choices.map(fieldKey), [mapped, correlatedElsewhere, uncorrelated].map(fieldKey));
});

test('field identity uses standard casing across C# and Rust paths', () => {
  assert.equal(standardFieldName('HTTPClientId'), 'http_client_id');
  assert.equal(standardFieldName('http_client_id'), 'http_client_id');
  assert.equal(standardFieldPath('$["DisplayName"][*]["HTTPClientId"]'), '$["display_name"][*]["http_client_id"]');
  assert.equal(
    fieldKey(field('csharp', 'type', 'Sdk.User', '$["DisplayName"]', null, 'run-1')),
    fieldKey(field('csharp', 'type', 'Sdk.User', '$["display_name"]', null, 'run-2')));
});

test('enum type choices aggregate runs while excluding symbols paired elsewhere', () => {
  const current = { runtimeId: 'csharp', symbol: 'Sdk.Current' };
  const pairings = [
    { endpoints: [current] },
    { endpoints: [{ runtimeId: 'csharp', symbol: 'Sdk.AlreadyPaired' }] },
  ];
  const inventory = [
    { runtimeId: 'csharp', symbol: 'Sdk.FromAnotherRun', runId: 'run-2' },
    { runtimeId: 'csharp', symbol: 'Sdk.AlreadyPaired', runId: 'run-3' },
    { runtimeId: 'rust', symbol: 'sdk::RustType', runId: 'run-2' },
  ];

  const choices = enumEndpointChoices(pairings[0], 0, pairings, inventory, 'csharp');

  assert.deepEqual(choices.map(choice => choice.symbol), ['Sdk.Current', 'Sdk.FromAnotherRun']);
});

test('enum member choices include the aggregate catalog and preserve the current symbol', () => {
  const item = {
    endpoints: [{ runtimeId: 'rust', symbol: 'sdk::Kind' }],
    members: [
      { symbols: { rust: 'sdk::Kind::CURRENT' } },
      { symbols: { rust: 'sdk::Kind::USED' } },
    ],
  };
  const inventory = [{
    runtimeId: 'rust',
    symbol: 'sdk::Kind',
    runId: 'run-with-catalog',
    members: [
      { symbol: 'sdk::Kind::CURRENT', name: 'CURRENT', value: 1 },
      { symbol: 'sdk::Kind::USED', name: 'USED', value: 2 },
      { symbol: 'sdk::Kind::AVAILABLE', name: 'AVAILABLE', value: 3 },
    ],
  }];

  const choices = enumMemberChoices(item, 0, inventory, 'rust');

  assert.deepEqual(choices.map(choice => choice.symbol), ['sdk::Kind::CURRENT', 'sdk::Kind::AVAILABLE']);
  assert.equal(choices[0].value, 1);
});

test('a new field pairing can select persisted CombinedContext paths without a live observation', () => {
  const combinedContext = field('csharp', 'function', 'Tuple', '$["item1"]', 'output.user', 'old-run');
  combinedContext.functionSymbol = 'Sdk.CombinedContext.GetAuthResolutionContext';
  const catalog = documentSymbolCatalog({
    fields: [{ id: 'output.user', endpoints: [combinedContext] }],
    enums: [],
  });

  const choices = fieldEndpointChoices({ id: 'field.new', endpoints: [] }, catalog.fields, 'csharp');

  assert.equal(choices.length, 1);
  assert.equal(choices[0].functionSymbol, 'Sdk.CombinedContext.GetAuthResolutionContext');
});

test('a deleted enum pairing can be recreated from the retained document catalog', () => {
  const deleted = {
    flags: true,
    endpoints: [
      { runtimeId: 'csharp', symbol: 'Sdk.ResolutionTypes' },
      { runtimeId: 'rust', symbol: 'sdk::ResolutionTypes' },
    ],
    members: [{ symbols: { csharp: 'Sdk.ResolutionTypes.User', rust: 'sdk::ResolutionTypes::USER' } }],
  };
  const retained = documentSymbolCatalog({ fields: [], enums: [deleted] });
  const newPairing = { id: 'enum.new', endpoints: [], members: [] };

  const csharpTypes = enumEndpointChoices(newPairing, 0, [newPairing], retained.enums, 'csharp');
  newPairing.endpoints.push(csharpTypes[0]);
  newPairing.members.push({ symbols: {} });
  const csharpMembers = enumMemberChoices(newPairing, 0, retained.enums, 'csharp');

  assert.deepEqual(csharpTypes.map(item => item.symbol), ['Sdk.ResolutionTypes']);
  assert.deepEqual(csharpMembers.map(item => item.symbol), ['Sdk.ResolutionTypes.User']);
});

test('live enum metadata replaces the retained member values when available', () => {
  const retained = documentSymbolCatalog({
    fields: [],
    enums: [{
      endpoints: [{ runtimeId: 'csharp', symbol: 'Sdk.Kind' }],
      members: [{ symbols: { csharp: 'Sdk.Kind.Value' } }],
    }],
  });
  const observed = {
    fields: [],
    enums: [{
      runtimeId: 'csharp',
      symbol: 'Sdk.Kind',
      members: [{ symbol: 'Sdk.Kind.Value', name: 'Value', value: 7 }],
    }],
  };

  const merged = mergeSymbolCatalog(retained, observed);

  assert.equal(merged.enums[0].members[0].value, 7);
});

test('field hierarchy keeps structured parent and leaf nodes selectable', () => {
  const parent = field('rust', 'function', 'JsonValue', '$["value"]', null, 'run-1');
  const child = field('rust', 'function', 'JsonValue', '$["value"]["displayName"]', null, 'run-1');
  const hierarchy = fieldChoiceHierarchy([parent, child]);

  assert.equal(hierarchy.length, 1);
  assert.equal(hierarchy[0].children[0].segment, 'value');
  assert.equal(hierarchy[0].children[0].choice, parent);
  assert.equal(hierarchy[0].children[0].children[0].segment, 'displayName');
  assert.equal(hierarchy[0].children[0].children[0].choice, child);
});

test('field hierarchy sorts types by their displayed names before function contexts', () => {
  const dynamic = field('csharp', 'function', 'DynamicOwner', '$["dynamic"]', null, 'run-1');
  dynamic.functionSymbol = 'Sdk.Operations.Resolve';
  const zebra = field('csharp', 'type', 'Sdk.Models.Zebra', '$["value"]', null, 'run-1');
  const alpha = field('csharp', 'type', 'Sdk.Models.Alpha', '$["value"]', null, 'run-1');
  const otherAlpha = field('csharp', 'type', 'Other.Models.Alpha', '$["value"]', null, 'run-1');

  const hierarchy = fieldChoiceHierarchy([dynamic, zebra, alpha, otherAlpha]);

  assert.deepEqual(
    hierarchy.map(group => group.scope === 'type' ? group.ownerTypeSymbol : group.functionSymbol),
    ['Other.Models.Alpha', 'Sdk.Models.Alpha', 'Sdk.Models.Zebra', 'Sdk.Operations.Resolve']);
});

test('impactful fields include one-sided normalization opt-outs', () => {
  const paired = { id: 'paired', excluded: false, endpoints: [{ runtimeId: 'csharp' }, { runtimeId: 'rust' }] };
  const excluded = { id: 'excluded', excluded: true, endpoints: [{ runtimeId: 'csharp' }] };
  const inert = { id: 'inert', excluded: false, endpoints: [{ runtimeId: 'rust' }] };
  const inherited = { id: 'inherited', excluded: true, aliases: { csharp: ['value'], rust: ['value'] }, endpoints: [] };
  const draft = { id: 'draft', excluded: false, endpoints: [] };

  assert.deepEqual(
    impactfulFields([paired, excluded, inert, inherited, draft]).map(field => field.id),
    ['paired', 'excluded', 'inert', 'inherited', 'draft']);
});

test('rich picker overlay placement does not depend on document flow', () => {
  const below = richPickerPlacement(
    { left: 300, top: 100, bottom: 132, width: 260 },
    { width: 1200, height: 900 },
    620);
  const above = richPickerPlacement(
    { left: 980, top: 760, bottom: 792, width: 260 },
    { width: 1200, height: 900 },
    620);

  assert.deepEqual(below, {
    left: 300, width: 620, maxHeight: 430, top: 136, bottom: null, opensAbove: false,
  });
  assert.equal(above.opensAbove, true);
  assert.equal(above.left, 572);
  assert.equal(above.top, null);
  assert.equal(above.bottom, 144);
  assert.equal(above.maxHeight, 430);
});

test('scenario helpers preserve exact fixture text and support actual execution mode', () => {
  const scenario = newScenario([{ id: 'scenario.new-2' }]);
  scenario.response.bodyText = '{"value":"exact\\ntext"}';
  const previousResponse = scenario.response;
  const actual = setScenarioResponseEnabled(scenario, false);
  const restored = setScenarioResponseEnabled(actual, true, previousResponse);

  assert.equal(scenario.id, 'scenario.new-3');
  assert.equal(actual.response, null);
  assert.equal(restored.response, previousResponse);
  assert.equal(restored.response.bodyText, '{"value":"exact\\ntext"}');
});

test('scenario header edits retain row order', () => {
  const headers = replaceDictionaryEntry({ 'content-type': 'text/plain', 'retry-after': '30' }, 0, 'x-content-type', 'application/json');

  assert.deepEqual(Object.entries(headers), [
    ['x-content-type', 'application/json'],
    ['retry-after', '30'],
  ]);
  assert.deepEqual(
    replaceDictionaryEntry(headers, 0, 'retry-after', 'duplicate'),
    headers);
});

test('scenario order changes without mutating the source list', () => {
  const scenarios = [{ id: 'actual' }, { id: 'json-404' }, { id: 'http-503' }];

  const moved = moveItem(scenarios, 2, 1);

  assert.deepEqual(moved.map(item => item.id), ['actual', 'http-503', 'json-404']);
  assert.deepEqual(scenarios.map(item => item.id), ['actual', 'json-404', 'http-503']);
  assert.deepEqual(moveItem(scenarios, 0, -1), scenarios);
});

test('new entity operation contains the complete runtime artifact contract', () => {
  const entity = newEntity([{ id: 'entity.new-2' }]);
  const operation = newOperation(entity, [{ id: 'sdk-entry' }]);

  assert.equal(entity.id, 'entity.new-3');
  assert.equal(operation.rootFunction.id, 'entity.new-3.operation.new-1');
  assert.equal(operation.rootFunction.layerId, 'sdk-entry');
  assert.deepEqual(operation.rootFunction.endpoints, []);
  assert.deepEqual(operation.parameterSchema.map(parameter => parameter.id), ['tenant', 'token']);
  assert.deepEqual(operation.artifact.invocation.arguments, {});
  assert.deepEqual(operation.artifact.request.body, null);
  assert.deepEqual(operation.artifact.response.body, null);
});

test('operation parameter schema exposes only relevant typed inputs', () => {
  const operation = {
    artifact: {
      invocation: {
        tenant: 'contoso.test',
        token: 'fixture-token',
        key: 'user-001',
        querySelect: ['id', 'displayName'],
        arguments: { assignmentMethodFlags: '1', oidsTo: ['user-002'] },
      },
    },
  };

  const parameters = operationParameterSchema(operation);

  assert.deepEqual(parameters.map(parameter => parameter.id), [
    'tenant', 'token', 'key', 'querySelect', 'assignmentMethodFlags', 'oidsTo',
  ]);
  assert.equal(parameters.find(parameter => parameter.id === 'assignmentMethodFlags').label, 'Assignment method flags');
  assert.equal(parameters.find(parameter => parameter.id === 'oidsTo').kind, 'string-list');
});

test('explicit operation parameter schema overrides inferred argument metadata', () => {
  const operation = {
    parameterSchema: [
      { id: 'flag', label: 'Assignment mode', source: 'arguments.flag', kind: 'integer', required: false },
    ],
    artifact: { invocation: { arguments: { flag: '1' } } },
  };

  assert.deepEqual(operationParameterSchema(operation), [{
    id: 'flag',
    label: 'Assignment mode',
    source: 'arguments.flag',
    kind: 'integer',
    required: false,
    value: '1',
  }]);
});

test('HTTP request view omits absent JSON and separates route from runtime matchers', () => {
  const view = operationRequestView({
    method: 'GET',
    route: '/users/{key}',
    artifact: {
      request: {
        method: 'GET',
        pathContains: '/Users/',
        pathAliases: { rust: '/users/' },
        headers: {},
        body: null,
      },
    },
  });

  assert.equal(view.route, '/users/{key}');
  assert.deepEqual(view.pathMatchers, [['default', '/Users/'], ['rust', '/users/']]);
  assert.equal(view.body, undefined);
  assert.deepEqual(view.headers, []);
});

test('JSON editor accepts structured values and reports incomplete input', () => {
  assert.deepEqual(parseJsonEditor('{"value":[1,null]}'), { valid: true, value: { value: [1, null] } });
  assert.equal(parseJsonEditor('{"value":').valid, false);
});

test('validation problems route to pairing sections and fall back to source', () => {
  assert.deepEqual(
    validationProblemTarget('$.scenarios[json-404].response.statusCode must be at least 100.'),
    { section: 'scenarios', collection: 'scenarios', pairingId: 'json-404', itemIndex: null });
  assert.deepEqual(
    validationProblemTarget('$.fields[field.inert] must pair C# and Rust or be excluded.'),
    { section: 'fields', collection: 'fields', pairingId: 'field.inert', itemIndex: null });
  assert.deepEqual(
    validationProblemTarget("$.enums[enum.kind].members reuses rust member symbol 'sdk::Kind::A'."),
    { section: 'enums', collection: 'enums', pairingId: 'enum.kind', itemIndex: null });
  assert.deepEqual(
    validationProblemTarget("$.functions item 'request.send' references unknown layer 'missing'."),
    { section: 'functions', collection: 'functions', pairingId: 'request.send', itemIndex: null });
  assert.deepEqual(
    validationProblemTarget('$.layers[@7].id requires a non-empty value.'),
    { section: 'layers', collection: 'layers', pairingId: null, itemIndex: 7 });
  assert.deepEqual(
    validationProblemTarget('$.entities[users].operations[find-by-key].name requires a non-empty value.'),
    { section: 'entities', collection: 'entities', pairingId: 'users', itemIndex: null, operationId: 'find-by-key', operationIndex: null });
  assert.deepEqual(
    validationProblemTarget('$.entities[@18].name requires a non-empty value.'),
    { section: 'entities', collection: 'entities', pairingId: null, itemIndex: 18, operationId: null, operationIndex: null });
  assert.deepEqual(
    validationProblemTarget('$.entities[users].operations[@2].name requires a non-empty value.'),
    { section: 'entities', collection: 'entities', pairingId: 'users', itemIndex: null, operationId: null, operationIndex: 2 });
  assert.deepEqual(
    validationProblemTarget('Unsupported parity data schema 9.0.0.'),
    { section: 'source', collection: undefined, pairingId: null, itemIndex: null });
});

function field(runtimeId, scope, ownerTypeSymbol, path, fieldId, runId) {
  return {
    runtimeId,
    scope,
    ownerTypeSymbol,
    memberPath: path,
    functionSymbol: scope === 'function' ? 'sdk.dynamic' : undefined,
    direction: scope === 'function' ? 'output' : undefined,
    path,
    fieldId,
    runId,
  };
}