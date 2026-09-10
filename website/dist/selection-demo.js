// Independent illustrative sequence. No selection interception or rate requests.
(() => {
  const demo = document.querySelector('#selection-demo');
  const control = document.querySelector('#selection-playback');
  if (!demo || !control) return;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let playing = !reducedMotion.matches;
  let visible = !('IntersectionObserver' in window);

  function sync() {
    demo.classList.toggle('is-animated', !reducedMotion.matches);
    demo.dataset.running = String(playing && visible && !document.hidden && !reducedMotion.matches);
    control.hidden = reducedMotion.matches;
    control.textContent = playing ? 'Pause animation' : 'Play animation';
    control.setAttribute('aria-pressed', String(playing));
  }

  control.addEventListener('click', () => { playing = !playing; sync(); });
  document.addEventListener('visibilitychange', sync);
  reducedMotion.addEventListener('change', () => {
    playing = !reducedMotion.matches;
    sync();
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    }, { threshold: 0.2 }).observe(demo.querySelector('.selection-scene'));
  }
  sync();
})();
