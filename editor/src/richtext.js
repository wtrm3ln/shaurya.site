// The writing surface. The document is always plain markdown, so saving can
// never mangle shortcodes or raw HTML. "Rich" mode only changes how the text is
// drawn: markers hide on every line except the one being edited, like Obsidian.

import { EditorState, EditorSelection, StateField, Compartment } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, keymap, placeholder, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';

const TAG = /\{\{[<%]\s*(\/?)\s*([\w-]+)([\s\S]*?)\s*\/?[%>]\}\}/g;
const ARG = /([\w-]+)=("(?:[^"\\]|\\.)*"|`[^`]*`|[^\s"`]+)|("(?:[^"\\]|\\.)*"|`[^`]*`|[^\s"`]+)/g;

function argValue(raw) {
  if (raw[0] === '"') return raw.slice(1, -1).replace(/\\(.)/g, '$1');
  if (raw[0] === '`') return raw.slice(1, -1);
  return raw;
}

// Every Hugo block tag in the text, with its arguments read out.
export function findTags(text) {
  const tags = [];
  TAG.lastIndex = 0;
  for (let m; (m = TAG.exec(text)); ) {
    const attrs = {};
    const positional = [];
    for (const a of m[3].matchAll(ARG)) {
      if (a[1]) attrs[a[1]] = argValue(a[2]);
      else positional.push(argValue(a[3]));
    }
    tags.push({ from: m.index, to: m.index + m[0].length, raw: m[0], name: m[2], closing: !!m[1], attrs, positional });
  }
  return tags;
}

// Matches opening tags to closing ones and works out what sits inside what.
// A tag is paired only if its closing tag exists, so no list of names is needed.
export function pairTags(tags) {
  const stack = [];
  for (const t of tags) {
    if (!t.closing) {
      stack.push(t);
      continue;
    }
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].name === t.name) {
        stack[i].close = t;
        t.open = stack[i];
        stack.length = i;
        break;
      }
    }
  }
  const open = [];
  for (const t of tags) {
    if (t.closing) {
      if (t.open) open.length = Math.max(0, open.lastIndexOf(t.open));
      t.depth = open.length;
      continue;
    }
    t.parent = open[open.length - 1] || null;
    t.depth = open.length;
    if (t.parent) {
      t.parent.kids = (t.parent.kids || 0) + 1;
      t.index = t.parent.kids;
    }
    if (t.close) open.push(t);
  }
  return tags;
}

class ImageWidget extends WidgetType {
  constructor(src, alt, resolve, caption = '') {
    super();
    this.src = src;
    this.alt = alt;
    this.resolve = resolve;
    this.caption = caption;
  }
  eq(other) {
    return other.src === this.src && other.alt === this.alt && other.caption === this.caption;
  }
  toDOM(view) {
    const box = document.createElement('span');
    box.className = 'md-image';
    const img = document.createElement('img');
    img.alt = this.alt;
    img.src = this.resolve(this.src);
    img.onload = () => view.requestMeasure();
    img.onerror = () => {
      box.classList.add('missing');
      box.textContent = `IMAGE NOT FOUND: ${this.src}`;
      view.requestMeasure();
    };
    box.append(img);

    // The caption sits under the picture, as on the site. Typing in it rewrites
    // the quoted text after the image address in the markdown.
    const cap = document.createElement('input');
    cap.type = 'text';
    cap.className = 'md-caption';
    cap.placeholder = 'Add a caption';
    cap.value = this.caption;
    cap.addEventListener('mousedown', (e) => e.stopPropagation());
    cap.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === 'Escape') cap.blur();
    });
    cap.addEventListener('change', () => {
      const at = view.posAtDOM(box);
      const hit = findImageAt(view.state.doc, at);
      if (!hit) return;
      const next = cap.value.replace(/\s+/g, ' ').trim().replace(/"/g, '\u201D');
      const raw = view.state.doc.sliceString(hit.from, hit.to);
      const m = /^(!\[[^\]]*\]\(\s*<?[^)\s>]+>?)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)$/.exec(raw);
      if (!m) return;
      view.dispatch({ changes: { from: hit.from, to: hit.to, insert: `${m[1]}${next ? ` "${next}"` : ''})` } });
    });
    box.append(cap);
    return box;
  }
  ignoreEvent(event) {
    return event.target instanceof HTMLInputElement;
  }
}

// The markdown image that starts at or just before `pos`.
function findImageAt(doc, pos) {
  const line = doc.lineAt(Math.min(pos, doc.length));
  const re = /!\[[^\]]*\]\([^)]*\)/g;
  let best = null;
  for (let m = re.exec(line.text); m; m = re.exec(line.text)) {
    const from = line.from + m.index;
    if (from <= pos || !best) best = { from, to: from + m[0].length };
  }
  return best;
}

class BlockWidget extends WidgetType {
  constructor(key, tag, opts) {
    super();
    this.key = key;
    this.tag = tag;
    this.opts = opts;
  }
  eq(other) {
    return other.key === this.key;
  }
  toDOM(view) {
    const dom = document.createElement('div');
    dom.className = `md-block${this.tag.depth ? ` md-d${Math.min(this.tag.depth, 3)}` : ''}`;
    dom.append(this.opts.renderBlock(this.tag));
    dom.addEventListener('mousedown', (e) => e.preventDefault());
    dom.addEventListener('click', () => this.opts.onBlockClick(view.posAtDOM(dom)));
    for (const media of dom.querySelectorAll('img, video')) {
      media.addEventListener(media.tagName === 'IMG' ? 'load' : 'loadedmetadata', () => view.requestMeasure());
      media.addEventListener('error', () => view.requestMeasure());
    }
    return dom;
  }
  ignoreEvent() {
    return true;
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'md-bullet';
    span.textContent = '■';
    return span;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'md-rule';
    return span;
  }
}

const hide = Decoration.replace({});
const mark = (cls) => Decoration.mark({ class: cls });
const line = (cls) => Decoration.line({ class: cls });

const HEADINGS = {
  ATXHeading1: 'md-h1', ATXHeading2: 'md-h2', ATXHeading3: 'md-h3',
  ATXHeading4: 'md-h4', ATXHeading5: 'md-h5', ATXHeading6: 'md-h6',
  SetextHeading1: 'md-h1', SetextHeading2: 'md-h2',
};
const INLINE = { StrongEmphasis: 'md-strong', Emphasis: 'md-em', InlineCode: 'md-code', Strikethrough: 'md-strike' };
const HIDDEN_MARKS = new Set(['EmphasisMark', 'CodeMark', 'StrikethroughMark']);

function build(state, opts) {
  const { resolveImage } = opts;
  const out = [];
  const lines = [];
  const add = (from, to, deco) => out.push(deco.range(from, to));
  const doc = state.doc;

  const activeLines = new Set();
  for (const r of state.selection.ranges) {
    const end = doc.lineAt(r.to).number;
    for (let n = doc.lineAt(r.from).number; n <= end; n++) activeLines.add(n);
  }
  const active = (from, to) => {
    const end = doc.lineAt(to).number;
    for (let n = doc.lineAt(from).number; n <= end; n++) if (activeLines.has(n)) return true;
    return false;
  };
  const eachLine = (from, to, deco) => {
    const end = doc.lineAt(to).number;
    for (let n = doc.lineAt(from).number; n <= end; n++) {
      lines.push(deco.range(doc.line(n).from));
    }
  };

  const tree = ensureSyntaxTree(state, doc.length, 200) || syntaxTree(state);
  tree.iterate({
    enter(node) {
      const { name, from, to } = node;
      if (HEADINGS[name]) {
        eachLine(from, to, line(HEADINGS[name]));
      } else if (name === 'HeaderMark') {
        if (!active(from, to)) {
          const text = doc.sliceString(to, to + 1);
          if (doc.sliceString(from, to).startsWith('#')) add(from, text === ' ' ? to + 1 : to, hide);
        }
      } else if (INLINE[name]) {
        add(from, to, mark(INLINE[name]));
      } else if (HIDDEN_MARKS.has(name)) {
        if (!active(from, to)) add(from, to, hide);
      } else if (name === 'Blockquote') {
        eachLine(from, to, line('md-quote'));
      } else if (name === 'QuoteMark') {
        if (!active(from, to)) {
          const text = doc.sliceString(to, to + 1);
          add(from, text === ' ' ? to + 1 : to, hide);
        }
      } else if (name === 'ListMark') {
        const text = doc.sliceString(from, to);
        if (!active(from, to) && /^[-*+]$/.test(text)) add(from, to, Decoration.replace({ widget: new BulletWidget() }));
        else add(from, to, mark('md-listmark'));
      } else if (name === 'HorizontalRule') {
        if (!active(from, to)) add(from, to, Decoration.replace({ widget: new RuleWidget() }));
      } else if (name === 'FencedCode' || name === 'CodeBlock') {
        eachLine(from, to, line('md-codeblock'));
        return false;
      } else if (name === 'Table') {
        eachLine(from, to, line('md-table'));
        return false;
      } else if (name === 'HTMLBlock') {
        eachLine(from, to, line('md-html'));
        return false;
      } else if (name === 'HTMLTag') {
        add(from, to, mark('md-htmltag'));
      } else if (name === 'Link') {
        add(from, to, mark('md-link'));
        if (!active(from, to)) {
          const cursor = node.node.cursor();
          if (cursor.firstChild()) {
            do {
              if (cursor.name === 'LinkMark' || cursor.name === 'URL' || cursor.name === 'LinkTitle' || cursor.name === 'LinkLabel') {
                add(cursor.from, cursor.to, hide);
              }
            } while (cursor.nextSibling());
          }
        }
        return undefined;
      } else if (name === 'Image') {
        const raw = doc.sliceString(from, to);
        const m = /^!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"]*)")?/.exec(raw);
        if (m) {
          const widget = new ImageWidget(m[2], m[1], resolveImage, m[3] || '');
          if (active(from, to)) {
            add(from, to, mark('md-imagesource'));
            out.push(Decoration.widget({ widget, side: 1 }).range(to));
          } else {
            const l = doc.lineAt(from);
            const alone = l.text.trim() === raw && doc.lineAt(to).number === l.number;
            if (alone) add(l.from, l.to, Decoration.replace({ widget, block: true }));
            else add(from, to, Decoration.replace({ widget }));
          }
        }
        return false;
      }
      return undefined;
    },
  });

  // Blocks aren't markdown, so they're found by pattern and drawn on top.
  const text = doc.toString();
  const tags = pairTags(findTags(text));
  const depth = new Map();
  const deepen = (n, d) => depth.set(n, Math.max(depth.get(n) || 0, d));
  const spans = [];
  const blocks = [];
  const covered = new Set();
  for (const t of tags) {
    if (t.depth) deepen(doc.lineAt(t.from).number, t.depth);
    if (t.covered) continue;
    const line_ = doc.lineAt(t.from);
    const sameLine = !t.closing && t.close && doc.lineAt(t.close.to).number === line_.number;
    const end = sameLine ? t.close.to : t.to;
    if (sameLine) {
      t.close.covered = true;
      t.inner = text.slice(t.to, t.close.from);
    } else if (!t.closing && t.close) {
      const last = doc.lineAt(t.close.from).number;
      for (let n = doc.lineAt(t.to).number + 1; n < last; n++) deepen(n, t.depth + 1);
    }
    const endLine = doc.lineAt(end);
    const alone = text.slice(line_.from, t.from).trim() === '' && text.slice(end, endLine.to).trim() === '';
    const from = alone ? line_.from : t.from;
    const to = alone ? endLine.to : end;
    spans.push({ from, to });
    if (active(t.from, end)) {
      blocks.push(mark('md-shortcode').range(t.from, t.to));
      if (sameLine) blocks.push(mark('md-shortcode').range(t.close.from, t.close.to));
    } else {
      const widget = new BlockWidget(`${t.raw}|${t.index || 0}|${t.depth}|${t.inner || ''}`, t, opts);
      blocks.push(Decoration.replace({ widget, block: alone }).range(from, to));
      if (alone) covered.add(line_.number);
    }
  }
  for (const [n, d] of depth) if (!covered.has(n)) lines.push(line(`md-d${Math.min(d, 3)}`).range(doc.line(n).from));
  const outsideBlocks = out.filter((r) => !spans.some((s) => r.from >= s.from && r.to <= s.to));

  return Decoration.set([...outsideBlocks, ...lines, ...blocks], true);
}

function liveMarkdown(opts) {
  return StateField.define({
    create: (state) => build(state, opts),
    update(value, tr) {
      return tr.docChanged || tr.selection ? build(tr.state, opts) : value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

// ---- formatting commands ------------------------------------------------

function toggleWrap(view, open, close = open) {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    let { from, to } = range;
    if (from === to) {
      const word = state.wordAt(from);
      if (word) ({ from, to } = word);
    }
    const inner = state.sliceDoc(from, to);
    const before = state.sliceDoc(from - open.length, from);
    const after = state.sliceDoc(to, to + close.length);
    if (before === open && after === close) {
      return {
        changes: [{ from: from - open.length, to: from }, { from: to, to: to + close.length }],
        range: EditorSelection.range(from - open.length, to - open.length),
      };
    }
    if (inner.startsWith(open) && inner.endsWith(close) && inner.length >= open.length + close.length) {
      return {
        changes: { from, to, insert: inner.slice(open.length, inner.length - close.length) },
        range: EditorSelection.range(from, to - open.length - close.length),
      };
    }
    return {
      changes: [{ from, insert: open }, { from: to, insert: close }],
      range: EditorSelection.range(from + open.length, to + open.length),
    };
  });
  view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: 'input.format' }));
  view.focus();
}

const PREFIX = /^(#{1,6} |> |[-*+] |\d+\. )/;

function setLinePrefix(view, make, matches) {
  const { state } = view;
  const lines = [];
  for (const r of state.selection.ranges) {
    const end = state.doc.lineAt(r.to).number;
    for (let n = state.doc.lineAt(r.from).number; n <= end; n++) {
      const l = state.doc.line(n);
      if (!lines.some((x) => x.number === l.number)) lines.push(l);
    }
  }
  const allOn = lines.every((l) => !l.text.trim() || matches.test(l.text));
  let count = 0;
  const changes = lines.map((l) => {
    const old = PREFIX.exec(l.text);
    const oldLen = old ? old[0].length : 0;
    if (allOn) return { from: l.from, to: l.from + oldLen, insert: '' };
    count += 1;
    return { from: l.from, to: l.from + oldLen, insert: make(count) };
  });
  view.dispatch({ changes, scrollIntoView: true, userEvent: 'input.format' });
  view.focus();
}

const COMMANDS = {
  bold: (v) => toggleWrap(v, '**'),
  italic: (v) => toggleWrap(v, '*'),
  strike: (v) => toggleWrap(v, '~~'),
  code: (v) => toggleWrap(v, '`'),
  h1: (v) => setLinePrefix(v, () => '# ', /^# /),
  h2: (v) => setLinePrefix(v, () => '## ', /^## /),
  h3: (v) => setLinePrefix(v, () => '### ', /^### /),
  h4: (v) => setLinePrefix(v, () => '#### ', /^#### /),
  quote: (v) => setLinePrefix(v, () => '> ', /^> /),
  bullets: (v) => setLinePrefix(v, () => '- ', /^[-*+] /),
  numbers: (v) => setLinePrefix(v, (n) => `${n}. `, /^\d+\. /),
  rule: (v) => insertBlock(v, '---'),
};

function insertBlock(view, text) {
  const { state } = view;
  const pos = state.selection.main.to;
  const l = state.doc.lineAt(pos);
  const needsBefore = l.text.trim() !== '';
  const insert = `${needsBefore ? '\n\n' : ''}${text}\n\n`;
  const at = needsBefore ? l.to : l.from;
  view.dispatch({
    changes: { from: at, to: needsBefore ? at : l.to, insert },
    selection: { anchor: at + insert.length },
    scrollIntoView: true,
    userEvent: 'input.format',
  });
  view.focus();
}

export function create({ parent, onChange, resolveImage, renderBlock, onBlockClick, onFiles, onLink }) {
  const rich = new Compartment();
  const liveField = liveMarkdown({ resolveImage: (src) => resolveImage(src), renderBlock, onBlockClick });
  let view;

  const extensions = () => [
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    placeholder('Start typing…'),
    markdown({ base: markdownLanguage }),
    keymap.of([
      { key: 'Mod-b', run: (v) => (COMMANDS.bold(v), true) },
      { key: 'Mod-i', run: (v) => (COMMANDS.italic(v), true) },
      { key: 'Mod-k', run: () => (onLink(), true) },
      { key: 'Mod-Alt-1', run: (v) => (COMMANDS.h1(v), true) },
      { key: 'Mod-Alt-2', run: (v) => (COMMANDS.h2(v), true) },
      { key: 'Mod-Alt-3', run: (v) => (COMMANDS.h3(v), true) },
      ...markdownKeymap,
      ...historyKeymap,
      indentWithTab,
      ...defaultKeymap,
    ]),
    rich.of([liveField, EditorView.editorAttributes.of({ class: 'is-rich' })]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onChange(u.state.doc.toString());
    }),
    EditorView.domEventHandlers({
      paste(event, v) {
        const files = [...(event.clipboardData?.files || [])];
        if (files.length) {
          event.preventDefault();
          onFiles(files, v.state.selection.main.head);
          return true;
        }
        return false;
      },
      drop(event, v) {
        const files = [...(event.dataTransfer?.files || [])];
        if (files.length) {
          event.preventDefault();
          const pos = v.posAtCoords({ x: event.clientX, y: event.clientY }) ?? v.state.selection.main.head;
          onFiles(files, pos);
          return true;
        }
        return false;
      },
    }),
  ];

  view = new EditorView({ state: EditorState.create({ doc: '', extensions: extensions() }), parent });

  let isRich = true;

  return {
    view,
    getDoc: () => view.state.doc.toString(),
    setDoc(doc) {
      view.setState(EditorState.create({ doc, extensions: extensions() }));
      view.scrollDOM.scrollTop = 0;
      if (!isRich) view.dispatch({ effects: rich.reconfigure([]) });
    },
    focus: () => view.focus(),
    command(name) {
      COMMANDS[name](view);
    },
    setRich(on) {
      isRich = on;
      view.dispatch({
        effects: rich.reconfigure(on ? [liveField, EditorView.editorAttributes.of({ class: 'is-rich' })] : []),
      });
    },
    selectedText() {
      const r = view.state.selection.main;
      return view.state.sliceDoc(r.from, r.to);
    },
    replaceSelection(text) {
      view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true, userEvent: 'input' });
      view.focus();
    },
    replaceRange(from, to, text) {
      view.dispatch({ changes: { from, to, insert: text }, userEvent: 'input' });
      view.focus();
    },
    // Blocks need a blank line either side, or markdown folds them into the text around them.
    insertBlockAt(text, pos) {
      const { doc } = view.state;
      const l = doc.lineAt(pos ?? view.state.selection.main.head);
      const here = l.text.trim() !== '';
      const from = here ? l.to : l.from;
      const to = l.to;
      const prev = here ? l.text : l.number > 1 ? doc.line(l.number - 1).text : '';
      const next = l.number < doc.lines ? doc.line(l.number + 1).text : '';
      const before = here ? '\n\n' : prev.trim() ? '\n' : '';
      const after = next.trim() ? '\n\n' : '\n';
      const insert = `${before}${text}${after}`;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
        scrollIntoView: true,
        userEvent: 'input',
      });
      view.focus();
    },
  };
}
