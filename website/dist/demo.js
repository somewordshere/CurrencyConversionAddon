const toggle = document.querySelector('#demo-toggle');
const currency = document.querySelector('#demo-currency');
const converted = document.querySelector('#converted-price');
const caption = document.querySelector('#conversion-caption');
const status = document.querySelector('#demo-status');
const playback = document.querySelector('#demo-playback');
// Fixed demonstration rates, never live quotes.
const examples = {
  PLN: { rate: 4.30, locale: 'pl-PL', label: 'Polish złoty' },
  USD: { rate: 1.10, locale: 'en-US', label: 'US dollars' },
  JPY: { rate: 162, locale: 'ja-JP', label: 'Japanese yen' },
  UAH: { rate: 45.50, locale: 'uk-UA', label: 'Ukrainian hryvnias' },
  GBP: { rate: 0.86, locale: 'en-GB', label: 'British pounds' },
  MXN: { rate: 21, locale: 'es-MX', label: 'Mexican pesos' },
  ZAR: { rate: 20, locale: 'en-ZA', label: 'South African rand' },
  KRW: { rate: 1490, locale: 'ko-KR', label: 'South Korean won' },
  KZT: { rate: 570, locale: 'kk-KZ', label: 'Kazakh tenge' },
  INR: { rate: 92.50, locale: 'en-IN', label: 'Indian rupees' },
  DZD: { rate: 145, locale: 'en-GB', label: 'Algerian dinars' },
};
const sequence = Object.keys(examples);
// Format once and reserve enough room for every example without measuring layout.
const amounts = Object.fromEntries(sequence.map(code => [code, new Intl.NumberFormat(examples[code].locale, {
  style: 'currency', currency: code, currencyDisplay: 'narrowSymbol',
}).format(89 * examples[code].rate)]));
const sizing = document.createElement('span');
sizing.className = 'price-sizing';
sizing.setAttribute('aria-hidden', 'true');
for (const amount of Object.values(amounts)) {
  const value = document.createElement('span');
  value.textContent = '≈ ' + amount;
  sizing.append(value);
}
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let playing = !motionPreference.matches;
let visible = true;
let timer;
let transition = [];
let transitionId = 0;

function displayPrice(text, slide) {
  const id = ++transitionId;
  transition.forEach(animation => animation.cancel());
  transition = [];
  const previous = converted.querySelector('.price-value:last-child');
  const next = document.createElement('span');
  next.className = 'price-value';
  next.textContent = text;
  converted.setAttribute('aria-label', text);
  next.setAttribute('aria-hidden', 'true');
  if (!slide || motionPreference.matches || !previous) {
    converted.replaceChildren(sizing, next);
    return;
  }
  previous.setAttribute('aria-hidden', 'true');
  converted.replaceChildren(sizing, previous, next);
  const options = { duration: 420, easing: 'cubic-bezier(.22,.68,0,1)', fill: 'both' };
  transition = [
    previous.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-125%)', opacity: 0 }], options),
    next.animate([{ transform: 'translateY(125%)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], options),
  ];
  Promise.all(transition.map(animation => animation.finished)).then(() => {
    if (id !== transitionId) return;
    converted.replaceChildren(sizing, next);
    transition.forEach(animation => animation.cancel());
    transition = [];
  }).catch(() => { /* Manual controls can interrupt a slide. */ });
}

function updateDemo({ announce = false, slide = false } = {}) {
  const example = examples[currency.value];
  const amount = amounts[currency.value];
  displayPrice(`≈ ${amount}`, slide && toggle.checked);
  converted.hidden = !toggle.checked;
  caption.hidden = !toggle.checked;
  document.querySelector('#toggle-label').textContent = toggle.checked ? 'On' : 'Off';
  document.querySelector('#demo-rate').textContent = `Example rate: €1 = ${example.rate.toFixed(Number.isInteger(example.rate) ? 0 : 2)} ${currency.value}`;
  // Automatic changes stay quiet for screen readers; announce deliberate actions.
  if (announce) status.textContent = toggle.checked
    ? `Twinprice on. Original price 89 euros, approximately ${amount} in ${example.label}. This is a fixed example rate.`
    : 'Twinprice off. Only the original price, 89 euros, is shown.';
}

function schedule() {
  clearTimeout(timer);
  playback.textContent = playing ? 'Pause animation' : 'Play animation';
  playback.setAttribute('aria-pressed', String(playing));
  playback.disabled = !toggle.checked;
  if (!playing || !toggle.checked || !visible || document.hidden || document.activeElement === currency) return;
  timer = setTimeout(() => {
    currency.value = sequence[(sequence.indexOf(currency.value) + 1) % sequence.length];
    updateDemo({ slide: true });
    schedule();
  }, 2800);
}

if (toggle && currency && playback) {
  playback.hidden = false;
  toggle.addEventListener('change', () => { updateDemo({ announce: true }); schedule(); });
  currency.addEventListener('change', () => {
    playing = false;
    updateDemo({ announce: true });
    schedule();
  });
  currency.addEventListener('focus', schedule);
  currency.addEventListener('blur', schedule);
  playback.addEventListener('click', () => { playing = !playing; schedule(); });
  document.addEventListener('visibilitychange', schedule);
  motionPreference.addEventListener('change', () => {
    if (motionPreference.matches) playing = false;
    updateDemo();
    schedule();
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; schedule(); }, { threshold: 0.15 })
      .observe(document.querySelector('#demo'));
  }
  updateDemo();
  schedule();
}
