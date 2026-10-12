#!/usr/bin/env node
// Local server for the app on the Mac: serves the site and the sorted media, and exposes a small API
// so the Library tab can re-file a photo and run the ingest.
//   node tools/serve.mjs            -> http://localhost:3324
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const PORT = Number(process.env.PORT || 3324);
const MEDIA = path.join(root, 'media');
const INDEX = path.join(MEDIA, 'index.json');
const WORKS = path.join(root, 'data', 'works.json');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.ics': 'text/calendar', '.svg': 'image/svg+xml' };

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n'); };
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
const body = (req) => new Promise((ok) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch { ok({}); } }); });

// Published paths for the browser: /media/... maps to the media folder on disk.
const toUrl = (abs) => (abs && abs.startsWith(MEDIA) ? '/media/' + path.relative(MEDIA, abs).split(path.sep).join('/') : null);
function publicIndex() {
  const idx = readJson(INDEX, { files: {}, works: {} });
  const files = Object.values(idx.files).map((f) => ({ ...f, url: toUrl(f.dest), thumbUrl: toUrl(f.thumb) }));
  return { files, works: idx.works };
}

// Move a sorted file to a new painting / shot type and update the index.
function refile(hash, work, shot_type) {
  const idx = readJson(INDEX, { files: {}, works: {} });
  const f = idx.files[hash]; if (!f) throw new Error('unknown file');
  const works = readJson(WORKS, []);
  const folder = work && works.some((w) => w.id === work) ? work : '_unsorted';
  const dest = path.join(MEDIA, folder, shot_type, path.basename(f.dest));
  if (dest !== f.dest) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.renameSync(f.dest, dest); }
  Object.assign(f, { dest, work: folder === '_unsorted' ? null : folder, shot_type, confidence: 1, reviewed: true });
  if (f.work) { idx.works[f.work] ||= { title: works.find((w) => w.id === f.work).title }; if (shot_type === 'finished' && !idx.works[f.work].cover) idx.works[f.work].cover = dest; }
  writeJson(INDEX, idx);
  return { ...f, url: toUrl(dest), thumbUrl: toUrl(f.thumb) };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/index') return send(res, 200, publicIndex());
    if (url.pathname === '/api/works' && req.method === 'POST') { writeJson(WORKS, await body(req)); return send(res, 200, { ok: true }); }
    if (url.pathname === '/api/refile' && req.method === 'POST') { const { hash, work, shot_type } = await body(req); return send(res, 200, refile(hash, work, shot_type)); }
    if (url.pathname === '/api/ingest' && req.method === 'POST') {
      const { inbox } = await body(req);
      const a = [path.join(root, 'tools', 'ingest.mjs')]; if (inbox) a.push('--inbox', inbox);
      const p = spawn(process.execPath, a, { cwd: root });
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      p.stdout.pipe(res, { end: false }); p.stderr.pipe(res, { end: false });
      p.on('close', (code) => res.end(`\n[exit ${code}]\n`));
      return;
    }
    // static
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch (e) { send(res, 500, { error: e.message }); }
}).listen(PORT, '127.0.0.1', () => console.log(`Studio Days: http://localhost:${PORT}`));
