// Rebuild the public policy from the extension's existing policy without changing it.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const source = await readFile(new URL('../privacy-policy.md', import.meta.url), 'utf8');
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const inline = value => escape(value)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/`(.+?)`/g, '<code>$1</code>')
  .replace(/https:\/\/api\.frankfurter\.dev\//g, '<a href="https://api.frankfurter.dev/">api.frankfurter.dev</a>');
const blocks = source.replace(/^# .+\r?\n/, '').trim().split(/\r?\n\s*\r?\n/);
const rendered = blocks.map(block => {
  if (block.startsWith('## ')) return `<h2>${inline(block.slice(3))}</h2>`;
  if (block.startsWith('- ')) {
    const items = block.split(/\r?\n(?=- )/).map(item => `<li>${inline(item.replace(/^- /, '').replace(/\r?\n/g, ' '))}</li>`);
    return `<ul>${items.join('\n')}</ul>`;
  }
  return `<p>${inline(block.replace(/\r?\n/g, ' '))}</p>`;
}).join('\n');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#245bea"><title>Privacy policy — twinprice.com</title><meta name="description" content="How Twinprice processes prices locally, stores settings, and requests exchange rates. Read the full extension privacy policy."><link rel="icon" href="../assets/twinprice-icon.png"><link rel="stylesheet" href="../styles.css"></head>
<body><a class="skip-link" href="#main">Skip to content</a><header class="site-header wrap"><a class="brand" href="../" aria-label="twinprice.com home"><img src="../assets/twinprice-icon.png" width="32" height="32" alt=""><span>twinprice<span class="brand-period">.</span>com</span></a><nav aria-label="Main navigation"><a href="../#how-it-works">How it works</a><a href="./" aria-current="page">Privacy</a><a href="../#faq">FAQ</a></nav><a class="button button-small" href="../#install">Get Twinprice <span aria-hidden="true">↗</span></a></header>
<main class="wrap policy-main" id="main"><p class="eyebrow">YOUR BROWSING STAYS YOURS</p><h1>Privacy, in plain sight.</h1><div class="policy-notice"><p>The full Twinprice extension policy appears below, with its version and effective date. The browser stores may offer different release versions; consult the policy linked from your installed version's store listing for the current release.</p></div><article class="policy-content" aria-label="Extension privacy policy">${rendered}
<section class="policy-site"><h2>This website</h2><p>The Twinprice landing page does not add analytics, advertising trackers, cookies, or browser storage. Its interactive demonstration runs locally using fixed example rates and does not contact an exchange-rate service. Images and styles are served with the site.</p><p>The hosting service may process normal request details, including your IP address, to deliver and secure the website. Any access controls supplied by the hosting service operate separately from this site's own code. Following a store or GitHub link takes you to a service with its own privacy practices.</p></section></article></main>
<footer class="site-footer wrap"><a class="brand" href="../"><span>twinprice<span class="brand-period">.</span>com</span></a><span>A familiar price, wherever you shop.</span><a href="./" aria-current="page">Privacy policy</a><a href="https://github.com/somewordshere/CurrencyConversionAddon/issues">Help / Report an issue</a><a href="https://github.com/somewordshere/CurrencyConversionAddon">Source code</a></footer></body></html>`;
await mkdir(new URL('./dist/privacy/', import.meta.url), { recursive: true });
await writeFile(new URL('./dist/privacy/index.html', import.meta.url), html);
console.log('Privacy page updated from the extension policy.');
