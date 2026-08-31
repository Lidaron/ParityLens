import { initializeParitySettingsIde } from './settings.js?v=parity-data-studio-55';
import { logicallyOrderedEntities } from './entity-order.js?v=logical-entity-order-1';
import { initializeHelpDialog } from './help.js?v=instrumentation-guide-4';
import { traceServiceEndpointIndex } from './timeline-options.js?v=role-only-timeline-1';
import { dataNodeDefaultOpen, dataValueWithRuntimeNames, pairRuntimeFieldKeys, standardFieldName } from './data-tree-options.js?v=runtime-names-5';
import { selectedStepRuntimeFacts, selectedStepTraceCounts } from './inspector-options.js?v=trace-local-facts-1';

const state = {
  catalog: null,
  run: null,
  recentRuns: [],
  selectedTraceId: null,
  executionCollapsed: new Set(),
  dataTreesExpanded: {},
  diffOnly: false,
  zoom: 1,
  traceTimeline: null,
  traceTimelineBounds: null,
  traceTimelinePositions: null,
  traceTimelineZoomRange: null,
  layoutMode: null,
};

const richComboboxes = new Map();

const elements = {
  entity: document.querySelector('#entity-select'),
  operation: document.querySelector('#operation-select'),
  baseline: document.querySelector('#baseline-select'),
  candidate: document.querySelector('#candidate-select'),
  scenario: document.querySelector('#scenario-select'),
  runButton: document.querySelector('#run-button'),
  operationNav: document.querySelector('#operation-nav'),
  recentRuns: document.querySelector('#recent-runs'),
  runCount: document.querySelector('#run-count'),
  coverage: document.querySelector('#coverage-label'),
  operationRoute: document.querySelector('#operation-route'),
  operationDescription: document.querySelector('#operation-description'),
  verdict: document.querySelector('#verdict-badge'),
  traceMap: document.querySelector('#trace-map'),
  executionTable: document.querySelector('#execution-table'),
  executionSummary: document.querySelector('#execution-summary'),
  divergenceSummary: document.querySelector('#divergence-summary'),
  inspectorHeadingLabel: document.querySelector('#inspector-heading-label'),
  diffList: document.querySelector('#diff-list'),
  functionIoDialog: document.querySelector('#function-io-dialog'),
  functionIoDialogContent: document.querySelector('#function-io-dialog-content'),
  functionIoDialogTitle: document.querySelector('#function-io-dialog-title'),
  openFunctionIo: document.querySelector('#open-function-io'),
  responseMeta: document.querySelector('#response-meta'),
  changedCount: document.querySelector('#changed-count'),
  fieldCount: document.querySelector('#field-count'),
  diffOnly: document.querySelector('#diff-only-toggle'),
  responseDiff: document.querySelector('#response-diff'),
  baselinePayloadVersion: document.querySelector('#payload-baseline-version'),
  candidatePayloadVersion: document.querySelector('#payload-candidate-version'),
  baselinePayloadStatus: document.querySelector('#payload-baseline-status'),
  candidatePayloadStatus: document.querySelector('#payload-candidate-status'),
  traceView: document.querySelector('#trace-view'),
  traceLoading: document.querySelector('#trace-loading'),
  responseView: document.querySelector('#response-view'),
  workspaceResizer: document.querySelector('#workspace-resizer'),
  toast: document.querySelector('#toast'),
};

async function initialize() {
  initializeResizableLayout();
  bindEvents();
  initializeHelpDialog({ button: document.querySelector('#help-button') });
  initializeParitySettingsIde({
    button: document.querySelector('#settings-button'),
    notify: showToast,
    onSaved: async () => {
      state.catalog = await requestJson('/api/catalog');
      populateControls();
      updateOperationContext();
      renderOperationNav();
      clearComparison();
    },
  });
  setView('trace');
  try {
    const [catalog, recentRuns] = await Promise.all([requestJson('/api/catalog'), requestJson('/api/runs')]);
    state.catalog = catalog;
    state.recentRuns = recentRuns;
    populateControls();
    initializeRichComboboxes();
    renderOperationNav();
    renderRecentRuns();
    updateOperationContext();
    refreshIcons();
    await runComparison();
  } catch (error) {
    showToast(error.message, true);
  }
}

function initializeResizableLayout() {
  const root = document.documentElement;
  const saved = {
    sidebar: Number(sessionStorage.getItem('parity.sidebarWidth')) || 236,
    recentPane: Number(sessionStorage.getItem('parity.recentPaneHeight')) || 250,
    inspector: Number(sessionStorage.getItem('parity.inspectorWidth')) || 354,
    comparison: Number(sessionStorage.getItem('parity.comparisonHeight')) || 304,
    inspectorSummary: Number(sessionStorage.getItem('parity.inspectorSummaryHeight')) || 250,
  };
  const setSidebar = value => {
    const inspector = parseFloat(getComputedStyle(root).getPropertyValue('--inspector-width')) || saved.inspector;
    const width = clamp(value, 180, Math.max(180, window.innerWidth - inspector - 520));
    root.style.setProperty('--sidebar-width', `${width}px`);
    return width;
  };
  const setInspector = value => {
    const sidebar = parseFloat(getComputedStyle(root).getPropertyValue('--sidebar-width')) || saved.sidebar;
    const width = clamp(value, 280, Math.max(280, window.innerWidth - sidebar - 520));
    root.style.setProperty('--inspector-width', `${width}px`);
    return width;
  };
  const setComparison = value => {
    const height = Math.max(180, value);
    root.style.setProperty('--comparison-pane-height', `${height}px`);
    return height;
  };
  const setInspectorSummary = value => {
    const inspectorHeight = document.querySelector('.inspector')?.clientHeight || window.innerHeight - 68;
    const height = clamp(value, 110, Math.max(110, inspectorHeight - 260));
    root.style.setProperty('--inspector-summary-height', `${height}px`);
    return height;
  };
  const setRecentPane = value => {
    const sidebarHeight = document.querySelector('.sidebar')?.clientHeight || window.innerHeight - 68;
    const height = clamp(value, 100, Math.max(100, sidebarHeight - 217));
    root.style.setProperty('--recent-pane-height', `${height}px`);
    return height;
  };
  setSidebar(saved.sidebar);
  setRecentPane(saved.recentPane);
  setInspector(saved.inspector);
  setComparison(saved.comparison);
  setInspectorSummary(saved.inspectorSummary);
  state.layoutMode = responsiveLayoutMode();
  if (state.layoutMode === 'desktop') requestAnimationFrame(() => window.scrollTo(0, 0));
  bindResizableSeparator('#sidebar-resizer', 'vertical',
    () => parseFloat(getComputedStyle(root).getPropertyValue('--sidebar-width')),
    setSidebar, 'parity.sidebarWidth', 1);
  bindResizableSeparator('#investigation-pane-resizer', 'horizontal',
    () => parseFloat(getComputedStyle(root).getPropertyValue('--recent-pane-height')),
    setRecentPane, 'parity.recentPaneHeight', 1);
  bindResizableSeparator('#inspector-resizer', 'vertical',
    () => parseFloat(getComputedStyle(root).getPropertyValue('--inspector-width')),
    setInspector, 'parity.inspectorWidth', -1);
  bindResizableSeparator('#workspace-resizer', 'horizontal',
    () => parseFloat(getComputedStyle(root).getPropertyValue('--comparison-pane-height')),
    setComparison, 'parity.comparisonHeight', 1);
  bindResizableSeparator('#inspector-section-resizer', 'horizontal',
    () => parseFloat(getComputedStyle(root).getPropertyValue('--inspector-summary-height')),
    setInspectorSummary, 'parity.inspectorSummaryHeight', 1);
  let resizeFrame;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      const nextMode = responsiveLayoutMode();
      if (nextMode !== state.layoutMode) {
        window.scrollTo(0, 0);
        state.layoutMode = nextMode;
      }
      state.traceTimeline?.redraw();
      if (nextMode !== 'desktop') return;
      const sidebarWidth = setSidebar(parseFloat(getComputedStyle(root).getPropertyValue('--sidebar-width')));
      const inspectorWidth = setInspector(parseFloat(getComputedStyle(root).getPropertyValue('--inspector-width')));
      document.querySelector('#sidebar-resizer')?.setAttribute('aria-valuenow', String(Math.round(sidebarWidth)));
      document.querySelector('#inspector-resizer')?.setAttribute('aria-valuenow', String(Math.round(inspectorWidth)));
      const recentPaneHeight = setRecentPane(parseFloat(getComputedStyle(root).getPropertyValue('--recent-pane-height')));
      document.querySelector('#investigation-pane-resizer')?.setAttribute('aria-valuenow', String(Math.round(recentPaneHeight)));
      setComparison(parseFloat(getComputedStyle(root).getPropertyValue('--comparison-pane-height')));
      setInspectorSummary(parseFloat(getComputedStyle(root).getPropertyValue('--inspector-summary-height')));
    });
  });
}

function responsiveLayoutMode() {
  if (window.innerWidth <= 700) return 'mobile';
  if (window.innerWidth <= 980) return 'stacked';
  return 'desktop';
}

function withStableViewport(update) {
  if (responsiveLayoutMode() === 'desktop') {
    update();
    window.scrollTo(0, 0);
    return;
  }
  const candidates = [
    document.querySelector('.sidebar'),
    document.querySelector('.workspace'),
    document.querySelector('.execution-panel'),
    document.querySelector('.inspector'),
  ].filter(Boolean);
  const viewportMiddle = window.innerHeight / 2;
  const anchor = candidates.find(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top <= viewportMiddle && bounds.bottom >= viewportMiddle;
  }) ?? candidates.find(element => element.getBoundingClientRect().bottom > 0);
  const anchorTop = anchor?.getBoundingClientRect().top ?? 0;
  const previousOverflowAnchor = document.documentElement.style.overflowAnchor;
  document.documentElement.style.overflowAnchor = 'none';
  update();
  if (anchor) window.scrollBy(0, anchor.getBoundingClientRect().top - anchorTop);
  requestAnimationFrame(() => { document.documentElement.style.overflowAnchor = previousOverflowAnchor; });
}

function bindResizableSeparator(selector, orientation, readValue, writeValue, storageKey, direction) {
  const separator = document.querySelector(selector);
  if (!separator) return;
  const coordinate = event => orientation === 'vertical' ? event.clientX : event.clientY;
  const updateAria = value => separator.setAttribute('aria-valuenow', String(Math.round(value)));
  updateAria(readValue());
  separator.addEventListener('pointerdown', event => {
    if (separator.getAttribute('aria-disabled') === 'true') return;
    if (event.button !== 0) return;
    event.preventDefault();
    const startCoordinate = coordinate(event);
    const startValue = readValue();
    const scrollContainer = orientation === 'horizontal' ? separator.closest('.workspace') : null;
    const startScrollOffset = scrollContainer?.scrollTop ?? 0;
    let pointerCoordinate = startCoordinate;
    let scrollVelocity = 0;
    let autoScrollFrame = null;
    separator.classList.add('resizing');
    separator.setPointerCapture(event.pointerId);
    const resize = () => {
      const scrollDelta = (scrollContainer?.scrollTop ?? 0) - startScrollOffset;
      updateAria(writeValue(startValue + ((pointerCoordinate - startCoordinate + scrollDelta) * direction)));
    };
    const updateScrollVelocity = moveEvent => {
      if (!scrollContainer) return;
      const bounds = scrollContainer.getBoundingClientRect();
      const top = Math.max(0, bounds.top);
      const bottom = Math.min(window.innerHeight, bounds.bottom);
      const edge = Math.min(64, (bottom - top) / 4);
      if (moveEvent.clientY > bottom - edge) {
        scrollVelocity = 2 + 16 * clamp((moveEvent.clientY - (bottom - edge)) / edge, 0, 1);
      } else if (moveEvent.clientY < top + edge) {
        scrollVelocity = -(2 + 16 * clamp(((top + edge) - moveEvent.clientY) / edge, 0, 1));
      } else {
        scrollVelocity = 0;
      }
    };
    const autoScroll = () => {
      if (scrollContainer && scrollVelocity !== 0) {
        const previousScrollTop = scrollContainer.scrollTop;
        scrollContainer.scrollTop += scrollVelocity;
        if (scrollContainer.scrollTop !== previousScrollTop) resize();
      }
      autoScrollFrame = requestAnimationFrame(autoScroll);
    };
    const move = moveEvent => {
      pointerCoordinate = coordinate(moveEvent);
      updateScrollVelocity(moveEvent);
      resize();
    };
    const finish = () => {
      cancelAnimationFrame(autoScrollFrame);
      separator.classList.remove('resizing');
      sessionStorage.setItem(storageKey, String(Math.round(readValue())));
      separator.removeEventListener('pointermove', move);
      separator.removeEventListener('pointerup', finish);
      separator.removeEventListener('pointercancel', finish);
    };
    separator.addEventListener('pointermove', move);
    separator.addEventListener('pointerup', finish);
    separator.addEventListener('pointercancel', finish);
    autoScrollFrame = requestAnimationFrame(autoScroll);
  });
  separator.addEventListener('keydown', event => {
    if (separator.getAttribute('aria-disabled') === 'true') return;
    const decrement = orientation === 'vertical' ? event.key === 'ArrowLeft' : event.key === 'ArrowUp';
    const increment = orientation === 'vertical' ? event.key === 'ArrowRight' : event.key === 'ArrowDown';
    if (!decrement && !increment) return;
    event.preventDefault();
    const value = writeValue(readValue() + (increment ? 12 : -12) * direction);
    updateAria(value);
    sessionStorage.setItem(storageKey, String(Math.round(value)));
  });
}

function bindColumnResizers(owner, labelSelector, cssVariable, storageKey, minimums) {
  const saved = sessionStorage.getItem(storageKey);
  if (saved && !owner.style.getPropertyValue(cssVariable)) {
    const values = saved.split(',').map(Number);
    const total = values.reduce((sum, value) => sum + value, 0);
    owner.style.setProperty(cssVariable, values.map((value, index) =>
      `minmax(${minimums[index]}px, ${value / total * 100}fr)`).join(' '));
  }
  owner.querySelectorAll('[data-column-resizer]').forEach(handle => {
    const columnIndex = Number(handle.dataset.columnResizer);
    const labels = [...handle.closest('.execution-header, .data-column-labels').querySelectorAll(':scope > span')];
    const setWidths = widths => {
      const total = widths.reduce((sum, value) => sum + value, 0);
      owner.style.setProperty(cssVariable, widths.map((value, index) =>
        `minmax(${minimums[index]}px, ${value / total * 100}fr)`).join(' '));
      handle.setAttribute('aria-valuenow', String(Math.round(widths[columnIndex])));
    };
    const currentWidths = () => labels.map(label => label.getBoundingClientRect().width);
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-valuenow', String(Math.round(currentWidths()[columnIndex])));
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const widths = currentWidths();
      const pairTotal = widths[columnIndex] + widths[columnIndex + 1];
      handle.classList.add('resizing');
      handle.setPointerCapture(event.pointerId);
      const move = moveEvent => {
        const left = clamp(
          widths[columnIndex] + moveEvent.clientX - startX,
          minimums[columnIndex],
          pairTotal - minimums[columnIndex + 1]);
        const next = [...widths];
        next[columnIndex] = left;
        next[columnIndex + 1] = pairTotal - left;
        setWidths(next);
      };
      const finish = () => {
        handle.classList.remove('resizing');
        const finalWidths = currentWidths();
        const finalTotal = finalWidths.reduce((sum, value) => sum + value, 0);
        sessionStorage.setItem(storageKey, finalWidths.map(value => value / finalTotal * 100).join(','));
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', finish);
        handle.removeEventListener('pointercancel', finish);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', finish);
      handle.addEventListener('pointercancel', finish);
    });
    handle.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      event.stopPropagation();
      const widths = currentWidths();
      const pairTotal = widths[columnIndex] + widths[columnIndex + 1];
      const left = clamp(
        widths[columnIndex] + (event.key === 'ArrowRight' ? 12 : -12),
        minimums[columnIndex],
        pairTotal - minimums[columnIndex + 1]);
      widths[columnIndex] = left;
      widths[columnIndex + 1] = pairTotal - left;
      setWidths(widths);
      const total = widths.reduce((sum, value) => sum + value, 0);
      sessionStorage.setItem(storageKey, widths.map(value => value / total * 100).join(','));
    });
  });
}

function bindEvents() {
  const filterButton = document.querySelector('#trace-filter-button');
  const filterMenu = document.querySelector('#trace-filter-menu');
  filterMenu?.addEventListener('beforetoggle', event => {
    if (event.newState === 'open') requestAnimationFrame(positionTraceFilterMenu);
  });
  window.addEventListener('resize', () => {
    if (filterMenu?.matches(':popover-open')) positionTraceFilterMenu();
  });
  elements.entity.addEventListener('change', () => {
    populateOperations();
    updateOperationContext();
    renderOperationNav();
    reconcileComparisonSelection();
  });
  elements.operation.addEventListener('change', () => {
    updateOperationContext();
    renderOperationNav();
    reconcileComparisonSelection();
  });
  elements.baseline.addEventListener('change', reconcileComparisonSelection);
  elements.candidate.addEventListener('change', reconcileComparisonSelection);
  elements.scenario.addEventListener('change', reconcileComparisonSelection);
  elements.runButton.addEventListener('click', runComparison);
  elements.diffOnly.addEventListener('change', event => {
    withStableViewport(() => {
      state.diffOnly = event.target.checked;
      renderFilteredComparison();
      elements.traceMap.scrollLeft = Math.min(
        elements.traceMap.scrollLeft,
        Math.max(0, elements.traceMap.scrollWidth - elements.traceMap.clientWidth));
    });
  });
  document.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });
  document.querySelector('#fit-button').addEventListener('click', () => {
    setZoom(1);
  });
  document.querySelector('#zoom-out').addEventListener('click', () => setZoom(state.zoom - .1));
  document.querySelector('#zoom-in').addEventListener('click', () => setZoom(state.zoom + .1));
  document.querySelector('#sidebar-toggle').addEventListener('click', () => {
    if (filterMenu?.matches(':popover-open')) filterMenu.hidePopover();
    document.querySelector('.app-shell').classList.toggle('sidebar-collapsed');
  });
  document.querySelector('#inspector-toggle').addEventListener('click', () => {
    document.querySelector('.app-shell').classList.toggle('inspector-collapsed');
  });
  elements.openFunctionIo.addEventListener('click', () => elements.functionIoDialog.showModal());
  document.querySelector('#close-function-io').addEventListener('click', () => elements.functionIoDialog.close());
  dataTreeHosts().forEach(container => {
    container.addEventListener('click', event => {
      const button = event.target.closest('[data-tree-toggle]');
      if (button) toggleDataTree(button.dataset.treeToggle);
    });
    container.addEventListener('toggle', event => {
      const tree = event.target.closest('.data-comparison[data-tree-key]');
      if (tree) syncDataTreeControl(tree.dataset.treeKey);
    }, true);
  });
  elements.functionIoDialog.addEventListener('click', event => {
    if (event.target === elements.functionIoDialog) elements.functionIoDialog.close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && filterMenu?.matches(':popover-open')) {
      event.preventDefault();
      filterMenu.hidePopover();
      return;
    }
    if (event.key === 'Escape' && elements.functionIoDialog.open) {
      event.preventDefault();
      elements.functionIoDialog.close();
    }
  }, true);
}

function positionTraceFilterMenu() {
  const button = [...document.querySelectorAll('[popovertarget="trace-filter-menu"]')]
    .find(candidate => candidate.getClientRects().length > 0 && !candidate.hasAttribute('popovertargetaction'));
  const menu = document.querySelector('#trace-filter-menu');
  if (!button || !menu) return;
  const trigger = button.getBoundingClientRect();
  const bounds = menu.getBoundingClientRect();
  const width = bounds.width || Math.min(280, window.innerWidth - 16);
  const height = bounds.height || 190;
  const left = clamp(trigger.right - width, 8, Math.max(8, window.innerWidth - width - 8));
  const below = trigger.bottom + 6;
  const top = below + height <= window.innerHeight - 8
    ? below
    : Math.max(8, trigger.top - height - 6);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function populateControls() {
  elements.entity.innerHTML = logicallyOrderedEntities(state.catalog.entities).map(entity => option(entity.id, entity.name)).join('');
  elements.baseline.innerHTML = state.catalog.versions.map(version => option(version, version)).join('');
  elements.candidate.innerHTML = state.catalog.versions.map(version => option(version, version)).join('');
  elements.scenario.innerHTML = state.catalog.scenarios.map(scenario => option(scenario.id, scenario.name)).join('');
  elements.baseline.value = state.catalog.versions[0];
  elements.candidate.value = state.catalog.versions[1] ?? state.catalog.versions[0];
  elements.scenario.value = state.catalog.scenarios[0]?.id ?? '';
  populateOperations();
  syncRichComboboxes();

  const operationCount = state.catalog.entities.reduce((count, entity) => count + entity.operations.length, 0);
  elements.coverage.textContent = `${operationCount} mapped`;
}

function populateOperations(selectedOperation) {
  const entity = selectedEntity();
  elements.operation.innerHTML = entity.operations.map(operation => option(operation.id, operation.name)).join('');
  if (selectedOperation && entity.operations.some(operation => operation.id === selectedOperation)) {
    elements.operation.value = selectedOperation;
  }
  syncRichCombobox(elements.operation);
}

function initializeRichComboboxes() {
  [elements.entity, elements.operation, elements.baseline, elements.candidate, elements.scenario].forEach(select => {
    if (richComboboxes.has(select)) return;
    select.classList.add('native-combobox-source');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    const root = document.createElement('div');
    root.className = `rich-combobox rich-combobox-${select.id.replace('-select', '')}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rich-combobox-trigger';
    button.setAttribute('role', 'combobox');
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', select.getAttribute('aria-label') ?? 'Select option');
    const list = document.createElement('div');
    list.id = `${select.id}-listbox`;
    list.className = 'rich-combobox-list';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    button.setAttribute('aria-controls', list.id);
    root.append(button);
    select.insertAdjacentElement('afterend', root);
    document.body.append(list);

    const combobox = { select, root, button, list, activeIndex: -1, typeahead: '', typeaheadTimer: null };
    richComboboxes.set(select, combobox);

    button.addEventListener('click', event => {
      event.preventDefault();
      if (list.hidden) openRichCombobox(combobox);
      else closeRichCombobox(combobox);
    });
    button.addEventListener('keydown', event => handleRichComboboxKeydown(combobox, event));
    list.addEventListener('pointermove', event => {
      const optionButton = event.target.closest('[data-rich-option-index]');
      if (optionButton) setRichComboboxActive(combobox, Number(optionButton.dataset.richOptionIndex));
    });
    list.addEventListener('click', event => {
      const optionButton = event.target.closest('[data-rich-option-index]');
      if (!optionButton) return;
      event.preventDefault();
      chooseRichComboboxOption(combobox, Number(optionButton.dataset.richOptionIndex));
    });
    syncRichCombobox(select);
  });

  document.addEventListener('pointerdown', event => {
    richComboboxes.forEach(combobox => {
      if (!combobox.root.contains(event.target) && !combobox.list.contains(event.target)) {
        closeRichCombobox(combobox);
      }
    });
  });
  window.addEventListener('resize', positionOpenRichComboboxes);
  document.addEventListener('scroll', positionOpenRichComboboxes, true);
}

function syncRichComboboxes() {
  richComboboxes.forEach((_, select) => syncRichCombobox(select));
}

function syncRichCombobox(select) {
  const combobox = richComboboxes.get(select);
  if (!combobox) return;
  const options = [...select.options];
  const selectedIndex = Math.max(0, select.selectedIndex);
  const selectedOption = options[selectedIndex];
  combobox.button.replaceChildren();
  if (selectedOption) {
    combobox.button.append(createRichComboboxOptionContent(select, selectedOption, true));
  }
  const chevron = document.createElement('i');
  chevron.className = 'rich-combobox-chevron';
  chevron.dataset.lucide = 'chevron-down';
  combobox.button.append(chevron);
  combobox.list.replaceChildren(...options.map((option, index) => {
    const optionButton = document.createElement('button');
    optionButton.type = 'button';
    optionButton.id = `${select.id}-option-${index}`;
    optionButton.className = `rich-combobox-option${index === selectedIndex ? ' selected' : ''}`;
    optionButton.dataset.richOptionIndex = String(index);
    optionButton.setAttribute('role', 'option');
    optionButton.setAttribute('aria-selected', String(index === selectedIndex));
    optionButton.tabIndex = -1;
    optionButton.append(createRichComboboxOptionContent(select, option, false));
    if (index === selectedIndex) {
      const check = document.createElement('i');
      check.className = 'rich-combobox-check';
      check.dataset.lucide = 'check';
      optionButton.append(check);
    }
    return optionButton;
  }));
  combobox.activeIndex = selectedIndex;
  setRichComboboxActive(combobox, selectedIndex);
  refreshIcons();
}

function createRichComboboxOptionContent(select, option, compact) {
  const descriptor = describeRichComboboxOption(select, option);
  const content = document.createElement('span');
  content.className = 'rich-combobox-option-content';
  const icon = document.createElement('span');
  icon.className = `rich-combobox-option-icon${descriptor.tone ? ` ${descriptor.tone}` : ''}`;
  const iconGlyph = document.createElement('i');
  iconGlyph.dataset.lucide = descriptor.icon;
  icon.append(iconGlyph);
  const copy = document.createElement('span');
  copy.className = 'rich-combobox-option-copy';
  copy.append(timelineTextElement('strong', '', descriptor.label));
  copy.append(timelineTextElement(
    'small',
    '',
    compact || !descriptor.detail ? descriptor.meta : `${descriptor.meta} · ${descriptor.detail}`));
  content.append(icon, copy);
  return content;
}

function describeRichComboboxOption(select, option) {
  if (select === elements.entity) {
    const entity = state.catalog.entities.find(item => item.id === option.value);
    return {
      icon: entity?.icon ?? 'box',
      label: option.textContent,
      meta: `${entity?.operations.length ?? 0} mapped operations`,
      detail: 'Entity API',
    };
  }
  if (select === elements.operation) {
    const operation = selectedEntity().operations.find(item => item.id === option.value);
    return {
      icon: operation?.method === 'GET' ? 'arrow-down-to-line' : 'send',
      label: option.textContent,
      meta: operation?.method ?? 'Operation',
      detail: operation?.route ?? '',
    };
  }
  if (select === elements.baseline || select === elements.candidate) {
    const rust = option.value.toLowerCase().startsWith('rust');
    return {
      icon: rust ? 'code-2' : 'braces',
      label: option.textContent,
      meta: rust ? 'Native SDK' : 'Managed SDK',
      detail: rust ? 'Rust runtime' : 'C# runtime',
      tone: select === elements.candidate ? 'candidate' : 'baseline',
    };
  }
  const scenario = state.catalog.scenarios.find(item => item.id === option.value);
  return {
    icon: 'flask-conical',
    label: option.textContent,
    meta: 'Scenario',
    detail: scenario?.summary ?? '',
  };
}

function openRichCombobox(combobox) {
  richComboboxes.forEach(other => {
    if (other !== combobox) closeRichCombobox(other);
  });
  syncRichCombobox(combobox.select);
  combobox.list.hidden = false;
  combobox.root.classList.add('open');
  combobox.button.setAttribute('aria-expanded', 'true');
  positionRichCombobox(combobox);
  setRichComboboxActive(combobox, Math.max(0, combobox.select.selectedIndex));
  combobox.list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
}

function closeRichCombobox(combobox) {
  if (combobox.list.hidden) return;
  combobox.list.hidden = true;
  combobox.root.classList.remove('open');
  combobox.button.setAttribute('aria-expanded', 'false');
  combobox.button.removeAttribute('aria-activedescendant');
}

function positionOpenRichComboboxes() {
  richComboboxes.forEach(combobox => {
    if (!combobox.list.hidden) positionRichCombobox(combobox);
  });
}

function positionRichCombobox(combobox) {
  const bounds = combobox.button.getBoundingClientRect();
  const preferredWidth = combobox.select === elements.operation ? 350 : 290;
  const width = Math.min(Math.max(bounds.width, preferredWidth), window.innerWidth - 16);
  const maxHeight = Math.min(360, Math.max(160, window.innerHeight - 24));
  const left = clamp(bounds.left, 8, Math.max(8, window.innerWidth - width - 8));
  const roomBelow = window.innerHeight - bounds.bottom - 8;
  const roomAbove = bounds.top - 8;
  const opensAbove = roomBelow < Math.min(240, maxHeight) && roomAbove > roomBelow;
  combobox.list.style.width = `${width}px`;
  combobox.list.style.maxHeight = `${Math.min(maxHeight, Math.max(120, opensAbove ? roomAbove : roomBelow))}px`;
  combobox.list.style.left = `${left}px`;
  combobox.list.style.top = opensAbove ? 'auto' : `${bounds.bottom + 5}px`;
  combobox.list.style.bottom = opensAbove ? `${window.innerHeight - bounds.top + 5}px` : 'auto';
}

function setRichComboboxActive(combobox, index) {
  const options = [...combobox.list.querySelectorAll('[data-rich-option-index]')];
  if (!options.length) return;
  combobox.activeIndex = clamp(index, 0, options.length - 1);
  options.forEach((option, optionIndex) => option.classList.toggle('active', optionIndex === combobox.activeIndex));
  combobox.button.setAttribute('aria-activedescendant', options[combobox.activeIndex].id);
}

function chooseRichComboboxOption(combobox, index) {
  const option = combobox.select.options[index];
  if (!option) return;
  const changed = combobox.select.value !== option.value;
  combobox.select.value = option.value;
  syncRichCombobox(combobox.select);
  closeRichCombobox(combobox);
  combobox.button.focus();
  if (changed) combobox.select.dispatchEvent(new Event('change', { bubbles: true }));
}

function handleRichComboboxKeydown(combobox, event) {
  const optionCount = combobox.select.options.length;
  if (!optionCount) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (combobox.list.hidden) openRichCombobox(combobox);
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    setRichComboboxActive(combobox, (combobox.activeIndex + direction + optionCount) % optionCount);
    combobox.list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    if (combobox.list.hidden) openRichCombobox(combobox);
    setRichComboboxActive(combobox, event.key === 'Home' ? 0 : optionCount - 1);
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (combobox.list.hidden) openRichCombobox(combobox);
    else chooseRichComboboxOption(combobox, combobox.activeIndex);
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    closeRichCombobox(combobox);
    return;
  }
  if (event.key === 'Tab') {
    closeRichCombobox(combobox);
    return;
  }
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    clearTimeout(combobox.typeaheadTimer);
    combobox.typeahead += event.key.toLowerCase();
    combobox.typeaheadTimer = setTimeout(() => { combobox.typeahead = ''; }, 650);
    const options = [...combobox.select.options];
    const match = options.findIndex(option => option.textContent.trim().toLowerCase().startsWith(combobox.typeahead));
    if (match >= 0) {
      event.preventDefault();
      if (combobox.list.hidden) openRichCombobox(combobox);
      setRichComboboxActive(combobox, match);
      combobox.list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
    }
  }
}

function updateOperationContext() {
  const operation = selectedOperation();
  elements.operationRoute.textContent = `${operation.method} ${operation.route}`;
  elements.operationDescription.textContent = operation.description;
}

function renderOperationNav() {
  const selectedEntityId = elements.entity.value;
  const selectedOperationId = elements.operation.value;
  elements.operationNav.innerHTML = logicallyOrderedEntities(state.catalog.entities).map(entity => `
    <div class="entity-group ${entity.id === selectedEntityId ? 'open' : ''}" data-entity="${escapeHtml(entity.id)}">
      <button class="entity-toggle" type="button">
        <i data-lucide="${escapeHtml(entity.icon)}"></i>
        <span>${escapeHtml(entity.name)}</span>
        <span class="entity-op-count">${entity.operations.length}</span>
        <i class="chevron" data-lucide="chevron-right"></i>
      </button>
      <div class="entity-operations">
        ${entity.operations.map(operation => `
          <button class="operation-link ${entity.id === selectedEntityId && operation.id === selectedOperationId ? 'active' : ''}"
                  type="button" data-entity="${escapeHtml(entity.id)}" data-operation="${escapeHtml(operation.id)}">
            ${escapeHtml(operation.name)}
          </button>`).join('')}
      </div>
    </div>`).join('');

  elements.operationNav.querySelectorAll('.entity-toggle').forEach(button => {
    button.addEventListener('click', () => button.closest('.entity-group').classList.toggle('open'));
  });
  elements.operationNav.querySelectorAll('.operation-link').forEach(button => {
    button.addEventListener('click', () => {
      elements.entity.value = button.dataset.entity;
      populateOperations(button.dataset.operation);
      updateOperationContext();
      renderOperationNav();
      reconcileComparisonSelection();
    });
  });
  refreshIcons();
}

async function runComparison() {
  beginTraceRendering();
  elements.runButton.disabled = true;
  elements.runButton.classList.add('loading');
  try {
    const run = await requestJson('/api/comparisons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityId: elements.entity.value,
        operationId: elements.operation.value,
        scenarioId: elements.scenario.value,
        baselineVersion: elements.baseline.value,
        candidateVersion: elements.candidate.value,
      }),
    });
    selectRun(run);
    state.recentRuns = [run, ...state.recentRuns.filter(item => item.id !== run.id)];
    renderRecentRuns();
    showToast(`${run.operationName}: ${run.verdict}`);
  } catch (error) {
    endTraceRendering();
    showToast(error.message, true);
  } finally {
    elements.runButton.disabled = false;
    elements.runButton.classList.remove('loading');
  }
}

function selectRun(run) {
  state.run = run;
  state.selectedTraceId = initialTraceSelectionId() ?? run.trace[0]?.id ?? null;
  state.executionCollapsed.clear();
  state.dataTreesExpanded = {};
  syncControlsToRun(run);
  renderRun();
  renderRecentRuns();
}

function syncControlsToRun(run) {
  elements.entity.value = run.entityId;
  populateOperations(run.operationId);
  elements.scenario.value = run.scenarioId;
  elements.baseline.value = run.baseline.version;
  elements.candidate.value = run.candidate.version;
  updateOperationContext();
  renderOperationNav();
  syncRichComboboxes();
}

function reconcileComparisonSelection() {
  if (comparisonMatchesSelection(state.run)) return;
  const matchingRun = state.recentRuns.find(comparisonMatchesSelection);
  if (matchingRun) {
    selectRun(matchingRun);
    return;
  }
  clearComparison();
}

function comparisonMatchesSelection(run) {
  return Boolean(run
    && run.entityId === elements.entity.value
    && run.operationId === elements.operation.value
    && run.scenarioId === elements.scenario.value
    && run.baseline.version === elements.baseline.value
    && run.candidate.version === elements.candidate.value);
}

function clearComparison() {
  state.traceTimeline?.destroy();
  state.traceTimeline = null;
  state.traceTimelineBounds = null;
  state.traceTimelinePositions = null;
  state.traceTimelineZoomRange = null;
  state.run = null;
  state.selectedTraceId = null;
  state.executionCollapsed.clear();
  state.dataTreesExpanded = {};
  endTraceRendering();

  const emptyMessage = '<div class="empty-state comparison-empty"><i data-lucide="workflow"></i><span>No comparison run for this selection</span></div>';
  elements.verdict.textContent = 'Not run';
  elements.verdict.className = 'verdict-badge';
  elements.changedCount.textContent = '0';
  elements.fieldCount.textContent = '0';
  elements.traceMap.innerHTML = emptyMessage;
  elements.responseDiff.innerHTML = emptyMessage;
  elements.executionTable.innerHTML = `
    <div class="execution-row execution-header">
      <span>Step / function</span><span>Baseline</span><span>Candidate</span><span>Status</span>
    </div>`;
  elements.executionSummary.textContent = 'No comparison run for this selection';
  elements.inspectorHeadingLabel.textContent = 'Selected step';
  elements.divergenceSummary.innerHTML = '<div class="empty-inspector"><i data-lucide="split"></i><span>No step selected</span></div>';
  elements.diffList.innerHTML = emptyMessage;
  elements.responseMeta.textContent = 'No comparison run for this selection';
  elements.openFunctionIo.disabled = true;
  elements.functionIoDialogContent.innerHTML = '';
  elements.functionIoDialogTitle.textContent = '';
  if (elements.functionIoDialog.open) elements.functionIoDialog.close();
  elements.baselinePayloadVersion.textContent = elements.baseline.value;
  elements.candidatePayloadVersion.textContent = elements.candidate.value;
  elements.baselinePayloadStatus.textContent = 'Not run';
  elements.candidatePayloadStatus.textContent = 'Not run';
  updateZoomLabel();
  renderRecentRuns();
  refreshIcons();
}

function renderRun() {
  const run = state.run;
  elements.verdict.textContent = run.verdict;
  elements.verdict.className = `verdict-badge ${run.verdict}`;
  renderFilteredComparison();
  refreshIcons();
}

function renderFilteredComparison() {
  if (!state.run) return;
  const run = state.run;
  const visibleTrace = state.diffOnly
    ? run.trace.filter(pair => displayedPairKind(pair) !== 'matched')
    : run.trace;
  if (!visibleTrace.some(pair => pair.id === state.selectedTraceId)) {
    state.selectedTraceId = initialTraceSelectionId() ?? visibleTrace[0]?.id ?? run.trace[0]?.id ?? null;
  }
  elements.changedCount.textContent = run.trace.filter(pair => displayedPairKind(pair) !== 'matched').length;
  elements.fieldCount.textContent = responseDisplayChangeCount();
  renderTraceMap();
  renderExecutionTable();
  renderInspector();
  renderPayloads();
  refreshIcons();
}

function renderTraceMap() {
  if (!state.run) return;
  beginTraceRendering();
  state.traceTimeline?.destroy();
  state.traceTimeline = null;
  state.traceTimelineBounds = null;
  state.traceTimelinePositions = null;
  state.traceTimelineZoomRange = null;
  const fullTrace = state.run.trace;
  const trace = state.diffOnly ? fullTrace.filter(pair => displayedPairKind(pair) !== 'matched') : fullTrace;
  elements.traceMap.innerHTML = trace.length
    ? `<div class="trace-timeline-shell">
        <div class="trace-timeline" id="trace-timeline" aria-label="Baseline and candidate execution timeline"></div>
      </div>`
    : '<div class="empty-state"><i data-lucide="workflow"></i><span>No changed trace steps</span></div>';
  if (!trace.length) {
    endTraceRendering();
    updateZoomLabel();
    refreshIcons();
    return;
  }
  if (!window.vis?.Timeline || !window.vis?.DataSet) {
    endTraceRendering();
    elements.traceMap.innerHTML = '<div class="empty-state"><i data-lucide="triangle-alert"></i><span>Timeline library unavailable</span></div>';
    refreshIcons();
    return;
  }

  const host = document.querySelector('#trace-timeline');
  const stepMilliseconds = 1000;
  const origin = Date.UTC(2020, 0, 1);
  const groups = new window.vis.DataSet([
    { id: 'layers', order: 0, className: 'timeline-layer-group', content: '' },
    { id: 'baseline', order: 1, className: 'timeline-runtime-group baseline', content: timelineLaneLabel('Baseline', state.run.baseline.version, 'baseline') },
    { id: 'candidate', order: 2, className: 'timeline-runtime-group candidate', content: timelineLaneLabel('Candidate', state.run.candidate.version, 'candidate') },
  ]);
  const itemToPair = new Map();
  const items = [];
  const serviceIndices = Object.fromEntries(
    ['baseline', 'candidate'].map(lane => [lane, traceServiceEndpointIndex(trace, lane)]));
  const serviceBreaks = [...new Set(Object.values(serviceIndices))].sort((left, right) => left - right);
  const eventSlot = index => 1 + index + serviceBreaks.filter(serviceIndex => serviceIndex < index).length;
  const eventTimes = trace.map((_, index) => new Date(origin + eventSlot(index) * stepMilliseconds));
  const startTime = new Date(origin);
  const serviceTimes = Object.fromEntries(Object.entries(serviceIndices).map(([lane, index]) => [
    lane,
    new Date(eventTimes[index].valueOf() + stepMilliseconds),
  ]));
  const turnSlot = Math.max(
    eventSlot(trace.length - 1) + 1,
    ...Object.values(serviceTimes).map(time => (time.valueOf() - origin) / stepMilliseconds + 1));
  const turnTime = new Date(origin + turnSlot * stepMilliseconds);
  const minimum = new Date(startTime.valueOf() - .5 * stepMilliseconds);
  const maximum = new Date(turnTime.valueOf() + 1.5 * stepMilliseconds);
  state.traceTimelineBounds = { start: minimum, end: maximum };
  state.traceTimelinePositions = eventTimes;
  const timelineLayers = traceTimelineLayers(trace);
  timelineLayers.forEach((layer, layerIndex) => items.push({
    id: `layer:${layerIndex}`,
    group: 'layers',
    start: layerIndex === 0
      ? minimum
      : new Date((eventTimes[layer.start - 1].valueOf() + eventTimes[layer.start].valueOf()) / 2),
    end: layerIndex === timelineLayers.length - 1
      ? maximum
      : new Date((eventTimes[layer.end].valueOf() + eventTimes[layer.end + 1].valueOf()) / 2),
    type: 'range',
    selectable: false,
    className: 'timeline-layer-item',
    content: timelineTextElement('span', 'timeline-layer-cell-label', layer.name),
    title: timelineTooltip({
      meta: 'Software layer',
      title: layer.name,
      identity: layer.id,
    }),
  }));
  ['baseline', 'candidate'].forEach(lane => {
    items.push({
      id: `path:${lane}`,
      group: lane,
      start: startTime,
      end: turnTime,
      type: 'range',
      selectable: false,
      className: `timeline-lane-path-item ${lane}`,
      content: timelineLaneGuide(lane),
      title: timelineRouteTooltip(lane, 'Request and response path', 'The service call precedes response mapping.'),
    });
    items.push({
      id: `path-start:${lane}`,
      group: lane,
      start: startTime,
      type: 'point',
      selectable: false,
      className: `timeline-path-start-item ${lane}`,
      content: timelinePathStart(lane),
      title: timelineRouteTooltip(lane, 'SDK request start', 'The request enters the SDK execution path.'),
    });
    items.push({
      id: `service:${lane}`,
      group: lane,
      start: serviceTimes[lane],
      type: 'point',
      selectable: false,
      className: `timeline-service-endpoint-item ${lane}`,
      content: timelineServiceEndpoint(lane),
      title: timelineRouteTooltip(lane, 'Service endpoint', 'Outgoing HTTP transport returns before response mapping.'),
    });
    items.push({
      id: `path-turn:${lane}`,
      group: lane,
      start: turnTime,
      type: 'point',
      selectable: false,
      className: `timeline-path-turn-item ${lane}`,
      content: timelinePathTurn(),
      title: timelineRouteTooltip(lane, 'Response path', 'The response returns toward the SDK after the service call.'),
    });
  });
  trace.forEach((pair, index) => {
    ['baseline', 'candidate'].forEach(lane => {
      const itemId = `step:${index}:${lane}`;
      itemToPair.set(itemId, pair);
      items.push(traceTimelineItem(
        itemId,
        pair,
        pair[lane],
        lane,
        eventTimes[index],
        index));
    });
  });
  const labelRailWidth = window.innerWidth <= 700 ? 96 : 120;
  const visibleSteps = Math.max(3, Math.min(trace.length, Math.floor(Math.max(host.clientWidth - labelRailWidth, 336) / 112)));
  const zoomMinimum = stepMilliseconds * 2.25;
  const zoomMaximum = Math.max(stepMilliseconds * 3, maximum.valueOf() - minimum.valueOf());
  state.traceTimelineZoomRange = { minimum: zoomMinimum, maximum: zoomMaximum };
  const timeline = new window.vis.Timeline(host, new window.vis.DataSet(items), groups, {
    start: minimum,
    end: new Date(Math.min(
      maximum.valueOf(),
      eventTimes[Math.min(visibleSteps - 1, eventTimes.length - 1)].valueOf() + .5 * stepMilliseconds)),
    min: minimum,
    max: maximum,
    height: '100%',
    groupOrder: 'order',
    groupHeightMode: 'fixed',
    stack: false,
    selectable: true,
    multiselect: false,
    moveable: true,
    zoomable: true,
    horizontalScroll: true,
    verticalScroll: false,
    zoomKey: 'ctrlKey',
    zoomMin: zoomMinimum,
    zoomMax: zoomMaximum,
    orientation: { axis: 'none', item: 'top' },
    showCurrentTime: false,
    showMajorLabels: false,
    showMinorLabels: false,
    tooltip: { overflowMethod: 'flip' },
    margin: { axis: 0, item: { horizontal: 0, vertical: 0 } },
  });
  state.traceTimeline = timeline;
  let renderingCompletionScheduled = false;
  const finishRendering = () => {
    if (renderingCompletionScheduled) return;
    renderingCompletionScheduled = true;
    const shell = host.closest('.trace-timeline-shell');
    const revealTimeline = () => {
      if (!shell?.isConnected || state.traceTimeline !== timeline) return;
      endTraceRendering();
      refreshIcons();
    };
    refreshIcons();
    setTimeout(revealTimeline, 260);
  };
  const selectedIndex = trace.findIndex(pair => pair.id === state.selectedTraceId);
  if (selectedIndex >= 0) timeline.setSelection([`step:${selectedIndex}:baseline`, `step:${selectedIndex}:candidate`]);
  timeline.on('select', properties => {
    const pair = properties.items.map(item => itemToPair.get(item)).find(Boolean);
    if (!pair) {
      const currentIndex = trace.findIndex(item => item.id === state.selectedTraceId);
      if (currentIndex >= 0) {
        timeline.setSelection([`step:${currentIndex}:baseline`, `step:${currentIndex}:candidate`]);
      }
      return;
    }
    state.selectedTraceId = pair.id;
    const pairIndex = trace.indexOf(pair);
    timeline.setSelection([`step:${pairIndex}:baseline`, `step:${pairIndex}:candidate`]);
    renderExecutionTable();
    renderInspector();
    refreshIcons();
  });
  const updateItemWidth = () => {
    const range = timeline.getWindow();
    const visibleSlots = Math.max(1, (range.end - range.start) / stepMilliseconds);
    const centerWidth = host.querySelector('.vis-panel.vis-center')?.clientWidth ?? host.clientWidth - labelRailWidth;
    const width = clamp(centerWidth / visibleSlots - 8, 56, 104);
    host.style.setProperty('--timeline-item-width', `${Math.round(width)}px`);
  };
  const updateTimelineRangeUi = () => {
    updateItemWidth();
    updateZoomLabel();
  };
  timeline.on('rangechange', updateTimelineRangeUi);
  timeline.on('rangechanged', updateTimelineRangeUi);
  timeline.on('changed', refreshIcons);
  host.addEventListener('wheel', event => {
    if (event.ctrlKey || event.metaKey) return;
    const horizontal = Math.abs(event.deltaX) >= Math.abs(event.deltaY);
    const rawDelta = event.shiftKey
      ? (event.deltaY || event.deltaX)
      : horizontal ? event.deltaX : event.deltaY;
    if (!rawDelta) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const range = timeline.getWindow();
    const span = range.end.valueOf() - range.start.valueOf();
    const centerWidth = host.querySelector('.vis-panel.vis-center')?.clientWidth || host.clientWidth;
    const deltaPixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? rawDelta * 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? rawDelta * centerWidth : rawDelta;
    const requestedDelta = deltaPixels / Math.max(centerWidth, 1) * span;
    const minimumTime = state.traceTimelineBounds?.start.valueOf() ?? range.start.valueOf();
    const maximumTime = state.traceTimelineBounds?.end.valueOf() ?? range.end.valueOf();
    const delta = clamp(
      requestedDelta,
      minimumTime - range.start.valueOf(),
      maximumTime - range.end.valueOf());
    if (delta === 0) return;
    timeline.setWindow(
      new Date(range.start.valueOf() + delta),
      new Date(range.end.valueOf() + delta),
      { animation: false });
  }, { capture: true, passive: false });
  updateZoomLabel();
  updateItemWidth();
  finishRendering();
  requestAnimationFrame(() => timeline.redraw());
}

function beginTraceRendering() {
  elements.traceView.classList.add('trace-rendering');
  elements.traceView.setAttribute('aria-busy', 'true');
  elements.traceLoading.setAttribute('aria-hidden', 'false');
}

function endTraceRendering() {
  elements.traceView.classList.remove('trace-rendering');
  elements.traceView.setAttribute('aria-busy', 'false');
  elements.traceLoading.setAttribute('aria-hidden', 'true');
}

function selectTraceTimelinePair(traceId) {
  if (!state.traceTimeline || !state.run) return;
  const trace = state.diffOnly
    ? state.run.trace.filter(pair => displayedPairKind(pair) !== 'matched')
    : state.run.trace;
  const index = trace.findIndex(pair => pair.id === traceId);
  if (index < 0) return;
  const itemIds = [`step:${index}:baseline`, `step:${index}:candidate`];
  state.traceTimeline.setSelection(itemIds);
  const selectedTime = state.traceTimelinePositions?.[index]?.valueOf()
    ?? Date.UTC(2020, 0, 1) + index * 1000;
  const range = state.traceTimeline.getWindow();
  if (selectedTime < range.start.valueOf() || selectedTime > range.end.valueOf()) {
    state.traceTimeline.moveTo(new Date(selectedTime), {
      animation: { duration: 180, easingFunction: 'easeInOutQuad' },
    });
  }
}

function setZoom(value) {
  if (!state.traceTimeline) return updateZoomLabel();
  if (value === 1 && state.traceTimelineBounds) {
    state.traceTimeline.setWindow(
      state.traceTimelineBounds.start,
      state.traceTimelineBounds.end,
      { animation: { duration: 220, easingFunction: 'easeInOutQuad' } });
  }
  else if (value > state.zoom) state.traceTimeline.zoomIn(.22, { animation: false });
  else state.traceTimeline.zoomOut(.22, { animation: false });
  updateZoomLabel();
  requestAnimationFrame(updateZoomLabel);
}

function updateZoomLabel() {
  const zoomOut = document.querySelector('#zoom-out');
  const zoomIn = document.querySelector('#zoom-in');
  if (state.traceTimeline && state.traceTimelineZoomRange) {
    const range = state.traceTimeline.getWindow();
    const span = range.end.valueOf() - range.start.valueOf();
    const { minimum, maximum } = state.traceTimelineZoomRange;
    state.zoom = maximum / span;
    document.querySelector('#zoom-level').textContent = `${Math.round(state.zoom * 100)}%`;
    zoomOut.disabled = span >= maximum - 1;
    zoomIn.disabled = span <= minimum + 1;
    return;
  }
  state.zoom = 1;
  document.querySelector('#zoom-level').textContent = `${Math.round(state.zoom * 100)}%`;
  zoomOut.disabled = true;
  zoomIn.disabled = true;
}

function timelineLaneLabel(label, version, lane) {
  const container = document.createElement('div');
  container.className = 'timeline-lane-label';
  container.append(
    timelineTextElement('strong', '', label),
    timelineTextElement('span', `version-chip ${lane}`, version));
  return container;
}

function timelineLaneGuide(lane) {
  const path = document.createElement('div');
  path.className = `timeline-lane-path ${lane}`;
  path.append(timelineTextElement('span', 'timeline-path-request', ''));
  return path;
}

function timelinePathStart(lane) {
  const start = timelineTextElement('span', 'timeline-path-start', '');
  start.classList.add(lane);
  const play = document.createElement('i');
  play.dataset.lucide = 'play';
  start.append(play);
  return start;
}

function timelineServiceEndpoint(lane) {
  const service = timelineTextElement('span', 'timeline-service-endpoint', '');
  service.classList.add(lane);
  const icon = document.createElement('i');
  icon.dataset.lucide = 'server';
  service.append(icon);
  return service;
}

function timelinePathTurn() {
  const turn = timelineTextElement('span', 'timeline-path-turn', '');
  const returned = timelineTextElement('span', 'timeline-path-return', '');
  const returnIcon = document.createElement('i');
  returnIcon.dataset.lucide = 'arrow-left';
  returned.append(returnIcon);
  turn.append(returned);
  return turn;
}

function traceTimelineItem(id, pair, step, lane, start, index) {
  const kind = displayedPairKind(pair);
  if (!step) {
    const unsupported = isUnsupportedLane(lane);
    return {
      id,
      group: lane,
      start,
      type: 'point',
      className: `trace-event-item ${lane} empty${unsupported ? ' unsupported' : ''}`,
      content: timelineTextElement('div', 'timeline-event-content empty', unsupported ? 'Not implemented' : 'Not captured'),
      title: timelineTooltip({
        meta: `${lane === 'baseline' ? 'Baseline' : 'Candidate'} · ${statusLabel(kind)}`,
        lane,
        title: unsupported ? 'Not implemented' : 'Not captured',
        detail: unsupported ? 'This operation is not implemented by this runtime.' : 'No annotated function span was captured at this mapped step.',
      }),
    };
  }
  const status = step.status === 'error' ? 'error' : kind;
  const runtime = lane === 'baseline' ? 'Baseline' : 'Candidate';
  const content = document.createElement('div');
  content.className = 'timeline-event-content';
  content.dataset.traceId = pair.id;
  content.style.setProperty('--index', index);
  const icon = document.createElement('span');
  icon.className = 'timeline-event-icon';
  icon.setAttribute('aria-hidden', 'true');
  const iconElement = document.createElement('i');
  iconElement.dataset.lucide = traceIcon(step, kind);
  icon.append(iconElement);
  const copy = document.createElement('span');
  copy.className = 'timeline-event-copy';
  copy.append(
    timelineTextElement('strong', '', step.label),
    timelineTextElement('code', '', shortFunctionPath(step.function)));
  content.append(icon, copy);
  return {
    id,
    group: lane,
    start,
    type: 'point',
    className: `trace-event-item ${lane} ${status}`,
    content,
    title: timelineTooltip({
      meta: `${runtime} · ${statusLabel(kind)}`,
      lane,
      title: step.label,
      functionPath: step.function,
      identity: `${step.data?.layerName ?? 'Unmapped'} · ${step.data?.functionId ?? pair.id}`,
      outcome: step.data?.outcome?.id ?? step.status,
      outcomeKind: step.data?.outcome?.kind ?? (step.status === 'error' ? 'failure' : 'success'),
      error: step.data?.outcome?.error?.id,
      duration: `${step.durationMs} ms`,
    }),
  };
}

function timelineRouteTooltip(lane, title, detail) {
  return timelineTooltip({
    meta: `${lane === 'baseline' ? 'Baseline' : 'Candidate'} · Route`,
    lane,
    title,
    detail,
  });
}

function timelineTooltip({ meta, lane, title, functionPath, identity, outcome, outcomeKind, error, duration, detail }) {
  const tooltip = document.createElement('div');
  tooltip.className = 'timeline-tooltip-content';
  tooltip.append(timelineTextElement('span', `timeline-tooltip-meta${lane ? ` ${lane}` : ''}`, meta));
  tooltip.append(timelineTextElement('strong', 'timeline-tooltip-title', title));
  if (functionPath) tooltip.append(timelineTextElement('code', 'timeline-tooltip-function', functionPath));
  if (identity) tooltip.append(timelineTextElement('span', 'timeline-tooltip-identity', identity));
  if (detail) tooltip.append(timelineTextElement('span', 'timeline-tooltip-detail', detail));
  if (outcome) {
    tooltip.append(timelineTextElement(
      'span',
      `timeline-tooltip-outcome ${outcomeKind ?? 'unknown'}`,
      `${outcome}${error ? ` · ${error}` : ''}`));
  }
  if (duration) tooltip.append(timelineTextElement('span', 'timeline-tooltip-duration', duration));
  return tooltip;
}

function timelineTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function traceTimelineLayers(trace) {
  const layers = [];
  trace.forEach((pair, index) => {
    const step = pair.baseline ?? pair.candidate;
    const id = step?.data?.layerId ?? 'unmapped';
    const name = step?.data?.layerName ?? 'Unmapped';
    const previous = layers.at(-1);
    if (previous?.id === id) previous.end = index;
    else layers.push({ id, name, start: index, end: index });
  });
  return layers;
}

function renderExecutionTable() {
  if (!state.run) return;
  const trace = visibleExecutionTrace();
  const rows = trace.map((pair, index) => {
    const step = pair.baseline ?? pair.candidate;
    const depth = pair.baseline?.data?.layerIndex ?? pair.candidate?.data?.layerIndex ?? 0;
    const sourceIndex = state.run.trace.indexOf(pair);
    const nextDepth = sourceIndex + 1 < state.run.trace.length
      ? executionDepth(state.run.trace[sourceIndex + 1])
      : -1;
    const hasChildren = nextDepth > depth;
    const collapsed = hasChildren && state.executionCollapsed.has(pair.id);
    const kind = displayedPairKind(pair);
    const selected = pair.id === state.selectedTraceId ? 'selected' : '';
    return `
      <div class="execution-row ${escapeHtml(kind)} ${selected}" role="button" tabindex="0" data-trace-id="${escapeHtml(pair.id)}">
        <span class="execution-step${hasChildren && !collapsed ? ' has-children' : ''}" style="--depth:${depth}">
          <span class="step-index">${pair.order}</span>${executionTreeGuides(trace, index, depth)}${hasChildren ? `<span class="execution-toggle${depth ? ' nested' : ''}" role="button" tabindex="0" data-collapse-trace="${escapeHtml(pair.id)}" aria-expanded="${!collapsed}" aria-label="${collapsed ? 'Expand' : 'Collapse'} ${escapeHtml(step.label)}"><i data-lucide="chevron-right"></i></span>` : '<span class="execution-toggle-spacer" aria-hidden="true"></span>'}<i data-lucide="${traceIcon(step, kind)}"></i>
          <span class="execution-step-label" title="${escapeHtml(step.function)}"><strong>${escapeHtml(step.label)}</strong><code>${escapeHtml(step.data?.layerName ?? 'Unmapped')} &middot; ${escapeHtml(step.data?.functionId ?? pair.id)}</code></span>
        </span>
        ${runtimeCell(pair.baseline, 'baseline')}
        ${runtimeCell(pair.candidate, 'candidate')}
        <span class="status-cell ${escapeHtml(kind)}"><i data-lucide="${statusIcon(kind)}"></i>${statusLabel(kind)}</span>
      </div>`;
  }).join('');

  elements.executionTable.innerHTML = `
    <div class="execution-row execution-header">
      <span>Step / function<i class="column-resizer" data-column-resizer="0" role="separator" tabindex="0" aria-label="Resize step column"></i></span>
      <span>Baseline<i class="column-resizer" data-column-resizer="1" role="separator" tabindex="0" aria-label="Resize baseline column"></i></span>
      <span>Candidate<i class="column-resizer" data-column-resizer="2" role="separator" tabindex="0" aria-label="Resize candidate column"></i></span>
      <span>Status</span>
    </div>${rows}`;
  bindColumnResizers(
    elements.executionTable,
    '.execution-header > span',
    '--execution-columns',
    'parity.executionColumns',
    [170, 120, 120, 82]);

  const unique = state.run.trace.filter(pair => displayedPairKind(pair).endsWith('only')).length;
  const changed = state.run.trace.filter(pair => displayedPairKind(pair) === 'changed').length;
  elements.executionSummary.innerHTML = `${state.run.trace.length} mapped steps&nbsp;&nbsp;•&nbsp;&nbsp;<span class="orange">${changed} changed</span>&nbsp;&nbsp;•&nbsp;&nbsp;<span class="blue">${unique} unique</span>`;
  elements.executionTable.querySelectorAll('[data-trace-id]').forEach(row => {
    const select = () => {
      state.selectedTraceId = row.dataset.traceId;
      selectTraceTimelinePair(state.selectedTraceId);
      renderExecutionTable();
      renderInspector();
      refreshIcons();
    };
    row.addEventListener('click', select);
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select();
      }
    });
  });
  elements.executionTable.querySelectorAll('[data-collapse-trace]').forEach(button => {
    const toggle = event => {
      event.stopPropagation();
      const id = button.dataset.collapseTrace;
      if (state.executionCollapsed.has(id)) state.executionCollapsed.delete(id);
      else state.executionCollapsed.add(id);
      if (!visibleExecutionTrace().some(pair => pair.id === state.selectedTraceId)) {
        state.selectedTraceId = id;
        selectTraceTimelinePair(state.selectedTraceId);
        renderInspector();
      }
      renderExecutionTable();
    };
    button.addEventListener('click', toggle);
    button.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle(event);
      }
    });
  });
  refreshIcons();
}

function visibleExecutionTrace() {
  const visible = [];
  let hiddenBelowDepth = null;
  for (let index = 0; index < state.run.trace.length; index++) {
    const pair = state.run.trace[index];
    const depth = executionDepth(pair);
    if (hiddenBelowDepth !== null && depth > hiddenBelowDepth) continue;
    hiddenBelowDepth = null;
    if (!state.diffOnly || displayedPairKind(pair) !== 'matched') visible.push(pair);
    const nextDepth = index + 1 < state.run.trace.length ? executionDepth(state.run.trace[index + 1]) : -1;
    if (state.executionCollapsed.has(pair.id) && nextDepth > depth) hiddenBelowDepth = depth;
  }
  return visible;
}

function executionDepth(pair) {
  return pair.baseline?.data?.layerIndex ?? pair.candidate?.data?.layerIndex ?? 0;
}

function executionTreeGuides(trace, index, depth) {
  if (depth === 0) return '';
  const depthAt = pair => pair.baseline?.data?.layerIndex ?? pair.candidate?.data?.layerIndex ?? 0;
  const hasLaterSibling = level => {
    for (let next = index + 1; next < trace.length; next++) {
      const nextDepth = depthAt(trace[next]);
      if (nextDepth < level) return false;
      if (nextDepth === level) return true;
    }
    return false;
  };
  const ancestors = Array.from({ length: Math.max(0, depth - 1) }, (_, offset) => {
    const level = offset + 1;
    return `<span class="tree-guide ${hasLaterSibling(level) ? 'continue' : ''}" aria-hidden="true"></span>`;
  }).join('');
  return `<span class="tree-guides" aria-hidden="true">${ancestors}<span class="tree-guide branch ${hasLaterSibling(depth) ? 'tee' : 'elbow'}"></span></span>`;
}

function renderInspector() {
  if (!state.run) return;
  const pair = state.run.trace.find(item => item.id === state.selectedTraceId)
    ?? state.run.trace[0];
  const step = pair.baseline ?? pair.candidate;
  const kind = displayedPairKind(pair);
  const iconKind = step.status === 'error' ? 'error' : kind;
  elements.inspectorHeadingLabel.textContent = 'Selected step';
  elements.divergenceSummary.innerHTML = `
    <div class="divergence-title">
      <span class="divergence-icon ${escapeHtml(iconKind)}"><i data-lucide="${traceIcon(step, kind)}"></i></span>
      <div><strong>${escapeHtml(step.function)}</strong><small>Step ${pair.order} &middot; ${statusLabel(kind)}</small></div>
    </div>
    <div class="runtime-compare">
      ${runtimeSummary('Baseline', state.run.baseline, pair.baseline)}
      ${runtimeSummary('Candidate', state.run.candidate, pair.candidate, true)}
    </div>`;

  const functionValues = [
    {
      key: 'input',
      path: '$.input',
      baseline: pair.baseline?.data?.input,
      candidate: pair.candidate?.data?.input,
      fieldIds: { baseline: pair.baseline?.data?.inputFieldIds, candidate: pair.candidate?.data?.inputFieldIds },
      fieldPaths: { baseline: pair.baseline?.data?.inputPaths, candidate: pair.candidate?.data?.inputPaths },
    },
    {
      key: 'output',
      path: '$.output',
      baseline: pair.baseline?.data?.output,
      candidate: pair.candidate?.data?.output,
      fieldIds: { baseline: pair.baseline?.data?.outputFieldIds, candidate: pair.candidate?.data?.outputFieldIds },
      fieldPaths: { baseline: pair.baseline?.data?.outputPaths, candidate: pair.candidate?.data?.outputPaths },
    },
    { key: 'outcome', path: '$.outcome', baseline: pair.baseline?.data?.outcome, candidate: pair.candidate?.data?.outcome },
  ];
  elements.diffList.innerHTML = functionValues
    .map(value => renderDataComparison(value.path, value.baseline, value.candidate, {
      fieldIds: value.fieldIds,
      fieldPaths: value.fieldPaths,
      treeKey: `inspector:${value.key}`,
      expandChangedSubfields: true,
    }))
    .join('');
  elements.functionIoDialogContent.innerHTML = functionValues
    .map(value => renderDataComparison(value.path, value.baseline, value.candidate, {
      showColumnLabels: true,
      fieldIds: value.fieldIds,
      fieldPaths: value.fieldPaths,
      treeKey: `dialog:${value.key}`,
      expandChangedSubfields: true,
    }))
    .join('');
  bindColumnResizers(
    elements.functionIoDialogContent,
    '.data-column-labels > span',
    '--data-columns',
    'parity.functionIoColumns',
    [100, 120, 120, 50]);
  elements.functionIoDialogTitle.textContent = step.function;
  elements.openFunctionIo.disabled = false;
  applyDataTreeStates(elements.diffList);
  applyDataTreeStates(elements.functionIoDialogContent);
  syncDataTreeControls(elements.diffList);
  syncDataTreeControls(elements.functionIoDialogContent);

  const traceCounts = selectedStepTraceCounts(state.run.trace);
  elements.responseMeta.innerHTML = `Inspecting annotated call <strong>${escapeHtml(pair.id)}</strong><br>${traceCounts.capturedSpans} captured spans &middot; ${traceCounts.alignedSteps} aligned steps`;
  refreshIcons();
}

function renderPayloads() {
  const run = state.run;
  const root = run.trace.find(pair => pair.id === run.operationId);
  elements.responseDiff.innerHTML = renderDataComparison(
    '$.response',
    run.baseline.response,
    run.candidate.response,
    {
      showColumnLabels: true,
      expandShapeDifferences: true,
      expandChangedSubfields: true,
      treeKey: 'response',
      fieldIds: {
        baseline: root?.baseline?.data?.outputFieldIds,
        candidate: root?.candidate?.data?.outputFieldIds,
      },
      fieldPaths: {
        baseline: root?.baseline?.data?.outputPaths,
        candidate: root?.candidate?.data?.outputPaths,
      },
    });
  bindColumnResizers(
    elements.responseDiff,
    '.data-column-labels > span',
    '--data-columns',
    'parity.responseColumns',
    [100, 120, 120, 50]);
  elements.baselinePayloadVersion.textContent = run.baseline.version;
  elements.candidatePayloadVersion.textContent = run.candidate.version;
  elements.baselinePayloadStatus.textContent = `${run.baseline.statusCode} ${run.baseline.statusText} \u00b7 ${run.baseline.durationMs} ms`;
  elements.candidatePayloadStatus.textContent = `${run.candidate.statusCode} ${run.candidate.statusText} \u00b7 ${run.candidate.durationMs} ms`;
  applyDataTreeStates(elements.responseDiff);
  syncDataTreeControls(elements.responseDiff);
}

function renderRecentRuns() {
  const visibleRuns = state.recentRuns.slice(0, 8);
  elements.runCount.textContent = visibleRuns.length;
  elements.recentRuns.innerHTML = visibleRuns.length
    ? visibleRuns.map(run => `
      <button class="recent-run ${state.run?.id === run.id ? 'active' : ''}" type="button" data-run-id="${escapeHtml(run.id)}"${state.run?.id === run.id ? ' aria-current="true"' : ''}>
        <i data-lucide="play"></i>
        <span><strong>${escapeHtml(run.operationName)}</strong><small>${escapeHtml(run.scenarioName)} &middot; ${formatTime(run.startedAt)}</small></span>
        <i class="run-dot"></i>
      </button>`).join('')
    : '<div class="recent-empty">No runs in this session</div>';
  elements.recentRuns.querySelectorAll('[data-run-id]').forEach(button => {
    button.addEventListener('click', () => selectRun(state.recentRuns.find(run => run.id === button.dataset.runId)));
  });
  refreshIcons();
}

function setView(view) {
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  elements.traceView.classList.toggle('hidden', view !== 'trace');
  elements.responseView.classList.toggle('hidden', view !== 'response');
  const traceVisible = view === 'trace';
  elements.workspaceResizer.setAttribute('aria-disabled', String(traceVisible));
  elements.workspaceResizer.tabIndex = traceVisible ? -1 : 0;
  if (traceVisible) requestAnimationFrame(() => state.traceTimeline?.redraw());
}

function selectedEntity() {
  return state.catalog.entities.find(entity => entity.id === elements.entity.value) ?? state.catalog.entities[0];
}

function selectedOperation() {
  const entity = selectedEntity();
  return entity.operations.find(operation => operation.id === elements.operation.value) ?? entity.operations[0];
}

function option(value, text) {
  return `<option value="${escapeHtml(value)}">${escapeHtml(text)}</option>`;
}

function runtimeCell(step, lane) {
  if (!step) return `<span class="runtime-cell"><em>${isUnsupportedLane(lane) ? 'Not implemented' : '&mdash;'}</em></span>`;
  return `<span class="runtime-cell function-runtime" title="${escapeHtml(step.function)}"><code>${escapeHtml(step.function)}</code><em>${step.durationMs} ms</em></span>`;
}

function isUnsupportedLane(lane) {
  return (state.run?.operationId === 'upsert-setting' && lane === 'candidate')
    || (state.run?.operationId === 'global-data-encryption-policy' && lane === 'baseline');
}

function runtimeSummary(label, execution, step, candidate = false) {
  const facts = selectedStepRuntimeFacts(execution, step);
  return `
    <div class="runtime-summary ${candidate ? 'candidate' : ''}">
      <header>${escapeHtml(label)} &middot; ${escapeHtml(facts.version)}</header>
      <div class="runtime-stat"><span>Outcome</span><strong class="${facts.outcomeFailed ? 'error' : 'ok'}">${escapeHtml(facts.outcome)}</strong></div>
      ${step?.data?.outcome?.error?.id ? `<div class="runtime-stat"><span>Error</span><strong class="error">${escapeHtml(step.data.outcome.error.id)}</strong></div>` : ''}
      <div class="runtime-stat"><span>Duration</span><strong>${escapeHtml(facts.duration)}</strong></div>
      <div class="runtime-stat"><span>Layer</span><strong>${escapeHtml(facts.layer)}</strong></div>
    </div>`;
}

function traceIcon(step, kind) {
  if (step?.status === 'error') return 'triangle-alert';
  if (kind === 'matched') return 'check';
  if (kind === 'baseline-only') return 'minus';
  if (kind === 'candidate-only') return 'plus';
  return 'git-compare-arrows';
}

function statusIcon(kind) {
  if (kind === 'matched') return 'circle-check';
  if (kind === 'baseline-only') return 'circle-minus';
  if (kind === 'candidate-only') return 'circle-plus';
  return 'circle-alert';
}

function statusLabel(kind) {
  return ({ matched: 'Matched', changed: 'Diverged', 'baseline-only': 'Baseline only', 'candidate-only': 'Candidate only' })[kind] ?? kind;
}

function displayedPairKind(pair) {
  if (!pair.baseline || !pair.candidate) return pair.kind;
  const comparisons = [
    {
      baseline: pair.baseline.data?.input,
      candidate: pair.candidate.data?.input,
      fieldIds: { baseline: pair.baseline.data?.inputFieldIds, candidate: pair.candidate.data?.inputFieldIds },
      fieldPaths: { baseline: pair.baseline.data?.inputPaths, candidate: pair.candidate.data?.inputPaths },
    },
    {
      baseline: pair.baseline.data?.output,
      candidate: pair.candidate.data?.output,
      fieldIds: { baseline: pair.baseline.data?.outputFieldIds, candidate: pair.candidate.data?.outputFieldIds },
      fieldPaths: { baseline: pair.baseline.data?.outputPaths, candidate: pair.candidate.data?.outputPaths },
    },
    { baseline: pair.baseline.data?.outcome, candidate: pair.candidate.data?.outcome },
  ];
  return comparisons.some(value => countDisplayDifferences(value.baseline, value.candidate, value) > 0)
    ? 'changed'
    : 'matched';
}

function initialTraceSelectionId() {
  return state.run?.trace.find(pair => displayedPairKind(pair) !== 'matched')?.id ?? null;
}

function responseDisplayChangeCount() {
  const run = state.run;
  const root = run.trace.find(pair => pair.id === run.operationId);
  return countDisplayDifferences(run.baseline.response, run.candidate.response, {
    fieldIds: {
      baseline: root?.baseline?.data?.outputFieldIds,
      candidate: root?.candidate?.data?.outputFieldIds,
    },
    fieldPaths: {
      baseline: root?.baseline?.data?.outputPaths,
      candidate: root?.candidate?.data?.outputPaths,
    },
  });
}

function countDisplayDifferences(
  baseline,
  candidate,
  options = {},
  baselineFieldPath = '$',
  candidateFieldPath = '$',
  label = '$',
  suppressValues = false) {
  const path = baselineFieldPath ?? candidateFieldPath ?? '$';
  const identities = resolveFieldIdentities(
    label,
    path,
    baselineFieldPath,
    candidateFieldPath,
    options.fieldIds,
    options.fieldPaths);
  const suppressHere = suppressValues || isExcludedField(identities, label);
  const nameDifference = hasRuntimeFieldNameDifference(identities);
  if (suppressHere) return 0;
  if (baseline === undefined || candidate === undefined || baseline === null || candidate === null) {
    return deepEqual(baseline, candidate) && !nameDifference ? 0 : 1;
  }
  const baselineType = dataType(baseline);
  const candidateType = dataType(candidate);
  if (baselineType !== candidateType || (baselineType !== 'object' && baselineType !== 'array')) {
    return (deepEqual(baseline, candidate) || suppressHere) && !nameDifference ? 0 : 1;
  }
  const keyPairs = baselineType === 'array'
    ? [...Array(Math.max(baseline.length, candidate.length)).keys()]
      .map(String)
      .map(key => ({ baseline: key, candidate: key }))
    : pairRuntimeFieldKeys(baseline, candidate);
  return (nameDifference ? 1 : 0) + keyPairs.reduce((count, keys) => {
    const baselineKey = keys.baseline;
    const candidateKey = keys.candidate;
    const childLabel = baselineType === 'array' ? `[${baselineKey}]` : baselineKey ?? candidateKey;
    return count + countDisplayDifferences(
      baselineKey === null ? undefined : baseline[baselineType === 'array' ? Number(baselineKey) : baselineKey],
      candidateKey === null ? undefined : candidate[baselineType === 'array' ? Number(candidateKey) : candidateKey],
      options,
      baselineType === 'array'
        ? `${baselineFieldPath}[${baselineKey}]`
        : baselineKey === null ? null : `${baselineFieldPath}.${baselineKey}`,
      baselineType === 'array'
        ? `${candidateFieldPath}[${candidateKey}]`
        : candidateKey === null ? null : `${candidateFieldPath}.${candidateKey}`,
      childLabel,
      suppressHere);
  }, 0);
}

function isExcludedField(identities, label) {
  const ids = [identities.common, identities.baseline, identities.candidate].filter(Boolean);
  return state.run.fields.some(field => field.excluded && (ids.includes(field.id) || field.id === label));
}

const MAX_TOKEN_DIFF_CELLS = 40000;

function renderDataComparison(path, baseline, candidate, options = {}) {
  const node = compareDataNode(
    path,
    path,
    baseline,
    candidate,
    0,
    options.fieldIds,
    options.fieldPaths,
    '$',
    '$',
    options.expandShapeDifferences ?? false,
    options.expandChangedSubfields ?? false,
    false,
    false);
  const labels = options.showColumnLabels ? `
    <div class="data-column-labels">
      <span>Field name<i class="column-resizer" data-column-resizer="0" role="separator" tabindex="0" aria-label="Resize field name column"></i></span>
      <span class="baseline">${escapeHtml(state.run.baseline.version)}<i class="column-resizer" data-column-resizer="1" role="separator" tabindex="0" aria-label="Resize baseline value column"></i></span>
      <span class="candidate">${escapeHtml(state.run.candidate.version)}<i class="column-resizer" data-column-resizer="2" role="separator" tabindex="0" aria-label="Resize candidate value column"></i></span>
      <span>Status</span>
    </div>` : '';
  const treeKey = options.treeKey ?? path;
  return `<div class="data-comparison" data-tree-key="${escapeHtml(treeKey)}">
    <div class="data-tree-toolbar"><button class="text-button" type="button" data-tree-toggle="${escapeHtml(treeKey)}">Collapse all</button></div>
    ${labels}${node.html}
  </div>`;
}

function compareDataNode(
  path,
  label,
  baseline,
  candidate,
  depth,
  fieldIds,
  fieldPaths,
  baselineFieldPath,
  candidateFieldPath,
  expandShapeDifferences,
  expandChangedSubfields,
  shapeMismatchAncestor,
  suppressValues) {
  const displayDepth = depth;
  const rootClass = depth === 0 ? ' data-root' : '';
  const baselineDefined = baseline !== undefined;
  const candidateDefined = candidate !== undefined;
  const baselineType = dataType(baseline);
  const candidateType = dataType(candidate);
  const baselineEnum = enumScalarValue(baseline);
  const candidateEnum = enumScalarValue(candidate);
  const baselineStructural = baselineType === 'object' || baselineType === 'array';
  const candidateStructural = candidateType === 'object' || candidateType === 'array';
  const identities = resolveFieldIdentities(
    label,
    path,
    baselineFieldPath,
    candidateFieldPath,
    fieldIds,
    fieldPaths);
  const fieldNameChanged = hasRuntimeFieldNameDifference(identities);
  const suppressHere = suppressValues || isExcludedField(identities, label);

  if (baselineEnum !== null || candidateEnum !== null) {
    const status = suppressHere ? 'excluded'
      : !baselineDefined ? 'added'
      : !candidateDefined ? 'removed'
        : (deepEqual(baseline, candidate) || suppressHere) && !fieldNameChanged ? 'unchanged' : 'changed';
    const values = {
      baseline: enumToken(baselineEnum ?? undefined),
      candidate: enumToken(candidateEnum ?? undefined),
    };
    return {
      status,
      changes: isDisplayMatch(status) ? 0 : 1,
      html: state.diffOnly && depth > 0 && isDisplayMatch(status) ? '' : `<div class="data-leaf enum-value ${status}${rootClass}" style="--data-depth:${displayDepth}" tabindex="0">
        <code class="data-path" title="${escapeHtml(fieldIdentityTitle(identities, path))}">${fieldNameHtml(identities, label)}${commonFieldIdHtml(identities)}</code>
        <div class="data-value baseline" title="${escapeHtml(valueTitle(baseline))}">${values.baseline}</div>
        <div class="data-value candidate" title="${escapeHtml(valueTitle(candidate))}">${values.candidate}</div>
        <span class="data-status ${status}">${status}</span>
      </div>`,
    };
  }

  if (baselineStructural || candidateStructural) {
    const array = baselineStructural ? baselineType === 'array' : candidateType === 'array';
    const arrayChildren = array
      && (baselineType === 'array' || !baselineStructural)
      && (candidateType === 'array' || !candidateStructural);
    const left = baselineStructural ? baseline : (array ? [] : {});
    const right = candidateStructural ? candidate : (array ? [] : {});
    const shapeMismatch = baselineType !== candidateType;
    const mixedScalarShape = baselineStructural !== candidateStructural;
    const keyPairs = arrayChildren
      ? [...Array(Math.max(left.length, right.length)).keys()]
        .map(String)
        .map(key => ({ baseline: key, candidate: key }))
      : pairRuntimeFieldKeys(left, right);
    const children = keyPairs.map(keys => {
      const baselineKey = keys.baseline;
      const candidateKey = keys.candidate;
      const childLabel = arrayChildren ? `[${baselineKey}]` : baselineKey ?? candidateKey;
      const childPath = arrayChildren ? `${path}[${baselineKey}]` : `${path}.${childLabel}`;
      const childBaselineFieldPath = baselineFieldPath === null || baselineKey === null
        ? null
        : arrayChildren ? `${baselineFieldPath}[${baselineKey}]` : `${baselineFieldPath}.${baselineKey}`;
      const childCandidateFieldPath = candidateFieldPath === null || candidateKey === null
        ? null
        : arrayChildren ? `${candidateFieldPath}[${candidateKey}]` : `${candidateFieldPath}.${candidateKey}`;
      return compareDataNode(
        childPath,
        childLabel,
        baselineKey === null ? undefined : left[arrayChildren ? Number(baselineKey) : baselineKey],
        candidateKey === null ? undefined : right[arrayChildren ? Number(candidateKey) : candidateKey],
        depth + 1,
        fieldIds,
        fieldPaths,
        childBaselineFieldPath,
        childCandidateFieldPath,
        expandShapeDifferences,
        expandChangedSubfields,
        shapeMismatchAncestor || shapeMismatch,
        suppressHere);
    });
      const descendantChanges = children.reduce((count, child) => count + child.changes, 0);
      const changes = suppressHere ? 0 : descendantChanges + (fieldNameChanged ? 1 : 0);
    const status = suppressHere ? 'excluded'
      : !baselineDefined ? 'added'
        : !candidateDefined ? 'removed'
          : changes ? 'changed' : 'unchanged';
    const open = dataNodeDefaultOpen({
      depth,
      descendantChanges,
      expandChangedSubfields,
      status,
      expandShapeDifferences,
      shapeMismatch,
      shapeMismatchAncestor,
      scalarShapeMismatch: mixedScalarShape,
    }) ? ' open' : '';
    const kind = baselineType === candidateType
      ? `${array ? 'array' : 'object'} &middot; ${keyPairs.length}`
      : `${escapeHtml(baselineType)} &harr; ${escapeHtml(candidateType)}`;
    const baselineDisplayValue = mixedScalarShape
      ? dataValueWithRuntimeNames(baseline, fieldPaths?.baseline, baselineFieldPath ?? '$')
      : baseline;
    const candidateDisplayValue = mixedScalarShape
      ? dataValueWithRuntimeNames(candidate, fieldPaths?.candidate, candidateFieldPath ?? '$')
      : candidate;
    return {
      status,
      changes,
      html: state.diffOnly && depth > 0 && isDisplayMatch(status) ? '' : `<details class="data-node ${status}${rootClass}${mixedScalarShape ? ' mixed-shape' : ''}" style="--data-depth:${displayDepth}"${open}>
        <summary title="${escapeHtml(fieldIdentityTitle(identities, path))}">
          <span class="data-node-heading"><i class="data-disclosure" data-lucide="chevron-right"></i><span class="data-path">${fieldNameHtml(identities, label)}</span><span class="data-kind">${kind}</span>${changes ? `<span class="data-count">${changes}</span>` : ''}</span>
          ${mixedScalarShape ? `<span class="data-node-value baseline" title="${escapeHtml(valueTitle(baselineDisplayValue))}">${nodeShapeValueHtml(baselineDisplayValue, baselineStructural)}</span><span class="data-node-value candidate" title="${escapeHtml(valueTitle(candidateDisplayValue))}">${nodeShapeValueHtml(candidateDisplayValue, candidateStructural)}</span><span class="data-status ${status}">${status}</span>` : ''}
        </summary>
        <div class="data-children">${children.map(child => child.html).join('')}</div>
      </details>`,
    };
  }

  const status = suppressHere ? 'excluded'
    : !baselineDefined ? 'added'
    : !candidateDefined ? 'removed'
      : (deepEqual(baseline, candidate) || suppressHere) && !fieldNameChanged ? 'unchanged' : 'changed';
  const values = comparedScalarHtml(baseline, candidate, status);
  return {
    status,
    changes: isDisplayMatch(status) ? 0 : 1,
    html: state.diffOnly && depth > 0 && isDisplayMatch(status) ? '' : `<div class="data-leaf ${status}${rootClass}" style="--data-depth:${displayDepth}" tabindex="0">
      <code class="data-path" title="${escapeHtml(fieldIdentityTitle(identities, path))}">${fieldNameHtml(identities, label)}${commonFieldIdHtml(identities)}</code>
      <div class="data-value baseline" title="${escapeHtml(valueTitle(baseline))}">${values.baseline}</div>
      <div class="data-value candidate" title="${escapeHtml(valueTitle(candidate))}">${values.candidate}</div>
      <span class="data-status ${status}">${status}</span>
    </div>`,
  };
}

function isDisplayMatch(status) {
  return status === 'unchanged' || status === 'excluded';
}

function resolveFieldIdentities(label, path, baselineFieldPath, candidateFieldPath, fieldIds, fieldPaths) {
  const common = resolveFieldId(label, path);
  if (baselineFieldPath === '$' && candidateFieldPath === '$') {
    return { common: null, baseline: null, candidate: null, baselinePath: '$', candidatePath: '$' };
  }
  return {
    common: fieldIds ? null : common,
    baseline: baselineFieldPath === null ? null : fieldIds?.baseline?.[baselineFieldPath] ?? common,
    candidate: candidateFieldPath === null ? null : fieldIds?.candidate?.[candidateFieldPath] ?? common,
    baselinePath: baselineFieldPath === null
      ? null
      : fieldPaths?.baseline?.[baselineFieldPath] ?? baselineFieldPath,
    candidatePath: candidateFieldPath === null
      ? null
      : fieldPaths?.candidate?.[candidateFieldPath] ?? candidateFieldPath,
  };
}

function commonFieldIdHtml(identities) {
  return identities.common
    ? `<span class="data-field-id">${escapeHtml(identities.common)}</span>`
    : '';
}

function fieldNameHtml(identities, fallback) {
  const baselineName = runtimeFieldName(identities.baselinePath);
  const candidateName = runtimeFieldName(identities.candidatePath);
  if (!baselineName && !candidateName) return escapeHtml(fallback.replace(/^json:/, ''));
  if (baselineName === candidateName) return escapeHtml(baselineName);
  if (!baselineName || !candidateName) return escapeHtml(baselineName ?? candidateName);
  return `<span class="field-name baseline">${escapeHtml(baselineName)}</span><span class="field-name-separator" aria-label="maps to"> &harr; </span><span class="field-name candidate">${escapeHtml(candidateName)}</span>`;
}

function hasRuntimeFieldNameDifference(identities) {
  const baselineName = runtimeFieldName(identities.baselinePath);
  const candidateName = runtimeFieldName(identities.candidatePath);
  return Boolean(baselineName
    && candidateName
    && standardFieldName(baselineName) !== standardFieldName(candidateName));
}

function runtimeFieldName(propertyPath) {
  if (!propertyPath || propertyPath === '$') return null;
  const arrayIndex = propertyPath.match(/\[[^\]]+\]$/)?.[0];
  if (arrayIndex) return arrayIndex;
  return propertyPath.slice(propertyPath.lastIndexOf('.') + 1);
}

function fieldIdentityTitle(identities, fallbackPath) {
  if (!identities.baselinePath && !identities.candidatePath) return fallbackPath;
  return [
    `${state.run.baseline.version}: ${identities.baselinePath ?? 'not present'}${identities.baseline ? ` (${identities.baseline})` : ''}`,
    `${state.run.candidate.version}: ${identities.candidatePath ?? 'not present'}${identities.candidate ? ` (${identities.candidate})` : ''}`,
  ].join('\n');
}

function nodeShapeValueHtml(value, structural) {
  if (!structural) return scalarToken(value);
  const type = Array.isArray(value) ? 'array' : 'object';
  return `<span class="json-token ${type}">${escapeHtml(JSON.stringify(value))}</span>`;
}

function enumScalarValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value['enum.name'] !== 'string' || typeof value['enum.value'] !== 'number') return null;
  return `${value['enum.name']} (${value['enum.value']})`;
}

function enumToken(value) {
  if (value === undefined) return '<span class="json-token missing">missing</span>';
  return `<span class="json-token enum">${escapeHtml(value)}</span>`;
}

function resolveFieldId(label, path) {
  const field = state.run?.fields?.find(candidate => candidate.id === label);
  return field?.id ?? `json:${path}`;
}

function comparedScalarHtml(baseline, candidate, status) {
  if (status === 'changed' && typeof baseline === 'string' && typeof candidate === 'string') {
    return tokenDiffHtml(baseline, candidate);
  }
  return { baseline: scalarToken(baseline), candidate: scalarToken(candidate) };
}

function scalarToken(value) {
  if (value === undefined) return '<span class="json-token missing">missing</span>';
  if (value === null) return '<span class="json-token null">null</span>';
  const type = typeof value;
  const serialized = type === 'string' ? JSON.stringify(value) : String(value);
  return `<span class="json-token ${escapeHtml(type)}">${escapeHtml(serialized)}</span>`;
}

function tokenDiffHtml(baseline, candidate) {
  const left = tokenize(baseline);
  const right = tokenize(candidate);
  if ((left.length + 1) * (right.length + 1) > MAX_TOKEN_DIFF_CELLS) {
    return {
      baseline: `<span class="diff-token removed">${escapeHtml(JSON.stringify(baseline))}</span>`,
      candidate: `<span class="diff-token added">${escapeHtml(JSON.stringify(candidate))}</span>`,
    };
  }

  const lengths = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex--)
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex--)
      lengths[leftIndex][rightIndex] = left[leftIndex] === right[rightIndex]
        ? lengths[leftIndex + 1][rightIndex + 1] + 1
        : Math.max(lengths[leftIndex + 1][rightIndex], lengths[leftIndex][rightIndex + 1]);

  const baselineParts = ['<span class="diff-token punctuation">&quot;</span>'];
  const candidateParts = ['<span class="diff-token punctuation">&quot;</span>'];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      const token = `<span class="diff-token equal">${escapeHtml(left[leftIndex])}</span>`;
      baselineParts.push(token);
      candidateParts.push(token);
      leftIndex++;
      rightIndex++;
    } else if (lengths[leftIndex + 1][rightIndex] >= lengths[leftIndex][rightIndex + 1]) {
      baselineParts.push(`<span class="diff-token removed">${escapeHtml(left[leftIndex++])}</span>`);
    } else {
      candidateParts.push(`<span class="diff-token added">${escapeHtml(right[rightIndex++])}</span>`);
    }
  }
  while (leftIndex < left.length) baselineParts.push(`<span class="diff-token removed">${escapeHtml(left[leftIndex++])}</span>`);
  while (rightIndex < right.length) candidateParts.push(`<span class="diff-token added">${escapeHtml(right[rightIndex++])}</span>`);
  baselineParts.push('<span class="diff-token punctuation">&quot;</span>');
  candidateParts.push('<span class="diff-token punctuation">&quot;</span>');
  return { baseline: baselineParts.join(''), candidate: candidateParts.join('') };
}

function tokenize(value) {
  return String(value).match(/[A-Za-z0-9_]+|\s+|[^\sA-Za-z0-9_]/g) ?? [];
}

function dataType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function deepEqual(baseline, candidate) {
  return JSON.stringify(baseline) === JSON.stringify(candidate);
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function dataTreeHosts() {
  return [elements.responseDiff, elements.diffList, elements.functionIoDialogContent].filter(Boolean);
}

function dataTreeEntries(host) {
  const roots = host ? [host] : dataTreeHosts();
  return roots.flatMap(container => [...container.querySelectorAll('.data-comparison[data-tree-key]')]
    .map(tree => ({
      key: tree.dataset.treeKey,
      container: tree,
      button: tree.querySelector('[data-tree-toggle]'),
    })))
    .filter(entry => entry.button);
}

function dataTreeEntry(key) {
  return dataTreeEntries().find(entry => entry.key === key);
}

function toggleDataTree(key) {
  const entry = dataTreeEntry(key);
  if (!entry) return;
  const details = [...entry.container.querySelectorAll('details')];
  const expanded = !details.some(item => item.open);
  state.dataTreesExpanded[key] = expanded;
  details.forEach(item => { item.open = expanded; });
  syncDataTreeControl(key);
}

function applyDataTreeState(key) {
  const entry = dataTreeEntry(key);
  const expanded = state.dataTreesExpanded[key];
  if (!entry || expanded == null) return;
  entry.container.querySelectorAll('details').forEach(item => { item.open = expanded; });
}

function applyDataTreeStates(host) {
  dataTreeEntries(host).forEach(entry => applyDataTreeState(entry.key));
}

function syncDataTreeControl(key) {
  const entry = dataTreeEntry(key);
  if (!entry) return;
  const details = [...entry.container.querySelectorAll('details')];
  const openCount = details.filter(item => item.open).length;
  state.dataTreesExpanded[key] = openCount === 0 ? false : openCount === details.length ? true : null;
  entry.button.textContent = openCount > 0 ? 'Collapse all' : 'Expand all';
  entry.button.disabled = details.length === 0;
}

function syncDataTreeControls(host) {
  dataTreeEntries(host).forEach(entry => syncDataTreeControl(entry.key));
}

function valueTitle(value) {
  if (value === undefined) return 'missing';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function shortFunctionPath(value) {
  const segments = String(value).split(/::|\./).filter(Boolean);
  return segments.slice(-2).join('.');
}

function formatTime(value) {
  return new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `Request failed with ${response.status}`);
  return payload;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': 1.7 } });
}

let toastTimer;
function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast visible${isError ? ' error' : ''}`;
  toastTimer = setTimeout(() => { elements.toast.className = 'toast'; }, 2800);
}

initialize();