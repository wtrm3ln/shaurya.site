// Project blocks (the Hugo shortcodes in layouts/shortcodes): how each one looks
// while writing, and the forms that add and change them. A block added to that
// folder later still works here, with a form built from its template.
'use strict';

const BLOCK_GROUPS = ['Numbers & steps', 'Images', 'Layout', 'Extras', 'Your own blocks'];

// These only make sense inside another block, so the picker doesn't list them.
const CHILD_TAGS = new Set(['metric', 'event', 'col']);

const BLOCK_TYPES = {
  metrics: {
    name: 'Metrics',
    group: 'Numbers & steps',
    blurb: 'Big numbers in cards.',
    sketch: ['nnn'],
    rows: {
      child: 'metric',
      start: 3,
      add: 'Add number',
      fields: [
        { key: 'value', label: 'Number', placeholder: '+18%' },
        { key: 'label', label: 'What it is', placeholder: 'conversion' },
      ],
    },
  },
  process: { name: 'Process steps', group: 'Numbers & steps', blurb: 'Steps joined by arrows.', sketch: ['b>b>b'], steps: true },
  timeline: {
    name: 'Timeline',
    group: 'Numbers & steps',
    blurb: 'Events running down the page.',
    sketch: ['.l', '.l', '.l'],
    rows: {
      child: 'event',
      start: 2,
      add: 'Add event',
      fields: [
        { key: 'date', label: 'When', placeholder: 'Week 1' },
        { key: 'title', label: 'Title', placeholder: 'Kickoff' },
        { inner: true, label: 'What happened', placeholder: 'Scoping and interviews.' },
      ],
    },
  },
  figure: {
    name: 'Captioned image',
    group: 'Images',
    blurb: 'One image with a caption.',
    sketch: ['i', 'l'],
    fields: [
      { key: 'src', label: 'Image', type: 'image', required: true },
      { key: 'caption', label: 'Caption' },
      { key: 'alt', label: 'Alt text', note: 'Describes the image for screen readers. Uses the caption if empty.' },
    ],
  },
  gallery: { name: 'Gallery', group: 'Images', blurb: 'A grid of images.', sketch: ['iii', 'iii'], images: true },
  comparison: {
    name: 'Before & after',
    group: 'Images',
    blurb: 'Two images side by side.',
    sketch: ['ii', 'll'],
    fields: [
      { key: 'before', label: 'Before image', type: 'image', required: true },
      { key: 'before-label', label: 'Before label', placeholder: 'Before' },
      { key: 'after', label: 'After image', type: 'image', required: true },
      { key: 'after-label', label: 'After label', placeholder: 'After' },
    ],
  },
  video: {
    name: 'Video',
    group: 'Images',
    blurb: 'A video player.',
    sketch: ['v'],
    fields: [
      { key: 'src', label: 'Video', type: 'video', required: true },
      { key: 'poster', label: 'Still image', type: 'image', note: 'Shown before it plays.' },
      { key: 'autoplay', label: 'Play by itself (silent)', type: 'bool' },
      { key: 'loop', label: 'Loop', type: 'bool' },
      { key: 'muted', label: 'Muted', type: 'bool' },
    ],
  },
  '2col': { name: 'Two columns', group: 'Layout', blurb: 'Side by side, half and half.', sketch: ['tt'], columns: 2 },
  '2col-reverse': { name: 'Two columns, flipped', group: 'Layout', blurb: 'Same, with the sides swapped on desktop.', sketch: ['it'], columns: 2 },
  '3col': { name: 'Three columns', group: 'Layout', blurb: 'Three equal columns.', sketch: ['ttt'], columns: 3 },
  accordion: {
    name: 'Accordion',
    group: 'Extras',
    blurb: 'A section that opens when clicked.',
    sketch: ['l+', 'l+', 'l+'],
    fields: [{ key: 'title', label: 'Title', required: true }],
    inner: { label: 'What it reveals' },
  },
  persona: {
    name: 'Persona',
    group: 'Extras',
    blurb: 'A profile card.',
    sketch: ['ot'],
    fields: [
      { key: 'name', label: 'Name', required: true },
      { key: 'role', label: 'Role' },
      { key: 'image', label: 'Photo', type: 'image' },
    ],
    inner: { label: 'Notes', placeholder: '- Wants a calmer commute' },
  },
  button: {
    name: 'Link button',
    group: 'Extras',
    blurb: 'A button that opens a site.',
    sketch: ['B'],
    fields: [{ key: 'href', label: 'Address', required: true, placeholder: 'https://…' }],
    inner: { label: 'Button text', oneLine: true, placeholder: 'View prototype' },
  },
  paintings: { name: 'Paintings grid', group: 'Extras', blurb: 'Every image in the paintings folder.', sketch: ['iii'], fields: [] },
};

const humanize = (name) => name.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

function blockType(name) {
  if (BLOCK_TYPES[name]) return BLOCK_TYPES[name];
  const info = state.blockInfo[name] || { params: [], hasInner: false, positional: false, note: '' };
  return {
    name: humanize(name),
    group: 'Your own blocks',
    blurb: info.note || 'One of your own blocks.',
    sketch: ['b'],
    fields: info.params.map((key) => ({ key, label: humanize(key) })),
    inner: info.hasInner ? { label: 'Content' } : null,
    steps: info.positional && !info.params.length,
  };
}

// ---- drawing blocks while writing ----------------------------------------

function blockImage(src) {
  const box = el('span', { class: 'bk-image' });
  const img = el('img', {
    src: resolveImage(src, true),
    alt: '',
    onerror: () => box.replaceChildren(`IMAGE NOT FOUND: ${src}`),
  });
  box.classList.add('loaded');
  box.append(img);
  return box;
}

function blockBar(label, detail) {
  return el('div', { class: 'bk-bar', title: 'Click to edit' },
    el('span', { class: 'bk-name' }, label),
    detail ? el('span', { class: 'bk-detail' }, detail) : null,
    el('span', { class: 'bk-edit' }, 'Edit'));
}

const blockBox = (label, detail, ...content) =>
  el('div', { class: 'bk-box', title: 'Click to edit' }, blockBar(label, detail), el('div', { class: 'bk-content' }, content));

function renderBlock(tag) {
  const a = tag.attrs;
  if (tag.closing) return el('div', { class: `bk-end${tag.name === 'col' ? ' small' : ''}`, title: 'Click to edit' });

  switch (tag.name) {
    case 'metric':
      return el('div', { class: 'bk-card', title: 'Click to edit' }, el('b', {}, a.value || '…'), el('span', {}, a.label || ''));
    case 'event':
      return el('div', { class: 'bk-card', title: 'Click to edit' },
        el('b', {}, a.date || '…'),
        el('span', {}, [a.title, tag.inner].filter(Boolean).join(': ')));
    case 'col':
      return el('div', { class: 'bk-col', title: 'Click to edit' }, `Column ${tag.index || ''}`);
    case 'process': {
      const steps = el('div', { class: 'bk-steps' });
      tag.positional.forEach((step, i) => {
        if (i) steps.append(el('span', {}, '→'));
        steps.append(el('span', { class: 'bk-step' }, step));
      });
      return blockBox('Process steps', null, steps);
    }
    case 'figure':
      return blockBox('Captioned image', null, a.src ? blockImage(a.src) : null, a.caption ? el('div', { class: 'bk-caption' }, a.caption) : null);
    case 'comparison':
      return blockBox('Before & after', null,
        el('div', { class: 'bk-pair' },
          el('div', {}, a.before ? blockImage(a.before) : null, el('div', { class: 'bk-caption' }, a['before-label'] || 'Before')),
          el('div', {}, a.after ? blockImage(a.after) : null, el('div', { class: 'bk-caption' }, a['after-label'] || 'After'))));
    case 'video': {
      const video = a.src ? el('video', { src: resolveImage(a.src, true), preload: 'metadata', muted: true, poster: a.poster ? resolveImage(a.poster, true) : '' }) : null;
      return blockBox('Video', a.src, video);
    }
    case 'button':
      return el('div', { class: 'bk-box', title: 'Click to edit' },
        blockBar('Link button', a.href || a.url),
        el('div', { class: 'bk-content' }, el('span', { class: 'bk-fake-button' }, `${tag.inner || 'Button'} ↗`)));
    case 'paintings': {
      const paintings = state.media.items.filter((m) => m.folder === 'paintings' && !m.isVideo);
      return blockBox('Paintings grid', 'Add or remove them in the Images tab',
        el('div', { class: 'bk-thumbs' }, paintings.map((m) => el('img', { src: m.url, alt: '' }))));
    }
    case 'persona':
      return el('div', { class: 'bk-group', title: 'Click to edit' },
        blockBar('Persona', [a.name, a.role].filter(Boolean).join(', ')),
        a.image ? el('div', { class: 'bk-content' }, blockImage(a.image)) : null);
    case 'accordion':
      return blockBar('Accordion', a.title);
    default: {
      const detail = Object.entries(a).map(([k, v]) => `${k}: ${v}`).concat(tag.positional).join(' · ');
      const label = blockType(tag.name).name;
      if (tag.inner) return blockBox(label, detail, tag.inner);
      return blockBar(label, detail);
    }
  }
}

// ---- finding a block in the text -----------------------------------------

function locateBlock(pos) {
  const doc = editor.getDoc();
  const tags = RichText.pairTags(RichText.findTags(doc));
  let tag = tags.find((t) => t.to >= pos);
  if (!tag) return null;
  if (tag.closing) {
    if (!tag.open) return null;
    tag = tag.open;
  }
  while (CHILD_TAGS.has(tag.name) && tag.parent) tag = tag.parent;
  const from = tag.from;
  const to = tag.close ? tag.close.to : tag.to;
  const inner = tag.close ? doc.slice(tag.to, tag.close.from) : '';

  // Anything loose inside (not in a child block) would be lost if rebuilt from a form.
  const kids = tags.filter((t) => !t.closing && t.parent === tag);
  let loose = inner;
  for (const kid of [...kids].reverse()) {
    const start = kid.from - tag.to;
    const end = (kid.close ? kid.close.to : kid.to) - tag.to;
    loose = loose.slice(0, start) + loose.slice(end);
  }
  return {
    open: tag,
    from,
    to,
    raw: doc.slice(from, to),
    inner,
    loose: loose.trim(),
    children: kids.map((kid) => ({ tag: kid, inner: kid.close ? doc.slice(kid.to, kid.close.from) : '' })),
  };
}

const IMAGE_LINE = /^!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?\s*\)$/;

function readValues(name, type, block) {
  const values = { name, attrs: {}, steps: [], inner: '', rows: [], columns: [], images: [], onlyText: false };
  if (!block) {
    if (type.rows) for (let i = 0; i < type.rows.start; i++) values.rows.push({ attrs: {}, inner: '' });
    if (type.steps) values.steps = ['', '', ''];
    if (type.columns) values.columns = Array(type.columns).fill('');
    return values;
  }
  values.attrs = { ...block.open.attrs };
  values.steps = [...block.open.positional];
  values.inner = block.inner.replace(/^\s*\n/, '').replace(/\n\s*$/, '');
  if (type.rows) {
    values.rows = block.children
      .filter((c) => c.tag.name === type.rows.child)
      .map((c) => ({ attrs: { ...c.tag.attrs }, inner: c.inner.trim() }));
    values.onlyText = !!block.loose;
  } else if (type.columns) {
    values.columns = block.children.filter((c) => c.tag.name === 'col').map((c) => c.inner.replace(/^\s*\n/, '').replace(/\n\s*$/, ''));
    values.onlyText = !!block.loose;
  } else if (type.images) {
    const lines = values.inner.split('\n').map((l) => l.trim()).filter(Boolean);
    const parsed = lines.map((l) => IMAGE_LINE.exec(l));
    values.onlyText = parsed.some((m) => !m);
    if (!values.onlyText) values.images = parsed.map((m) => ({ alt: m[1], src: m[2] }));
  }
  return values;
}

function tagText(name, positional, attrs) {
  const quote = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\s*\n\s*/g, ' ')}"`;
  const parts = [name];
  for (const step of positional || []) if (String(step).trim()) parts.push(quote(step.trim()));
  for (const [key, value] of Object.entries(attrs)) if (value !== '' && value != null) parts.push(`${key}=${quote(value)}`);
  return `{{< ${parts.join(' ')} >}}`;
}

function buildBlock(values, type) {
  const { name } = values;
  const end = `{{< /${name} >}}`;
  if (type.steps) return tagText(name, values.steps, values.attrs);
  const open = tagText(name, null, values.attrs);
  if (type.rows) {
    const { child, fields } = type.rows;
    const paired = fields.some((f) => f.inner);
    const rows = values.rows.map((r) => {
      const tag = tagText(child, null, r.attrs);
      return paired ? `  ${tag}${r.inner.trim()}{{< /${child} >}}` : `  ${tag}`;
    });
    return `${open}\n${rows.join('\n')}\n${end}`;
  }
  if (type.columns) {
    const cols = values.columns.map((c) => `  {{< col >}}\n${c.trim()}\n  {{< /col >}}`);
    return `${open}\n${cols.join('\n')}\n${end}`;
  }
  if (type.images) {
    return `${open}\n${values.images.map((i) => `![${i.alt || ''}](${i.src})`).join('\n')}\n${end}`;
  }
  if (type.inner) {
    return type.inner.oneLine ? `${open}${values.inner.trim()}${end}` : `${open}\n${values.inner.trim()}\n${end}`;
  }
  return open;
}

// ---- forms ---------------------------------------------------------------

function mediaSelect(value, onChange, wantVideo) {
  const box = el('div', { class: 'image-field' });
  const matches = (m, v) => {
    const wanted = (v || '').toLowerCase();
    return m.ref?.toLowerCase() === wanted || m.name.toLowerCase() === wanted;
  };
  let current = value;
  const draw = () => {
    const items = state.media.items.filter((m) => !!m.isVideo === !!wantVideo);
    const hit = items.find((m) => matches(m, current));
    box.replaceChildren(
      ...[
        hit && !wantVideo ? el('img', { src: hit.url, alt: '' }) : null,
        el('select', {
          onchange: (e) => {
            current = e.target.value;
            onChange(current);
            draw();
          },
        },
        el('option', { value: '', selected: !current }, '(choose)'),
        items.map((m) => el('option', { value: m.ref, selected: m === hit }, m.ref)),
        current && !hit ? el('option', { value: current, selected: true }, `${current} (not found)`) : null),
        el('button', {
          onclick: () =>
            pickFiles({
              folder: '',
              onUploaded: (added) => {
                if (added[0]) {
                  current = added[0].ref;
                  onChange(current);
                }
                draw();
              },
            }),
        }, 'Add…'),
      ].filter(Boolean),
    );
  };
  draw();
  return box;
}

function blockField(field, attrs) {
  const value = attrs[field.key] ?? '';
  const set = (v) => {
    attrs[field.key] = v;
  };
  let control;
  if (field.type === 'image' || field.type === 'video') control = mediaSelect(value, set, field.type === 'video');
  else if (field.type === 'bool') {
    control = el('input', { type: 'checkbox', checked: value === 'true', onchange: (e) => set(e.target.checked ? 'true' : '') });
  } else control = el('input', { type: 'text', value, placeholder: field.placeholder || '', oninput: (e) => set(e.target.value) });
  return el('div', { class: `field${field.type === 'bool' ? ' check' : ''}` },
    el('label', {}, field.label),
    control,
    field.note ? el('div', { class: 'note' }, field.note) : null);
}

// A list the writer can grow, shrink and reorder. drawRow returns the row's controls.
function editableList(items, makeItem, drawRow, addLabel, min = 0) {
  const box = el('div', { class: 'block-list' });
  const draw = () => {
    box.replaceChildren(
      ...items.map((item, i) =>
        el('div', { class: 'block-list-row' },
          el('div', { class: 'block-list-main' }, drawRow(item, i)),
          el('button', { title: 'Move up', disabled: i === 0, onclick: () => { items.splice(i - 1, 0, items.splice(i, 1)[0]); draw(); } }, '↑'),
          el('button', { title: 'Move down', disabled: i === items.length - 1, onclick: () => { items.splice(i + 1, 0, items.splice(i, 1)[0]); draw(); } }, '↓'),
          el('button', { title: 'Remove', disabled: items.length <= min, onclick: () => { items.splice(i, 1); draw(); } }, '×'))),
      el('button', { onclick: () => { items.push(makeItem()); draw(); } }, addLabel),
    );
  };
  draw();
  return box;
}

function blockControls(values, type) {
  const out = [];
  if (type.columns === 2) {
    out.push(el('div', { class: 'field' },
      el('label', {}, 'Layout'),
      el('select', { onchange: (e) => (values.name = e.target.value) },
        el('option', { value: '2col', selected: values.name === '2col' }, 'Half and half'),
        el('option', { value: '2col-reverse', selected: values.name === '2col-reverse' }, 'Half and half, sides swapped on desktop'))));
  }
  for (const field of type.fields || []) out.push(blockField(field, values.attrs));
  if (type.steps) {
    out.push(el('div', { class: 'subhead' }, 'Steps'),
      editableList(values.steps, () => '', (step, i) =>
        el('input', { type: 'text', value: step, placeholder: `Step ${i + 1}`, oninput: (e) => (values.steps[i] = e.target.value) }), 'Add step', 1));
  }
  if (type.rows) {
    out.push(editableList(values.rows, () => ({ attrs: {}, inner: '' }), (row) =>
      type.rows.fields.map((f) =>
        el('input', {
          type: 'text',
          value: f.inner ? row.inner : row.attrs[f.key] ?? '',
          placeholder: f.placeholder || f.label,
          'aria-label': f.label,
          oninput: (e) => {
            if (f.inner) row.inner = e.target.value;
            else row.attrs[f.key] = e.target.value;
          },
        })), type.rows.add, 1));
  }
  if (type.images) {
    out.push(editableList(values.images, () => ({ alt: '', src: '' }), (image) =>
      mediaSelect(image.src, (v) => (image.src = v)), 'Add image'));
  }
  if (type.columns) {
    values.columns.forEach((col, i) => {
      out.push(el('div', { class: 'subhead' }, `Column ${i + 1}`),
        el('textarea', { rows: 5, value: col, placeholder: 'Text, or an image with ![](file.png)', oninput: (e) => (values.columns[i] = e.target.value) }));
    });
  }
  if (type.inner) {
    const set = (e) => (values.inner = e.target.value);
    out.push(el('div', { class: 'field' },
      el('label', {}, type.inner.label),
      type.inner.oneLine
        ? el('input', { type: 'text', value: values.inner, placeholder: type.inner.placeholder || '', oninput: set })
        : el('textarea', { rows: 5, value: values.inner, placeholder: type.inner.placeholder || '', oninput: set })));
  }
  return out;
}

function missingRequired(values, type) {
  return (type.fields || []).find((f) => f.required && !String(values.attrs[f.key] || '').trim());
}

async function blockForm(name, block) {
  const type = blockType(name);
  const values = readValues(name, type, block);
  const body = el('div', { class: 'block-form' });
  let asText = values.onlyText;
  let rawText = block ? block.raw : '';
  let error = '';

  const draw = () => {
    const parts = [];
    if (error) parts.push(el('div', { class: 'notice warn' }, error));
    if (asText) {
      if (values.onlyText) parts.push(el('p', {}, 'This block has extra content the form can’t show, so it opens as text.'));
      parts.push(el('textarea', { class: 'raw-box', spellcheck: false, value: rawText, oninput: (e) => (rawText = e.target.value) }));
      if (!values.onlyText) parts.push(el('div', { class: 'details-foot' }, el('button', { class: 'flat', onclick: () => { asText = false; draw(); } }, 'Back to the form')));
    } else {
      parts.push(...blockControls(values, type));
      parts.push(el('div', { class: 'details-foot' },
        el('button', { class: 'flat', onclick: () => { rawText = buildBlock(values, type); asText = true; draw(); } }, 'Edit as text')));
    }
    body.replaceChildren(...parts);
  };
  draw();

  const action = await dialog({
    title: block ? `Edit: ${type.name}` : `Add: ${type.name}`,
    body,
    buttons: [
      ...(block ? [{ label: 'Remove block', left: true, value: 'remove' }] : []),
      { label: 'Cancel', value: undefined },
      {
        label: block ? 'Save' : 'Add to page',
        primary: true,
        run: (close) => {
          const missing = !asText && missingRequired(values, type);
          if (missing) {
            error = `${missing.label} is needed.`;
            draw();
            return;
          }
          close('save');
        },
      },
    ],
  });

  if (action === 'remove') editor.replaceRange(block.from, block.to, '');
  if (action !== 'save') return;
  const text = asText ? rawText : buildBlock(values, type);
  if (block) editor.replaceRange(block.from, block.to, text);
  else editor.insertBlockAt(text);
}

function editBlockAt(pos) {
  const block = locateBlock(pos);
  if (block) blockForm(block.open.name, block);
}

// ---- picker --------------------------------------------------------------

const SKETCH_CELLS = { n: 'num', b: 'box', '>': 'arrow', '.': 'dot', l: 'line', i: 'img', v: 'vid', t: 'text', o: 'avatar', '+': 'plus', B: 'btn' };

function blockSketch(rows) {
  return el('div', { class: 'sk' },
    rows.map((row) =>
      el('div', { class: 'sk-row' }, [...row].map((cell) => el('span', { class: `sk-${SKETCH_CELLS[cell]}` })))));
}

async function openBlockPicker() {
  const page = state.page;
  if (!page) return;
  const names = Object.keys(state.blockInfo).filter((n) => !CHILD_TAGS.has(n));
  const ordered = [...Object.keys(BLOCK_TYPES).filter((n) => names.includes(n)), ...names.filter((n) => !BLOCK_TYPES[n])]
    .filter((n) => n !== 'paintings' || state.media.folders.includes('paintings'));

  const styled = page.kind === 'writing' || (page.kind === 'working' && page.ownPage);
  const name = await dialog({
    title: 'Add a block',
    wide: true,
    body: (close) =>
      el('div', {},
        styled ? null : el('p', {}, el('b', {}, 'These are styled for case studies and writing, so they may look plain on this page.')),
        BLOCK_GROUPS.map((group) => {
          const here = ordered.filter((n) => blockType(n).group === group);
          if (!here.length) return null;
          return el('div', {},
            el('div', { class: 'subhead' }, group),
            el('div', { class: 'block-grid' }, here.map((n) => {
              const type = blockType(n);
              return el('button', { class: 'block-card', onclick: () => close(n) },
                blockSketch(type.sketch),
                el('span', { class: 'block-card-name' }, type.name),
                el('span', { class: 'block-card-blurb' }, type.blurb));
            })));
        })),
    buttons: [{ label: 'Cancel', value: undefined }],
  });
  if (!name) return;
  const type = blockType(name);
  const noForm = !type.fields?.length && !type.rows && !type.steps && !type.images && !type.columns && !type.inner;
  if (noForm) editor.insertBlockAt(tagText(name, null, {}));
  else await blockForm(name, null);
}
