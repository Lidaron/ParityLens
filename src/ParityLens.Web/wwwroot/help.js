export function initializeHelpDialog({ button }) {
  const dialog = document.querySelector('#help-dialog');
  if (!button || !dialog) return;

  const close = dialog.querySelector('#help-close');
  const search = dialog.querySelector('#help-search');
  const navigation = dialog.querySelector('#help-navigation');
  const content = dialog.querySelector('.help-content');
  const empty = dialog.querySelector('#help-empty');
  const tabs = [...dialog.querySelectorAll('[data-help-language]')];
  const sections = [...dialog.querySelectorAll('[data-help-section]')];
  let language = 'csharp';
  let scrollFrame = 0;

  button.addEventListener('click', () => {
    dialog.showModal();
    applyFilters();
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    dialog.close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && dialog.open) {
      event.preventDefault();
      event.stopImmediatePropagation();
      dialog.close();
    }
  }, true);
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  tabs.forEach(tab => tab.addEventListener('click', () => {
    language = tab.dataset.helpLanguage;
    tabs.forEach(item => {
      const selected = item === tab;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    applyFilters();
  }));

  search.addEventListener('input', applyFilters);
  content.addEventListener('scroll', () => {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(syncNavigationToScroll);
  }, { passive: true });
  navigation.addEventListener('click', event => {
    const target = event.target.closest('[data-help-target]');
    if (!target) return;
    const section = dialog.querySelector(`#${CSS.escape(target.dataset.helpTarget)}`);
    section?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setActiveNavigation(target.dataset.helpTarget, false);
  });

  dialog.addEventListener('click', async event => {
    const copy = event.target.closest('[data-copy-code]');
    if (!copy) return;
    const code = copy.closest('.help-code')?.querySelector('code')?.textContent ?? '';
    await navigator.clipboard.writeText(code);
    copy.innerHTML = '<i data-lucide="check"></i>';
    copy.title = 'Copied';
    window.lucide?.createIcons({ attrs: { 'stroke-width': 1.7 } });
    window.setTimeout(() => {
      copy.innerHTML = '<i data-lucide="copy"></i>';
      copy.title = 'Copy code';
      window.lucide?.createIcons({ attrs: { 'stroke-width': 1.7 } });
    }, 1200);
  });

  function applyFilters() {
    const query = search.value.trim().toLowerCase();
    const visible = sections.filter(section => {
      const languageMatch = section.dataset.helpSection === 'shared'
        || section.dataset.helpSection === language;
      const queryMatch = !query || section.textContent.toLowerCase().includes(query);
      section.hidden = !(languageMatch && queryMatch);
      return !section.hidden;
    });

    navigation.innerHTML = visible.map(section => `
      <button type="button" data-help-target="${escapeHtml(section.id)}">
        <span>${escapeHtml(section.dataset.helpStep)}</span>
        <strong>${escapeHtml(section.dataset.helpTitle)}</strong>
      </button>`).join('');
    empty.hidden = visible.length > 0;
    requestAnimationFrame(syncNavigationToScroll);
    window.lucide?.createIcons({ attrs: { 'stroke-width': 1.7 } });
  }

  function syncNavigationToScroll() {
    const visible = sections.filter(section => !section.hidden);
    if (!visible.length) return;
    const viewport = content.getBoundingClientRect();
    const probe = viewport.top + Math.min(96, viewport.height * .2);
    let current = visible[0];
    for (const section of visible) {
      if (section.getBoundingClientRect().top <= probe) current = section;
      else break;
    }
    const atBottom = content.scrollHeight - content.scrollTop - content.clientHeight < 2;
    if (atBottom) current = visible.at(-1);
    setActiveNavigation(current.id, true);
  }

  function setActiveNavigation(targetId, reveal) {
    const items = [...navigation.querySelectorAll('[data-help-target]')];
    const active = items.find(item => item.dataset.helpTarget === targetId);
    items.forEach(item => {
      const selected = item === active;
      item.classList.toggle('active', selected);
      if (selected) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
    if (reveal) active?.scrollIntoView({ block: 'nearest' });
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}
