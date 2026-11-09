// Front matter helpers shared by the server and the page. Everything works on
// the raw text one key at a time, so comments, quoting and any field the form
// doesn't know about stay exactly as they were.
(function (exports) {
  'use strict';

  const OPEN = /^---[ \t]*\r?\n/;
  const CLOSE = /^---[ \t]*(\r?\n|$)/m;

  function split(raw) {
    const open = OPEN.exec(raw);
    if (!open) return { hasFm: false, fm: '', gap: '', body: raw };
    const rest = raw.slice(open[0].length);
    const close = CLOSE.exec(rest);
    if (!close) return { hasFm: false, fm: '', gap: '', body: raw };
    const fm = rest.slice(0, close.index).replace(/\r?\n$/, '');
    const after = rest.slice(close.index + close[0].length);
    const gap = /^(\r?\n)*/.exec(after)[0];
    return { hasFm: true, fm, gap, body: after.slice(gap.length) };
  }

  function join({ hasFm, fm, gap, body }) {
    if (!hasFm && !fm) return body;
    return `---\n${fm}${fm ? '\n' : ''}---\n${gap || ''}${body}`;
  }

  function keyRe(key) {
    return new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*:(.*)$`, 'mi');
  }

  // The lines belonging to a key: its own line plus any indented or "- " lines.
  function block(fm, key) {
    const m = keyRe(key).exec(fm);
    if (!m) return null;
    const lines = fm.slice(m.index).split('\n');
    let count = 1;
    while (count < lines.length && /^(\s+\S|-\s|-$)/.test(lines[count]) && !/^\S+\s*:/.test(lines[count])) count += 1;
    const text = lines.slice(0, count).join('\n');
    return { start: m.index, end: m.index + text.length, inline: m[1].trim(), lines: lines.slice(1, count) };
  }

  function unquote(value) {
    const v = value.trim();
    if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') {
      try {
        return JSON.parse(v);
      } catch {
        return v.slice(1, -1);
      }
    }
    if (v.length >= 2 && v[0] === "'" && v[v.length - 1] === "'") return v.slice(1, -1).replace(/''/g, "'");
    return v.replace(/\s+#.*$/, '');
  }

  function get(fm, key) {
    const b = block(fm, key);
    if (!b) return '';
    return unquote(b.inline);
  }

  function getList(fm, key) {
    const b = block(fm, key);
    if (!b) return [];
    if (b.inline.startsWith('[')) {
      return b.inline
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map(unquote)
        .filter(Boolean);
    }
    if (b.inline) return [unquote(b.inline)];
    return b.lines.map((l) => unquote(l.replace(/^\s*-\s*/, ''))).filter(Boolean);
  }

  function has(fm, key) {
    return !!block(fm, key);
  }

  function isTrue(fm, key) {
    return get(fm, key).toLowerCase() === 'true';
  }

  // Plain YAML where that's safe, quoted when the text could be misread.
  function quote(value) {
    const v = String(value);
    if (v === '') return '""';
    const risky =
      /^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(v) ||
      /:\s|\s#|:$|\s$|\n/.test(v) ||
      /^(true|false|yes|no|on|off|null|~)$/i.test(v) ||
      /^[-+]?[\d.]+$/.test(v) ||
      /^\d{4}-\d{2}-\d{2}/.test(v);
    return risky ? JSON.stringify(v) : v;
  }

  function write(fm, key, text) {
    const b = block(fm, key);
    if (b) {
      const existing = /^([^:]+?)[ \t]*:/.exec(fm.slice(b.start))[1];
      return fm.slice(0, b.start) + text.replace(/^[^:]+/, existing) + fm.slice(b.end);
    }
    return fm ? `${fm}\n${text}` : text;
  }

  function set(fm, key, value) {
    return write(fm, key, `${key}: ${quote(value)}`);
  }

  // Dates, numbers and booleans are written bare so Hugo reads their real type.
  function setBare(fm, key, value) {
    return write(fm, key, `${key}: ${value}`);
  }

  function setList(fm, key, items) {
    return write(fm, key, `${key}: [${items.map(quote).join(', ')}]`);
  }

  function remove(fm, key) {
    const b = block(fm, key);
    if (!b) return fm;
    const after = fm[b.end] === '\n' ? b.end + 1 : b.end;
    return (fm.slice(0, b.start) + fm.slice(after)).replace(/\n$/, '');
  }

  // Every top-level key, in the order it appears.
  function keys(fm) {
    const out = [];
    for (const line of fm.split('\n')) {
      const m = /^([A-Za-z_][\w.-]*)[ \t]*:/.exec(line);
      if (m && !out.some((k) => k.toLowerCase() === m[1].toLowerCase())) out.push(m[1]);
    }
    return out;
  }

  // Guess what kind of value a key holds, so the form can pick a control.
  function kindOf(fm, key) {
    const b = block(fm, key);
    if (!b) return 'text';
    const v = b.inline.replace(/\s+#.*$/, '');
    if (!v) {
      if (!b.lines.length) return 'text';
      return b.lines.every((l) => /^\s*-(\s|$)/.test(l)) ? 'list' : 'yaml';
    }
    if (v.startsWith('[')) return 'list';
    if (v.startsWith('{') || v === '|' || v === '>' || /^[|>][-+]?$/.test(v)) return 'yaml';
    if (/^(true|false)$/i.test(v)) return 'bool';
    if (/^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) return 'date';
    if (/^[-+]?\d+(\.\d+)?$/.test(v)) return 'barenum';
    const u = unquote(v);
    if (/^#[0-9a-f]{6}$/i.test(u)) return 'color';
    if (/^[\w./ -]+\.(png|jpe?g|gif|webp|avif|svg)$/i.test(u)) return 'image';
    if (u.length > 60) return 'area';
    return 'text';
  }

  // The indented lines under a key, as text, without their shared indent.
  function getBlock(fm, key) {
    const b = block(fm, key);
    if (!b) return '';
    if (!b.lines.length) return b.inline;
    const pad = Math.min(...b.lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)[0].length));
    const body = b.lines.map((l) => l.slice(pad)).join('\n');
    return b.inline ? `${b.inline}\n${body}` : body;
  }

  function setBlock(fm, key, text) {
    const lines = text.replace(/\s+$/, '').split('\n');
    const indent = (ls) => ls.map((l) => (l ? `  ${l}` : l)).join('\n');
    if (/^([|>][-+]?|\{.*\}|\[.*\])$/.test(lines[0].trim())) {
      const rest = lines.slice(1);
      return write(fm, key, `${key}: ${lines[0].trim()}${rest.length ? `\n${indent(rest)}` : ''}`);
    }
    return write(fm, key, `${key}:\n${indent(lines)}`);
  }

  exports.keys = keys;
  exports.kindOf = kindOf;
  exports.getBlock = getBlock;
  exports.setBlock = setBlock;
  exports.split = split;
  exports.join = join;
  exports.get = get;
  exports.getList = getList;
  exports.has = has;
  exports.isTrue = isTrue;
  exports.set = set;
  exports.setBare = setBare;
  exports.setList = setList;
  exports.remove = remove;
  exports.quote = quote;
})(typeof module !== 'undefined' ? module.exports : (window.FM = {}));
