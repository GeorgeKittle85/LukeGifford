// Keyboard shortcuts. Ignored while typing in a form field or when a modal
// dialog is open (except Space/digits, which never fire inside inputs).

import { modalOpen } from './modals.js';

export function installKeyboard(ctx, panels) {
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'select', 'textarea'].includes(tag) || e.target.isContentEditable) return;
    if (!ctx.state) return;

    if (e.key === ' ' && !modalOpen()) {
      e.preventDefault();
      ctx.host.togglePause();
      return;
    }
    if (/^[1-5]$/.test(e.key) && !modalOpen()) {
      ctx.host.setSpeed(Number(e.key));
      return;
    }
    if (modalOpen()) return;
    if (e.key === '?') {
      ctx.openMenu('help');
      return;
    }
    if (e.key.toLowerCase() === 'p') {
      ctx.openPlanner();
      return;
    }
    const panel = panels.find((p) => p.hotkey === e.key.toLowerCase());
    if (panel) ctx.openPanel(panel.id, {});
  });
}
