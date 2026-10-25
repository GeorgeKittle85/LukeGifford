// A couple of hidden extras for the faithful.

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

export function installEasterEggs(ctx, brandEl) {
  // Konami code: every plane becomes a football.
  let progress = 0;
  document.addEventListener('keydown', (e) => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    progress = key === KONAMI[progress] ? progress + 1 : key === KONAMI[0] ? 1 : 0;
    if (progress === KONAMI.length) {
      progress = 0;
      const on = !ctx.map.getOption('kittleMode');
      ctx.setMapOption('kittleMode', on);
      ctx.toast(on ? '🏈 Kittle Mode: every plane is a football. Spike it!' : 'Kittle Mode off. Back to regular jets.');
    }
  });

  // Tap the logo enough times and the coach shares a secret.
  let taps = 0;
  let timer = null;
  brandEl.addEventListener('click', () => {
    taps++;
    clearTimeout(timer);
    timer = setTimeout(() => { taps = 0; }, 1500);
    if (taps === 5) {
      taps = 0;
      ctx.toast('Locker room secret: your starter jet wears tail N85KS, and your first route flies KS85. Some numbers just catch everything.');
    }
  });
}
