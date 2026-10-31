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
    // On a phone a download link saves into a folder nobody sees (PIE-1383): the share sheet (Save to Files, AirDrop)
    // takes the file instead, where it can; the link itself is the fallback.
    const download = event.target.closest('a[data-source-download]');
    if (download && navigator.share && navigator.canShare && matchMedia('(pointer: coarse)').matches) {
      event.preventDefault();
      try {
        const response = await fetch(download.href, { cache: 'no-store' });
        if (!response.ok) throw new Error(`the publisher answered ${response.status}`);
        const file = new File([await response.blob()], download.getAttribute('download') || 'source', { type: response.headers.get('content-type') || 'text/plain' });
        if (!navigator.canShare({ files: [file] })) throw new Error('this browser shares no files');
        await navigator.share({ files: [file], title: file.name });
      } catch (error) {
        // Dismissed is no failure; anything else falls back to the link.
        if (error?.name !== 'AbortError') location.href = download.href;
      }
    }
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
})();
