#!/usr/bin/env node
// Local backend for the Portfolio editor: pages, images, site text, the Hugo
// preview and git publishing. No dependencies beyond Node, Hugo and git.
'use strict';

const http = require('http');
const net = require('net');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const FM = require('./web/fm.js');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

const ROOT = path.resolve(arg('root') || path.join(__dirname, '..'));
const WEB = path.join(__dirname, 'web');
const PREFERRED_PORT = Number(arg('port')) || 47470;
const LIVE_URL = 'https://shaurya.site';
const GITHUB_REPO = 'wtrm3ln/shaurya.site';
const MAX_ASSET_BYTES = 25 * 1024 * 1024; // Cloudflare Pages rejects larger files
const MAX_IMAGE_SIDE = 2400;
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov']);
const CONVERT_EXT = new Set(['.heic', '.heif', '.tif', '.tiff']);

process.env.PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin', process.env.PATH]
  .filter(Boolean)
  .join(':');

let serverPort = PREFERRED_PORT;

// ---- helpers -------------------------------------------------------------

function run(cmd, args, { timeout = 120000, cwd = ROOT, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1', LC_ALL: 'C' };
const git = (...args) => run('git', args, { env: GIT_ENV });

class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Every path the page sends goes through here: relative, inside the site, and
// only under the folders the editor is meant to touch.
function safe(rel, allowed = ['content', 'static']) {
  if (typeof rel !== 'string' || !rel) throw new UserError('Missing path.');
  const abs = path.resolve(ROOT, rel);
  const inside = path.relative(ROOT, abs);
  const top = inside.split(path.sep)[0];
  if (inside.startsWith('..') || path.isAbsolute(inside) || !allowed.includes(top)) {
    throw new UserError(`Not allowed: ${rel}`, 403);
  }
  return abs;
}

const toRel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function writeAtomic(abs, data) {
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, abs);
}

function slugify(text) {
  return (
    String(text)
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/['’"]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled'
  );
}

function localTimestamp(d = new Date()) {
  const pad = (n) => String(Math.abs(Math.trunc(n))).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(off / 60)}:${pad(off % 60)}`
  );
}

async function moveToTrash(abs) {
  const res = await run('/usr/bin/trash', [abs]);
  if (res.code === 0) return;
  // Older macOS has no trash command.
  const dest = path.join(os.homedir(), '.Trash', `${path.basename(abs)}-${Date.now()}`);
  await fsp.rename(abs, dest);
}

async function walk(dir, visit) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) await walk(abs, visit);
    else await visit(abs, e.name);
  }
}

// ---- pages ---------------------------------------------------------------

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  return rows;
}

async function hugoPermalinks() {
  const res = await run('hugo', ['list', 'all'], { timeout: 30000 });
  const map = new Map();
  if (res.code !== 0) return map;
  const rows = parseCsv(res.stdout);
  const header = rows[0] || [];
  const pathCol = header.indexOf('path');
  const linkCol = header.indexOf('permalink');
  for (const row of rows.slice(1)) {
    if (!row[pathCol]) continue;
    let pathname = '';
    try {
      pathname = new URL(row[linkCol]).pathname;
    } catch {}
    map.set(row[pathCol], pathname);
  }
  return map;
}

function classify(rel, fm) {
  const parts = rel.replace(/^content\//, '').split('/');
  const file = parts[parts.length - 1];
  const [top] = parts;
  // A folder whose _index.md says `layout: gallery` is a full-screen image wall.
  if ((file === '_index.md' || file === 'index.md') && FM.get(fm, 'layout') === 'gallery') return 'gallery';
  if (top === 'writing' && parts.length > 1) {
    if (file === '_index.md') return null;
    return FM.isTrue(fm, 'isQuote') || FM.has(fm, 'quote') ? 'quote' : 'writing';
  }
  if (top === 'working' && parts.length > 1) return file === '_index.md' ? null : 'working';
  if (top === 'experimenting' && parts.length > 1) return file === '_index.md' ? null : 'experimenting';
  return 'page';
}

const GROUP = { page: 'Pages', gallery: 'Galleries', writing: 'Writing', quote: 'Writing', working: 'Working', experimenting: 'Experimenting' };

function previewFor(kind, rel, fm, url) {
  const type = FM.get(fm, 'type');
  if (kind === 'working') {
    if (type === 'case-study' || (!type && !FM.isTrue(fm, 'external'))) return { previewUrl: url, ownPage: true };
    return { previewUrl: '/', ownPage: false };
  }
  if (kind === 'experimenting') {
    if (type === 'case-study') return { previewUrl: url, ownPage: true };
    return { previewUrl: '/experimenting/', ownPage: false };
  }
  if (kind === 'quote') return { previewUrl: '/writing/', ownPage: false };
  return { previewUrl: url || '/', ownPage: true };
}

async function navUrls() {
  try {
    const { nav = {} } = JSON.parse(await fsp.readFile(path.join(ROOT, SITE_JSON), 'utf8'));
    const norm = (u) => `/${String(u || '').replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
    return new Set([...(nav.main || []), ...(nav.right || [])].map((l) => norm(l.url)));
  } catch {
    return new Set();
  }
}

async function listPages() {
  const [links, changes, inNav] = await Promise.all([hugoPermalinks(), gitChanges(), navUrls()]);
  const changed = new Map(changes.files.map((f) => [f.path, f.status]));
  const pages = [];
  await walk(path.join(ROOT, 'content'), async (abs, name) => {
    if (!name.endsWith('.md')) return;
    const rel = toRel(abs);
    const raw = await fsp.readFile(abs, 'utf8');
    const { fm } = FM.split(raw);
    const kind = classify(rel, fm);
    if (!kind) return;
    const bundle = name === 'index.md' || name === '_index.md';
    // Hugo's page list leaves out section pages like a gallery's _index.md, but
    // their address is simply their folder.
    const sectionUrl = name === '_index.md' ? `/${rel.replace(/^content\//, '').replace(/_index\.md$/, '')}` : '';
    const url = links.get(rel) || sectionUrl;
    pages.push({
      path: rel,
      kind,
      group: GROUP[kind],
      title: FM.get(fm, 'title') || name.replace(/\.md$/, ''),
      draft: FM.isTrue(fm, 'draft'),
      date: FM.get(fm, 'date'),
      weight: FM.has(fm, 'weight') ? Number(FM.get(fm, 'weight')) : null,
      url,
      bundle,
      change: changed.get(rel) || null,
      // Whether the top menu links to it (galleries are easy to forget to add).
      inNav: inNav.has(`/${url.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/')),
      // Every setting this page uses, so its siblings can offer the same ones.
      settings: FM.keys(fm).map((key) => [key, FM.kindOf(fm, key)]),
      ...previewFor(kind, rel, fm, url),
    });
  });

  // Two pages building to one URL silently overwrite each other.
  const byUrl = new Map();
  for (const p of pages) {
    if (!p.url || !p.ownPage) continue;
    byUrl.set(p.url, [...(byUrl.get(p.url) || []), p]);
  }
  for (const p of pages) {
    const same = byUrl.get(p.url) || [];
    p.clashes = p.ownPage && same.length > 1 ? same.filter((o) => o !== p).map((o) => o.title) : [];
  }

  const byDate = (a, b) => String(b.date).localeCompare(String(a.date));
  pages.sort((a, b) => {
    if (a.group !== b.group) return 0;
    if (a.group === 'Working') {
      const wa = a.weight ?? Infinity;
      const wb = b.weight ?? Infinity;
      return wa - wb || a.title.localeCompare(b.title);
    }
    if (a.group === 'Pages' || a.group === 'Galleries') return a.title.localeCompare(b.title);
    return byDate(a, b);
  });

  return { pages, unpublished: changes.files.length + changes.ahead };
}

async function readPage(rel) {
  const abs = safe(rel, ['content']);
  const [raw, stat] = await Promise.all([fsp.readFile(abs, 'utf8'), fsp.stat(abs)]);
  return { path: rel, raw, mtime: stat.mtimeMs };
}

async function savePage({ path: rel, raw, baseMtime, force }) {
  const abs = safe(rel, ['content']);
  if (!rel.endsWith('.md')) throw new UserError('Only markdown files can be saved.');
  if (!force && baseMtime && (await exists(abs))) {
    const stat = await fsp.stat(abs);
    if (Math.abs(stat.mtimeMs - baseMtime) > 1) {
      const onDisk = await fsp.readFile(abs, 'utf8');
      if (onDisk !== raw) return { conflict: true, raw: onDisk, mtime: stat.mtimeMs };
    }
  }
  await writeAtomic(abs, raw);
  const stat = await fsp.stat(abs);
  return { mtime: stat.mtimeMs };
}

function newPageFile(kind, title) {
  const slug = slugify(title);
  const now = localTimestamp();
  const year = new Date().getFullYear();
  const yamlTitle = FM.quote(title);
  switch (kind) {
    case 'writing':
      return {
        rel: `content/writing/${slug}.md`,
        slug,
        text: `---\ntitle: ${yamlTitle}\ndate: ${now}\ndescription: ""\ntags: []\ncategories: []\nfeaturedImage: ""\nslug: ${slug}\nExcerpt: ""\ndraft: false\n---\n`,
      };
    case 'quote':
      return {
        rel: `content/writing/${slug}.md`,
        slug,
        text: `---\ntitle: ${yamlTitle}\ndate: ${now}\nisQuote: true\nauthor: ${yamlTitle}\nquote: ""\n---\n`,
      };
    case 'working':
      return {
        rel: `content/working/${slug}/index.md`,
        slug,
        text: `---\ntitle: ${yamlTitle}\ndate: ${now}\nyear: ${year}\ntags: []\nfeatured: true\nslug: ${slug}\ndescription: ""\ntype: case-study\ncover: ""\ndraft: false\n---\n`,
      };
    case 'experimenting':
      return {
        rel: `content/experimenting/${slug}/index.md`,
        slug,
        text: `---\ntitle: ${yamlTitle}\ndate: ${now}\nyear: ${year}\ntags: []\nfeatured: true\nslug: ${slug}\ndescription: ""\nexternal: true\nexternalurl: ""\ncover: ""\ndraft: false\n---\n`,
      };
    case 'gallery':
      // A folder of its own: the images go in beside _index.md.
      return { rel: `content/${slug}/_index.md`, slug, text: `---\ntitle: ${yamlTitle}\ndescription: ""\nlayout: gallery\ndraft: false\n---\n` };
    case 'page':
      return { rel: `content/${slug}.md`, slug, text: `---\ntitle: ${yamlTitle}\ndraft: false\nlayout: "expanded"\n---\n` };
    default:
      throw new UserError('Unknown page type.');
  }
}

async function createPage({ kind, title }) {
  if (!title || !title.trim()) throw new UserError('Give it a title.');
  const file = newPageFile(kind, title.trim());
  let rel = file.rel;
  let n = 2;
  while ((await exists(path.join(ROOT, rel))) || (await exists(path.join(ROOT, rel.replace(/\/_?index\.md$/, ''))))) {
    rel = file.rel.replace(file.slug, `${file.slug}-${n}`);
    n += 1;
  }
  const finalSlug = n === 2 ? file.slug : `${file.slug}-${n - 1}`;
  await writeAtomic(path.join(ROOT, rel), file.text.replace(`slug: ${file.slug}\n`, `slug: ${finalSlug}\n`));
  return { path: rel };
}

async function deletePage({ path: rel }) {
  const abs = safe(rel, ['content']);
  const name = path.basename(abs);
  // A page with a folder of its own takes its images with it (but never the
  // whole content folder, if the page happens to sit at its top).
  const ownFolder = (name === 'index.md' || name === '_index.md') && path.dirname(abs) !== path.join(ROOT, 'content');
  await moveToTrash(ownFolder ? path.dirname(abs) : abs);
  return { ok: true };
}

// ---- images --------------------------------------------------------------

function isMedia(name) {
  const ext = path.extname(name).toLowerCase();
  return IMAGE_EXT.has(ext) || VIDEO_EXT.has(ext);
}

const standaloneImageDir = (rel) => {
  const noExt = rel.replace(/^content\//, '').replace(/\.md$/, '');
  return `static/images/${noExt.split('/').map(slugify).join('/')}`;
};

// Where a page's images live: beside it for bundles, under static/ otherwise.
function imageHome(rel) {
  const name = path.basename(rel);
  if (name === 'index.md' || name === '_index.md') {
    const dir = rel.slice(0, -name.length - 1);
    return { dir, makeRef: (fileRel) => fileRel.slice(dir.length + 1) };
  }
  const dir = standaloneImageDir(rel);
  return { dir, makeRef: (fileRel) => `/${fileRel.replace(/^static\//, '')}` };
}

function describeMedia(fileRel, stat, extra = {}) {
  const ext = path.extname(fileRel).toLowerCase();
  return {
    path: fileRel,
    name: path.basename(fileRel),
    url: `/files/${fileRel.split('/').map(encodeURIComponent).join('/')}`,
    size: stat.size,
    mtime: stat.mtimeMs,
    isVideo: VIDEO_EXT.has(ext),
    ...extra,
  };
}

const referenced = (text, ref) => text.toLowerCase().includes(ref.toLowerCase());
// The paintings shortcode shows its whole folder, so those files never get named.
const inPaintingsGrid = (text, ref) => ref.startsWith('paintings/') && text.includes('{{< paintings');
// A gallery page shows every image in its folder, so none of them get named either.
const inGalleryPage = (text, ref) => !ref.includes('/') && /^layout:\s*["']?gallery["']?\s*$/m.test(text);

async function pageMedia(rel) {
  safe(rel, ['content']);
  const { dir, makeRef } = imageHome(rel);
  const raw = await fsp.readFile(path.join(ROOT, rel), 'utf8');
  const items = [];
  const seenFolders = new Set(['']);
  await walk(path.join(ROOT, dir), async (abs, name) => {
    const fileRel = toRel(abs);
    const ref = makeRef(fileRel);
    const folder = ref.startsWith('/') ? '' : path.posix.dirname(ref).replace(/^\.$/, '');
    seenFolders.add(folder);
    if (!isMedia(name)) return;
    const stat = await fsp.stat(abs);
    items.push(describeMedia(fileRel, stat, { ref, folder, used: referenced(raw, ref) || referenced(raw, name) || inPaintingsGrid(raw, ref) || inGalleryPage(raw, ref) }));
  });
  items.sort((a, b) => a.path.localeCompare(b.path));
  return { items, folders: [...seenFolders].sort(), dir };
}

async function allMedia() {
  const pages = [];
  await walk(path.join(ROOT, 'content'), async (abs, name) => {
    if (!name.endsWith('.md')) return;
    const raw = await fsp.readFile(abs, 'utf8');
    pages.push({ rel: toRel(abs), raw, title: FM.get(FM.split(raw).fm, 'title') || name, dir: path.dirname(toRel(abs)), bundle: name === 'index.md' || name === '_index.md' });
  });
  const items = [];
  const collect = async (abs, name) => {
    if (!isMedia(name)) return;
    const fileRel = toRel(abs);
    const stat = await fsp.stat(abs);
    const usedBy = [];
    let owner = null;
    if (fileRel.startsWith('content/')) {
      for (const p of pages) {
        if (!p.bundle || !fileRel.startsWith(`${p.dir}/`)) continue;
        if (!owner || p.dir.length > owner.dir.length) owner = p;
      }
      if (owner) {
        const ref = fileRel.slice(owner.dir.length + 1);
        if (referenced(owner.raw, ref) || referenced(owner.raw, name) || inPaintingsGrid(owner.raw, ref) || inGalleryPage(owner.raw, ref)) usedBy.push({ path: owner.rel, title: owner.title });
      }
    } else {
      const ref = `/${fileRel.replace(/^static\//, '')}`;
      for (const p of pages) if (referenced(p.raw, ref)) usedBy.push({ path: p.rel, title: p.title });
      const home = pages.find((p) => !p.bundle && standaloneImageDir(p.rel) === path.posix.dirname(fileRel));
      if (home) owner = home;
    }
    items.push(describeMedia(fileRel, stat, { usedBy, owner: owner ? { path: owner.rel, title: owner.title } : null, used: usedBy.length > 0 }));
  };
  await walk(path.join(ROOT, 'content'), collect);
  await walk(path.join(ROOT, 'static', 'images'), collect);
  items.sort((a, b) => a.path.localeCompare(b.path));
  return { items, totalBytes: items.reduce((n, i) => n + i.size, 0) };
}

function cleanFileName(name) {
  const ext = path.extname(name).toLowerCase();
  const base = slugify(path.basename(name, path.extname(name)));
  return { base, ext: ext === '.jpeg' ? '.jpg' : ext };
}

async function uniquePath(dirAbs, base, ext) {
  let candidate = path.join(dirAbs, `${base}${ext}`);
  for (let n = 2; await exists(candidate); n++) candidate = path.join(dirAbs, `${base}-${n}${ext}`);
  return candidate;
}

function readBody(req, limit, toFile) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const out = fs.createWriteStream(toFile);
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        req.destroy();
        out.destroy();
        reject(new UserError('That file is too big.', 413));
      }
    });
    req.pipe(out);
    out.on('finish', () => resolve(size));
    out.on('error', reject);
    req.on('error', reject);
  });
}

// Web-ready before it's added: HEIC becomes JPEG, huge photos are shrunk.
async function prepareImage(tmp, ext) {
  let current = tmp;
  let finalExt = ext;
  if (CONVERT_EXT.has(ext)) {
    const converted = `${tmp}.jpg`;
    const res = await run('sips', ['-s', 'format', 'jpeg', tmp, '--out', converted]);
    if (res.code !== 0) throw new UserError(`Could not convert this ${ext} image.`);
    current = converted;
    finalExt = '.jpg';
  }
  if (finalExt === '.jpg' || finalExt === '.png') {
    const size = await run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', current]);
    const w = Number(/pixelWidth: (\d+)/.exec(size.stdout)?.[1] || 0);
    const h = Number(/pixelHeight: (\d+)/.exec(size.stdout)?.[1] || 0);
    if (Math.max(w, h) > MAX_IMAGE_SIDE) await run('sips', ['-Z', String(MAX_IMAGE_SIDE), current]);
  }
  return { file: current, ext: finalExt };
}

async function uploadMedia(req, query) {
  const page = query.get('page');
  const folder = (query.get('folder') || '').split('/').filter((p) => p && p !== '..').map(slugify).join('/');
  const original = query.get('name') || 'image.png';
  safe(page, ['content']);
  const { dir, makeRef } = imageHome(page);
  const { base, ext } = cleanFileName(original);
  if (!IMAGE_EXT.has(ext) && !VIDEO_EXT.has(ext) && !CONVERT_EXT.has(ext)) {
    throw new UserError(`${original} isn't an image or video this site can show.`);
  }
  const tmp = path.join(os.tmpdir(), `portfolio-upload-${process.pid}-${Date.now()}${ext}`);
  try {
    await readBody(req, 500 * 1024 * 1024, tmp);
    const prepared = await prepareImage(tmp, ext);
    const stat = await fsp.stat(prepared.file);
    if (stat.size > MAX_ASSET_BYTES) {
      const mb = (stat.size / 1024 / 1024).toFixed(0);
      throw new UserError(`${original} is ${mb} MB. Cloudflare only accepts files up to 25 MB, so compress it first.`);
    }
    const targetDir = path.join(ROOT, dir, folder);
    await fsp.mkdir(targetDir, { recursive: true });
    const target = await uniquePath(targetDir, base, prepared.ext);
    await fsp.copyFile(prepared.file, target);
    const rel = toRel(target);
    const finalStat = await fsp.stat(target);
    return describeMedia(rel, finalStat, { ref: makeRef(rel), folder });
  } finally {
    await fsp.rm(tmp, { force: true });
    await fsp.rm(`${tmp}.jpg`, { force: true });
  }
}

async function renameMedia({ path: rel, newName }) {
  const abs = safe(rel);
  const { base } = cleanFileName(`${newName}.x`);
  const ext = path.extname(abs).toLowerCase();
  const stem = base.replace(/\.[a-z0-9]+$/, '');
  if (`${stem}${ext}` === path.basename(abs)) return { path: rel };
  const target = await uniquePath(path.dirname(abs), stem, ext);
  await fsp.rename(abs, target);
  const newRel = toRel(target);

  // Update everything that pointed at the old file.
  const oldAbsRef = `/${rel.replace(/^static\//, '')}`;
  const newAbsRef = `/${newRel.replace(/^static\//, '')}`;
  const oldName = path.basename(rel);
  const newFileName = path.basename(newRel);
  const swap = (text, from, to) =>
    text.replace(new RegExp(`(^|[^\\w./-])${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`, 'gm'), `$1${to}`);

  await walk(path.join(ROOT, 'content'), async (mdAbs, name) => {
    if (!name.endsWith('.md')) return;
    const mdRel = toRel(mdAbs);
    const raw = await fsp.readFile(mdAbs, 'utf8');
    let next = raw;
    if (rel.startsWith('static/')) {
      next = swap(raw, oldAbsRef, newAbsRef);
    } else {
      const dir = path.posix.dirname(mdRel);
      const isBundle = name === 'index.md' || name === '_index.md';
      if (isBundle && rel.startsWith(`${dir}/`)) {
        const oldRef = rel.slice(dir.length + 1);
        const newRef = newRel.slice(dir.length + 1);
        next = swap(raw, oldRef, newRef);
        if (oldRef !== oldName) next = next.split(`/${oldName}`).join(`/${newFileName}`);
      }
    }
    if (next !== raw) await writeAtomic(mdAbs, next);
  });

  // A gallery remembers its notes by file name, so follow the rename.
  const metaAbs = path.join(path.dirname(target), GALLERY_FILE);
  if (await exists(metaAbs)) {
    try {
      const meta = JSON.parse(await fsp.readFile(metaAbs, 'utf8'));
      let changed = false;
      for (const item of meta.items || []) {
        if (item.file === oldName) {
          item.file = newFileName;
          changed = true;
        }
      }
      if (changed) await writeAtomic(metaAbs, `${JSON.stringify(meta, null, 2)}\n`);
    } catch {}
  }
  return { path: newRel };
}

// ---- galleries -----------------------------------------------------------

// A gallery page is a folder of images plus one gallery.json beside them that
// holds what the files can't: the order, a title (alt text), and the notes
// pinned on each image (x and y are fractions of its width and height).
const GALLERY_FILE = 'gallery.json';

const clamp01 = (n) => Math.min(1, Math.max(0, Math.round(n * 10000) / 10000));

function cleanNotes(notes) {
  if (!Array.isArray(notes)) return [];
  return notes
    .map((n) => ({ x: Number(n?.x), y: Number(n?.y), text: String(n?.text ?? '').slice(0, 2000) }))
    .filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y) && n.text.trim())
    .map((n) => ({ x: clamp01(n.x), y: clamp01(n.y), text: n.text }));
}

async function galleryFolder(rel) {
  safe(rel, ['content']);
  const name = path.basename(rel);
  if (name !== 'index.md' && name !== '_index.md') throw new UserError('This page has no folder for images.');
  return imageHome(rel).dir;
}

async function readGallery(rel) {
  const dir = await galleryFolder(rel);
  const abs = path.join(ROOT, dir);
  const files = new Map();
  for (const entry of await fsp.readdir(abs, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || entry.name.startsWith('.') || !IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    files.set(entry.name, await fsp.stat(path.join(abs, entry.name)));
  }

  let saved = [];
  try {
    const meta = JSON.parse(await fsp.readFile(path.join(abs, GALLERY_FILE), 'utf8'));
    if (Array.isArray(meta.items)) saved = meta.items;
  } catch {}

  const make = (file, meta = {}) =>
    describeMedia(`${dir}/${file}`, files.get(file), {
      file,
      title: String(meta.title ?? ''),
      notes: cleanNotes(meta.notes),
    });

  // Saved order first; anything new (just added) follows, oldest first.
  const items = [];
  const seen = new Set();
  for (const meta of saved) {
    if (!files.has(meta?.file) || seen.has(meta.file)) continue;
    seen.add(meta.file);
    items.push(make(meta.file, meta));
  }
  const fresh = [...files.keys()].filter((f) => !seen.has(f)).sort((a, b) => files.get(a).mtimeMs - files.get(b).mtimeMs || a.localeCompare(b, undefined, { numeric: true }));
  for (const file of fresh) items.push(make(file));
  return { items, dir };
}

async function writeGallery({ page, items }) {
  const dir = await galleryFolder(page);
  if (!Array.isArray(items)) throw new UserError('Nothing to save.');
  const abs = path.join(ROOT, dir);
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const file = path.basename(String(item?.file ?? ''));
    if (!file || seen.has(file) || !(await exists(path.join(abs, file)))) continue;
    seen.add(file);
    const entry = { file };
    const title = String(item.title ?? '').trim();
    const notes = cleanNotes(item.notes);
    if (title) entry.title = title;
    if (notes.length) entry.notes = notes;
    out.push(entry);
  }
  const target = path.join(abs, GALLERY_FILE);
  if (out.length || (await exists(target))) await writeAtomic(target, `${JSON.stringify({ items: out }, null, 2)}\n`);
  return { ok: true };
}

async function deleteMedia({ path: rel }) {
  const abs = safe(rel);
  if (!isMedia(path.basename(abs))) throw new UserError('That is not an image.');
  await moveToTrash(abs);
  return { ok: true };
}

// ---- blocks --------------------------------------------------------------

// Reads the templates in layouts/shortcodes, so a block added there later turns
// up in the editor on its own.
async function listBlocks() {
  const dir = path.join(ROOT, 'layouts', 'shortcodes');
  const comment = /\{\{-?\s*\/\*([\s\S]*?)\*\/\s*-?\}\}/g;
  const blocks = {};
  for (const file of await fsp.readdir(dir).catch(() => [])) {
    if (!file.endsWith('.html')) continue;
    const src = await fsp.readFile(path.join(dir, file), 'utf8');
    const doc = [...src.matchAll(comment)][0];
    const code = src.replace(comment, '');
    blocks[file.slice(0, -5)] = {
      hasInner: /\.Inner/.test(code),
      params: [...new Set([...code.matchAll(/\.Get\s+"([^"]+)"/g)].map((m) => m[1]))],
      positional: /\.Params\b|\.Get\s+\d/.test(code),
      note: doc ? doc[1].trim().split(/\.\s|\n/)[0] : '',
    };
  }
  return blocks;
}

// ---- site text -----------------------------------------------------------

const SITE_JSON = 'data/site.json';

async function readSite() {
  const abs = path.join(ROOT, SITE_JSON);
  const [raw, stat] = await Promise.all([fsp.readFile(abs, 'utf8'), fsp.stat(abs)]);
  return { data: JSON.parse(raw), mtime: stat.mtimeMs };
}

async function saveSite({ data }) {
  if (!data || typeof data !== 'object') throw new UserError('Nothing to save.');
  const abs = path.join(ROOT, SITE_JSON);
  await writeAtomic(abs, `${JSON.stringify(data, null, 2)}\n`);
  const stat = await fsp.stat(abs);
  return { mtime: stat.mtimeMs };
}

// ---- git -----------------------------------------------------------------

// Editor state and OS clutter that should never reach the site's history.
function isNoise(p) {
  return (
    p.startsWith('content/.obsidian/') ||
    p.startsWith('public/') ||
    p.startsWith('resources/_gen/') ||
    p === '.hugo_build.lock' ||
    p.includes('node_modules/') ||
    path.posix.basename(p) === '.DS_Store'
  );
}

async function gitChanges() {
  const [status, branch, ahead] = await Promise.all([
    git('status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'),
    git('rev-parse', '--abbrev-ref', 'HEAD'),
    git('rev-list', '--count', '@{u}..HEAD'),
  ]);
  const files = [];
  for (const entry of status.stdout.split('\0')) {
    if (!entry) continue;
    const code = entry.slice(0, 2);
    const p = entry.slice(3);
    if (isNoise(p)) continue;
    let state = 'changed';
    if (code === '??' || code[0] === 'A') state = 'new';
    else if (code.includes('D')) state = 'deleted';
    files.push({ path: p, status: state });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    files,
    branch: branch.stdout.trim(),
    ahead: ahead.code === 0 ? Number(ahead.stdout.trim()) : 0,
    gitOk: status.code === 0,
    gitError: status.code === 0 ? '' : status.stderr.trim(),
  };
}

function plainHugoError(text) {
  const lines = text.split('\n').filter((l) => /error/i.test(l));
  return (lines.length ? lines.slice(0, 6).join('\n') : text).replace(new RegExp(ROOT, 'g'), '').trim();
}

async function publish({ paths = [], message }, emit) {
  const changes = await gitChanges();
  const known = new Set(changes.files.map((f) => f.path));
  const chosen = paths.filter((p) => known.has(p));
  if (!chosen.length && !changes.ahead) throw new UserError('Nothing to publish.');
  if (await exists(path.join(ROOT, '.git', 'rebase-merge'))) {
    throw new UserError('Git is in the middle of another operation. Finish or abort it in a terminal first.');
  }

  emit({ step: 'build', state: 'run', text: 'Checking the site builds' });
  const build = await run('hugo', ['--renderToMemory', '--logLevel', 'error'], { timeout: 180000 });
  if (build.code !== 0) {
    emit({ step: 'build', state: 'fail', text: "The site wouldn't build, so nothing was published.", detail: plainHugoError(build.stderr || build.stdout) });
    return;
  }
  emit({ step: 'build', state: 'ok', text: 'Site builds fine' });

  if (chosen.length) {
    emit({ step: 'commit', state: 'run', text: 'Saving a new version' });
    // Git refuses to add a file that's gone from disk and already marked as deleted.
    const present = [];
    const gone = [];
    for (const p of chosen) ((await exists(path.join(ROOT, p))) ? present : gone).push(p);
    let staged = present.length ? await git('add', '-A', '--', ...present) : { code: 0 };
    if (staged.code === 0 && gone.length) staged = await git('rm', '-q', '--cached', '--ignore-unmatch', '--', ...gone);
    const commit = staged.code === 0 ? await git('commit', '-m', message || 'update site', '--', ...chosen) : staged;
    if (commit.code !== 0) {
      emit({ step: 'commit', state: 'fail', text: 'Could not save the new version.', detail: (commit.stderr || commit.stdout).trim() });
      return;
    }
    emit({ step: 'commit', state: 'ok', text: 'New version saved' });
  }

  emit({ step: 'sync', state: 'run', text: 'Getting the latest from GitHub' });
  const pull = await git('pull', '--rebase', '--autostash');
  if (pull.code !== 0) {
    const output = `${pull.stderr}\n${pull.stdout}`;
    const clash = /could not apply|conflict/i.test(output);
    if (clash) await git('rebase', '--abort');
    emit({
      step: 'sync',
      state: 'fail',
      text: clash
        ? 'GitHub has changes that clash with yours. Your version is saved here but not published. Ask Claude Code to sort it out, or run `git pull --rebase` in a terminal.'
        : "Couldn't reach GitHub. Your version is saved here; publish again when you're back online.",
      detail: output.trim(),
    });
    return;
  }
  emit({ step: 'sync', state: 'ok', text: 'Up to date with GitHub' });

  emit({ step: 'push', state: 'run', text: 'Sending to GitHub' });
  const push = await git('push');
  if (push.code !== 0) {
    const auth = /authentication|could not read username|permission denied|403/i.test(push.stderr);
    emit({
      step: 'push',
      state: 'fail',
      text: auth
        ? "GitHub didn't accept your login. Your version is saved here; run `gh auth login` in a terminal, then publish again."
        : "Couldn't reach GitHub. Your version is saved here; publish again when you're back online.",
      detail: push.stderr.trim(),
    });
    return;
  }
  const sha = (await git('rev-parse', 'HEAD')).stdout.trim();
  emit({ step: 'push', state: 'ok', text: 'Sent to GitHub' });
  emit({ done: true, sha });
}

// Cloudflare reports each deploy as a check on the commit.
async function deployStatus(sha) {
  if (!/^[0-9a-f]{7,40}$/.test(sha || '')) throw new UserError('Bad commit id.');
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits/${sha}/check-runs`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'portfolio-editor' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return { state: 'unknown' };
  const { check_runs: runs = [] } = await res.json();
  const cf = runs.find((r) => /cloudflare/i.test(r.name));
  if (!cf) return { state: 'pending' };
  if (cf.status !== 'completed') return { state: 'pending' };
  return { state: cf.conclusion === 'success' ? 'live' : 'failed', url: cf.details_url };
}

async function revertFile({ path: rel }) {
  if (!rel || isNoise(rel)) throw new UserError('Not allowed.');
  const changes = await gitChanges();
  const file = changes.files.find((f) => f.path === rel);
  if (!file) return { ok: true };
  if (file.status === 'new') {
    const headHas = (await git('cat-file', '-e', `HEAD:${rel}`)).code === 0;
    if (!headHas) {
      await git('reset', '-q', '--', rel);
      await moveToTrash(path.join(ROOT, rel));
      return { ok: true };
    }
  }
  const res = await git('restore', '--source=HEAD', '--staged', '--worktree', '--', rel);
  if (res.code !== 0) throw new UserError(res.stderr.trim() || 'Could not undo that.');
  return { ok: true };
}

// ---- hugo preview --------------------------------------------------------

const preview = { port: null, proc: null, stopping: false, log: '' };

function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

async function firstFreePort(start) {
  for (let p = start; p < start + 50; p++) if (await portFree(p)) return p;
  throw new Error('No free port found.');
}

async function startPreview() {
  if (preview.stopping) return;
  preview.port = preview.port || (await firstFreePort(PREFERRED_PORT + 100));
  const args = [
    'server',
    '--bind', '127.0.0.1',
    '--baseURL', 'http://127.0.0.1/',
    '--port', String(preview.port),
    '--buildDrafts',
    '--buildFuture',
    '--noHTTPCache',
    '--disableFastRender',
  ];
  const proc = spawn('hugo', args, { cwd: ROOT, env: process.env });
  preview.proc = proc;
  preview.log = '';
  const collect = (d) => {
    preview.log = (preview.log + d).slice(-4000);
  };
  proc.stdout.on('data', collect);
  proc.stderr.on('data', collect);
  proc.on('error', (err) => collect(`${err.message}\n`));
  proc.on('close', () => {
    preview.proc = null;
    if (!preview.stopping) setTimeout(startPreview, 2000);
  });
}

// Hold the window back until the preview can answer.
async function waitForPreview(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await portFree(preview.port))) return;
    await new Promise((r) => setTimeout(r, 150));
  }
}

// A brand-new page takes Hugo a moment; opening it too soon shows a dead 404.
async function previewReady(url) {
  if (!url || !url.startsWith('/')) throw new UserError('Bad address.');
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const res = await fetch(`http://127.0.0.1:${preview.port}${url}`, { method: 'HEAD' }).catch(() => null);
    if (res && res.status !== 404) return { ready: true };
    await new Promise((r) => setTimeout(r, 200));
  }
  return { ready: false };
}

function shutdown() {
  preview.stopping = true;
  if (preview.proc) preview.proc.kill('SIGTERM');
  setTimeout(() => process.exit(0), 150);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
if (process.argv.includes('--watch-stdin')) {
  // The Mac app holds this pipe open, so the server can't outlive it.
  process.stdin.resume();
  process.stdin.on('end', shutdown);
  process.stdin.on('close', shutdown);
}

// ---- http ----------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 20 * 1024 * 1024) throw new UserError('Too much text at once.', 413);
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function sendFile(res, req, abs) {
  fs.stat(abs, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(abs).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
    };
    if (ext === '.svg') headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      const start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(abs, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    fs.createReadStream(abs).pipe(res);
  });
}

// Only this app's own page may talk to the server: other sites in a browser
// can't send the custom header, and DNS tricks fail the host check.
function trusted(req) {
  const host = req.headers.host || '';
  if (host !== `127.0.0.1:${serverPort}` && host !== `localhost:${serverPort}`) return false;
  const origin = req.headers.origin;
  if (origin && origin !== `http://127.0.0.1:${serverPort}` && origin !== `http://localhost:${serverPort}`) return false;
  return true;
}

async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  const q = url.searchParams;
  if (req.method !== 'GET' && req.headers['x-portfolio'] !== '1') throw new UserError('Refused.', 403);
  switch (route) {
    case 'GET /api/bootstrap':
      return sendJson(res, 200, { hugoPort: preview.port, liveUrl: LIVE_URL, root: ROOT });
    case 'GET /api/pages':
      return sendJson(res, 200, await listPages());
    case 'GET /api/page':
      return sendJson(res, 200, await readPage(q.get('path')));
    case 'PUT /api/page':
      return sendJson(res, 200, await savePage(await readJson(req)));
    case 'POST /api/page':
      return sendJson(res, 200, await createPage(await readJson(req)));
    case 'POST /api/page/delete':
      return sendJson(res, 200, await deletePage(await readJson(req)));
    case 'GET /api/media':
      return sendJson(res, 200, q.get('page') ? await pageMedia(q.get('page')) : await allMedia());
    case 'POST /api/media':
      return sendJson(res, 200, await uploadMedia(req, q));
    case 'POST /api/media/rename':
      return sendJson(res, 200, await renameMedia(await readJson(req)));
    case 'POST /api/media/delete':
      return sendJson(res, 200, await deleteMedia(await readJson(req)));
    case 'GET /api/gallery':
      return sendJson(res, 200, await readGallery(q.get('page')));
    case 'PUT /api/gallery':
      return sendJson(res, 200, await writeGallery(await readJson(req)));
    case 'GET /api/preview-ready':
      return sendJson(res, 200, await previewReady(q.get('url')));
    case 'GET /api/blocks':
      return sendJson(res, 200, await listBlocks());
    case 'GET /api/site':
      return sendJson(res, 200, await readSite());
    case 'PUT /api/site':
      return sendJson(res, 200, await saveSite(await readJson(req)));
    case 'GET /api/changes':
      return sendJson(res, 200, await gitChanges());
    case 'POST /api/revert':
      return sendJson(res, 200, await revertFile(await readJson(req)));
    case 'GET /api/deploy':
      return sendJson(res, 200, await deployStatus(q.get('sha')));
    case 'POST /api/publish': {
      const body = await readJson(req);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
      const emit = (event) => res.write(`${JSON.stringify(event)}\n`);
      try {
        await publish(body, emit);
      } catch (err) {
        emit({ step: 'error', state: 'fail', text: err.message });
      }
      return res.end();
    }
    default:
      throw new UserError('Unknown request.', 404);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (!trusted(req)) {
      res.writeHead(403);
      res.end('Refused');
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      await api(req, res, url);
    } else if (url.pathname.startsWith('/files/')) {
      const rel = decodeURIComponent(url.pathname.slice('/files/'.length));
      sendFile(res, req, safe(rel));
    } else {
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const abs = path.resolve(WEB, rel);
      if (!abs.startsWith(WEB + path.sep)) throw new UserError('Refused.', 403);
      sendFile(res, req, abs);
    }
  } catch (err) {
    const status = err.status || (err.code === 'ENOENT' ? 404 : 500);
    const message = err.code === 'ENOENT' ? 'That file no longer exists.' : err.message;
    if (status >= 500) console.error(err);
    if (!res.headersSent) sendJson(res, status, { error: message });
    else res.end();
  }
});

(async () => {
  serverPort = await firstFreePort(PREFERRED_PORT);
  await startPreview();
  await waitForPreview();
  server.listen(serverPort, '127.0.0.1', () => {
    // The Mac app reads this line to know where to point its window.
    console.log(`READY http://127.0.0.1:${serverPort}/`);
  });
})();
