// The editor's page. Plain DOM, no framework: it's small enough not to need one.
'use strict';

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child != null && child !== false) node.append(child);
  }
  return node;
}

const state = {
  boot: null,
  pages: [],
  blockInfo: {},
  unpublished: 0,
  view: null, // 'page' | 'site' | 'images'
  page: null, // entry from state.pages
  fm: '',
  parts: null,
  mtime: 0,
  dirty: false,
  saving: null,
  media: { items: [], folders: [''], dir: '' },
  site: null,
  siteDirty: false,
  rich: true,
  sideTab: 'preview',
  rawDetails: false,
  uploadTarget: null,
};

function remember(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(`portfolio.${key}`)) ?? fallback;
  } catch {
    return fallback;
  }
}
function memorize(key, value) {
  try {
    localStorage.setItem(`portfolio.${key}`, JSON.stringify(value));
  } catch {}
}

// ---- server calls --------------------------------------------------------

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'X-Portfolio': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const fileUrl = (rel) => `/files/${rel.split('/').map(encodeURIComponent).join('/')}`;
const dirname = (rel) => rel.split('/').slice(0, -1).join('/');
const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

let toastTimer;
function toast(text) {
  document.querySelector('.toast')?.remove();
  const box = el('div', { class: 'toast' }, text);
  document.body.append(box);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.remove(), 5000);
}

async function attempt(fn) {
  try {
    return await fn();
  } catch (err) {
    alertBox(err.message);
    return undefined;
  }
}

// ---- dialogs -------------------------------------------------------------

const openDialogs = new Set();

function closeAllDialogs() {
  for (const close of [...openDialogs]) close(undefined);
}

function dialog({ title, body, buttons, wide }) {
  return new Promise((resolve) => {
    const root = $('modal-root');
    let back;
    const close = (value) => {
      back.remove();
      openDialogs.delete(close);
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    const foot = el('div', { class: 'dialog-foot' });
    let primary = null;
    for (const b of buttons || []) {
      const btn = el('button', { class: b.primary ? 'heavy' : b.left ? 'push-left' : '', onclick: () => (b.run ? b.run(close) : close(b.value)) }, b.label);
      if (b.primary) primary = b;
      foot.append(btn);
    }
    const onKey = (e) => {
      if (root.lastChild !== back) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close(undefined);
      } else if (e.key === 'Enter' && primary && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
        e.preventDefault();
        primary.run ? primary.run(close) : close(primary.value);
      }
    };
    document.addEventListener('keydown', onKey, true);
    openDialogs.add(close);
    back = el('div', { class: 'modal-back' },
      el('div', { class: `dialog${wide ? ' wide' : ''}`, role: 'dialog', 'aria-label': title },
        el('div', { class: 'dialog-title' }, el('span', {}, title)),
        el('div', { class: 'dialog-body' }, typeof body === 'function' ? body(close) : body),
        foot));
    root.append(back);
    (back.querySelector('input:not([type=checkbox]),select,textarea') || foot.lastChild)?.focus();
    back.querySelector('input[type=text], input:not([type])')?.select();
  });
}

const alertBox = (text) => dialog({ title: 'Heads up', body: el('p', {}, text), buttons: [{ label: 'OK', primary: true, value: true }] });

const confirmBox = (title, text, yes = 'OK') =>
  dialog({ title, body: el('p', {}, text), buttons: [{ label: 'Cancel', value: false }, { label: yes, primary: true, value: true }] });

function promptBox(title, label, value = '', yes = 'OK') {
  const input = el('input', { value, type: 'text' });
  return dialog({
    title,
    body: el('div', { class: 'field' }, el('label', {}, label), input),
    buttons: [{ label: 'Cancel', value: undefined }, { label: yes, primary: true, run: (close) => close(input.value) }],
  });
}

// ---- sidebar -------------------------------------------------------------

const GROUPS = ['Pages', 'Writing', 'Working', 'Experimenting'];

function renderSidebar() {
  const box = $('sidebar');
  const scroll = box.scrollTop;
  const item = (label, sel, onclick, opts = {}) =>
    el('button', { class: `nav-item${sel ? ' sel' : ''}${opts.draft ? ' draft' : ''}`, onclick },
      el('span', { class: 'label', title: label }, label),
      opts.tag ? el('span', { class: 'tag' }, opts.tag) : null);

  const top = el('div', { class: 'nav-group' },
    item('Home & site text', state.view === 'site', openSite),
    item('All images', state.view === 'images', openImages));

  const groups = GROUPS.map((group) => {
    const pages = state.pages.filter((p) => p.group === group);
    if (!pages.length) return null;
    return el('div', { class: 'nav-group' },
      el('div', { class: 'nav-title' }, group),
      pages.map((p) => {
        const tags = [];
        if (p.draft) tags.push('draft');
        if (p.change) tags.push('●');
        const label = p.kind === 'quote' ? `“${p.title}”` : p.title;
        return item(label, state.view === 'page' && state.page?.path === p.path, () => openPage(p.path), { draft: p.draft, tag: tags.join(' ') });
      }));
  });
  box.replaceChildren(top, ...groups.filter(Boolean));
  box.scrollTop = scroll;

  const btn = $('publish-btn');
  btn.textContent = state.unpublished ? `Publish (${state.unpublished})` : 'Publish';
  $('status-left').textContent = state.unpublished
    ? `${state.unpublished} change${state.unpublished === 1 ? '' : 's'} not published yet`
    : 'Everything is published';
}

let refreshTimer;
function refreshSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshPages, 1200);
}

async function refreshPages() {
  const data = await api('GET', '/api/pages');
  state.pages = data.pages;
  state.unpublished = data.unpublished;
  if (state.page) {
    const fresh = state.pages.find((p) => p.path === state.page.path);
    if (fresh) {
      state.page = fresh;
      renderNotices();
      setPreview(fresh.previewUrl);
      $('page-url').textContent = fresh.ownPage ? fresh.url : '';
    }
  }
  renderSidebar();
}

// ---- preview pane --------------------------------------------------------

async function setPreview(url) {
  const frame = $('preview');
  const src = `http://127.0.0.1:${state.boot.hugoPort}${url}`;
  $('preview-url').textContent = url;
  if (frame.dataset.target === src) return;
  frame.dataset.target = src;
  await api('GET', `/api/preview-ready?url=${encodeURIComponent(url)}`).catch(() => {});
  if (frame.dataset.target === src) frame.src = src;
}

function setSideTab(tab) {
  state.sideTab = tab;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === tab));
  $('pane-preview').hidden = tab !== 'preview';
  $('pane-images').hidden = tab !== 'images';
  if (tab === 'images') renderPageImages();
}

// ---- opening views -------------------------------------------------------

function showView(view) {
  state.view = view;
  for (const name of ['page', 'site', 'images']) $(`view-${name}`).hidden = name !== view;
  const imagesTab = document.querySelector('.tab[data-tab=images]');
  imagesTab.hidden = view !== 'page';
  if (view !== 'page' && state.sideTab === 'images') setSideTab('preview');
  renderSidebar();
}

async function openPage(rel) {
  await flushSave();
  const data = await attempt(() => api('GET', `/api/page?path=${encodeURIComponent(rel)}`));
  if (!data) return;
  const page = state.pages.find((p) => p.path === rel);
  if (!page) return;
  state.page = page;
  state.mtime = data.mtime;
  state.parts = FM.split(data.raw);
  state.fm = state.parts.fm;
  state.dirty = false;
  state.rawDetails = false;
  memorize('last', rel);
  state.media = await attempt(() => api('GET', `/api/media?page=${encodeURIComponent(rel)}`)) || { items: [], folders: [''], dir: '' };

  showView('page');
  $('crumb').textContent = page.group === 'Pages' ? page.title : `${page.group} / ${page.title}`;
  $('title-input').value = FM.get(state.fm, 'title');
  $('page-url').textContent = page.ownPage ? page.url : '';
  const isQuote = page.kind === 'quote';
  $('format-bar').hidden = isQuote;
  $('paper').classList.toggle('quote-mode', isQuote);
  editor.setDoc(state.parts.body);
  setDetailsOpen(isQuote || remember(`details.${page.kind}`, false));
  renderNotices();
  setPreview(page.previewUrl);
  setSaveState('');
  if (state.sideTab === 'images') renderPageImages();
}

// ---- saving --------------------------------------------------------------

function setSaveState(text) {
  $('save-state').textContent = text;
}

let saveTimer;
function markDirty() {
  state.dirty = true;
  setSaveState('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
}

function currentRaw() {
  return FM.join({ ...state.parts, fm: state.fm, body: editor.getDoc() });
}

async function flushSave() {
  clearTimeout(saveTimer);
  if (state.saving) await state.saving;
  if (state.dirty && state.page) state.saving = savePage().finally(() => (state.saving = null));
  await state.saving;
  await flushSite();
}

async function savePage(force) {
  state.dirty = false;
  const rel = state.page.path;
  try {
    const res = await api('PUT', '/api/page', { path: rel, raw: currentRaw(), baseMtime: state.mtime, force });
    if (res.conflict) return resolveConflict(res);
    state.mtime = res.mtime;
    if (!state.dirty) setSaveState('Saved');
    refreshSoon();
  } catch (err) {
    state.dirty = true;
    setSaveState('NOT SAVED');
    toast(`Couldn't save: ${err.message}`);
  }
  return undefined;
}

async function resolveConflict(res) {
  const choice = await dialog({
    title: 'File changed elsewhere',
    body: el('p', {}, 'This page was changed outside the app, maybe in Obsidian, while you were editing it.'),
    buttons: [{ label: 'Use the other version', value: 'theirs' }, { label: 'Keep mine', primary: true, value: 'mine' }],
  });
  if (choice === 'theirs') {
    state.mtime = res.mtime;
    state.parts = FM.split(res.raw);
    state.fm = state.parts.fm;
    $('title-input').value = FM.get(state.fm, 'title');
    editor.setDoc(state.parts.body);
    renderDetails();
    setSaveState('Reloaded');
    return;
  }
  await savePage(true);
}

async function checkDisk() {
  if (state.view !== 'page' || !state.page || state.dirty || state.saving) return;
  const data = await api('GET', `/api/page?path=${encodeURIComponent(state.page.path)}`).catch(() => null);
  if (!data) {
    await refreshPages();
    if (!state.pages.some((p) => p.path === state.page?.path)) openFirstPage();
    return;
  }
  if (Math.abs(data.mtime - state.mtime) <= 1 || data.raw === currentRaw()) return;
  state.mtime = data.mtime;
  state.parts = FM.split(data.raw);
  state.fm = state.parts.fm;
  $('title-input').value = FM.get(state.fm, 'title');
  editor.setDoc(state.parts.body);
  renderDetails();
  setSaveState('Updated from disk');
}

// ---- page details form ---------------------------------------------------

const DRAFT = ['draft', 'Draft', 'bool', { note: 'Drafts stay hidden on the live site.' }];
const SLUG = ['slug', 'URL name', 'text', { note: 'The last part of the address.' }];
const type = (fm) => FM.get(fm, 'type');
const isExternal = (fm) => FM.isTrue(fm, 'external');

const FIELDS = {
  writing: [
    ['date', 'Date', 'date'],
    ['Excerpt', 'Line under title', 'text'],
    ['description', 'Intro line', 'text'],
    ['featuredImage', 'Top image', 'image'],
    SLUG,
    DRAFT,
  ],
  quote: [
    ['quote', 'Quote', 'area'],
    ['author', 'Who said it', 'text'],
    ['date', 'Date', 'date'],
    DRAFT,
  ],
  working: [
    ['description', 'One-line summary', 'area'],
    ['type', 'When clicked', 'select', { options: [['case-study', 'Opens a case study'], ['external', 'Opens a live site'], ['nda', 'Opens an NDA popup']] }],
    ['externalurl', 'Live site URL', 'text', { when: (fm) => type(fm) === 'external' }],
    ['ndaBadge', 'Popup badge', 'text', { when: (fm) => type(fm) === 'nda' }],
    ['ndaNote', 'Popup note', 'area', { when: (fm) => type(fm) === 'nda' }],
    ['cover', 'Cover image', 'image'],
    ['tags', 'Tags', 'tags', { note: 'Comma separated. These become the filters on the home page.' }],
    ['messages', 'Hover message', 'lines', { note: 'One per line. Several lines cycle.' }],
    ['year', 'Year', 'barenum'],
    ['weight', 'Order', 'barenum', { note: 'Lower numbers come first.' }],
    ['bgColor', 'Page colour', 'color', { when: (fm) => type(fm) === 'case-study' }],
    SLUG,
    DRAFT,
  ],
  experimenting: [
    ['description', 'One-line summary', 'area'],
    ['external', 'Opens a live site', 'bool'],
    ['externalurl', 'Live site URL', 'text', { when: isExternal }],
    ['cover', 'Cover image', 'image'],
    ['tags', 'Tags', 'tags', { note: 'Comma separated.' }],
    ['date', 'Date', 'date'],
    ['year', 'Year', 'barenum'],
    SLUG,
    DRAFT,
  ],
  page: [
    ['description', 'Search description', 'text'],
    DRAFT,
  ],
};

function changeFm(next) {
  state.fm = next;
  state.parts.hasFm = true;
  markDirty();
}

function fieldRow(key, label, kind, opts = {}) {
  const fm = state.fm;
  const value = FM.get(fm, key);
  let control;
  const clearIfEmpty = (v, write) => changeFm(!v && !FM.has(fm, key) ? state.fm : write(v));

  switch (kind) {
    case 'bool':
      control = el('input', {
        type: 'checkbox',
        id: `f-${key}`,
        checked: value.toLowerCase() === 'true',
        onchange: (e) => {
          changeFm(FM.setBare(state.fm, key, e.target.checked));
          renderDetails();
          refreshSoon();
        },
      });
      break;
    case 'area':
      control = el('textarea', { rows: 2, value, oninput: (e) => changeFm(FM.set(state.fm, key, e.target.value)) });
      break;
    case 'select':
      control = el('select', {
        onchange: (e) => {
          changeFm(FM.set(state.fm, key, e.target.value));
          renderDetails();
          refreshSoon();
        },
      }, opts.options.map(([v, text]) => el('option', { value: v, selected: v === value }, text)));
      break;
    case 'date': {
      const [day, rest = ''] = value.split('T');
      control = el('input', {
        type: 'date',
        value: day,
        onchange: (e) => {
          if (e.target.value) changeFm(FM.setBare(state.fm, key, rest ? `${e.target.value}T${rest}` : e.target.value));
        },
      });
      break;
    }
    case 'barenum':
      control = el('input', {
        type: 'number',
        value,
        oninput: (e) => {
          const v = e.target.value.trim();
          changeFm(v === '' ? FM.remove(state.fm, key) : FM.setBare(state.fm, key, v));
        },
      });
      break;
    case 'color':
      control = el('div', { class: 'image-field' },
        el('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff', oninput: (e) => changeFm(FM.set(state.fm, key, e.target.value)) }),
        el('button', { class: 'flat', onclick: () => { changeFm(FM.remove(state.fm, key)); renderDetails(); } }, 'none'));
      break;
    case 'tags':
      control = el('input', {
        type: 'text',
        value: FM.getList(fm, key).join(', '),
        oninput: (e) => changeFm(FM.setList(state.fm, key, e.target.value.split(',').map((s) => s.trim()).filter(Boolean))),
      });
      break;
    case 'lines': {
      control = el('textarea', {
        rows: 2,
        value: FM.getList(fm, key).join('\n'),
        oninput: (e) => {
          const lines = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
          if (!lines.length) changeFm(FM.remove(state.fm, key));
          else if (lines.length === 1) changeFm(FM.set(state.fm, key, lines[0]));
          else changeFm(FM.setList(state.fm, key, lines));
        },
      });
      break;
    }
    case 'image':
      control = imagePicker(key, value);
      break;
    default:
      control = el('input', { type: 'text', value, oninput: (e) => clearIfEmpty(e.target.value, (v) => FM.set(state.fm, key, v)) });
  }

  return el('div', { class: `field${kind === 'bool' ? ' check' : ''}` },
    el('label', { htmlFor: `f-${key}` }, label),
    control,
    opts.note ? el('div', { class: 'note' }, opts.note) : null);
}

function imagePicker(key, value) {
  const select = el('select', {
    onchange: (e) => {
      changeFm(FM.set(state.fm, key, e.target.value));
      renderDetails();
      refreshSoon();
    },
  },
  el('option', { value: '', selected: !value }, '(none)'),
  state.media.items.filter((m) => !m.isVideo).map((m) => el('option', { value: m.ref, selected: m.ref === value }, m.ref)),
  value && !state.media.items.some((m) => m.ref === value) ? el('option', { value, selected: true }, `${value} (not found)`) : null);
  const current = state.media.items.find((m) => m.ref === value);
  return el('div', { class: 'image-field' },
    current ? el('img', { src: current.url, alt: '' }) : null,
    select,
    el('button', {
      onclick: () =>
        pickFiles({ folder: '', onUploaded: (items) => {
          if (items[0]) changeFm(FM.set(state.fm, key, items[0].ref));
          renderDetails();
        } }),
    }, 'Add…'));
}

function renderDetails() {
  const box = $('details');
  if (box.hidden || !state.page) return;
  if (state.rawDetails) {
    box.replaceChildren(
      el('textarea', { class: 'raw-box', spellcheck: false, value: state.fm, oninput: (e) => changeFm(e.target.value) }),
      el('div', { class: 'details-foot' },
        el('button', { class: 'flat', onclick: () => { state.rawDetails = false; renderDetails(); } }, 'Back to the form')));
    return;
  }
  const fields = FIELDS[state.page.kind] || FIELDS.page;
  box.replaceChildren(
    ...fields
      .filter(([, , , opts]) => !opts?.when || opts.when(state.fm))
      .map(([key, label, kind, opts]) => fieldRow(key, label, kind, opts)),
    el('div', { class: 'details-foot' },
      el('button', { class: 'flat', onclick: () => { state.rawDetails = true; renderDetails(); } }, 'Edit all settings as text')));
}

function setDetailsOpen(open) {
  $('details').hidden = !open;
  $('details-btn').textContent = `${open ? '▾' : '▸'} Details`;
  renderDetails();
}

function renderNotices() {
  const page = state.page;
  if (!page) return;
  const out = [];
  if (page.clashes?.length) {
    out.push(el('div', { class: 'notice warn' }, `Same address as “${page.clashes.join('”, “')}”. One will overwrite the other. Change the URL name in Details.`));
  }
  const date = FM.get(state.fm, 'date');
  if (date && !FM.isTrue(state.fm, 'draft') && new Date(date) > new Date()) {
    out.push(el('div', { class: 'notice warn' }, "This is dated in the future, so it won't appear on the live site until then."));
  }
  if (FM.isTrue(state.fm, 'draft')) out.push(el('div', { class: 'notice' }, 'Draft: only you can see this. Untick Draft in Details to show it on the site.'));
  if (page.kind === 'working' && !page.ownPage) out.push(el('div', { class: 'notice' }, type(state.fm) === 'nda' ? 'What you write below shows inside the NDA popup.' : 'This opens a live site, so only the card on the home page is shown. Anything below stays unused.'));
  if (page.kind === 'experimenting' && !page.ownPage) out.push(el('div', { class: 'notice' }, 'Shown as a card on the experimenting page. Anything below stays unused.'));
  $('notices').replaceChildren(...out);
}

// ---- images --------------------------------------------------------------

function resolveImage(src, lenient) {
  if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:')) return src;
  if (src.startsWith('/')) return fileUrl(`static${src}`);
  if (lenient) {
    // Shortcodes accept bare file names in any case, wherever in the page's folder.
    const wanted = src.toLowerCase();
    const hit = state.media.items.find((m) => m.ref?.toLowerCase() === wanted || m.name.toLowerCase() === wanted);
    if (hit) return hit.url;
  }
  return fileUrl(`${dirname(state.page.path)}/${src}`);
}

function markdownFor(item) {
  if (item.isVideo) return `{{< video src="${item.ref}" >}}`;
  const ref = /\s/.test(item.ref) ? `<${item.ref}>` : item.ref;
  return `![](${ref})`;
}

function pickFiles(target) {
  state.uploadTarget = target;
  $('file-input').value = '';
  $('file-input').click();
}

async function uploadFiles(files, { folder = '', onUploaded } = {}) {
  const page = state.page;
  if (!page) return;
  const done = [];
  for (const [i, file] of files.entries()) {
    setSaveState(`Adding ${i + 1} of ${files.length}…`);
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const name = file.name && file.name !== 'image.png' ? file.name : `pasted-${stamp}${i || ''}.${(file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;
    const url = `/api/media?page=${encodeURIComponent(page.path)}&folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(name)}`;
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'X-Portfolio': '1' }, body: file });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      done.push(data);
    } catch (err) {
      await alertBox(err.message);
    }
  }
  setSaveState('');
  state.media = await api('GET', `/api/media?page=${encodeURIComponent(page.path)}`);
  onUploaded?.(done);
  if (state.sideTab === 'images') renderPageImages();
  renderDetails();
  refreshSoon();
}

function imageCard(item, actions, sub) {
  const thumb = item.isVideo
    ? el('video', { src: item.url, preload: 'metadata', muted: true })
    : el('img', { src: item.url, alt: '', loading: 'lazy' });
  const dims = el('span', {});
  if (!item.isVideo) thumb.onload = () => (dims.textContent = ` · ${thumb.naturalWidth}×${thumb.naturalHeight}`);
  return el('div', { class: 'image-card' },
    el('div', { class: 'image-thumb' }, thumb),
    el('div', { class: 'image-info' },
      el('div', { class: 'image-name', title: item.path }, item.name),
      el('div', { class: 'image-sub' }, kb(item.size), dims),
      sub),
    el('div', { class: 'image-actions' }, actions));
}

async function renameImage(item, after) {
  const stem = item.name.replace(/\.[^.]+$/, '');
  const name = await promptBox('Rename image', 'New name', stem, 'Rename');
  if (!name || name === stem) return;
  await flushSave();
  await attempt(() => api('POST', '/api/media/rename', { path: item.path, newName: name }));
  await after();
}

async function deleteImage(item, used, after) {
  const text = used
    ? `${item.name} is used on the site. Deleting it will leave a broken image there. It goes to the Trash.`
    : `Move ${item.name} to the Trash?`;
  if (!(await confirmBox('Delete image', text, 'Delete'))) return;
  await attempt(() => api('POST', '/api/media/delete', { path: item.path }));
  await after();
}

async function reloadCurrentPageMedia() {
  if (!state.page) return;
  state.media = await api('GET', `/api/media?page=${encodeURIComponent(state.page.path)}`);
  const data = await api('GET', `/api/page?path=${encodeURIComponent(state.page.path)}`);
  if (data.raw !== currentRaw()) {
    state.mtime = data.mtime;
    state.parts = FM.split(data.raw);
    state.fm = state.parts.fm;
    editor.setDoc(state.parts.body);
  } else {
    state.mtime = data.mtime;
  }
  renderPageImages();
  renderDetails();
  refreshSoon();
}

function folderNote(folder) {
  if (state.page?.path === 'content/about/index.md' && folder === 'paintings') return 'Everything here shows in the Paintings grid.';
  return '';
}

function renderPageImages() {
  const box = $('pane-images');
  const page = state.page;
  if (!page) return box.replaceChildren();
  const { items, folders } = state.media;
  const coverKey = { working: 'cover', experimenting: 'cover', writing: 'featuredImage' }[page.kind];
  const coverRef = coverKey ? FM.get(state.fm, coverKey) : '';

  const sections = folders.map((folder) => {
    const here = items.filter((m) => (m.folder || '') === folder);
    const addHere = () => pickFiles({ folder });
    const note = folderNote(folder);
    return el('div', {},
      el('div', { class: 'folder-head' },
        el('span', {}, folder ? `${folder}/` : 'This page'),
        el('button', { onclick: addHere }, 'Add images…'),
        note ? el('span', { class: 'note' }, note) : null),
      here.length
        ? el('div', { class: 'image-grid' }, here.map((item) => {
            const isCover = coverRef && item.ref === coverRef;
            const sub = el('div', { class: 'image-sub' }, isCover ? el('b', {}, coverKey === 'cover' ? 'Cover' : 'Top image') : item.used ? 'in use' : el('b', {}, 'not used yet'));
            return imageCard(item, [
              el('button', { disabled: page.kind === 'quote', onclick: () => { editor.insertBlockAt(markdownFor(item)); } }, 'Insert'),
              coverKey && !item.isVideo && !isCover
                ? el('button', { onclick: () => { changeFm(FM.set(state.fm, coverKey, item.ref)); renderPageImages(); renderDetails(); } }, coverKey === 'cover' ? 'Set cover' : 'Set top')
                : null,
              el('button', { onclick: () => renameImage(item, reloadCurrentPageMedia) }, 'Rename'),
              el('button', { onclick: () => deleteImage(item, item.used, reloadCurrentPageMedia) }, 'Delete'),
            ], sub);
          }))
        : el('div', { class: 'empty' }, 'No images yet. Drop some here.'));
  });

  const wrap = el('div', { class: 'image-pane' }, sections);
  box.replaceChildren(wrap);
}

async function openImages() {
  await flushSave();
  state.page = null;
  showView('images');
  $('crumb').textContent = 'All images';
  setSaveState('');
  setPreview('/');
  await renderAllImages();
}

async function renderAllImages() {
  const box = $('view-images');
  const filter = remember('imagesFilter', 'all');
  const data = await attempt(() => api('GET', '/api/media'));
  if (!data) return;
  const shown = data.items.filter((i) => filter === 'all' || !i.used);
  const select = el('select', {
    onchange: (e) => {
      memorize('imagesFilter', e.target.value);
      renderAllImages();
    },
  }, el('option', { value: 'all', selected: filter === 'all' }, 'Every image'), el('option', { value: 'unused', selected: filter === 'unused' }, 'Not used on any page'));

  const cards = shown.map((item) => {
    const owner = item.usedBy[0] || item.owner;
    const sub = el('div', { class: 'image-sub', title: owner?.title || '' }, owner ? `${item.used ? '' : 'unused, '}${owner.title}` : el('b', {}, 'not on any page'));
    return imageCard(item, [
      owner ? el('button', { onclick: () => openPage(owner.path) }, 'Open page') : null,
      el('button', { onclick: () => renameImage(item, renderAllImages) }, 'Rename'),
      el('button', { onclick: () => deleteImage(item, item.used, renderAllImages) }, 'Delete'),
    ], sub);
  });

  box.replaceChildren(
    el('div', { class: 'sheet', style: 'max-width:none' },
      el('h1', {}, 'All images'),
      el('p', {}, `${data.items.length} files, ${kb(data.totalBytes)}. To add images, open a page and use its Images tab.`),
      el('div', { class: 'toolbar-row' }, el('label', {}, 'Show'), select),
      cards.length ? el('div', { class: 'image-grid' }, cards) : el('div', { class: 'empty' }, 'Nothing here.')),
  );
}

// ---- site text -----------------------------------------------------------

const SITE_SECTIONS = [
  {
    title: 'Home page',
    preview: '/',
    fields: [
      ['home.tagline', 'Big headline'],
      ['home.subtitle', 'Line under it'],
      ['name', 'Your name'],
      ['home.role', 'Current role', 'text', 'Markdown links work: [Name](https://…)'],
      ['home.intro', 'Intro', 'area'],
      ['home.workHeading', 'Work heading'],
      ['home.filterLabel', 'Filter label'],
      ['home.filterAll', '“Show all” filter'],
      ['home.moreText', 'Text at the bottom'],
      ['home.moreLink', 'Its link text'],
    ],
  },
  {
    title: 'Writing page',
    preview: '/writing/',
    fields: [
      ['writing.tagline', 'Big headline'],
      ['writing.subtitle', 'Line under it'],
      ['writing.heading', 'List heading'],
      ['writing.intro', 'Intro', 'area'],
    ],
  },
  {
    title: 'Experimenting page',
    preview: '/experimenting/',
    fields: [
      ['experimenting.heading', 'Heading'],
      ['experimenting.intro', 'Intro', 'area'],
    ],
  },
];

const dig = (obj, key) => key.split('.').reduce((o, k) => o?.[k], obj);
function plant(obj, key, value) {
  const parts = key.split('.');
  const last = parts.pop();
  const target = parts.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = value;
}

let siteTimer;
function markSiteDirty() {
  state.siteDirty = true;
  setSaveState('Saving…');
  clearTimeout(siteTimer);
  siteTimer = setTimeout(flushSite, 600);
}

async function flushSite() {
  clearTimeout(siteTimer);
  if (!state.siteDirty) return;
  state.siteDirty = false;
  try {
    await api('PUT', '/api/site', { data: state.site });
    setSaveState('Saved');
    refreshSoon();
  } catch (err) {
    state.siteDirty = true;
    setSaveState('NOT SAVED');
    toast(`Couldn't save: ${err.message}`);
  }
}

function linkTable(list) {
  const box = el('div', { class: 'link-table' });
  const draw = () => {
    box.replaceChildren(
      ...list.map((link, i) =>
        el('div', { class: 'link-row' },
          el('input', { type: 'text', value: link.label, placeholder: 'Label', 'aria-label': 'Label', oninput: (e) => { link.label = e.target.value; markSiteDirty(); } }),
          el('input', { type: 'text', value: link.url, placeholder: '/page or https://…', 'aria-label': 'Address', oninput: (e) => { link.url = e.target.value; markSiteDirty(); } }),
          el('button', { title: 'Move up', disabled: i === 0, onclick: () => { list.splice(i - 1, 0, list.splice(i, 1)[0]); markSiteDirty(); draw(); } }, '↑'),
          el('button', { title: 'Move down', disabled: i === list.length - 1, onclick: () => { list.splice(i + 1, 0, list.splice(i, 1)[0]); markSiteDirty(); draw(); } }, '↓'),
          el('button', { title: 'Remove', onclick: () => { list.splice(i, 1); markSiteDirty(); draw(); } }, '×'))),
      el('button', { onclick: () => { list.push({ label: '', url: '' }); draw(); } }, 'Add link'),
    );
  };
  draw();
  return box;
}

function siteField(key, label, kind, note) {
  const value = dig(state.site, key) ?? '';
  const oninput = (e) => {
    plant(state.site, key, e.target.value);
    markSiteDirty();
  };
  return el('div', { class: 'field' },
    el('label', {}, label),
    kind === 'area' ? el('textarea', { rows: 3, value, oninput }) : el('input', { type: 'text', value, oninput }),
    note ? el('div', { class: 'note' }, note) : null);
}

function renderSite() {
  const s = state.site;
  const follow = (preview) => ({ onfocusin: () => setPreview(preview) });
  const columns = el('div', {});
  const drawColumns = () => {
    columns.replaceChildren(
      ...s.footer.columns.map((col, i) =>
        el('div', { class: 'column-box' },
          el('div', { class: 'column-head' },
            el('input', { type: 'text', value: col.title, 'aria-label': 'Column title', oninput: (e) => { col.title = e.target.value; markSiteDirty(); } }),
            el('button', { onclick: () => { s.footer.columns.splice(i, 1); markSiteDirty(); drawColumns(); } }, 'Remove column')),
          linkTable(col.links))),
      el('button', { onclick: () => { s.footer.columns.push({ title: 'New column', links: [] }); markSiteDirty(); drawColumns(); } }, 'Add column'),
    );
  };
  drawColumns();

  $('view-site').replaceChildren(
    el('div', { class: 'sheet' },
      el('h1', {}, 'Home & site text'),
      el('p', {}, 'Everything on the site that isn’t part of a page. Changes save as you type and show in the preview.'),
      SITE_SECTIONS.map((sec) =>
        el('fieldset', follow(sec.preview),
          el('legend', {}, sec.title),
          sec.fields.map(([key, label, kind, note]) => siteField(key, label, kind, note)))),
      el('fieldset', follow('/'),
        el('legend', {}, 'Top navigation'),
        el('div', { class: 'subhead' }, 'Left'),
        linkTable(s.nav.main),
        el('div', { class: 'subhead' }, 'Right'),
        linkTable(s.nav.right)),
      el('fieldset', follow('/'),
        el('legend', {}, 'Footer'),
        siteField('footer.heading', 'Big footer text'),
        columns,
        el('div', { style: 'height:10px' }),
        siteField('footer.copyright', 'Copyright name'),
        siteField('footer.bottomLabel', 'Small link'),
        siteField('footer.bottomUrl', 'Its address')),
      el('fieldset', follow('/'),
        el('legend', {}, 'Search engines'),
        siteField('description', 'Site description', 'area'))),
  );
}

async function openSite() {
  await flushSave();
  const data = await attempt(() => api('GET', '/api/site'));
  if (!data) return;
  state.page = null;
  state.site = data.data;
  showView('site');
  $('crumb').textContent = 'Home & site text';
  setSaveState('');
  setPreview('/');
  renderSite();
  memorize('last', '@site');
}

// ---- new page ------------------------------------------------------------

async function newPage() {
  await flushSave();
  const kinds = [
    ['writing', 'Writing: an essay or note'],
    ['quote', 'Writing: a quote'],
    ['working', 'Working: a project'],
    ['experimenting', 'Experimenting: a side project'],
    ['page', 'Page: its own address, like Now'],
  ];
  const kindSelect = el('select', {}, kinds.map(([v, label]) => el('option', { value: v }, label)));
  const title = el('input', { type: 'text', placeholder: 'Title' });
  const created = await dialog({
    title: 'New',
    body: el('div', {},
      el('div', { class: 'field' }, el('label', {}, 'What'), kindSelect),
      el('div', { class: 'field' }, el('label', {}, 'Title'), title)),
    buttons: [
      { label: 'Cancel', value: undefined },
      {
        label: 'Create',
        primary: true,
        run: async (close) => {
          if (!title.value.trim()) return title.focus();
          const res = await attempt(() => api('POST', '/api/page', { kind: kindSelect.value, title: title.value }));
          return close(res);
        },
      },
    ],
  });
  if (!created) return;
  await refreshPages();
  await openPage(created.path);
  $('details').hidden || renderDetails();
  editor.focus();
}

async function deleteCurrentPage() {
  const page = state.page;
  if (!page) return;
  const text = page.bundle
    ? `Move “${page.title}” and its images to the Trash? It leaves the live site next time you publish.`
    : `Move “${page.title}” to the Trash? It leaves the live site next time you publish.`;
  if (!(await confirmBox('Delete page', text, 'Delete'))) return;
  clearTimeout(saveTimer);
  state.dirty = false;
  await attempt(() => api('POST', '/api/page/delete', { path: page.path }));
  state.page = null;
  await refreshPages();
  openFirstPage();
}

function openFirstPage() {
  const first = state.pages.find((p) => p.group === 'Writing') || state.pages[0];
  if (first) openPage(first.path);
  else openSite();
}

// ---- publish -------------------------------------------------------------

const STATE_LABEL = { new: 'NEW', changed: 'EDITED', deleted: 'REMOVED' };

function changeLabel(p) {
  const page = state.pages.find((x) => x.path === p);
  if (page) return page.title;
  if (p === 'data/site.json') return 'Home & site text';
  return p.replace(/^content\//, '');
}

const isContent = (p) => p.startsWith('content/') || p.startsWith('static/images/') || p === 'data/site.json';

function suggestMessage(files) {
  const named = (f) => changeLabel(f.path);
  const verb = { new: 'add', changed: 'update', deleted: 'remove' };
  const content = files.filter((f) => f.path.endsWith('.md') || f.path === 'data/site.json');
  const pick = content.length ? content : files;
  if (pick.length === 1) return `${verb[pick[0].status]} ${named(pick[0])}`;
  if (pick.length <= 3) return `update ${pick.map(named).join(', ')}`;
  return `update ${pick.length} files`;
}

async function openPublish() {
  closeAllDialogs();
  await flushSave();
  const changes = await attempt(() => api('GET', '/api/changes'));
  if (!changes) return;
  await refreshPages();
  if (!changes.gitOk) return alertBox(`Git isn't happy: ${changes.gitError}`);

  if (!changes.files.length && !changes.ahead) {
    return dialog({ title: 'Publish', body: el('p', {}, 'Nothing new. The live site already matches what’s here.'), buttons: [{ label: 'OK', primary: true, value: true }] });
  }

  const checks = new Map();
  const list = el('div', { class: 'change-list' });
  const rows = (files) =>
    files.map((f) => {
      const box = el('input', { type: 'checkbox', id: `c-${f.path}`, checked: true });
      checks.set(f.path, box);
      return el('div', { class: 'change-row' },
        box,
        el('span', { class: `change-state ${f.status}` }, STATE_LABEL[f.status]),
        el('label', { htmlFor: `c-${f.path}`, title: f.path }, changeLabel(f.path)),
        el('button', {
          class: 'flat',
          title: 'Throw away this change',
          onclick: async () => {
            if (!(await confirmUndo(f))) return reopen();
            await attempt(() => api('POST', '/api/revert', { path: f.path }));
            await refreshPages();
            if (state.page) await checkDisk();
            reopen();
          },
        }, 'undo'));
    });
  const reopen = () => setTimeout(openPublish);

  const content = changes.files.filter((f) => isContent(f.path));
  const code = changes.files.filter((f) => !isContent(f.path));
  list.append(
    ...(content.length ? [el('div', { class: 'change-head' }, 'Pages & images'), ...rows(content)] : []),
    ...(code.length ? [el('div', { class: 'change-head' }, 'Site code'), ...rows(code)] : []),
  );

  const message = el('input', { type: 'text', value: suggestMessage(changes.files.length ? changes.files : [{ path: 'site', status: 'changed' }]) });
  const body = el('div', {},
    changes.branch !== 'main'
      ? el('p', {}, el('b', {}, `You’re on the “${changes.branch}” branch, so publishing won’t update the live site.`))
      : null,
    changes.files.length ? list : null,
    changes.ahead ? el('p', {}, `${changes.ahead} earlier version${changes.ahead === 1 ? '' : 's'} still waiting to be sent to GitHub.`) : null,
    el('div', { class: 'field' }, el('label', {}, 'Note'), message));

  await dialog({
    title: 'Publish to shaurya.site',
    body,
    buttons: [
      { label: 'Cancel', value: undefined },
      {
        label: 'Publish',
        primary: true,
        run: (close) => {
          const paths = [...checks].filter(([, box]) => box.checked).map(([p]) => p);
          if (!paths.length && !changes.ahead) return;
          close(true);
          runPublish(paths, message.value.trim());
        },
      },
    ],
  });
  return undefined;
}

function confirmUndo(file) {
  const text = file.status === 'new'
    ? `Move ${changeLabel(file.path)} to the Trash?`
    : `Go back to the published version of ${changeLabel(file.path)}? Your edits will be lost.`;
  return confirmBox('Undo change', text, 'Undo');
}

function runPublish(paths, message) {
  const steps = new Map();
  const log = el('div', { class: 'steps' });
  const drawStep = (event) => {
    let row = steps.get(event.step);
    if (!row) {
      row = el('div', { class: 'step' });
      steps.set(event.step, row);
      log.append(row);
    }
    const icon = { run: '…', ok: '✓', fail: '✗' }[event.state];
    row.className = `step ${event.state}`;
    row.replaceChildren(
      el('span', { class: event.state === 'run' ? 'blink' : '' }, icon),
      el('span', {}, event.text),
    );
    if (event.detail) row.append(el('pre', {}, event.detail));
  };

  let closeDialog;
  const closeBtn = el('button', { disabled: true, onclick: () => closeDialog?.() }, 'Close');
  const liveBtn = el('button', { class: 'heavy', hidden: true, onclick: () => openExternal(state.boot.liveUrl) }, 'View live site');

  $('modal-root').replaceChildren(
    el('div', { class: 'modal-back' },
      el('div', { class: 'dialog' },
        el('div', { class: 'dialog-title' }, el('span', {}, 'Publishing')),
        el('div', { class: 'dialog-body' }, log),
        el('div', { class: 'dialog-foot' }, closeBtn, liveBtn))),
  );
  closeDialog = () => {
    $('modal-root').replaceChildren();
    refreshPages();
  };

  (async () => {
    let sha = null;
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'X-Portfolio': '1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths, message }),
      });
      if (!res.body) throw new Error('No response from the app.');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const event = JSON.parse(buffer.slice(0, nl));
          buffer = buffer.slice(nl + 1);
          if (event.done) sha = event.sha;
          else drawStep(event);
        }
      }
    } catch (err) {
      drawStep({ step: 'error', state: 'fail', text: err.message });
    }
    closeBtn.disabled = false;
    await refreshPages();
    if (sha) {
      drawStep({ step: 'deploy', state: 'run', text: 'Cloudflare is building the site (about a minute)' });
      watchDeploy(sha, (event) => {
        if (document.body.contains(log)) drawStep(event);
        if (event.state === 'ok' && document.body.contains(liveBtn)) liveBtn.hidden = false;
      });
    }
  })();
}

function watchDeploy(sha, report) {
  $('status-right').textContent = 'Deploying…';
  const started = Date.now();
  const tick = async () => {
    const res = await api('GET', `/api/deploy?sha=${sha}`).catch(() => ({ state: 'unknown' }));
    if (res.state === 'live') {
      $('status-right').textContent = `Live as of ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      report({ step: 'deploy', state: 'ok', text: 'Live on shaurya.site' });
      return;
    }
    if (res.state === 'failed') {
      $('status-right').textContent = 'Deploy failed';
      report({ step: 'deploy', state: 'fail', text: 'Cloudflare could not build this version. The live site still shows the previous one.' });
      return;
    }
    if (Date.now() - started > 6 * 60 * 1000) {
      $('status-right').textContent = '';
      report({ step: 'deploy', state: 'ok', text: 'Sent. Cloudflare hasn’t reported back yet, so check the live site in a minute.' });
      return;
    }
    setTimeout(tick, 8000);
  };
  setTimeout(tick, 8000);
}

function openExternal(url) {
  window.open(url, '_blank', 'noopener');
}

// ---- wiring --------------------------------------------------------------

let editor;

function insertLink() {
  const selected = editor.selectedText();
  const looksLikeUrl = /^https?:\/\//.test(selected);
  const text = el('input', { type: 'text', value: looksLikeUrl ? '' : selected });
  const url = el('input', { type: 'text', value: looksLikeUrl ? selected : '', placeholder: 'https://…' });
  dialog({
    title: 'Add link',
    body: el('div', {},
      el('div', { class: 'field' }, el('label', {}, 'Text'), text),
      el('div', { class: 'field' }, el('label', {}, 'Address'), url)),
    buttons: [
      { label: 'Cancel', value: undefined },
      {
        label: 'Add',
        primary: true,
        run: (close) => {
          if (url.value.trim()) editor.replaceSelection(`[${text.value || url.value}](${url.value.trim()})`);
          close();
        },
      },
    ],
  }).then(() => editor.focus());
}

function makeDropTarget(node, getFolder) {
  const has = (e) => e.dataTransfer?.types?.includes('Files');
  node.addEventListener('dragover', (e) => {
    if (!has(e)) return;
    e.preventDefault();
    node.classList.add('dropping');
  });
  node.addEventListener('dragleave', (e) => {
    if (!node.contains(e.relatedTarget)) node.classList.remove('dropping');
  });
  node.addEventListener('drop', (e) => {
    if (!has(e)) return;
    e.preventDefault();
    node.classList.remove('dropping');
    uploadFiles([...e.dataTransfer.files], { folder: getFolder(e) });
  });
}

function wire() {
  editor = RichText.create({
    parent: $('paper'),
    onChange: () => markDirty(),
    resolveImage,
    renderBlock,
    onBlockClick: editBlockAt,
    onLink: insertLink,
    onFiles: (files, pos) =>
      uploadFiles(files, {
        onUploaded: (items) => {
          const text = items.map(markdownFor).join('\n\n');
          if (text) editor.insertBlockAt(text, pos);
        },
      }),
  });

  $('new-btn').onclick = newPage;
  $('publish-btn').onclick = openPublish;
  $('live-btn').onclick = () => openExternal(state.page?.ownPage ? state.boot.liveUrl + state.page.url : state.boot.liveUrl);
  $('delete-page-btn').onclick = deleteCurrentPage;
  $('reload-btn').onclick = () => ($('preview').src = $('preview').dataset.target);
  $('title-input').oninput = (e) => {
    changeFm(FM.set(state.fm, 'title', e.target.value));
    refreshSoon();
  };
  $('details-btn').onclick = () => {
    const open = $('details').hidden;
    setDetailsOpen(open);
    if (state.page) memorize(`details.${state.page.kind}`, open);
  };
  $('format-bar').addEventListener('mousedown', (e) => e.preventDefault());
  $('format-bar').addEventListener('click', (e) => {
    const cmd = e.target.closest('[data-cmd]')?.dataset.cmd;
    if (cmd) editor.command(cmd);
  });
  $('link-btn').onclick = insertLink;
  $('blocks-btn').onclick = openBlockPicker;
  $('image-btn').onclick = () =>
    pickFiles({
      folder: '',
      onUploaded: (items) => {
        const text = items.map(markdownFor).join('\n\n');
        if (text) editor.insertBlockAt(text);
      },
    });
  $('mode-btn').onclick = () => {
    state.rich = !state.rich;
    editor.setRich(state.rich);
    $('mode-btn').textContent = state.rich ? 'Show markdown' : 'Show formatted';
    memorize('rich', state.rich);
    editor.focus();
  };
  if (!remember('rich', true)) $('mode-btn').click();

  document.querySelectorAll('.tab').forEach((tab) => (tab.onclick = () => setSideTab(tab.dataset.tab)));

  $('file-input').onchange = (e) => {
    const files = [...e.target.files];
    if (files.length) uploadFiles(files, state.uploadTarget || {});
  };
  makeDropTarget($('pane-images'), (e) => {
    const head = e.target.closest?.('div')?.closest?.('.image-pane > div');
    return head?.querySelector('.folder-head span')?.textContent.replace(/\/$/, '').replace('This page', '') || '';
  });

  $('phone-btn').onclick = () => {
    const on = $('preview-well').classList.toggle('phone');
    $('phone-btn').classList.toggle('on', on);
    memorize('phone', on);
  };
  if (remember('phone', false)) $('phone-btn').click();

  const applySide = (hidden) => {
    $('workspace').classList.toggle('no-side', hidden);
    $('side-btn').textContent = hidden ? 'Show preview' : 'Hide preview';
    memorize('sideHidden', hidden);
  };
  $('side-btn').onclick = () => applySide(!$('workspace').classList.contains('no-side'));
  applySide(remember('sideHidden', false));

  const width = remember('sideWidth', null);
  if (width) document.documentElement.style.setProperty('--side-width', `${width}px`);
  $('splitter').addEventListener('mousedown', (e) => {
    e.preventDefault();
    const frame = $('preview');
    frame.style.pointerEvents = 'none';
    const move = (m) => {
      const w = Math.min(window.innerWidth - 560, Math.max(280, window.innerWidth - m.clientX));
      document.documentElement.style.setProperty('--side-width', `${w}px`);
      memorize('sideWidth', w);
    };
    const up = () => {
      frame.style.pointerEvents = '';
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  document.addEventListener('keydown', (e) => {
    if (!e.metaKey || e.altKey || e.ctrlKey) return;
    const key = e.key.toLowerCase();
    if (key === 's') {
      e.preventDefault();
      flushSave();
    } else if (key === 'n') {
      e.preventDefault();
      if (!$('modal-root').children.length) newPage();
    }
  });

  // A file dropped anywhere else shouldn't replace the app with that file.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  // Files can change in Obsidian or git while the app is in the background.
  window.addEventListener('focus', () => {
    refreshPages().catch(() => {});
    checkDisk();
  });
  window.addEventListener('pagehide', () => {
    if (!state.dirty || !state.page) return;
    fetch('/api/page', {
      method: 'PUT',
      keepalive: true,
      headers: { 'X-Portfolio': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.page.path, raw: currentRaw(), force: true }),
    });
  });
  // Called by the Mac app just before it quits.
  window.flushForQuit = flushSave;
}

(async function start() {
  wire();
  state.boot = await api('GET', '/api/bootstrap');
  state.blockInfo = await api('GET', '/api/blocks');
  await refreshPages();
  setSideTab('preview');
  const last = remember('last', null);
  if (last === '@site') openSite();
  else if (last && state.pages.some((p) => p.path === last)) openPage(last);
  else openFirstPage();
})().catch((err) => alertBox(`The editor couldn't start: ${err.message}`));
