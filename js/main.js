import * as ui from './ui.js';

const routes = [
  [/^#\/?$/, () => ui.renderHome()],
  [/^#\/new$/, () => ui.renderForm(null)],
  [/^#\/edit\/([0-9a-zA-Z-]+)$/, m => ui.renderForm(m[1])],
  [/^#\/manage$/, () => ui.renderManage()],
  [/^#\/restart\/(tina|kaka)$/, m => ui.renderRestart(m[1])],
  [/^#\/review\/(tina|kaka)$/, m => ui.renderReview(m[1])],
  [/^#\/backup$/, () => ui.renderBackup()],
];

async function route() {
  const hash = location.hash || '#/';
  for (const [pattern, handler] of routes) {
    const match = hash.match(pattern);
    if (!match) continue;
    ui.resetPageState();
    try {
      await handler(match);
    } catch (error) {
      document.getElementById('app').innerHTML = `<div class="page"><main class="content"><p class="form-error">页面出错：${ui.esc(error.message || error)}</p><a class="btn btn-outline btn-block" href="#/">回首页</a></main></div>`;
    }
    return;
  }
  location.hash = '#/';
}

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
