(() => {
  const panel = document.querySelector('.sources-panel');
  if (!panel) return;
  const entries = [...panel.querySelectorAll('.source-entry')];
  const open = entry => { panel.open = true; if (entry) { entry.open = true; entry.scrollIntoView({ block: 'nearest' }); } };
  for (const entry of entries) {
    const anchor = document.getElementById(`line:${entry.dataset.sourceOffset}`);
    const region = anchor?.closest('.output-region,figure,p,section,blockquote');
    if (region) region.dataset.source = entry.id;
  }
  document.addEventListener('click', async event => {
    const copy = event.target.closest('[data-source-copy]');
    if (copy) {
      try { await navigator.clipboard.writeText(copy.dataset.sourceCopy); copy.textContent = 'Copied'; }
      catch { copy.textContent = 'Select the text to copy'; }
    }
    if (event.target.closest('[data-sources-close]')) panel.open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.target.closest('input,textarea,[contenteditable]')) return;
    if (event.key === 'S') { event.preventDefault(); open(); }
    if (event.key === 'Escape') panel.open = false;
  });
  let control;
  document.addEventListener('selectionchange', () => {
    control?.remove();
    const selection = getSelection();
    if (!selection || selection.isCollapsed) return;
    const node = selection.anchorNode;
    const region = (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)?.closest('[data-source]');
    if (!region) return;
    control = document.createElement('button');
    control.className = 'source-selection';
    control.textContent = 'Where this comes from';
    control.addEventListener('click', () => open(document.getElementById(region.dataset.source)));
    document.body.append(control);
  });
  const time = panel.querySelector('time');
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(time.dateTime)) / 60000));
  time.textContent = minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
})();
