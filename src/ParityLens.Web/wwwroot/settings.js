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
  uniqueBy,
  validationProblemTarget,
} from './settings-options.js?v=operation-schema-1';

const SECTIONS = [
  ['scenarios', 'Scenarios', 'flask-conical', 'Execution'],
  ['entities', 'Entity operations', 'boxes', 'Execution'],
  ['fields', 'Field paths', 'route', 'Mappings'],
  ['functions', 'Functions', 'function-square', 'Mappings'],
  ['enums', 'Enums', 'list-tree', 'Mappings'],
  ['layers', 'Layers', 'layers-3', 'Architecture'],
  ['history', 'Server versions', 'history', 'Persistence'],
  ['source', 'Source', 'braces', 'Advanced'],
];

export function initializeParitySettingsIde({ button, notify, onSaved }) {
  const element = id => document.querySelector(`#${id}`);
  const ui = {
    dialog: element('parity-settings-dialog'), close: element('settings-close'),
    dirty: element('settings-dirty-indicator'), schema: element('settings-schema-label'),
    inventoryLabel: element('settings-inventory-label'), nav: element('settings-section-nav'),
    content: element('settings-studio-content'), kicker: element('settings-section-kicker'),
    title: element('settings-section-title'), trace: element('settings-trace-filter'),
    refresh: element('settings-refresh-symbols'), validate: element('settings-validate'),
    hotload: element('settings-hotload'), importButton: element('settings-import'),
    importFile: element('settings-import-file'), exportButton: element('settings-export'),
    saveButton: element('settings-save-version'), savePanel: element('settings-save-panel'),
    saveCancel: element('settings-save-cancel'), saveCancelFooter: element('settings-save-cancel-footer'),
    versionLabel: element('settings-version-label'), versionNotes: element('settings-version-notes'),
    saveSummary: element('settings-save-summary'), validation: element('settings-validation-status'),
    problems: element('settings-problem-count'), problemsPanel: element('settings-problems-panel'),
    problemsList: element('settings-problems-list'), problemsClose: element('settings-problems-close'),
    stats: element('settings-document-stats'),
  };
  const state = {
    document: null, saved: '', versions: [], section: 'fields', runId: '', validation: null,
    inventory: { runs: [], functions: [], fields: [], enums: [] }, loading: false,
    symbols: { fields: [], enums: [] },
    renderVersion: 0, readyNotified: false, inventoryLoading: false,
    problemsOpen: false,
    selectedPairing: { scenarios: 0, fields: 0, enums: 0 },
    collapsedPairingPaths: { scenarios: new Set(), fields: new Set(), enums: new Set() },
    scenarioResponseDrafts: new Map(),
    selectedEntity: 0, selectedOperation: 0,
  };

  button.addEventListener('click', async () => {
    ui.dialog.showModal();
    if (!state.document && !state.loading) await load();
  });
  ui.close.addEventListener('click', () => ui.dialog.close());
  ui.nav.addEventListener('click', event => {
    const target = event.target.closest('[data-section]');
    if (target) { state.section = target.dataset.section; render(); }
  });
  ui.trace.addEventListener('change', () => { state.runId = ui.trace.value; renderContentPreservingPairingView(); });
  ui.refresh.addEventListener('click', refreshInventory);
  ui.validate.addEventListener('click', () => validate(true));
  ui.problems.addEventListener('click', () => { state.problemsOpen = !state.problemsOpen; renderProblems(); });
  ui.problemsClose.addEventListener('click', () => { state.problemsOpen = false; renderProblems(); });
  ui.problemsList.addEventListener('click', event => {
    const target = event.target.closest('[data-problem-index]');
    if (target) navigateToProblem(Number(target.dataset.problemIndex));
  });
  ui.hotload.addEventListener('click', hotload);
  ui.importButton.addEventListener('click', () => ui.importFile.click());
  ui.importFile.addEventListener('change', importFile);
  ui.exportButton.addEventListener('click', exportFile);
  ui.saveButton.addEventListener('click', openSave);
  ui.saveCancel.addEventListener('click', closeSave);
  ui.saveCancelFooter.addEventListener('click', closeSave);
  ui.savePanel.addEventListener('submit', saveVersion);
  ui.content.addEventListener('input', editScalar);
  ui.content.addEventListener('change', editSelection);
  ui.content.addEventListener('click', clickAction);
  ui.content.addEventListener('toggle', rememberTreeState, true);
  ui.dialog.addEventListener('scroll', positionOpenPickers, true);
  ui.dialog.addEventListener('pointerdown', event => {
    if (!event.target.closest('.studio-rich-picker')) closeRichPickers();
  });
  window.addEventListener('resize', positionOpenPickers);

  async function load() {
    state.loading = true;
    ui.content.innerHTML = empty('loader-circle', 'Loading parity contract', true);
    icons();
    try {
      const workspace = await api('/api/parity-data');
      state.document = workspace.document;
      rememberDocumentSymbols(state.document);
      state.saved = JSON.stringify(state.document);
      state.versions = workspace.versions ?? [];
      render();
      void validate(false);
      void loadInventory();
    } catch (error) {
      ui.content.innerHTML = empty('triangle-alert', error.message);
      notify(error.message, true);
    } finally { state.loading = false; }
  }

  async function loadInventory() {
    state.inventoryLoading = true;
    ui.inventoryLabel.textContent = 'Loading trace inventory';
    try {
      state.inventory = await api('/api/parity-data/symbols');
      rememberInventorySymbols(state.inventory);
      state.inventoryLoading = false;
      const resolved = resolveObservedMappings();
      updateTraceControls();
      if (state.section === 'fields' || state.section === 'enums') {
        renderContentPreservingPairingView();
        renderStatus();
      } else if (resolved > 0) {
        render();
      } else {
        updateSectionSummary();
      }
      if (resolved > 0) notify(`Resolved ${resolved} exact endpoints from observed traces. Save a server version to persist them.`);
    } catch (error) {
      state.inventoryLoading = false;
      ui.inventoryLabel.textContent = 'Trace inventory unavailable';
      notify(`Studio is ready, but trace inventory failed to load: ${error.message}`, true);
    }
  }

  function render() {
    const active = SECTIONS.find(([id]) => id === state.section) ?? SECTIONS[0];
    ui.schema.textContent = `Schema ${state.document?.schemaVersion ?? 'unknown'}`;
    ui.inventoryLabel.textContent = `${state.inventory.fields?.length ?? 0} observed paths`;
    ui.kicker.textContent = active[3];
    ui.title.textContent = active[1];
    ui.nav.innerHTML = SECTIONS.map(([id, label, icon]) => `<button type="button" class="studio-v2-nav-item${id === state.section ? ' active' : ''}${sectionProblemCount(id) ? ' has-problems' : ''}" data-section="${id}"><i data-lucide="${icon}"></i><span>${label}</span>${count(id)}${problemBadge(sectionProblemCount(id))}</button>`).join('');
    const traced = ['fields', 'functions', 'enums'].includes(state.section);
    ui.trace.hidden = !traced;
    ui.refresh.hidden = !traced;
    updateTraceControls();
    renderContent();
    renderStatus();
    icons();
  }

  function updateTraceControls() {
    ui.inventoryLabel.textContent = state.inventoryLoading
      ? 'Loading trace inventory'
      : `${state.inventory.fields?.length ?? 0} observed paths`;
    ui.trace.innerHTML = `<option value="">All observed traces</option>${(state.inventory.runs ?? []).map(run => `<option value="${esc(run.id)}">${esc(run.label)}</option>`).join('')}`;
    ui.trace.value = state.runId;
  }

  function updateSectionSummary() {
    const summary = ui.content.querySelector('.studio-section-actions > span');
    if (!summary) return;
    if (state.section === 'fields') summary.textContent = `${observed('fields', 'csharp')} C# · ${observed('fields', 'rust')} Rust observed paths`;
    if (state.section === 'functions') summary.textContent = `${observed('functions', 'csharp')} C# · ${observed('functions', 'rust')} Rust observed functions`;
  }

  function renderContent() {
    if (!state.document) return;
    state.renderVersion++;
    ui.content.removeAttribute('aria-busy');
    ui.content.classList.toggle('studio-pairing-workbench-mode', ['scenarios', 'entities', 'fields', 'enums'].includes(state.section));
    const renderers = { scenarios: renderScenarios, entities: renderEntities, fields: renderFields, functions: renderFunctions, enums: renderEnums, layers: renderLayers, history: renderHistory, source: renderSource };
    renderers[state.section]();
    icons();
  }

  function renderContentPreservingPairingView() {
    const tree = ui.content.querySelector('.studio-tree-scroll');
    const scrollTop = tree?.scrollTop ?? 0;
    const scrollLeft = tree?.scrollLeft ?? 0;
    renderContent();
    const renderedTree = ui.content.querySelector('.studio-tree-scroll');
    if (renderedTree) {
      renderedTree.scrollTop = scrollTop;
      renderedTree.scrollLeft = scrollLeft;
    }
  }

  function renderFields() {
    const definitions = state.document.fields ?? [];
    const fields = impactfulFields(definitions);
    const index = selectedPairingIndex('fields', fields);
    const field = fields[index];
    const definitionIndex = definitions.indexOf(field);
    ui.content.innerHTML = actionBar(`${observed('fields', 'csharp')} C# · ${observed('fields', 'rust')} Rust observed paths`, 'add-field', 'Pair field paths') +
      pairingWorkbench('fields', fields, field ? fieldCard(field, definitionIndex) : empty('route', 'No explicit field path pairings'));
    finishAsyncRender(state.renderVersion, 'Field mappings ready');
  }

  function renderScenarios() {
    const scenarios = state.document.scenarios ?? [];
    const index = selectedPairingIndex('scenarios', scenarios);
    const scenario = scenarios[index];
    const fixtures = scenarios.filter(item => item.response !== null).length;
    ui.content.innerHTML = actionBar(`${scenarios.length} scenarios · ${fixtures} HTTP fixtures`, 'add-scenario', 'Add scenario') +
      pairingWorkbench('scenarios', scenarios, scenario ? scenarioCard(scenario, index) : empty('flask-conical', 'No scenarios'));
  }

  function renderEntities() {
    const entities = state.document.entities ?? [];
    const entityIndex = Math.max(0, Math.min(state.selectedEntity, Math.max(0, entities.length - 1)));
    state.selectedEntity = entityIndex;
    const entity = entities[entityIndex];
    const operations = entity?.operations ?? [];
    const operationIndex = Math.max(0, Math.min(state.selectedOperation, Math.max(0, operations.length - 1)));
    state.selectedOperation = operationIndex;
    const operation = operations[operationIndex];
    const operationCount = entities.reduce((total, item) => total + (item.operations?.length ?? 0), 0);
    ui.content.innerHTML = actionBar(`${entities.length} entities · ${operationCount} operations`, 'add-entity', 'Add entity') +
      `<div class="studio-entity-workbench">
        <aside class="studio-entity-tree"><header><span>Entities and operations</span><em>${operationCount}</em></header><div class="studio-tree-scroll">${entities.length ? entities.map((item, index) => entityTreeGroup(item, index)).join('') : empty('boxes', 'No entities')}</div></aside>
        <section class="studio-entity-editor"><header><span>Selected operation</span><code>${esc(entity && operation ? `${entity.id}/${operation.id}` : entity?.id ?? 'None')}</code></header><div class="studio-focused-scroll">${entity ? entityEditor(entity, entityIndex, operation, operationIndex) : empty('boxes', 'Add an entity to begin')}</div></section>
      </div>`;
  }

  function entityTreeGroup(entity, entityIndex) {
    const selectedEntity = entityIndex === state.selectedEntity;
    const entityProblems = pairingProblemCount('entities', entity.id, entityIndex);
    return `<section class="studio-entity-tree-group${selectedEntity ? ' active' : ''}">
      <button type="button" class="studio-entity-tree-entity${entityProblems ? ' has-problems' : ''}" data-action="select-entity" data-entity="${entityIndex}" title="${esc(entity.id)}"><i data-lucide="${esc(entity.icon || 'box')}"></i><span><strong>${esc(entity.name || 'Unnamed entity')}</strong><code>${esc(entity.id)}</code></span><em>${entity.operations?.length ?? 0}</em>${problemBadge(entityProblems)}</button>
      <div>${(entity.operations ?? []).map((operation, operationIndex) => {
        const selected = selectedEntity && operationIndex === state.selectedOperation;
        const problems = operationProblemCount(entity.id, operation.id, operationIndex);
        return `<button type="button" class="studio-entity-tree-operation${selected ? ' active' : ''}${problems ? ' has-problems' : ''}" data-action="select-operation" data-entity="${entityIndex}" data-operation="${operationIndex}" title="${esc(`${entity.id}/${operation.id}`)}"><i data-lucide="${operation.method === 'GET' ? 'arrow-down-to-line' : 'send'}"></i><span>${esc(operation.name || operation.id)}</span><code>${esc(operation.method)}</code>${problemBadge(problems)}</button>`;
      }).join('')}</div>
    </section>`;
  }

  function entityEditor(entity, entityIndex, operation, operationIndex) {
    return `<article class="studio-entity-card" data-problem-section="entities" data-problem-id="${esc(entity.id)}" data-problem-index="${entityIndex}">
      <section class="studio-entity-metadata">
        <header><div><span>Entity</span><strong>${esc(entity.name || 'Unnamed entity')}</strong></div><div class="studio-entity-actions"><button class="text-button studio-text-action" type="button" data-action="add-operation" data-entity="${entityIndex}"><i data-lucide="plus"></i><span>Add operation</span></button>${removeEntityButton(entityIndex)}</div></header>
        <div>${entityInput('Entity ID', 'entity-id', entityIndex, entity.id)}${entityInput('Display name', 'entity-name', entityIndex, entity.name)}${entityInput('Lucide icon', 'entity-icon', entityIndex, entity.icon)}</div>
      </section>
      ${operation ? operationEditor(entity, entityIndex, operation, operationIndex) : `<div class="studio-entity-no-operation"><i data-lucide="workflow"></i><div><strong>No operation selected</strong><span>Add an operation to define its runtime fixture.</span></div></div>`}
    </article>`;
  }

  function operationEditor(entity, entityIndex, operation, operationIndex) {
    const root = operation.rootFunction ?? {};
    const artifact = operation.artifact ?? {};
    const invocation = artifact.invocation ?? {};
    const request = artifact.request ?? {};
    const response = artifact.response ?? {};
    return `<section class="studio-operation-editor" data-operation-id="${esc(operation.id)}">
      <header><div><span>Operation ${operationIndex + 1} of ${entity.operations.length}</span><strong>${esc(operation.name || 'Unnamed operation')}</strong></div><div class="studio-scenario-actions"><button class="icon-button" type="button" data-action="move-operation-up" data-entity="${entityIndex}" data-operation="${operationIndex}" ${operationIndex === 0 ? 'disabled' : ''} aria-label="Move operation up" title="Move up"><i data-lucide="arrow-up"></i></button><button class="icon-button" type="button" data-action="move-operation-down" data-entity="${entityIndex}" data-operation="${operationIndex}" ${operationIndex === entity.operations.length - 1 ? 'disabled' : ''} aria-label="Move operation down" title="Move down"><i data-lucide="arrow-down"></i></button><button class="icon-button" type="button" data-action="duplicate-operation" data-entity="${entityIndex}" data-operation="${operationIndex}" aria-label="Duplicate operation" title="Duplicate"><i data-lucide="copy-plus"></i></button>${removeOperationButton(entityIndex, operationIndex)}</div></header>
      <details class="studio-operation-group" open><summary><i data-lucide="chevron-right"></i><span>Operation metadata</span></summary><div class="studio-operation-grid">${operationInput('Operation ID', 'operation-id', entityIndex, operationIndex, operation.id)}${operationInput('Display name', 'operation-name', entityIndex, operationIndex, operation.name)}${operationSelect('Method', 'operation-method', entityIndex, operationIndex, operation.method, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])}${operationInput('Display route', 'operation-route', entityIndex, operationIndex, operation.route)}${operationSelect('Response shape', 'operation-response-shape', entityIndex, operationIndex, operation.responseShape, ['entity', 'collection'])}<label class="studio-operation-wide"><span>Description</span><textarea data-model="operation-description" data-entity="${entityIndex}" data-operation="${operationIndex}" rows="3">${esc(operation.description)}</textarea></label></div></details>
      <details class="studio-operation-group" open><summary><i data-lucide="chevron-right"></i><span>Root function</span></summary><div class="studio-operation-grid">${operationInput('Function ID', 'operation-root-id', entityIndex, operationIndex, root.id)}${operationSelect('Software layer', 'operation-root-layer', entityIndex, operationIndex, root.layerId, (state.document.layers ?? []).map(layer => layer.id))}${operationInput('C# symbol', 'operation-root-csharp', entityIndex, operationIndex, rootEndpoint(root, 'csharp'))}${operationInput('Rust symbol', 'operation-root-rust', entityIndex, operationIndex, rootEndpoint(root, 'rust'))}${jsonEditor('Runtime aliases', 'operation-root-aliases', entityIndex, operationIndex, root.aliases ?? { csharp: [], rust: [] }, 'studio-operation-wide')}</div></details>
      ${operationParametersEditor(operation, entityIndex, operationIndex)}
      ${operationRequestEditor(operation, entityIndex, operationIndex)}
      <details class="studio-operation-group"><summary><i data-lucide="chevron-right"></i><span>Success response fixture</span></summary><div class="studio-operation-grid">${operationInput('Status code', 'operation-response-status', entityIndex, operationIndex, response.statusCode, 'number')}${operationSelect('HTTP version', 'operation-response-version', entityIndex, operationIndex, response.version, ['1.0', '1.1', '2.0'])}${jsonEditor('Response headers', 'operation-response-headers', entityIndex, operationIndex, response.headers ?? {}, '')}${jsonEditor('JSON body', 'operation-response-body', entityIndex, operationIndex, response.body ?? null, 'studio-operation-wide')}<label class="studio-operation-wide"><span>Exact body text <em>Optional; overrides JSON body</em></span><textarea data-model="operation-response-body-text" data-entity="${entityIndex}" data-operation="${operationIndex}" spellcheck="false" rows="5">${esc(response.bodyText ?? '')}</textarea></label></div></details>
    </section>`;
  }

  function operationParametersEditor(operation, entityIndex, operationIndex) {
    const parameters = operationParameterSchema(operation);
    return `<details class="studio-operation-group" open><summary><i data-lucide="chevron-right"></i><span>Operation inputs</span><em class="studio-summary-count">${parameters.length}</em></summary>
      <div class="studio-contract-section">
        <header><div><strong>SDK call parameters</strong><span>${parameters.filter(parameter => parameter.required).length} required</span></div><button class="text-button studio-text-action" type="button" data-action="add-operation-parameter" data-entity="${entityIndex}" data-operation="${operationIndex}"><i data-lucide="plus"></i><span>Add parameter</span></button></header>
        <div class="studio-parameter-list">${parameters.length ? parameters.map((parameter, parameterIndex) => operationParameterRow(parameter, parameterIndex, entityIndex, operationIndex)).join('') : empty('list-plus', 'No operation inputs')}</div>
      </div>
    </details>`;
  }

  function operationParameterRow(parameter, parameterIndex, entityIndex, operationIndex) {
    const custom = parameter.source.startsWith('arguments.');
    const value = Array.isArray(parameter.value) ? parameter.value.join('\n') : parameter.value ?? '';
    const valueControl = parameter.kind === 'boolean'
      ? `<select data-model="operation-parameter-value" data-entity="${entityIndex}" data-operation="${operationIndex}" data-parameter="${parameterIndex}"><option value="true" ${parameter.value === true ? 'selected' : ''}>True</option><option value="false" ${parameter.value === false ? 'selected' : ''}>False</option></select>`
      : parameter.kind === 'string-list'
        ? `<textarea data-model="operation-parameter-value" data-entity="${entityIndex}" data-operation="${operationIndex}" data-parameter="${parameterIndex}" rows="2" placeholder="One value per line">${esc(value)}</textarea>`
        : `<input type="${parameter.kind === 'integer' ? 'number' : parameter.kind === 'secret' ? 'password' : 'text'}" data-model="operation-parameter-value" data-entity="${entityIndex}" data-operation="${operationIndex}" data-parameter="${parameterIndex}" value="${esc(value)}">`;
    return `<div class="studio-parameter-row">
      <div class="studio-parameter-schema">
        <label><span>${custom ? 'Parameter ID' : 'Input'}</span>${custom ? `<input data-model="operation-parameter-id" data-entity="${entityIndex}" data-operation="${operationIndex}" data-parameter="${parameterIndex}" value="${esc(parameter.id)}">` : `<code>${esc(parameter.id)}</code>`}</label>
        <label><span>Label</span><input data-model="operation-parameter-label" data-entity="${entityIndex}" data-operation="${operationIndex}" data-parameter="${parameterIndex}" value="${esc(parameter.label)}"></label>
        <label><span>Type</span><select data-model="operation-parameter-kind" data-entity="${entityIndex}" data-operation="${operationIndex}" data-parameter="${parameterIndex}">${['string', 'secret', 'integer', 'boolean', 'string-list'].map(kind => `<option value="${kind}" ${kind === parameter.kind ? 'selected' : ''}>${kind.replace('-', ' ')}</option>`).join('')}</select></label>
        <label class="studio-parameter-required"><input type="checkbox" data-model="operation-parameter-required" data-entity="${entityIndex}" data-operation="${operationIndex}" data-parameter="${parameterIndex}" ${parameter.required ? 'checked' : ''}><span>Required</span></label>
      </div>
      <label class="studio-parameter-value"><span>Fixture value</span>${valueControl}</label>
      ${custom ? `<button class="icon-button" type="button" data-action="remove-operation-parameter" data-entity="${entityIndex}" data-operation="${operationIndex}" data-parameter="${parameterIndex}" aria-label="Remove ${esc(parameter.label)}" title="Remove parameter"><i data-lucide="x"></i></button>` : '<span></span>'}
    </div>`;
  }

  function operationRequestEditor(operation, entityIndex, operationIndex) {
    const request = operation.artifact.request;
    const view = operationRequestView(operation);
    return `<details class="studio-operation-group" open><summary><i data-lucide="chevron-right"></i><span>Expected HTTP request</span></summary>
      <div class="studio-request-contract">
        <div class="studio-request-line"><select data-model="operation-request-method" data-entity="${entityIndex}" data-operation="${operationIndex}" aria-label="Expected HTTP method">${['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(method => `<option value="${method}" ${method === view.method ? 'selected' : ''}>${method}</option>`).join('')}</select><code>${esc(view.route)}</code></div>
        <section><header><span>Path matchers</span><button class="icon-button" type="button" data-action="add-operation-path-alias" data-entity="${entityIndex}" data-operation="${operationIndex}" aria-label="Add runtime path matcher" title="Add runtime path matcher"><i data-lucide="plus"></i></button></header><div>${requestDictionaryRow('path', 'default', request.pathContains ?? '', 0, entityIndex, operationIndex, true)}${Object.entries(request.pathAliases ?? {}).map(([runtime, path], matcherIndex) => requestDictionaryRow('path', runtime, path, matcherIndex, entityIndex, operationIndex)).join('')}</div></section>
        <section><header><span>Required headers</span><button class="icon-button" type="button" data-action="add-operation-request-header" data-entity="${entityIndex}" data-operation="${operationIndex}" aria-label="Add required header" title="Add required header"><i data-lucide="plus"></i></button></header><div>${view.headers.length ? view.headers.map(([name, value], headerIndex) => requestDictionaryRow('header', name, value, headerIndex, entityIndex, operationIndex)).join('') : `<span class="studio-contract-empty">No required headers</span>`}</div></section>
        <section><header><span>JSON body</span>${view.body === undefined ? `<button class="text-button studio-text-action" type="button" data-action="add-operation-request-body" data-entity="${entityIndex}" data-operation="${operationIndex}"><i data-lucide="plus"></i><span>Add body</span></button>` : `<button class="icon-button" type="button" data-action="remove-operation-request-body" data-entity="${entityIndex}" data-operation="${operationIndex}" aria-label="Remove request body" title="Remove body"><i data-lucide="x"></i></button>`}</header><div>${view.body === undefined ? `<span class="studio-contract-empty">No request body</span>` : jsonEditor('Expected JSON', 'operation-request-body', entityIndex, operationIndex, view.body, 'studio-operation-wide')}</div></section>
      </div>
    </details>`;
  }

  function requestDictionaryRow(kind, name, value, rowIndex, entityIndex, operationIndex, fixedName = false) {
    const nameModel = kind === 'path' ? 'operation-path-alias-name' : 'operation-request-header-name';
    const valueModel = fixedName ? 'operation-path-contains' : kind === 'path' ? 'operation-path-alias-value' : 'operation-request-header-value';
    const removeAction = kind === 'path' ? 'remove-operation-path-alias' : 'remove-operation-request-header';
    return `<div class="studio-contract-row"><label><span>${kind === 'path' ? 'Runtime' : 'Header'}</span>${fixedName ? `<code>default</code>` : `<input data-model="${nameModel}" data-entity="${entityIndex}" data-operation="${operationIndex}" data-row="${rowIndex}" value="${esc(name)}">`}</label><label><span>${kind === 'path' ? 'Path contains' : 'Exact value'}</span><input data-model="${valueModel}" data-entity="${entityIndex}" data-operation="${operationIndex}" data-row="${rowIndex}" value="${esc(value)}"></label>${fixedName ? '<span></span>' : `<button class="icon-button" type="button" data-action="${removeAction}" data-entity="${entityIndex}" data-operation="${operationIndex}" data-row="${rowIndex}" aria-label="Remove ${esc(name)}" title="Remove"><i data-lucide="x"></i></button>`}</div>`;
  }

  function entityInput(label, model, entityIndex, value) {
    return `<label><span>${label}</span><input data-model="${model}" data-entity="${entityIndex}" value="${esc(value)}"></label>`;
  }

  function operationInput(label, model, entityIndex, operationIndex, value, type = 'text') {
    return `<label><span>${label}</span><input type="${type}" data-model="${model}" data-entity="${entityIndex}" data-operation="${operationIndex}" value="${esc(value)}"></label>`;
  }

  function operationSelect(label, model, entityIndex, operationIndex, current, values) {
    const options = uniqueBy([current, ...values].filter(Boolean), value => value);
    return `<label><span>${label}</span><select data-model="${model}" data-entity="${entityIndex}" data-operation="${operationIndex}">${options.map(value => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select></label>`;
  }

  function jsonEditor(label, model, entityIndex, operationIndex, value, className) {
    return `<label class="studio-json-editor ${className}"><span>${label}<em>JSON</em></span><textarea data-model="${model}" data-json="true" data-entity="${entityIndex}" data-operation="${operationIndex}" spellcheck="false" rows="5">${esc(JSON.stringify(value, null, 2))}</textarea></label>`;
  }

  function rootEndpoint(root, runtimeId) {
    return (root.endpoints ?? []).find(endpoint => endpoint.runtimeId === runtimeId)?.symbol ?? '';
  }

  function removeEntityButton(entityIndex) {
    return `<button class="icon-button" type="button" data-action="remove-entity" data-entity="${entityIndex}" aria-label="Remove entity" title="Remove entity"><i data-lucide="trash-2"></i></button>`;
  }

  function removeOperationButton(entityIndex, operationIndex) {
    return `<button class="icon-button" type="button" data-action="remove-operation" data-entity="${entityIndex}" data-operation="${operationIndex}" aria-label="Remove operation" title="Remove operation"><i data-lucide="trash-2"></i></button>`;
  }

  function scenarioCard(scenario, index) {
    const response = scenario.response;
    const headers = Object.entries(response?.headers ?? {});
    const scenarios = state.document.scenarios ?? [];
    return `<article class="studio-scenario-card" data-problem-section="scenarios" data-problem-id="${esc(scenario.id)}" data-problem-index="${index}">
      <header class="studio-scenario-header">
        <div><span>Scenario ${index + 1} of ${scenarios.length}</span><strong>${esc(scenario.name || 'Unnamed scenario')}</strong></div>
        <div class="studio-scenario-actions">
          <button class="icon-button" type="button" data-action="move-scenario-up" data-index="${index}" ${index === 0 ? 'disabled' : ''} aria-label="Move scenario up" title="Move up"><i data-lucide="arrow-up"></i></button>
          <button class="icon-button" type="button" data-action="move-scenario-down" data-index="${index}" ${index === scenarios.length - 1 ? 'disabled' : ''} aria-label="Move scenario down" title="Move down"><i data-lucide="arrow-down"></i></button>
          <button class="icon-button" type="button" data-action="duplicate-scenario" data-index="${index}" aria-label="Duplicate scenario" title="Duplicate"><i data-lucide="copy-plus"></i></button>
          ${remove('remove-scenario', index)}
        </div>
      </header>
      <div class="studio-scenario-identity">
        ${input('Scenario ID', 'scenario-id', index, scenario.id)}
        ${input('Display name', 'scenario-name', index, scenario.name)}
        <label><span>Tone</span><select data-model="scenario-tone" data-index="${index}">${scenarioToneOptions(scenario.tone)}</select></label>
        <label class="studio-scenario-summary"><span>Summary</span><textarea data-model="scenario-summary" data-index="${index}" rows="3">${esc(scenario.summary)}</textarea></label>
      </div>
      <section class="studio-scenario-response">
        <header><div><span>Execution mode</span><strong>${response ? 'Injected HTTP response' : 'Actual execution'}</strong></div><div class="studio-segmented" role="group" aria-label="Scenario response mode"><button type="button" data-action="set-scenario-mode" data-index="${index}" data-enabled="false" class="${response ? '' : 'active'}">Actual</button><button type="button" data-action="set-scenario-mode" data-index="${index}" data-enabled="true" class="${response ? 'active' : ''}">HTTP fixture</button></div></header>
        ${response ? scenarioResponseEditor(response, index, headers) : `<div class="studio-scenario-actual"><i data-lucide="radio-tower"></i><div><strong>Use the SDK's actual execution result</strong><span>No scenario-level response overrides are applied.</span></div></div>`}
      </section>
    </article>`;
  }

  function scenarioResponseEditor(response, index, headers) {
    return `<div class="studio-scenario-http-grid">
      <label><span>Status code</span><input type="number" min="100" max="599" data-model="scenario-status" data-index="${index}" value="${Number(response.statusCode)}"></label>
      <label><span>HTTP version</span><select data-model="scenario-version" data-index="${index}">${httpVersionOptions(response.version)}</select></label>
    </div>
    <div class="studio-scenario-subsection">
      <header><div><span>Response headers</span><strong>${headers.length}</strong></div><button class="text-button studio-text-action" type="button" data-action="add-scenario-header" data-index="${index}"><i data-lucide="plus"></i><span>Add header</span></button></header>
      <div class="studio-scenario-headers">${headers.length ? headers.map(([name, value], headerIndex) => `<div class="studio-scenario-header-row"><label><span>Header name</span><input data-model="scenario-header-name" data-index="${index}" data-header="${headerIndex}" value="${esc(name)}"></label><label><span>Exact value</span><input data-model="scenario-header-value" data-index="${index}" data-header="${headerIndex}" value="${esc(value)}"></label><button class="icon-button" type="button" data-action="remove-scenario-header" data-index="${index}" data-header="${headerIndex}" aria-label="Remove ${esc(name)}" title="Remove header"><i data-lucide="x"></i></button></div>`).join('') : empty('list-minus', 'No response headers')}</div>
    </div>
    <label class="studio-scenario-body"><span>Exact response body</span><textarea data-model="scenario-body" data-index="${index}" spellcheck="false">${esc(response.bodyText)}</textarea><small>Preserved as raw text. JSON is not reformatted.</small></label>`;
  }

  function scenarioToneOptions(current) {
    return uniqueBy([current, 'neutral', 'absence', 'failure'].filter(Boolean), value => value)
      .map(value => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(value)}</option>`).join('');
  }

  function httpVersionOptions(current) {
    return uniqueBy([current, '1.0', '1.1', '2.0'].filter(Boolean), value => value)
      .map(value => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>HTTP/${esc(value)}</option>`).join('');
  }

  function fieldCard(field, index) {
    return `<article class="studio-mapping-card"><header><div class="studio-id-fields">${input('Field ID', 'field-id', index, field.id)}</div><label class="studio-check"><input type="checkbox" data-model="field-excluded" data-index="${index}" ${field.excluded ? 'checked' : ''}><span>Exclude from comparison</span></label>${remove('remove-field', index)}</header><div class="studio-endpoint-grid">${fieldEndpoint(field, index, 'csharp')}<div class="studio-pair-link"><i data-lucide="equal"></i></div>${fieldEndpoint(field, index, 'rust')}</div></article>`;
  }

  function fieldEndpoint(field, index, runtimeId) {
    const mapped = (field.endpoints ?? []).filter(item => item.runtimeId === runtimeId);
    const status = mapped.length > 0 ? `${mapped.length} exact path${mapped.length === 1 ? '' : 's'} mapped` : 'No observed path mapped';
    return `<section class="studio-endpoint ${runtimeId}"><header><i data-lucide="${runtimeId === 'csharp' ? 'hash' : 'box'}"></i><span>${runtimeId === 'csharp' ? 'C# field paths' : 'Rust field paths'}</span><em>${status}</em></header><div class="studio-mapped-paths">${mapped.length ? mapped.map(item => mappedFieldPath(item, index)).join('') : `<span>No exact path selected</span>`}</div><details class="studio-rich-picker" data-field-picker data-index="${index}" data-runtime="${runtimeId}"><summary><i data-lucide="plus"></i><span>${mapped.length ? 'Add another hierarchy level' : 'Select a hierarchy level'}</span><i data-lucide="chevron-down"></i></summary><div class="studio-picker-popover"><label class="studio-picker-search"><i data-lucide="search"></i><input data-model="field-picker-search" placeholder="Filter owner, function, or path" autocomplete="off"></label><div class="studio-picker-options" data-field-picker-options>${compactPickerEmpty('Open to load observed hierarchy')}</div></div></details></section>`;
  }

  function mappedFieldPath(item, index) {
    const path = item.scope === 'type' ? item.memberPath : item.path;
    const context = item.scope === 'type' ? shortTypeName(item.ownerTypeSymbol) : shortName(item.functionSymbol);
    return `<div class="studio-mapped-path"><span><strong>${esc(context)}</strong><code>${esc(path)}</code></span><button type="button" class="icon-button" data-action="remove-field-endpoint" data-index="${index}" data-key="${esc(fieldKey(item))}" aria-label="Remove ${esc(path)}" title="Remove path"><i data-lucide="x"></i></button></div>`;
  }

  function renderFunctions() {
    const functions = state.document.functions ?? [];
    ui.content.innerHTML = actionBar(`${observed('functions', 'csharp')} C# · ${observed('functions', 'rust')} Rust observed functions`, 'add-function', 'Pair functions') +
      `<div class="studio-mapping-list">${functions.length ? functions.map((item, index) => `<article class="studio-function-row" data-problem-section="functions" data-problem-id="${esc(item.id)}" data-problem-index="${index}">${input('Pairing ID', 'function-id', index, item.id)}${functionEndpoint(item, index, 'csharp')}${functionEndpoint(item, index, 'rust')}<label><span>Software layer</span><select data-model="function-layer" data-index="${index}">${(state.document.layers ?? []).map(layer => `<option value="${esc(layer.id)}" ${layer.id === item.layerId ? 'selected' : ''}>${esc(layer.name)}</option>`).join('')}</select></label><label><span>Timeline role</span><select data-model="function-role" data-index="${index}"><option value="step" ${item.role === 'step' ? 'selected' : ''}>Step</option><option value="serviceBoundary" ${item.role === 'serviceBoundary' ? 'selected' : ''}>Service boundary</option></select></label>${remove('remove-function', index)}</article>`).join('') : empty('function-square', 'No function pairings')}</div>`;
  }

  function functionEndpoint(item, index, runtimeId) {
    const current = (item.endpoints ?? []).find(endpoint => endpoint.runtimeId === runtimeId)?.symbol;
    const choices = uniqueBy([
      ...(current ? [{ symbol: current }] : []),
      ...inventory('functions', runtimeId),
    ], choice => choice.symbol);
    return `<label><span>${runtimeId === 'csharp' ? 'C# symbol' : 'Rust symbol'}</span><select data-model="function-endpoint" data-index="${index}" data-runtime="${runtimeId}"><option value="">No observed counterpart</option>${choices.map(choice => `<option value="${esc(choice.symbol)}" ${choice.symbol === current ? 'selected' : ''}>${esc(choice.symbol)}</option>`).join('')}</select></label>`;
  }

  function renderEnums() {
    const enums = state.document.enums ?? [];
    const members = enums.reduce((total, item) => total + (item.members?.length ?? 0), 0);
    const index = selectedPairingIndex('enums', enums);
    const item = enums[index];
    ui.content.innerHTML = actionBar(`${enums.length} enum type pairings · ${members} member pairings`, 'add-enum', 'Pair enum types') +
      pairingWorkbench('enums', enums, item ? enumCard(item, index) : empty('list-tree', 'No enum pairings'));
  }

  function pairingWorkbench(section, items, editor) {
    const scenarioMode = section === 'scenarios';
    const treeLabel = section === 'fields' ? 'Mappings & exclusions' : scenarioMode ? 'Scenario IDs' : 'Pairing IDs';
    return `<div class="studio-pairing-workbench${scenarioMode ? ' studio-scenario-workbench' : ''}"><aside class="studio-pairing-tree"><header><span>${treeLabel}</span><em>${items.length}</em></header><div class="studio-tree-scroll" role="tree">${items.length ? pairingTree(section, items) : empty(scenarioMode ? 'flask-conical' : 'list-tree', scenarioMode ? 'No scenarios' : 'No pairing IDs')}</div></aside><section class="studio-focused-editor"><header><span>${scenarioMode ? 'Selected scenario' : 'Selected pairing'}</span><code>${esc(items[selectedPairingIndex(section, items)]?.id ?? 'None')}</code></header><div class="studio-focused-scroll">${editor}</div></section></div>`;
  }

  function selectedPairingIndex(section, items) {
    const index = Math.max(0, Math.min(state.selectedPairing[section] ?? 0, Math.max(0, items.length - 1)));
    state.selectedPairing[section] = index;
    return index;
  }

  function pairingTree(section, items) {
    const root = { children: new Map() };
    items.forEach((item, index) => {
      let node = root;
      let path = '';
      const segments = String(item.id ?? '').split('.').filter(Boolean);
      if (!segments.length) segments.push(`Blank item ${index + 1}`);
      for (const segment of segments) {
        path = path ? `${path}.${segment}` : segment;
        if (!node.children.has(segment)) node.children.set(segment, { segment, path, children: new Map(), index: null });
        node = node.children.get(segment);
      }
      node.index = index;
    });
    return [...root.children.values()].map(node => pairingTreeNode(section, node, items)).join('');
  }

  function pairingTreeNode(section, node, items) {
    const children = [...node.children.values()];
    if (!children.length) return pairingTreeLeaf(section, node.index, node.segment, items);
    const count = pairingLeafCount(node);
    const collapsed = state.collapsedPairingPaths[section].has(node.path);
    const ownLeaf = node.index === null ? '' : pairingTreeLeaf(section, node.index, node.segment, items);
    return `<details class="studio-tree-branch" data-tree-section="${section}" data-tree-path="${esc(node.path)}" ${collapsed ? '' : 'open'}><summary><i data-lucide="chevron-right"></i><i data-lucide="folder"></i><span>${esc(node.segment)}</span><em>${count}</em></summary><div role="group">${ownLeaf}${children.map(child => pairingTreeNode(section, child, items)).join('')}</div></details>`;
  }

  function pairingTreeLeaf(section, index, label, items) {
    const selected = index === selectedPairingIndex(section, items);
    const definitionIndex = section === 'fields' ? state.document.fields.indexOf(items[index]) : index;
    const problems = pairingProblemCount(section, items[index].id, definitionIndex);
    const icon = section === 'fields' ? 'route' : section === 'scenarios' ? 'flask-conical' : 'list-tree';
    return `<button type="button" role="treeitem" class="studio-tree-leaf${selected ? ' active' : ''}${problems ? ' has-problems' : ''}" data-action="select-pairing" data-section="${section}" data-index="${index}" title="${esc(items[index].id || `Blank item ${index + 1}`)}"><i data-lucide="${icon}"></i><span>${esc(label)}</span>${problemBadge(problems)}</button>`;
  }

  function pairingLeafCount(node) {
    return (node.index === null ? 0 : 1) + [...node.children.values()].reduce((total, child) => total + pairingLeafCount(child), 0);
  }

  function rememberTreeState(event) {
    const richPicker = event.target.matches?.('details.studio-rich-picker') ? event.target : null;
    if (richPicker?.open) {
      closeRichPickers(richPicker);
      positionRichPicker(richPicker);
    }
    const picker = event.target.matches?.('details[data-field-picker]') ? event.target : null;
    if (picker?.open) renderFieldPickerOptions(
      picker,
      picker.querySelector('[data-model="field-picker-search"]')?.value ?? '');
    const details = event.target.closest?.('details[data-tree-section]');
    if (!details) return;
    const collapsed = state.collapsedPairingPaths[details.dataset.treeSection];
    if (details.open) collapsed.delete(details.dataset.treePath);
    else collapsed.add(details.dataset.treePath);
  }

  function positionOpenPickers() {
    ui.content.querySelectorAll('details.studio-rich-picker[open]').forEach(positionRichPicker);
  }

  function positionRichPicker(picker) {
    const trigger = picker.querySelector(':scope > summary')?.getBoundingClientRect();
    const popover = picker.querySelector(':scope > .studio-picker-popover');
    if (!trigger || !popover) return;
    const container = popover.offsetParent ?? document.documentElement;
    const containerRect = container.getBoundingClientRect();
    const originLeft = containerRect.left + container.clientLeft;
    const originTop = containerRect.top + container.clientTop;
    const preferredWidth = picker.matches('[data-field-picker]') ? 620 : 460;
    const preferredHeight = picker.matches('[data-field-picker]') ? 430 : 300;
    const placement = richPickerPlacement({
      left: trigger.left - originLeft,
      right: trigger.right - originLeft,
      top: trigger.top - originTop,
      bottom: trigger.bottom - originTop,
      width: trigger.width,
    }, {
      width: container.clientWidth,
      height: container.clientHeight,
    }, preferredWidth, preferredHeight);
    popover.style.setProperty('--picker-left', `${placement.left}px`);
    popover.style.setProperty('--picker-width', `${placement.width}px`);
    popover.style.setProperty('--picker-max-height', `${placement.maxHeight}px`);
    popover.style.setProperty('--picker-top', placement.top === null ? 'auto' : `${placement.top}px`);
    popover.style.setProperty('--picker-bottom', placement.bottom === null ? 'auto' : `${placement.bottom}px`);
  }

  function closeRichPickers(except = null) {
    ui.content.querySelectorAll('details.studio-rich-picker[open]').forEach(picker => {
      if (picker !== except) picker.open = false;
    });
  }

  function renderFieldPickerOptions(picker, query = '') {
    const field = state.document.fields[Number(picker.dataset.index)];
    const runtimeId = picker.dataset.runtime;
    const mapped = new Set((field.endpoints ?? []).map(fieldKey));
    const normalizedQuery = query.trim().toLowerCase();
    const choices = fieldEndpointChoices(field, state.symbols.fields, runtimeId)
      .filter(item => !mapped.has(fieldKey(item)))
      .filter(item => !normalizedQuery || fieldChoiceSearchText(item).includes(normalizedQuery));
    const hierarchy = fieldChoiceHierarchy(choices);
    const host = picker.querySelector('[data-field-picker-options]');
    host.innerHTML = hierarchy.length
      ? hierarchy.map(group => fieldHierarchyGroup(group, Number(picker.dataset.index))).join('')
      : compactPickerEmpty(normalizedQuery ? 'No matching hierarchy levels' : 'No additional observed paths');
    icons();
  }

  function fieldChoiceSearchText(item) {
    return [item.ownerTypeSymbol, item.functionSymbol, item.direction, item.memberPath, item.path, item.valueKind]
      .filter(Boolean).join(' ').toLowerCase();
  }

  function fieldHierarchyGroup(group, index) {
    const label = group.scope === 'type' ? shortTypeName(group.ownerTypeSymbol) : shortName(group.functionSymbol);
    const detail = group.scope === 'type' ? group.ownerTypeSymbol : `${group.direction} · ${group.functionSymbol}`;
    return `<details class="studio-path-group"><summary><i data-lucide="${group.scope === 'type' ? 'braces' : 'function-square'}"></i><span><strong>${esc(label)}</strong><code>${esc(detail)}</code></span><em>${hierarchyChoiceCount(group.children)}</em></summary><div>${group.children.map(node => fieldHierarchyNode(node, index, 0)).join('')}</div></details>`;
  }

  function fieldHierarchyNode(node, index, depth) {
    const selectable = node.choice ? fieldHierarchyChoice(node.choice, index, node.segment, depth, node.children.length > 0) : '';
    if (!node.children.length) return selectable;
    return `<details class="studio-path-node"><summary style="--path-depth:${depth}"><i data-lucide="chevron-right"></i><span>${esc(node.segment)}</span><em>${node.choice ? 'selectable' : ''}</em></summary><div>${selectable}${node.children.map(child => fieldHierarchyNode(child, index, depth + 1)).join('')}</div></details>`;
  }

  function fieldHierarchyChoice(choice, index, segment, depth, parent) {
    const path = choice.scope === 'type' ? choice.memberPath : choice.path;
    return `<button type="button" class="studio-path-choice${parent ? ' parent-level' : ''}" style="--path-depth:${depth}" data-action="add-field-endpoint" data-index="${index}" data-runtime="${choice.runtimeId}" data-key="${esc(fieldKey(choice))}" title="${esc(path)}"><i data-lucide="${choice.valueKind === 'object' ? 'braces' : choice.valueKind === 'array' ? 'list' : 'corner-down-right'}"></i><span><strong>${esc(segment)}</strong><code>${esc(path)}</code></span><em>${esc(choice.valueKind || 'value')}</em></button>`;
  }

  function hierarchyChoiceCount(nodes) {
    return nodes.reduce((total, node) => total + (node.choice ? 1 : 0) + hierarchyChoiceCount(node.children), 0);
  }

  function compactPickerEmpty(text) {
    return `<div class="studio-picker-empty"><i data-lucide="circle-dashed"></i><span>${esc(text)}</span></div>`;
  }

  function finishAsyncRender(version, message) {
    if (version !== state.renderVersion) return;
    ui.content.removeAttribute('aria-busy');
    if (!state.readyNotified) {
      state.readyNotified = true;
      notify('Parity Data Studio is ready.');
    }
    ui.validation.setAttribute('aria-label', message);
  }

  function enumCard(item, index) {
    const members = item.members ?? [];
    const csharpMembers = members.filter(member => member.symbols?.csharp).length;
    const rustMembers = members.filter(member => member.symbols?.rust).length;
    return `<article class="studio-mapping-card studio-enum-card"><header><div class="studio-id-fields">${input('Pairing ID', 'enum-id', index, item.id)}</div><label class="studio-check"><input type="checkbox" data-model="enum-flags" data-index="${index}" ${item.flags ? 'checked' : ''}><span>Flags enum</span></label>${remove('remove-enum', index)}</header><div class="studio-enum-types">${enumEndpoint(item, index, 'csharp')}${enumEndpoint(item, index, 'rust')}</div><div class="studio-member-heading"><span>Member equivalence <em>${members.length} pairings · C# ${csharpMembers} · Rust ${rustMembers}</em></span><button class="text-button" type="button" data-action="add-member" data-index="${index}"><i data-lucide="plus"></i>Add member</button></div><div class="studio-member-grid">${members.length ? members.map((member, memberIndex) => memberRow(item, index, member, memberIndex)).join('') : empty('list-minus', 'No member pairings')}</div></article>`;
  }

  function enumEndpoint(item, index, runtimeId) {
    const current = (item.endpoints ?? []).find(endpoint => endpoint.runtimeId === runtimeId)?.symbol;
    const choices = enumEndpointChoices(item, index, state.document.enums, state.symbols.enums, runtimeId);
    return richSymbolPicker(`${runtimeId === 'csharp' ? 'C#' : 'Rust'} enum symbol`, current, choices.map(choice => ({ value: choice.symbol, label: shortTypeName(choice.symbol), detail: choice.symbol })), 'set-enum-endpoint', index, runtimeId);
  }

  function memberRow(item, index, member, memberIndex) {
    return `<div class="studio-member-row">${memberSelect(item, index, member, memberIndex, 'csharp')}<i data-lucide="equal"></i>${memberSelect(item, index, member, memberIndex, 'rust')}<button class="icon-button" type="button" data-action="remove-member" data-index="${index}" data-member="${memberIndex}" aria-label="Remove member"><i data-lucide="x"></i></button></div>`;
  }

  function memberSelect(item, index, member, memberIndex, runtimeId) {
    const current = member.symbols?.[runtimeId];
    const choices = enumMemberChoices(item, memberIndex, state.symbols.enums, runtimeId);
    return richSymbolPicker(`${runtimeId === 'csharp' ? 'C#' : 'Rust'} enum member`, current, choices.map(choice => ({ value: choice.symbol, label: choice.name, detail: choice.symbol, meta: choice.value })), 'set-enum-member', index, runtimeId, memberIndex);
  }

  function richSymbolPicker(label, current, choices, action, index, runtimeId, memberIndex = null) {
    const selected = choices.find(choice => choice.value === current);
    const member = memberIndex === null ? '' : ` data-member="${memberIndex}"`;
    return `<label class="studio-symbol-picker-label"><span>${label}</span><details class="studio-rich-picker studio-symbol-picker"><summary><span><strong>${esc(selected?.label || 'No counterpart selected')}</strong><code>${esc(current || 'Choose an observed symbol')}</code></span><i data-lucide="chevron-down"></i></summary><div class="studio-picker-popover"><button type="button" class="studio-symbol-choice empty" data-action="${action}" data-index="${index}" data-runtime="${runtimeId}"${member} data-symbol=""><i data-lucide="circle-slash"></i><span>No observed counterpart</span></button>${choices.map(choice => `<button type="button" class="studio-symbol-choice${choice.value === current ? ' active' : ''}" data-action="${action}" data-index="${index}" data-runtime="${runtimeId}"${member} data-symbol="${esc(choice.value)}"><i data-lucide="${choice.value === current ? 'check' : 'code-2'}"></i><span><strong>${esc(choice.label)}</strong><code>${esc(choice.detail)}</code></span>${choice.meta === undefined ? '' : `<em>${esc(choice.meta)}</em>`}</button>`).join('')}</div></details></label>`;
  }

  function renderLayers() {
    const layers = state.document.layers ?? [];
    ui.content.innerHTML = actionBar(`${layers.length} software layers · array position defines placement`, 'add-layer', 'Add layer') + `<div class="studio-layer-table"><div class="studio-layer-header"><span>Position</span><span>ID</span><span>Name</span><span>Actions</span></div>${layers.map((layer, index) => `<div class="studio-layer-row" data-problem-section="layers" data-problem-id="${esc(layer.id)}" data-problem-index="${index}"><code>${index + 1}</code><input data-model="layer-id" data-index="${index}" value="${esc(layer.id)}"><input data-model="layer-name" data-index="${index}" value="${esc(layer.name)}"><div class="studio-layer-actions"><button class="icon-button" type="button" data-action="move-layer-up" data-index="${index}" ${index === 0 ? 'disabled' : ''} aria-label="Move layer up" title="Move up"><i data-lucide="arrow-up"></i></button><button class="icon-button" type="button" data-action="move-layer-down" data-index="${index}" ${index === layers.length - 1 ? 'disabled' : ''} aria-label="Move layer down" title="Move down"><i data-lucide="arrow-down"></i></button>${remove('remove-layer', index)}</div></div>`).join('')}</div>`;
  }

  function renderHistory() {
    ui.content.innerHTML = `<div class="studio-history-list">${state.versions.length ? state.versions.map(version => `<article class="studio-history-card"><div><strong>${esc(version.label)}</strong><code>${esc(version.id)}</code><small>${new Date(version.savedAt).toLocaleString()} · Schema ${esc(version.schemaVersion)}</small></div><p>${esc(version.notes || 'No notes')}</p><button class="text-button studio-text-action" type="button" data-action="load-version" data-version="${esc(version.id)}"><i data-lucide="file-input"></i><span>Load draft</span></button><button class="settings-save-button" type="button" data-action="restore-version" data-version="${esc(version.id)}"><i data-lucide="history"></i>Restore server</button></article>`).join('') : empty('history', 'No server versions')}</div>`;
  }

  function renderSource() {
    ui.content.innerHTML = `<div class="studio-source-view"><textarea id="settings-source-editor" spellcheck="false" aria-label="Parity data JSON source">${esc(JSON.stringify(state.document, null, 2))}</textarea><footer><span>JSON source</span><button class="settings-save-button" type="button" data-action="apply-source"><i data-lucide="check"></i>Apply source</button></footer></div>`;
  }

  function editScalar(event) {
    const target = event.target;
    if (target.dataset.model === 'field-picker-search') {
      renderFieldPickerOptions(target.closest('[data-field-picker]'), target.value);
      return;
    }
    if (!target.dataset.model || target.dataset.json || target.tagName === 'SELECT' || target.type === 'checkbox') return;
    setScalar(target);
  }

  function editSelection(event) {
    const target = event.target;
    const model = target.dataset.model;
    if (!model) return;
    const index = Number(target.dataset.index);
    if (model === 'function-endpoint') {
      const item = state.document.functions[index];
      item.endpoints = (item.endpoints ?? []).filter(endpoint => endpoint.runtimeId !== target.dataset.runtime);
      if (target.value) item.endpoints.push({ runtimeId: target.dataset.runtime, symbol: target.value });
    } else if (target.dataset.json) {
      const parsed = parseJsonEditor(target.value);
      target.classList.toggle('invalid', !parsed.valid);
      target.setAttribute('aria-invalid', String(!parsed.valid));
      if (!parsed.valid) return notify(`Invalid JSON: ${parsed.error}`, true);
      setOperationJson(target, parsed.value);
      changed();
      return;
    } else {
      setScalar(target);
      if (model === 'scenario-id' || model === 'entity-id' || model === 'operation-id' || model === 'field-id' || model === 'enum-id') renderContent();
      if (model === 'operation-parameter-kind') renderContent();
    }
    changed();
  }

  function setScalar(target) {
    const index = Number(target.dataset.index);
    const entityIndex = Number(target.dataset.entity);
    const operationIndex = Number(target.dataset.operation);
    const entity = state.document.entities?.[entityIndex];
    const operation = entity?.operations?.[operationIndex];
    const value = target.type === 'checkbox' ? target.checked : target.type === 'number' ? optionalNumber(target.value) : target.value;
    const set = {
      'scenario-id': () => state.document.scenarios[index].id = value,
      'scenario-name': () => state.document.scenarios[index].name = value,
      'scenario-summary': () => state.document.scenarios[index].summary = value,
      'scenario-tone': () => state.document.scenarios[index].tone = value,
      'scenario-status': () => state.document.scenarios[index].response.statusCode = value,
      'scenario-version': () => state.document.scenarios[index].response.version = value,
      'scenario-body': () => state.document.scenarios[index].response.bodyText = value,
      'scenario-header-name': () => {
        const response = state.document.scenarios[index].response;
        const entry = Object.entries(response.headers ?? {})[Number(target.dataset.header)];
        if (entry) response.headers = replaceDictionaryEntry(response.headers, Number(target.dataset.header), value, entry[1]);
      },
      'scenario-header-value': () => {
        const response = state.document.scenarios[index].response;
        const entry = Object.entries(response.headers ?? {})[Number(target.dataset.header)];
        if (entry) response.headers = replaceDictionaryEntry(response.headers, Number(target.dataset.header), entry[0], value);
      },
      'entity-id': () => entity.id = value,
      'entity-name': () => entity.name = value,
      'entity-icon': () => entity.icon = value,
      'operation-id': () => operation.id = value,
      'operation-name': () => operation.name = value,
      'operation-method': () => operation.method = value,
      'operation-route': () => operation.route = value,
      'operation-response-shape': () => operation.responseShape = value,
      'operation-description': () => operation.description = value,
      'operation-root-id': () => operation.rootFunction.id = value,
      'operation-root-layer': () => operation.rootFunction.layerId = value,
      'operation-root-csharp': () => setRootEndpoint(operation.rootFunction, 'csharp', value),
      'operation-root-rust': () => setRootEndpoint(operation.rootFunction, 'rust', value),
      'operation-tenant': () => operation.artifact.invocation.tenant = value,
      'operation-token': () => operation.artifact.invocation.token = value,
      'operation-key-kind': () => setOptional(operation.artifact.invocation, 'keyKind', value),
      'operation-key': () => setOptional(operation.artifact.invocation, 'key', value),
      'operation-query-filter': () => setOptional(operation.artifact.invocation, 'queryFilter', value),
      'operation-query-property-set': () => setOptional(operation.artifact.invocation, 'queryPropertySet', value),
      'operation-query-top': () => setOptional(operation.artifact.invocation, 'queryTop', value),
      'operation-query-skip': () => setOptional(operation.artifact.invocation, 'querySkip', value),
      'operation-query-expand': () => setOptional(operation.artifact.invocation, 'queryExpand', value),
      'operation-parameter-id': () => renameOperationParameter(operation, Number(target.dataset.parameter), value),
      'operation-parameter-label': () => ensureOperationParameterSchema(operation)[Number(target.dataset.parameter)].label = value,
      'operation-parameter-kind': () => ensureOperationParameterSchema(operation)[Number(target.dataset.parameter)].kind = value,
      'operation-parameter-required': () => ensureOperationParameterSchema(operation)[Number(target.dataset.parameter)].required = value,
      'operation-parameter-value': () => setOperationParameterValue(operation, Number(target.dataset.parameter), value),
      'operation-request-method': () => operation.artifact.request.method = value,
      'operation-path-contains': () => operation.artifact.request.pathContains = value,
      'operation-path-alias-name': () => replaceOperationRequestEntry(operation, 'pathAliases', Number(target.dataset.row), value, null),
      'operation-path-alias-value': () => replaceOperationRequestEntry(operation, 'pathAliases', Number(target.dataset.row), null, value),
      'operation-request-header-name': () => replaceOperationRequestEntry(operation, 'headers', Number(target.dataset.row), value, null),
      'operation-request-header-value': () => replaceOperationRequestEntry(operation, 'headers', Number(target.dataset.row), null, value),
      'operation-response-status': () => operation.artifact.response.statusCode = value,
      'operation-response-version': () => operation.artifact.response.version = value,
      'operation-response-body-text': () => setOptional(operation.artifact.response, 'bodyText', value),
      'field-id': () => state.document.fields[index].id = value,
      'field-excluded': () => state.document.fields[index].excluded = value,
      'function-id': () => state.document.functions[index].id = value,
      'function-layer': () => state.document.functions[index].layerId = value,
      'function-role': () => state.document.functions[index].role = value,
      'enum-id': () => state.document.enums[index].id = value,
      'enum-flags': () => state.document.enums[index].flags = value,
      'layer-id': () => state.document.layers[index].id = value,
      'layer-name': () => state.document.layers[index].name = value,
    };
    set[target.dataset.model]?.();
    changed();
  }

  function setOperationJson(target, value) {
    const operation = state.document.entities[Number(target.dataset.entity)].operations[Number(target.dataset.operation)];
    const set = {
      'operation-root-aliases': () => operation.rootFunction.aliases = value,
      'operation-query-select': () => operation.artifact.invocation.querySelect = value,
      'operation-query-orderby': () => operation.artifact.invocation.queryOrderBy = value,
      'operation-arguments': () => operation.artifact.invocation.arguments = value,
      'operation-path-aliases': () => operation.artifact.request.pathAliases = value,
      'operation-request-headers': () => operation.artifact.request.headers = value,
      'operation-request-body': () => operation.artifact.request.body = value,
      'operation-response-headers': () => operation.artifact.response.headers = value,
      'operation-response-body': () => operation.artifact.response.body = value,
    };
    set[target.dataset.model]?.();
  }

  function setRootEndpoint(root, runtimeId, symbol) {
    root.endpoints = (root.endpoints ?? []).filter(endpoint => endpoint.runtimeId !== runtimeId);
    if (symbol) root.endpoints.push({ runtimeId, symbol });
  }

  function setOptional(owner, property, value) {
    if (value === '' || value === null) delete owner[property];
    else owner[property] = value;
  }

  function ensureOperationParameterSchema(operation) {
    if (!Array.isArray(operation.parameterSchema) || operation.parameterSchema.length === 0) {
      operation.parameterSchema = operationParameterSchema(operation).map(({ value, ...definition }) => definition);
    }
    return operation.parameterSchema;
  }

  function setOperationParameterValue(operation, parameterIndex, value) {
    const parameter = operationParameterSchema(operation)[parameterIndex];
    if (!parameter) return;
    const converted = parameter.kind === 'integer'
      ? optionalNumber(value)
      : parameter.kind === 'boolean'
        ? value === true || value === 'true'
        : parameter.kind === 'string-list'
          ? String(value).split(/[\r\n,]+/).map(item => item.trim()).filter(Boolean)
          : value;
    if (parameter.source.startsWith('arguments.')) {
      operation.artifact.invocation.arguments ??= {};
      operation.artifact.invocation.arguments[parameter.source.slice('arguments.'.length)] = converted;
    } else {
      operation.artifact.invocation[parameter.source] = converted;
    }
  }

  function renameOperationParameter(operation, parameterIndex, id) {
    const schema = ensureOperationParameterSchema(operation);
    const parameter = schema[parameterIndex];
    if (!parameter?.source.startsWith('arguments.')) return;
    const previousId = parameter.source.slice('arguments.'.length);
    const argumentsValue = operation.artifact.invocation.arguments ??= {};
    const previousValue = argumentsValue[previousId];
    delete argumentsValue[previousId];
    parameter.id = id;
    parameter.source = `arguments.${id}`;
    argumentsValue[id] = previousValue;
  }

  function replaceOperationRequestEntry(operation, property, rowIndex, name, value) {
    const dictionary = operation.artifact.request[property] ?? {};
    const entry = Object.entries(dictionary)[rowIndex];
    if (!entry) return;
    operation.artifact.request[property] = replaceDictionaryEntry(
      dictionary,
      rowIndex,
      name ?? entry[0],
      value ?? entry[1]);
  }

  function optionalNumber(value) {
    return value === '' ? null : Number(value);
  }

  async function clickAction(event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const index = Number(target.dataset.index);
    if (action === 'select-entity') {
      state.selectedEntity = Number(target.dataset.entity);
      state.selectedOperation = 0;
      return renderContent();
    } else if (action === 'select-operation') {
      state.selectedEntity = Number(target.dataset.entity);
      state.selectedOperation = Number(target.dataset.operation);
      return renderContent();
    } else if (action === 'select-pairing') {
      const tree = ui.content.querySelector('.studio-tree-scroll');
      const scrollTop = tree?.scrollTop ?? 0;
      const scrollLeft = tree?.scrollLeft ?? 0;
      state.selectedPairing[target.dataset.section] = index;
      renderContent();
      const renderedTree = ui.content.querySelector('.studio-tree-scroll');
      const selected = renderedTree?.querySelector('.studio-tree-leaf.active');
      selected?.focus({ preventScroll: true });
      if (renderedTree) {
        renderedTree.scrollTop = scrollTop;
        renderedTree.scrollLeft = scrollLeft;
      }
      return;
    } else if (action === 'set-scenario-mode') {
      const scenario = state.document.scenarios[index];
      const enabled = target.dataset.enabled === 'true';
      if (!enabled && scenario.response) state.scenarioResponseDrafts.set(scenario, scenario.response);
      const updated = setScenarioResponseEnabled(scenario, enabled, state.scenarioResponseDrafts.get(scenario));
      if (state.scenarioResponseDrafts.has(scenario)) {
        state.scenarioResponseDrafts.set(updated, state.scenarioResponseDrafts.get(scenario));
        state.scenarioResponseDrafts.delete(scenario);
      }
      state.document.scenarios[index] = updated;
      changed();
      return renderContentPreservingPairingView();
    } else if (action === 'add-scenario-header') {
      const response = state.document.scenarios[index].response;
      response.headers ??= {};
      let headerIndex = Object.keys(response.headers).length + 1;
      let name = `x-header-${headerIndex}`;
      while (Object.hasOwn(response.headers, name)) name = `x-header-${++headerIndex}`;
      response.headers[name] = '';
      changed();
      return renderContentPreservingPairingView();
    } else if (action === 'remove-scenario-header') {
      const response = state.document.scenarios[index].response;
      response.headers = Object.fromEntries(Object.entries(response.headers ?? {}).filter((_, headerIndex) => headerIndex !== Number(target.dataset.header)));
      changed();
      return renderContentPreservingPairingView();
    } else if (action === 'add-operation-parameter') {
      const operation = state.document.entities[Number(target.dataset.entity)].operations[Number(target.dataset.operation)];
      const schema = ensureOperationParameterSchema(operation);
      let parameterIndex = schema.length + 1;
      let id = `parameter${parameterIndex}`;
      while (schema.some(parameter => parameter.id === id)) id = `parameter${++parameterIndex}`;
      schema.push({ id, label: `Parameter ${parameterIndex}`, source: `arguments.${id}`, kind: 'string', required: true });
      operation.artifact.invocation.arguments ??= {};
      operation.artifact.invocation.arguments[id] = '';
    } else if (action === 'remove-operation-parameter') {
      const operation = state.document.entities[Number(target.dataset.entity)].operations[Number(target.dataset.operation)];
      const parameterIndex = Number(target.dataset.parameter);
      const parameter = operationParameterSchema(operation)[parameterIndex];
      const schema = ensureOperationParameterSchema(operation);
      schema.splice(parameterIndex, 1);
      if (parameter?.source.startsWith('arguments.')) delete operation.artifact.invocation.arguments?.[parameter.source.slice('arguments.'.length)];
    } else if (action === 'add-operation-path-alias') {
      const request = state.document.entities[Number(target.dataset.entity)].operations[Number(target.dataset.operation)].artifact.request;
      request.pathAliases ??= {};
      let aliasIndex = Object.keys(request.pathAliases).length + 1;
      let runtime = `runtime-${aliasIndex}`;
      while (Object.hasOwn(request.pathAliases, runtime)) runtime = `runtime-${++aliasIndex}`;
      request.pathAliases[runtime] = '';
    } else if (action === 'remove-operation-path-alias') {
      const request = state.document.entities[Number(target.dataset.entity)].operations[Number(target.dataset.operation)].artifact.request;
      request.pathAliases = Object.fromEntries(Object.entries(request.pathAliases ?? {}).filter((_, rowIndex) => rowIndex !== Number(target.dataset.row)));
    } else if (action === 'add-operation-request-header') {
      const request = state.document.entities[Number(target.dataset.entity)].operations[Number(target.dataset.operation)].artifact.request;
      request.headers ??= {};
      let headerIndex = Object.keys(request.headers).length + 1;
      let name = `x-header-${headerIndex}`;
      while (Object.hasOwn(request.headers, name)) name = `x-header-${++headerIndex}`;
      request.headers[name] = '';
    } else if (action === 'remove-operation-request-header') {
      const request = state.document.entities[Number(target.dataset.entity)].operations[Number(target.dataset.operation)].artifact.request;
      request.headers = Object.fromEntries(Object.entries(request.headers ?? {}).filter((_, rowIndex) => rowIndex !== Number(target.dataset.row)));
    } else if (action === 'add-operation-request-body') {
      const request = state.document.entities[Number(target.dataset.entity)].operations[Number(target.dataset.operation)].artifact.request;
      request.body = {};
    } else if (action === 'remove-operation-request-body') {
      const request = state.document.entities[Number(target.dataset.entity)].operations[Number(target.dataset.operation)].artifact.request;
      request.body = null;
    } else if (action === 'add-field-endpoint') {
      const field = state.document.fields[index];
      const choice = fieldEndpointChoices(field, state.symbols.fields, target.dataset.runtime)
        .find(endpoint => fieldKey(endpoint) === target.dataset.key);
      field.endpoints ??= [];
      if (choice && !field.endpoints.some(endpoint => fieldKey(endpoint) === fieldKey(choice))) {
        field.endpoints.push(fieldEndpointValue(choice));
        changed();
      }
      return renderContentPreservingPairingView();
    } else if (action === 'remove-field-endpoint') {
      const field = state.document.fields[index];
      field.endpoints = (field.endpoints ?? []).filter(endpoint => fieldKey(endpoint) !== target.dataset.key);
      changed();
      return renderContentPreservingPairingView();
    } else if (action === 'set-enum-endpoint') {
      assignEnumEndpoint(state.document.enums[index], target.dataset.runtime, target.dataset.symbol);
      changed();
      return renderContentPreservingPairingView();
    } else if (action === 'set-enum-member') {
      const member = state.document.enums[index].members[Number(target.dataset.member)];
      member.symbols ??= {};
      if (target.dataset.symbol) member.symbols[target.dataset.runtime] = target.dataset.symbol;
      else delete member.symbols[target.dataset.runtime];
      changed();
      return renderContentPreservingPairingView();
    } else if (action === 'add-entity') {
      state.document.entities ??= [];
      state.document.entities.push(newEntity(state.document.entities));
      state.selectedEntity = state.document.entities.length - 1;
      state.selectedOperation = 0;
    }
    else if (action === 'remove-entity') {
      state.document.entities.splice(Number(target.dataset.entity), 1);
      state.selectedEntity = Math.min(Number(target.dataset.entity), state.document.entities.length - 1);
      state.selectedOperation = 0;
    }
    else if (action === 'add-operation') {
      const entityIndex = Number(target.dataset.entity);
      const entity = state.document.entities[entityIndex];
      entity.operations ??= [];
      entity.operations.push(newOperation(entity, state.document.layers));
      state.selectedEntity = entityIndex;
      state.selectedOperation = entity.operations.length - 1;
    }
    else if (action === 'duplicate-operation') {
      const entityIndex = Number(target.dataset.entity);
      const operationIndex = Number(target.dataset.operation);
      const entity = state.document.entities[entityIndex];
      const copy = JSON.parse(JSON.stringify(entity.operations[operationIndex]));
      const identity = newOperation(entity, state.document.layers);
      copy.id = identity.id;
      copy.name = `${copy.name || 'Operation'} copy`;
      copy.rootFunction.id = `${entity.id}.${copy.id}`;
      entity.operations.splice(operationIndex + 1, 0, copy);
      state.selectedEntity = entityIndex;
      state.selectedOperation = operationIndex + 1;
    }
    else if (action === 'remove-operation') {
      const entityIndex = Number(target.dataset.entity);
      const operationIndex = Number(target.dataset.operation);
      const operations = state.document.entities[entityIndex].operations;
      operations.splice(operationIndex, 1);
      state.selectedEntity = entityIndex;
      state.selectedOperation = Math.min(operationIndex, operations.length - 1);
    }
    else if (action === 'move-operation-up' || action === 'move-operation-down') {
      const entityIndex = Number(target.dataset.entity);
      const operationIndex = Number(target.dataset.operation);
      const destination = action === 'move-operation-up' ? operationIndex - 1 : operationIndex + 1;
      const entity = state.document.entities[entityIndex];
      if (destination < 0 || destination >= entity.operations.length) return;
      entity.operations = moveItem(entity.operations, operationIndex, destination);
      state.selectedEntity = entityIndex;
      state.selectedOperation = destination;
    }
    else if (action === 'add-scenario') {
      state.document.scenarios ??= [];
      state.document.scenarios.push(newScenario(state.document.scenarios));
      state.selectedPairing.scenarios = state.document.scenarios.length - 1;
    }
    else if (action === 'duplicate-scenario') {
      const copy = JSON.parse(JSON.stringify(state.document.scenarios[index]));
      const identity = newScenario(state.document.scenarios);
      copy.id = identity.id;
      copy.name = `${copy.name || 'Scenario'} copy`;
      state.document.scenarios.splice(index + 1, 0, copy);
      state.selectedPairing.scenarios = index + 1;
    }
    else if (action === 'remove-scenario') {
      state.document.scenarios.splice(index, 1);
      state.selectedPairing.scenarios = Math.min(index, state.document.scenarios.length - 1);
    }
    else if (action === 'move-scenario-up' || action === 'move-scenario-down') {
      const destination = action === 'move-scenario-up' ? index - 1 : index + 1;
      if (destination < 0 || destination >= state.document.scenarios.length) return;
      state.document.scenarios = moveItem(state.document.scenarios, index, destination);
      state.selectedPairing.scenarios = destination;
    }
    else if (action === 'add-field') {
      state.document.fields.push({ id: nextId('field', state.document.fields), endpoints: [], excluded: false });
      state.selectedPairing.fields = impactfulFields(state.document.fields).length - 1;
    }
    else if (action === 'remove-field') {
      state.document.fields.splice(index, 1);
      state.selectedPairing.fields = Math.min(index, state.document.fields.length - 1);
    }
    else if (action === 'add-function') state.document.functions.push({ id: nextId('function', state.document.functions), layerId: state.document.layers[0]?.id ?? '', role: 'step', endpoints: [] });
    else if (action === 'remove-function') state.document.functions.splice(index, 1);
    else if (action === 'add-enum') {
      state.document.enums.push({ id: nextId('enum', state.document.enums), flags: false, endpoints: [], members: [] });
      state.selectedPairing.enums = state.document.enums.length - 1;
    }
    else if (action === 'remove-enum') {
      state.document.enums.splice(index, 1);
      state.selectedPairing.enums = Math.min(index, state.document.enums.length - 1);
    }
    else if (action === 'add-member') (state.document.enums[index].members ??= []).push({ symbols: {} });
    else if (action === 'remove-member') state.document.enums[index].members.splice(Number(target.dataset.member), 1);
    else if (action === 'add-layer') state.document.layers.push({ id: nextId('layer', state.document.layers), name: 'New layer' });
    else if (action === 'move-layer-up' || action === 'move-layer-down') {
      const destination = action === 'move-layer-up' ? index - 1 : index + 1;
      if (destination < 0 || destination >= state.document.layers.length) return;
      state.document.layers = moveItem(state.document.layers, index, destination);
    }
    else if (action === 'remove-layer') state.document.layers.splice(index, 1);
    else if (action === 'apply-source') return applySource();
    else if (action === 'load-version') return loadVersion(target.dataset.version);
    else if (action === 'restore-version') return restoreVersion(target.dataset.version);
    else return;
    changed(); render();
  }

  function assignEnumEndpoint(item, runtimeId, symbol) {
    const previous = (item.endpoints ?? []).find(endpoint => endpoint.runtimeId === runtimeId)?.symbol;
    item.endpoints = (item.endpoints ?? []).filter(endpoint => endpoint.runtimeId !== runtimeId);
    if (symbol) item.endpoints.push({ runtimeId, symbol });
    if (previous !== symbol) {
      for (const member of item.members ?? []) delete member.symbols?.[runtimeId];
    }
  }

  function applySource() {
    try { state.document = JSON.parse(element('settings-source-editor').value); rememberDocumentSymbols(state.document); changed(); render(); validate(false); }
    catch (error) { notify(`Invalid JSON: ${error.message}`, true); }
  }

  async function validate(showMessage) {
    const invalidJson = ui.content.querySelector('[data-json][aria-invalid="true"]');
    if (invalidJson) {
      invalidJson.focus();
      if (showMessage) notify('Fix invalid JSON before validating.', true);
      return false;
    }
    const validatedDocument = JSON.stringify(state.document);
    try {
      const validation = await api('/api/parity-data/validate', { method: 'POST', body: state.document });
      if (JSON.stringify(state.document) !== validatedDocument) return false;
      state.validation = validation;
      if (!state.validation.valid) state.problemsOpen = true;
      renderStatus();
      if (showMessage) notify(state.validation.valid ? 'Parity data is valid.' : `${state.validation.errors.length} validation errors.`, !state.validation.valid);
      return state.validation.valid;
    } catch (error) { notify(error.message, true); return false; }
  }

  async function refreshInventory() {
    busy(ui.refresh, true);
    try {
      state.inventory = await api('/api/parity-data/symbols');
      rememberInventorySymbols(state.inventory);
      const resolved = resolveObservedMappings();
      updateTraceControls();
      if (state.section === 'fields' || state.section === 'enums') {
        renderContentPreservingPairingView();
        renderStatus();
      } else if (resolved > 0) render();
      else {
        updateSectionSummary();
      }
      notify(resolved > 0 ? `Resolved ${resolved} new exact endpoints.` : 'Trace inventory refreshed; mappings are current.');
    }
    catch (error) { notify(error.message, true); }
    finally { busy(ui.refresh, false); }
  }

  async function hotload() {
    if (!await validate(false)) return notify('Resolve validation errors before hotload.', true);
    busy(ui.hotload, true);
    try { await api('/api/parity-data/hotload', { method: 'POST', body: state.document }); await onSaved?.(); notify('Draft hotloaded for this server process.'); }
    catch (error) { notify(error.message, true); }
    finally { busy(ui.hotload, false); }
  }

  function openSave() {
    ui.versionLabel.value = ''; ui.versionNotes.value = '';
    const operationCount = (state.document.entities ?? []).reduce((total, entity) => total + (entity.operations?.length ?? 0), 0);
    ui.saveSummary.textContent = `${state.document.scenarios?.length ?? 0} scenarios · ${state.document.entities?.length ?? 0} entities · ${operationCount} operations · ${state.document.fields?.length ?? 0} fields · ${state.document.functions?.length ?? 0} functions · ${state.document.enums?.length ?? 0} enums`;
    ui.savePanel.hidden = false; ui.versionLabel.focus();
  }
  function closeSave() { ui.savePanel.hidden = true; }

  async function saveVersion(event) {
    event.preventDefault();
    if (!await validate(false)) return notify('Resolve validation errors before saving.', true);
    const submit = ui.savePanel.querySelector('[type="submit"]'); busy(submit, true);
    try {
      const result = await api('/api/parity-data/versions', { method: 'POST', body: { document: state.document, label: ui.versionLabel.value, notes: ui.versionNotes.value } });
      state.saved = JSON.stringify(state.document); state.versions = await api('/api/parity-data/versions'); closeSave(); render(); await onSaved?.(); notify(`Saved server version ${result.version.id}.`);
    } catch (error) { notify(error.message, true); }
    finally { busy(submit, false); }
  }

  async function loadVersion(id) {
    try { const version = await api(`/api/parity-data/versions/${encodeURIComponent(id)}`); state.document = version.document; rememberDocumentSymbols(state.document); state.section = 'fields'; changed(); render(); await validate(false); }
    catch (error) { notify(error.message, true); }
  }

  async function restoreVersion(id) {
    try {
      await api(`/api/parity-data/versions/${encodeURIComponent(id)}/restore`, { method: 'POST' });
      const workspace = await api('/api/parity-data'); state.document = workspace.document; rememberDocumentSymbols(state.document); state.saved = JSON.stringify(state.document); state.versions = workspace.versions; render(); await onSaved?.(); notify('Server version restored and activated.');
    } catch (error) { notify(error.message, true); }
  }

  async function importFile(event) {
    const file = event.target.files[0]; event.target.value = '';
    if (!file) return;
    try { state.document = JSON.parse(await file.text()); rememberDocumentSymbols(state.document); state.section = 'fields'; changed(); render(); await validate(true); }
    catch (error) { notify(`Import failed: ${error.message}`, true); }
  }

  function exportFile() {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([`${JSON.stringify(state.document, null, 2)}\n`], { type: 'application/json' }));
    link.download = `parity-data-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href);
  }

  function renderStatus() {
    const dirty = JSON.stringify(state.document) !== state.saved;
    ui.dirty.textContent = dirty ? 'Draft changed' : 'Server saved'; ui.dirty.classList.toggle('changed', dirty);
    const errors = state.validation?.errors?.length ?? 0, warnings = state.validation?.warnings?.length ?? 0;
    ui.validation.innerHTML = `<i data-lucide="${errors ? 'circle-x' : 'circle-check'}"></i>${errors ? 'Invalid' : state.validation ? 'Valid' : 'Not validated'}`;
    ui.problems.textContent = `${errors + warnings} problem${errors + warnings === 1 ? '' : 's'}`;
    ui.problems.disabled = errors + warnings === 0;
    const explicitFields = impactfulFields(state.document?.fields);
    const paired = explicitFields.filter(item => !item.excluded &&
      new Set((item.endpoints ?? []).map(endpoint => endpoint.runtimeId)).size >= 2);
    const pairedRoots = paired.filter(item => item.endpoints.every(endpoint =>
      endpoint.scope === 'type' && endpoint.memberPath === '$')).length;
    const exactPairs = paired.length - pairedRoots;
    const excluded = explicitFields.filter(item => item.excluded).length;
    ui.stats.textContent = `${pairedRoots} paired roots · ${exactPairs} exact pairs · ${excluded} excluded · ${explicitFields.length} maintained`;
    renderProblems();
    renderProblemMarkers();
    icons();
  }

  function renderProblems() {
    const entries = validationProblems();
    const visible = state.problemsOpen && entries.length > 0;
    ui.problemsPanel.hidden = !visible;
    ui.problems.setAttribute('aria-expanded', String(visible));
    ui.problems.classList.toggle('active', visible);
    if (!visible) {
      ui.problemsList.innerHTML = '';
      return;
    }
    ui.problemsList.innerHTML = entries.map((entry, index) => `<button type="button" class="studio-problem ${entry.severity}" data-problem-index="${index}"><i data-lucide="${entry.severity === 'error' ? 'circle-x' : 'triangle-alert'}"></i><span><strong>${esc(problemLocation(entry.target))}</strong><code>${esc(entry.message)}</code></span><i data-lucide="arrow-right"></i></button>`).join('');
    icons();
  }

  function renderProblemMarkers() {
    ui.nav.querySelectorAll('[data-section]').forEach(item => {
      const count = sectionProblemCount(item.dataset.section);
      item.classList.toggle('has-problems', count > 0);
      item.querySelector('.studio-problem-badge')?.remove();
      if (count) item.insertAdjacentHTML('beforeend', problemBadge(count));
    });
    ui.content.querySelectorAll('.studio-tree-leaf[data-section]').forEach(item => {
      const definitions = state.document?.[item.dataset.section] ?? [];
      const id = definitions[Number(item.dataset.index)]?.id;
      const count = pairingProblemCount(item.dataset.section, id, Number(item.dataset.index));
      item.classList.toggle('has-problems', count > 0);
      item.querySelector('.studio-problem-badge')?.remove();
      if (count) item.insertAdjacentHTML('beforeend', problemBadge(count));
    });
    ui.content.querySelectorAll('[data-problem-section][data-problem-id]').forEach(item => {
      const itemIndex = Number(item.dataset.problemIndex);
      const currentId = state.document?.[item.dataset.problemSection]?.[itemIndex]?.id;
      const count = pairingProblemCount(
        item.dataset.problemSection,
        currentId,
        itemIndex);
      item.classList.toggle('has-problems', count > 0);
      item.querySelector('.studio-problem-badge')?.remove();
      if (count) item.insertAdjacentHTML('beforeend', problemBadge(count));
    });
    ui.content.querySelectorAll('.studio-entity-tree-entity[data-entity]').forEach(item => {
      const entity = state.document?.entities?.[Number(item.dataset.entity)];
      const count = entity ? pairingProblemCount('entities', entity.id, Number(item.dataset.entity)) : 0;
      refreshProblemBadge(item, count);
    });
    ui.content.querySelectorAll('.studio-entity-tree-operation[data-entity][data-operation]').forEach(item => {
      const entity = state.document?.entities?.[Number(item.dataset.entity)];
      const operation = entity?.operations?.[Number(item.dataset.operation)];
      const count = entity && operation ? operationProblemCount(entity.id, operation.id, Number(item.dataset.operation)) : 0;
      refreshProblemBadge(item, count);
    });
  }

  function refreshProblemBadge(item, count) {
    item.classList.toggle('has-problems', count > 0);
    item.querySelector('.studio-problem-badge')?.remove();
    if (count) item.insertAdjacentHTML('beforeend', problemBadge(count));
  }

  function validationProblems() {
    return [
      ...(state.validation?.errors ?? []).map(message => ({ severity: 'error', message, target: validationProblemTarget(message) })),
      ...(state.validation?.warnings ?? []).map(message => ({ severity: 'warning', message, target: validationProblemTarget(message) })),
    ];
  }

  function sectionProblemCount(section) {
    return validationProblems().filter(problem => problem.target.section === section).length;
  }

  function pairingProblemCount(section, pairingId, itemIndex = null) {
    return validationProblems().filter(problem => problem.target.section === section
      && (pairingId ? problem.target.pairingId === pairingId : problem.target.itemIndex === itemIndex)).length;
  }

  function operationProblemCount(entityId, operationId, operationIndex = null) {
    return validationProblems().filter(problem => problem.target.section === 'entities'
      && problem.target.pairingId === entityId
      && (problem.target.operationId
        ? problem.target.operationId === operationId
        : problem.target.operationIndex === operationIndex)).length;
  }

  function navigateToProblem(problemIndex) {
    const problem = validationProblems()[problemIndex];
    if (!problem) return;
    const { section, collection, pairingId, itemIndex } = problem.target;
    state.section = section;
    let index = itemIndex ?? -1;
    if (section === 'entities') {
      index = itemIndex ?? (state.document.entities ?? []).findIndex(item => item.id === pairingId);
      if (index >= 0) {
        state.selectedEntity = index;
        const operations = state.document.entities[index].operations ?? [];
        state.selectedOperation = problem.target.operationIndex
          ?? Math.max(0, operations.findIndex(item => item.id === problem.target.operationId));
      }
    } else if (pairingId && ['scenarios', 'fields', 'enums'].includes(section)) {
      index = (state.document[section] ?? []).findIndex(item => item.id === pairingId);
      if (index >= 0) state.selectedPairing[section] = index;
    } else if (pairingId && ['functions', 'layers'].includes(section)) {
      index = (state.document[section] ?? []).findIndex(item => item.id === pairingId);
    }
    render();
    focusProblemTarget(section, index, collection, problem.message);
  }

  function focusProblemTarget(section, index, collection, message = '') {
    const selector = section === 'entities' ? entityProblemSelector(state.selectedEntity, state.selectedOperation, message)
      : section === 'scenarios' ? scenarioProblemSelector(index, message)
      : section === 'fields' ? `[data-model="field-id"][data-index="${index}"]`
      : section === 'enums' ? `[data-model="enum-id"][data-index="${index}"]`
      : section === 'functions' ? `[data-model="${message.includes('.role') || message.includes('serviceBoundary') ? 'function-role' : 'function-id'}"][data-index="${index}"]`
      : section === 'layers' ? `[data-model="layer-id"][data-index="${index}"]`
      : '#settings-source-editor';
    const target = ui.content.querySelector(selector) ?? ui.content.querySelector('input, select, textarea, button');
    const container = section === 'entities'
      ? ui.content.querySelector(`.studio-entity-card[data-problem-index="${state.selectedEntity}"]`)
      : section === 'scenarios'
      ? ui.content.querySelector(`.studio-scenario-card[data-problem-index="${index}"]`)
      : target?.closest('.studio-mapping-card, .studio-function-row, .studio-layer-row, .studio-source-view') ?? target;
    container?.classList.add('studio-problem-focus');
    container?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target?.focus({ preventScroll: true });
  }

  function entityProblemSelector(entityIndex, operationIndex, message) {
    const prefix = `[data-entity="${entityIndex}"]`;
    if (!message.includes('.operations[')) {
      const model = message.includes('non-empty name') ? 'entity-name' : message.includes('non-empty icon') ? 'entity-icon' : 'entity-id';
      return `[data-model="${model}"]${prefix}`;
    }
    const model = message.includes('non-empty name') ? 'operation-name'
      : message.includes('non-empty method') ? 'operation-method'
      : message.includes('non-empty route') ? 'operation-route'
      : message.includes('non-empty responseShape') ? 'operation-response-shape'
      : message.includes('non-empty description') ? 'operation-description'
      : message.includes('.rootFunction.layerId') ? 'operation-root-layer'
      : 'operation-id';
    return `[data-model="${model}"][data-entity="${entityIndex}"][data-operation="${operationIndex}"]`;
  }

  function scenarioProblemSelector(index, message) {
    const model = message.includes('.response.statusCode') ? 'scenario-status'
      : message.includes('.response.version') ? 'scenario-version'
      : message.includes('.response.headers') ? 'scenario-header-name'
      : message.includes('.response.bodyText') ? 'scenario-body'
      : message.includes('non-empty name') ? 'scenario-name'
      : message.includes('non-empty summary') ? 'scenario-summary'
      : message.includes('non-empty tone') ? 'scenario-tone'
      : 'scenario-id';
    return `[data-model="${model}"][data-index="${index}"]`;
  }

  function problemLocation(target) {
    const section = SECTIONS.find(([id]) => id === target.section)?.[1] ?? 'Source';
    const collection = target.section === 'source' && target.collection ? `${section} · ${target.collection}` : section;
    if (target.pairingId && target.operationId) return `${collection} · ${target.pairingId}/${target.operationId}`;
    if (target.pairingId && target.operationIndex !== null) return `${collection} · ${target.pairingId}/operation ${target.operationIndex + 1}`;
    if (target.pairingId) return `${collection} · ${target.pairingId}`;
    if (target.itemIndex !== null) return `${collection} · item ${target.itemIndex + 1}`;
    return collection;
  }

  function changed() { state.validation = null; state.problemsOpen = false; renderStatus(); }
  function rememberDocumentSymbols(document) {
    state.symbols = mergeSymbolCatalog(state.symbols, documentSymbolCatalog(document));
  }
  function rememberInventorySymbols(inventoryValue) {
    state.symbols = mergeSymbolCatalog(state.symbols, inventoryValue);
  }
  function resolveObservedMappings() {
    let resolved = 0;
    const functionDefinitions = [
      ...(state.document.functions ?? []),
      ...(state.document.entities ?? []).flatMap(entity =>
        (entity.operations ?? []).map(operation => operation.rootFunction).filter(Boolean)),
    ];
    for (const observed of state.inventory.functions ?? []) {
      const definition = functionDefinitions.find(item => item.id === observed.functionId);
      if (!definition?.id || !observed.symbol || !observed.runtimeId) continue;
      definition.endpoints ??= [];
      if (!definition.endpoints.some(endpoint => endpoint.runtimeId === observed.runtimeId && endpoint.symbol === observed.symbol)) {
        definition.endpoints.push({ runtimeId: observed.runtimeId, symbol: observed.symbol });
        resolved++;
      }
    }
    if (resolved > 0) changed();
    return resolved;
  }

  function fieldEndpointValue(observed) {
    const endpoint = {
      runtimeId: observed.runtimeId,
      scope: observed.scope,
      ownerTypeSymbol: observed.ownerTypeSymbol,
      memberPath: observed.memberPath,
    };
    if (observed.scope === 'function') {
      endpoint.functionSymbol = observed.functionSymbol;
      endpoint.direction = observed.direction;
      endpoint.path = observed.path;
    }
    return endpoint;
  }

  function inventory(name, runtimeId) { return (state.inventory[name] ?? []).filter(item => item.runtimeId === runtimeId && (!state.runId || item.runId === state.runId)); }
  function observed(name, runtimeId) { return inventory(name, runtimeId).length; }
  function count(id) {
    const value = id === 'history' ? state.versions.length
      : id === 'source' ? null
      : id === 'fields' ? impactfulFields(state.document?.fields).length
      : state.document?.[id]?.length ?? 0;
    return value === null ? '' : `<em>${value}</em>`;
  }
}

function actionBar(summary, action, label) { return `<div class="studio-section-actions"><span>${summary}</span><button class="settings-save-button" type="button" data-action="${action}"><i data-lucide="plus"></i>${label}</button></div>`; }
function problemBadge(count) { return count ? `<b class="studio-problem-badge" aria-label="${count} validation problem${count === 1 ? '' : 's'}">${count}</b>` : ''; }
function input(label, model, index, value) { return `<label><span>${label}</span><input data-model="${model}" data-index="${index}" value="${esc(value)}"></label>`; }
function remove(action, index) { return `<button class="icon-button" type="button" data-action="${action}" data-index="${index}" aria-label="Remove" title="Remove"><i data-lucide="trash-2"></i></button>`; }
function shortName(symbol = '') { return symbol.split(/::|\./).slice(-2).join('::'); }
function shortTypeName(symbol = '') {
  const withoutGenericArguments = symbol.replace(/\[\[.*$/s, '').replace(/<.*$/s, '');
  return withoutGenericArguments.split(/::|\./).at(-1) || symbol;
}
function nextId(prefix, items) { let index = items.length + 1; while (items.some(item => item.id === `${prefix}.new-${index}`)) index++; return `${prefix}.new-${index}`; }
function empty(icon, text, spin = false) { return `<div class="studio-empty"><i data-lucide="${icon}" class="${spin ? 'spin' : ''}"></i><span>${esc(text)}</span></div>`; }
function busy(button, value) { button.disabled = value; button.classList.toggle('busy', value); }
function icons() { window.lucide?.createIcons({ attrs: { 'stroke-width': 1.7 } }); }
function esc(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: options.body ? { 'Content-Type': 'application/json' } : undefined, body: options.body ? JSON.stringify(options.body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.validation?.errors?.join(' ') || payload.error || `Request failed (${response.status}).`);
  return payload;
}
