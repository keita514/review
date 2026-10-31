// 界面层：渲染 8 个界面，所有数据操作都经过 store.js
import * as store from './store.js';
import { isDue, masteryLabel } from './rules.js';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const modalEl = document.getElementById('modal');

let objectUrls = new Set();
let lastQuery = '';
let form = null;

export function resetPageState() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
  form = null;
}

function objUrl(blob) {
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  return url;
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setPage(html) {
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

export function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { toastEl.hidden = true; }, 2000);
}

export function dialog({ title, message = '', buttons, variant = '' }) {
  return new Promise(resolve => {
    modalEl.innerHTML = `
      <div class="modal-card ${variant}" role="dialog" aria-modal="true">
        <div class="modal-title">${esc(title)}</div>
        ${message ? `<div class="modal-msg">${esc(message)}</div>` : ''}
        <div class="modal-actions">
          ${buttons.map((b, i) => `<button class="btn ${b.kind === 'danger' ? 'btn-danger' : b.kind === 'primary' ? 'btn-primary' : 'btn-outline'}" data-i="${i}">${esc(b.text)}</button>`).join('')}
        </div>
      </div>`;
    modalEl.hidden = false;
    const close = value => {
      modalEl.hidden = true;
      modalEl.innerHTML = '';
      modalEl.onclick = null;
      resolve(value);
    };
    modalEl.querySelectorAll('button[data-i]').forEach(btn => {
      btn.onclick = () => close(buttons[Number(btn.dataset.i)].value);
    });
    modalEl.onclick = event => { if (event.target === modalEl) close(null); };
  });
}

function confirmDialog({ title, message, okText = '确定', danger = false }) {
  return dialog({
    title,
    message,
    buttons: [
      { text: '取消', value: false },
      { text: okText, value: true, kind: danger ? 'danger' : 'primary' },
    ],
  });
}

function actionSheet(title, actions) {
  return dialog({
    title,
    variant: 'sheet',
    buttons: actions.concat([{ text: '取消', value: null }]),
  });
}

function fmtDate(ts) {
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtTime(ts) {
  const d = new Date(ts);
  return `${fmtDate(ts)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function compressImage(blob, maxSide = 1600, quality = 0.8) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  if (bitmap.close) bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob(result => (result ? resolve(result) : reject(new Error('图片转换失败'))), 'image/jpeg', quality);
  });
}

function openViewer(url) {
  const layer = document.createElement('div');
  layer.className = 'viewer';
  layer.innerHTML = `<img src="${esc(url)}" alt="">`;
  layer.onclick = () => layer.remove();
  document.body.appendChild(layer);
}

// ---------- 首页 ----------

export async function renderHome() {
  const [tinaPlan, kakaPlan] = await Promise.all(store.OWNERS.map(o => store.getPlan(o.id)));
  const plans = { tina: tinaPlan, kaka: kakaPlan };
  setPage(`
    <div class="page">
      <header class="topbar"><h1>复习工具</h1></header>
      <main class="content">
        <div class="stack">
          <a class="btn btn-primary" href="#/new">＋ 知识新增</a>
          <a class="btn btn-outline" href="#/manage">≡ 知识维护</a>
        </div>
        ${store.OWNERS.map(o => {
          const plan = plans[o.id];
          const total = plan.queue.length;
          const done = Math.min(plan.progress, total);
          return `
          <section class="owner-block">
            <div class="owner-label">${esc(o.name)}</div>
            <div class="btn-row">
              <a class="btn btn-primary" href="#/review/${o.id}">
                ${total && done >= total ? '已复习完' : '继续复习'}
                <span class="btn-sub">${total ? `${done} / ${total}` : '—'}</span>
              </a>
              <a class="btn btn-outline" href="#/restart/${o.id}">重新开始</a>
            </div>
          </section>`;
        }).join('')}
      </main>
      <footer class="footer-link"><a href="#/backup">备份与恢复</a></footer>
    </div>
  `);
}

// ---------- 新增 / 编辑 ----------

export async function renderForm(id) {
  const editing = Boolean(id);
  const knowledge = editing ? await store.getKnowledge(id) : null;
  if (editing && !knowledge) {
    toast('知识不存在');
    location.hash = '#/manage';
    return;
  }
  const items = [];
  for (const imageId of (knowledge ? knowledge.imageIds : [])) {
    const record = await store.getImage(imageId);
    if (record) items.push({ kind: 'id', id: imageId, url: objUrl(record.blob) });
  }
  form = {
    editing,
    id,
    owner: knowledge ? knowledge.owner : 'kaka',
    items,
    removedIds: [],
  };

  setPage(`
    <div class="page">
      <header class="topbar">
        <a class="back" href="${editing ? '#/manage' : '#/'}">←</a>
        <h1>${editing ? '编辑知识' : '新增知识'}</h1>
      </header>
      <main class="content form">
        <label class="field">
          <span class="field-label">归属</span>
          <select id="f-owner" ${editing ? 'disabled' : ''}>
            ${store.OWNERS.map(o => `<option value="${o.id}" ${o.id === form.owner ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
          </select>
          ${editing ? '<span class="hint">归属不能修改</span>' : ''}
        </label>
        <label class="field">
          <span class="field-label">类型</span>
          <select id="f-type">
            ${store.TYPES.map(t => `<option value="${t.id}" ${knowledge && knowledge.type === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span class="field-label">知识名 *</span>
          <input id="f-name" type="text" autocomplete="off" placeholder="例如 apple" value="${esc(knowledge ? knowledge.name : '')}">
          <span class="hint">可用输入法的语音键直接说</span>
        </label>
        <div class="field">
          <span class="field-label">知识内容</span>
          <textarea id="f-text" rows="4" placeholder="释义、例句、备注……">${esc(knowledge ? knowledge.text : '')}</textarea>
        </div>
        <div class="field">
          <span class="field-label">图片（<span id="img-count">0</span>/6）</span>
          <div class="thumbs" id="thumbs"></div>
          <div class="btn-row">
            <button class="btn btn-outline" id="btn-photo" type="button">📷 拍照</button>
            <button class="btn btn-outline" id="btn-hand" type="button">✎ 手写</button>
          </div>
          <input type="file" id="file-input" accept="image/*" hidden>
        </div>
        <p class="form-error" id="form-error" hidden></p>
      </main>
      <div class="bottombar">
        <button class="btn btn-primary btn-block" id="btn-save" type="button">${editing ? '保存修改' : '保存'}</button>
      </div>
    </div>
  `);

  const thumbsEl = document.getElementById('thumbs');
  const countEl = document.getElementById('img-count');
  const paintThumbs = () => {
    thumbsEl.innerHTML = form.items.map((item, index) => `
      <div class="thumb">
        <img src="${esc(item.url)}" alt="" data-view="${index}">
        <button class="thumb-del" data-del="${index}" aria-label="删除图片" type="button">✕</button>
      </div>`).join('');
    countEl.textContent = String(form.items.length);
  };
  paintThumbs();

  thumbsEl.onclick = event => {
    const del = event.target.closest('[data-del]');
    if (del) {
      const index = Number(del.dataset.del);
      const [removed] = form.items.splice(index, 1);
      if (removed.kind === 'id') form.removedIds.push(removed.id);
      if (removed.url) URL.revokeObjectURL(removed.url);
      paintThumbs();
      return;
    }
    const view = event.target.closest('[data-view]');
    if (view) openViewer(form.items[Number(view.dataset.view)].url);
  };

  document.getElementById('btn-photo').onclick = () => document.getElementById('file-input').click();
  document.getElementById('file-input').onchange = event => {
    const files = Array.from(event.target.files || []);
    for (const file of files) {
      if (form.items.length >= 6) { toast('最多 6 张图片'); break; }
      form.items.push({ kind: 'new', blob: file, url: objUrl(file) });
    }
    event.target.value = '';
    paintThumbs();
  };

  document.getElementById('btn-hand').onclick = async () => {
    if (form.items.length >= 6) { toast('最多 6 张图片'); return; }
    const blob = await openHandwriting();
    if (!blob) return;
    form.items.push({ kind: 'new', blob, url: objUrl(blob) });
    paintThumbs();
  };

  document.getElementById('btn-save').onclick = saveForm;
}

async function saveForm() {
  const errorEl = document.getElementById('form-error');
  const nameInput = document.getElementById('f-name');
  const name = nameInput.value.trim();
  if (!name) {
    errorEl.textContent = '请填写知识名';
    errorEl.hidden = false;
    nameInput.focus();
    return;
  }
  errorEl.hidden = true;
  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  try {
    const type = document.getElementById('f-type').value;
    const text = document.getElementById('f-text').value;
    const imageIds = [];
    for (const item of form.items) {
      if (item.kind === 'id') imageIds.push(item.id);
      else imageIds.push(await store.saveImage(await compressImage(item.blob)));
    }
    const owner = form.editing ? form.owner : document.getElementById('f-owner').value;
    if (form.editing) {
      await store.updateKnowledge(form.id, { type, name, text, imageIds });
    } else {
      await store.addKnowledge({ owner, type, name, text, imageIds });
    }
    if (form.removedIds.length) await store.deleteImages(form.removedIds);
    toast(form.editing ? '已保存修改' : `已保存，并加入${store.ownerName(owner)}的复习计划`);
    location.hash = form.editing ? '#/manage' : '#/';
  } catch (error) {
    errorEl.textContent = '保存失败：' + (error.message || error);
    errorEl.hidden = false;
    btn.disabled = false;
  }
}

// ---------- 知识维护 ----------

export async function renderManage() {
  const scrollY = window.scrollY;
  const list = await store.listKnowledge();
  setPage(`
    <div class="page">
      <header class="topbar">
        <a class="back" href="#/">←</a>
        <h1>知识维护</h1>
        <span class="topbar-meta">共 ${list.length} 条</span>
      </header>
      <main class="content list-page">
        <input class="search" id="q" type="search" placeholder="搜索知识名" value="${esc(lastQuery)}">
        <ul class="klist" id="klist"></ul>
      </main>
    </div>
  `);

  const listEl = document.getElementById('klist');
  const paint = () => {
    const query = lastQuery.trim().toLowerCase();
    const filtered = query ? list.filter(k => k.name.toLowerCase().includes(query)) : list;
    if (!list.length) {
      listEl.innerHTML = '<li class="empty">还没有知识，去首页点「知识新增」</li>';
      return;
    }
    if (!filtered.length) {
      listEl.innerHTML = `<li class="empty">没有匹配「${esc(lastQuery)}」的知识</li>`;
      return;
    }
    listEl.innerHTML = filtered.map(k => {
      const label = masteryLabel(k.mastery);
      return `
      <li class="krow" data-id="${esc(k.id)}">
        <div class="krow-main">
          <div class="krow-name">${esc(k.name)}</div>
          <div class="krow-sub">${esc(store.ownerName(k.owner))} · ${fmtDate(k.createdAt)} · ${esc(store.typeName(k.type))}${k.imageIds.length ? ` · 🖼 ${k.imageIds.length}` : ''}</div>
        </div>
        <span class="chip chip-${label.tone}">${esc(label.text)}</span>
        <button class="more" data-more="${esc(k.id)}" aria-label="更多操作" type="button">⋯</button>
      </li>`;
    }).join('');
  };
  paint();

  document.getElementById('q').oninput = event => {
    lastQuery = event.target.value;
    paint();
  };

  listEl.onclick = async event => {
    const more = event.target.closest('[data-more]');
    if (more) {
      event.stopPropagation();
      await openRowActions(more.dataset.more);
      return;
    }
    const row = event.target.closest('[data-id]');
    if (row) location.hash = '#/edit/' + row.dataset.id;
  };

  window.scrollTo(0, scrollY);
}

async function openRowActions(id) {
  const knowledge = await store.getKnowledge(id);
  if (!knowledge) return;
  const value = await actionSheet(knowledge.name, [
    { text: '编辑', value: 'edit' },
    { text: '设为熟练', value: 'master' },
    { text: '废弃', value: 'discard' },
    { text: '删除', value: 'delete', kind: 'danger' },
  ]);
  if (value === 'edit') {
    location.hash = '#/edit/' + id;
  } else if (value === 'master') {
    await store.rate(knowledge, 'master');
    toast('已设为熟练');
    renderManage();
  } else if (value === 'discard') {
    const ok = await confirmDialog({
      title: '废弃知识',
      message: `废弃「${knowledge.name}」后，它不再进入需复习范围。`,
      okText: '废弃',
    });
    if (ok) {
      await store.rate(knowledge, 'discard');
      toast('已废弃');
      renderManage();
    }
  } else if (value === 'delete') {
    const ok = await confirmDialog({
      title: '删除知识',
      message: `删除「${knowledge.name}」后无法恢复。`,
      okText: '删除',
      danger: true,
    });
    if (ok) {
      await store.removeKnowledge(id);
      toast('已删除');
      renderManage();
    }
  }
}

// ---------- 重新开始 ----------

export async function renderRestart(owner) {
  const counts = { tina: await store.countRanges('tina'), kaka: await store.countRanges('kaka') };
  const state = { owner, ranges: { due: true, discarded: false, mastered: false } };

  const rows = [
    ['due', '需复习（0–10）'],
    ['discarded', '废弃（-1）'],
    ['mastered', '熟练（100）'],
  ];

  setPage(`
    <div class="page">
      <header class="topbar">
        <a class="back" href="#/">←</a>
        <h1>重新开始</h1>
      </header>
      <main class="content form">
        <label class="field">
          <span class="field-label">复习计划</span>
          <select id="r-owner">
            ${store.OWNERS.map(o => `<option value="${o.id}" ${o.id === owner ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
          </select>
        </label>
        <div class="field">
          <span class="field-label">选择范围（可多选）</span>
          <div class="check-list" id="ranges">
            ${rows.map(([key, label]) => `
              <label class="check-row">
                <input type="checkbox" data-range="${key}" ${state.ranges[key] ? 'checked' : ''}>
                <span>${label}</span>
                <span class="check-count" id="count-${key}"></span>
              </label>`).join('')}
          </div>
        </div>
        <div class="summary" id="summary"></div>
      </main>
      <div class="bottombar">
        <button class="btn btn-primary btn-block" id="btn-rebuild" type="button">重建复习计划</button>
      </div>
    </div>
  `);

  const btn = document.getElementById('btn-rebuild');
  const summaryEl = document.getElementById('summary');

  const refresh = () => {
    const c = counts[state.owner];
    document.getElementById('count-due').textContent = `${c.due} 条`;
    document.getElementById('count-discarded').textContent = `${c.discarded} 条`;
    document.getElementById('count-mastered').textContent = `${c.mastered} 条`;
    const total = (state.ranges.due ? c.due : 0) + (state.ranges.discarded ? c.discarded : 0) + (state.ranges.mastered ? c.mastered : 0);
    summaryEl.innerHTML = `将重建「${esc(store.ownerName(state.owner))}」的复习计划<br>共 ${total} 条，进度从 0 开始`;
    btn.disabled = total === 0;
  };

  document.getElementById('r-owner').onchange = event => {
    state.owner = event.target.value;
    refresh();
  };
  document.querySelectorAll('[data-range]').forEach(input => {
    input.onchange = () => {
      state.ranges[input.dataset.range] = input.checked;
      refresh();
    };
  });

  btn.onclick = async () => {
    btn.disabled = true;
    const ok = await confirmDialog({
      title: '重建复习计划',
      message: `将重建「${store.ownerName(state.owner)}」的复习计划，当前进度会被清空。`,
      okText: '重建',
    });
    if (!ok) { refresh(); return; }
    const { count } = await store.rebuildPlan(state.owner, state.ranges);
    if (!count) {
      toast('没有符合条件的知识');
      refresh();
      return;
    }
    toast(`已重建，共 ${count} 条`);
    location.hash = '#/review/' + state.owner;
  };

  refresh();
}

// ---------- 复习 ----------

export async function renderReview(owner) {
  // 每翻一张都会重建图片 URL，这里先回收上一张的，避免长会话内存增长
  resetPageState();
  const plan = await store.cleanPlan(owner);
  const total = plan.queue.length;
  if (!total) return renderReviewEmpty(owner);
  if (plan.progress >= total) return renderReviewDone(owner, total);

  const knowledge = await store.getKnowledge(plan.queue[plan.progress]);
  if (!knowledge) {
    await store.advance(owner);
    return renderReview(owner);
  }

  let expanded = false;
  const label = masteryLabel(knowledge.mastery);
  const actions = isDue(knowledge.mastery)
    ? `<button class="btn act-unknown" data-action="unknown" type="button">✕ 不会</button>
       <button class="btn act-know" data-action="know" type="button">✓ 会</button>
       <button class="btn act-text" data-action="discard" type="button">废弃</button>`
    : `<button class="btn act-know" data-action="know" type="button">✓ 会</button>
       <button class="btn act-text" data-action="relearn" type="button">重新复习</button>`;

  setPage(`
    <div class="page review">
      <header class="topbar">
        <a class="back" href="#/">←</a>
        <h1>${esc(store.ownerName(owner))}</h1>
        <span class="topbar-meta">${plan.progress} / ${total}</span>
      </header>
      <div class="progress"><i style="width:${(plan.progress / total) * 100}%"></i></div>
      <main class="content review-body">
        <button class="card-name" id="card-name" type="button" aria-expanded="false">${esc(knowledge.name)}</button>
        <div class="card-tip" id="card-tip">点一下看内容</div>
        <div class="card-content" id="card-content" hidden>
          ${knowledge.text ? `<p class="card-text">${esc(knowledge.text)}</p>` : ''}
          <div class="card-images" id="card-images"></div>
          ${!knowledge.text && !knowledge.imageIds.length ? '<p class="muted">无内容</p>' : ''}
        </div>
        <div class="card-state"><span class="chip chip-${label.tone}">${esc(label.text)}</span></div>
      </main>
      <div class="actions">${actions}</div>
    </div>
  `);

  const nameEl = document.getElementById('card-name');
  const tipEl = document.getElementById('card-tip');
  const contentEl = document.getElementById('card-content');
  const imagesEl = document.getElementById('card-images');

  const urls = [];
  for (const imageId of knowledge.imageIds) {
    const record = await store.getImage(imageId);
    if (!record) continue;
    const url = objUrl(record.blob);
    urls.push(url);
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.onclick = () => openViewer(url);
    imagesEl.appendChild(img);
  }

  const toggle = () => {
    expanded = !expanded;
    contentEl.hidden = !expanded;
    nameEl.setAttribute('aria-expanded', String(expanded));
    tipEl.textContent = expanded ? '点一下收起' : '点一下看内容';
  };
  nameEl.onclick = toggle;

  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.onclick = async () => {
      document.querySelectorAll('[data-action]').forEach(b => { b.disabled = true; });
      try {
        await store.rate(knowledge, btn.dataset.action);
        await store.advance(owner);
        renderReview(owner);
      } catch (error) {
        toast('操作失败：' + (error.message || error));
        document.querySelectorAll('[data-action]').forEach(b => { b.disabled = false; });
      }
    };
  });
}

function renderReviewEmpty(owner) {
  setPage(`
    <div class="page">
      <header class="topbar">
        <a class="back" href="#/">←</a>
        <h1>${esc(store.ownerName(owner))}</h1>
      </header>
      <main class="content center-box">
        <p class="done-title">还没有复习计划</p>
        <p class="muted">先选择范围，生成一份复习计划。</p>
        <a class="btn btn-primary btn-block" href="#/restart/${owner}">去重新开始</a>
        <a class="btn btn-outline btn-block" href="#/">回首页</a>
      </main>
    </div>
  `);
}

function renderReviewDone(owner, total) {
  setPage(`
    <div class="page">
      <header class="topbar">
        <a class="back" href="#/">←</a>
        <h1>${esc(store.ownerName(owner))}</h1>
      </header>
      <main class="content center-box">
        <p class="done-title">本计划已完成</p>
        <p class="muted">${total} / ${total}</p>
        <a class="btn btn-primary btn-block" href="#/restart/${owner}">重新开始</a>
        <a class="btn btn-outline btn-block" href="#/">回首页</a>
      </main>
    </div>
  `);
}

// ---------- 备份与恢复 ----------

export async function renderBackup() {
  const lastExport = await store.lastExportAt();
  setPage(`
    <div class="page">
      <header class="topbar">
        <a class="back" href="#/">←</a>
        <h1>备份与恢复</h1>
      </header>
      <main class="content form">
        <p class="notice">数据保存在这台手机上。清除浏览器数据会全部丢失，换手机前请先导出。</p>
        <button class="btn btn-primary btn-block" id="btn-export" type="button">导出备份文件</button>
        <button class="btn btn-outline btn-block" id="btn-import" type="button">从备份文件恢复</button>
        <p class="muted small">上次导出：${lastExport ? esc(fmtTime(lastExport)) : '从未导出'}</p>
        <input type="file" id="backup-file" accept="application/json,.json" hidden>
      </main>
    </div>
  `);

  document.getElementById('btn-export').onclick = async () => {
    const data = await store.exportData();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const link = document.createElement('a');
    link.href = url;
    link.download = `review-backup-${stamp}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('已导出备份文件');
    renderBackup();
  };

  document.getElementById('btn-import').onclick = () => document.getElementById('backup-file').click();

  document.getElementById('backup-file').onchange = async event => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      toast('文件不是有效的 JSON');
      return;
    }
    const mode = await dialog({
      title: '恢复备份',
      message: `共 ${data.knowledge ? data.knowledge.length : '?'} 条知识。「覆盖」会清空当前全部数据，「合并」只补本机没有的或更新的。`,
      buttons: [
        { text: '取消', value: null },
        { text: '合并', value: 'merge' },
        { text: '覆盖', value: 'replace', kind: 'danger' },
      ],
    });
    if (!mode) return;
    try {
      const result = await store.importData(data, mode);
      toast(`已导入 ${result.knowledge} 条知识`);
      location.hash = '#/';
    } catch (error) {
      toast('导入失败：' + (error.message || error));
    }
  };
}

// ---------- 手写板 ----------

function openHandwriting() {
  return new Promise(resolve => {
    const layer = document.createElement('div');
    layer.className = 'hw-layer';
    layer.innerHTML = `
      <div class="hw-bar">
        <button class="btn btn-outline" data-act="cancel" type="button">✕ 取消</button>
        <span class="hw-title">手写</span>
      </div>
      <canvas class="hw-canvas"></canvas>
      <div class="hw-actions">
        <button class="btn btn-outline" data-act="undo" type="button">撤销</button>
        <button class="btn btn-outline" data-act="clear" type="button">清空</button>
        <button class="btn btn-primary" data-act="done" type="button" disabled>完成</button>
      </div>`;
    document.body.appendChild(layer);

    const canvas = layer.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const dpr = 2;
    const strokes = [];
    let current = null;

    const resize = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#111827';
      redraw();
    };

    const redraw = () => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      ctx.strokeStyle = '#111827';
      for (const stroke of strokes) {
        if (stroke.length < 2) {
          ctx.beginPath();
          ctx.arc(stroke[0][0], stroke[0][1], 2, 0, Math.PI * 2);
          ctx.fillStyle = '#111827';
          ctx.fill();
          continue;
        }
        ctx.beginPath();
        ctx.moveTo(stroke[0][0], stroke[0][1]);
        for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i][0], stroke[i][1]);
        ctx.stroke();
      }
    };

    const point = event => {
      const rect = canvas.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };

    canvas.addEventListener('pointerdown', event => {
      event.preventDefault();
      // 触摸时锁住指针，手指滑出画布也能连续画；个别环境不支持时忽略即可
      try { canvas.setPointerCapture(event.pointerId); } catch {}
      current = [point(event)];
      strokes.push(current);
      layer.querySelector('[data-act="done"]').disabled = false;
    });
    canvas.addEventListener('pointermove', event => {
      if (!current) return;
      current.push(point(event));
      redraw();
    });
    const end = () => { current = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    layer.onclick = async event => {
      const button = event.target.closest('[data-act]');
      if (!button) return;
      const act = button.dataset.act;
      if (act === 'cancel') {
        layer.remove();
        resolve(null);
      } else if (act === 'undo') {
        strokes.pop();
        layer.querySelector('[data-act="done"]').disabled = strokes.length === 0;
        redraw();
      } else if (act === 'clear') {
        const ok = await confirmDialog({ title: '清空手写', message: '会清掉当前画布上的全部笔迹。', okText: '清空' });
        if (!ok) return;
        strokes.length = 0;
        layer.querySelector('[data-act="done"]').disabled = true;
        redraw();
      } else if (act === 'done') {
        canvas.toBlob(blob => {
          layer.remove();
          resolve(blob);
        }, 'image/jpeg', 0.9);
      }
    };

    requestAnimationFrame(resize);
  });
}
