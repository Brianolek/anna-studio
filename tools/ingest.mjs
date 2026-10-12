#!/usr/bin/env node
// Sorts studio photos and videos by painting and shot type.
//
//   node tools/ingest.mjs                 # reads inbox/, files into media/, updates media/index.json
//   node tools/ingest.mjs --inbox ~/Pictures/Studio --dry
//   node tools/ingest.mjs --list          # print the index as a table
//
// Needs: ffmpeg + ffprobe on PATH (previews, video frames, dates). ImageMagick `convert` or macOS `sips` for HEIC.
// Needs: ANTHROPIC_API_KEY (or an `ant auth login` profile) for classification.
// Originals are never modified. Sorted copies are hardlinks when possible.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const flag = (name) => args.includes(`--${name}`);

const INBOX = path.resolve(opt('inbox', path.join(root, 'inbox')));
const OUT = path.resolve(opt('out', path.join(root, 'media')));
const WORKS = path.resolve(opt('works', path.join(root, 'data', 'works.json')));
const INDEX = path.join(OUT, 'index.json');
const BATCH = Number(opt('batch', 6));
const MODEL = opt('model', 'claude-opus-5-5');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tif', '.tiff']);
const VIDEO_EXT = new Set(['.mov', '.mp4', '.m4v']);
export const SHOT_TYPES = ['reference', 'wip', 'finished', 'detail', 'process_video', 'print', 'studio', 'photoshoot', 'other'];

// ---------- index ----------
function loadJson(p, def) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; } }
function saveJson(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n'); }

const works = loadJson(WORKS, []);
const index = loadJson(INDEX, { files: {}, works: {} });

if (flag('list')) {
  const rows = Object.values(index.files).sort((a, b) => (a.captured || '').localeCompare(b.captured || ''));
  for (const r of rows) console.log([r.captured || '?', (r.work || '_unsorted').padEnd(12), r.shot_type.padEnd(13), r.description, '->', path.relative(root, r.dest)].join('  '));
  console.log(`${rows.length} files`);
  process.exit(0);
}

// ---------- media helpers ----------
function sha1(file) { return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex'); }
function run(cmd, a, allowFail = false) {
  const r = spawnSync(cmd, a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) throw new Error(`${cmd} ${a.join(' ')}\n${r.stderr}`);
  return r;
}
function has(cmd) { return spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0; }

function probe(file) {
  const r = run('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file], true);
  try { return JSON.parse(r.stdout); } catch { return {}; }
}
function capturedAt(file, kind) {
  const p = probe(file);
  const tags = { ...(p.format?.tags || {}), ...((p.streams || [])[0]?.tags || {}) };
  const raw = tags['com.apple.quicktime.creationdate'] || tags.creation_time || tags.DateTimeOriginal || tags['date'];
  if (raw) { const d = new Date(raw); if (!isNaN(d)) return d; }
  if (kind === 'image' && has('identify')) {
    const r = run('identify', ['-quiet', '-format', '%[EXIF:DateTimeOriginal]', `${file}[0]`], true);
    const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(r.stdout || '');
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }
  return fs.statSync(file).mtime;
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-'));
function previewImage(file, i) {
  const out = path.join(tmp, `p${i}.jpg`);
  const ext = path.extname(file).toLowerCase();
  if (ext === '.heic' || ext === '.heif') {
    if (has('sips')) run('sips', ['-s', 'format', 'jpeg', '-Z', '1200', file, '--out', out]);
    else run('convert', [`${file}[0]`, '-auto-orient', '-resize', '1200x1200>', '-quality', '80', out]);
  } else {
    run('ffmpeg', ['-y', '-v', 'error', '-i', file, '-vf', "scale='min(1200,iw)':-2", '-q:v', '4', '-frames:v', '1', out]);
  }
  return [out];
}
function previewVideo(file, i) {
  const dur = Number(probe(file).format?.duration || 0) || 10;
  return [0.1, 0.5, 0.9].map((f, k) => {
    const out = path.join(tmp, `v${i}_${k}.jpg`);
    run('ffmpeg', ['-y', '-v', 'error', '-ss', String(dur * f), '-i', file, '-vf', "scale='min(900,iw)':-2", '-q:v', '5', '-frames:v', '1', out]);
    return out;
  });
}
const b64 = (f) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(f).toString('base64') } });

// ---------- classification ----------
const Result = z.object({
  files: z.array(z.object({
    n: z.number().int(),
    work_id: z.string().nullable(),
    new_work_title: z.string().nullable(),
    shot_type: z.enum(SHOT_TYPES),
    description: z.string(),
    confidence: z.number().min(0).max(1),
  })),
});

const SYSTEM = `You sort a painter's studio photos and videos. For each file decide which painting it shows and what kind of shot it is.
Shot types: reference (source photo, sketch, or subject; not a painting), wip (unfinished painting, on easel or in progress), finished (completed painting, full view), detail (close crop of part of a painting), process_video (video of painting being made or shown), print (a printed reproduction, framed print, or print proof), studio (room, tools, palette, no single painting as subject), photoshoot (styled photo of a finished painting in a room or setting), other.
Known paintings are listed with id, dates, and sometimes a cover image. Match by visual content first, then by capture date against the painting's dates. If a file shows a painting that is not in the list, set work_id null and give new_work_title as a short factual title of the subject. If unsure, work_id null.
description: at most 10 words, factual, no adjectives of praise.`;

async function classify(client, batch) {
  const content = [];
  const known = works.filter((w) => w.stage !== 'archived');
  content.push({ type: 'text', text: 'KNOWN PAINTINGS:\n' + (known.map((w) => `${w.id}: "${w.title}" stage=${w.stage}${w.started ? ' started=' + w.started : ''}${w.finished ? ' finished=' + w.finished : ''}`).join('\n') || '(none yet)') });
  let covers = 0;
  for (const w of known) {
    const cover = index.works[w.id]?.cover;
    if (cover && fs.existsSync(cover) && covers < 12) { content.push({ type: 'text', text: `cover for ${w.id}:` }); content.push(b64(previewCover(cover, covers))); covers++; }
  }
  content.push({ type: 'text', text: `FILES TO SORT (${batch.length}):` });
  batch.forEach((f, i) => {
    content.push({ type: 'text', text: `FILE ${i}: ${path.basename(f.src)} | ${f.kind} | captured ${f.captured.toISOString().slice(0, 16)}${f.kind === 'video' ? ' | 3 frames at 10%, 50%, 90%' : ''}` });
    for (const p of f.previews) content.push(b64(p));
  });
  content.push({ type: 'text', text: 'Return one entry per FILE n.' });

  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{ role: 'user', content }],
    output_config: { format: zodOutputFormat(Result) },
  });
  if (res.stop_reason === 'refusal') throw new Error('classification refused');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return Result.parse(JSON.parse(text)).files;
}
function previewCover(file, i) { const out = path.join(tmp, `c${i}.jpg`); run('ffmpeg', ['-y', '-v', 'error', '-i', file, '-vf', "scale='min(600,iw)':-2", '-q:v', '6', '-frames:v', '1', out]); return out; }

// ---------- main ----------
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name.startsWith('.') ? [] : walk(p);
    const ext = path.extname(e.name).toLowerCase();
    return IMAGE_EXT.has(ext) || VIDEO_EXT.has(ext) ? [p] : [];
  });
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'untitled';
function place(f, r) {
  const work = r.work_id && works.some((w) => w.id === r.work_id) ? r.work_id : null;
  const folder = work || (r.new_work_title ? `_new/${slug(r.new_work_title)}` : '_unsorted');
  const stamp = f.captured.toISOString().slice(0, 16).replace('T', '_').replace(':', '');
  const dest = path.join(OUT, folder, r.shot_type, `${stamp}_${path.basename(f.src)}`);
  return { work, dest };
}

async function main() {
  const files = walk(INBOX);
  const fresh = [];
  for (const src of files) {
    const h = sha1(src);
    if (index.files[h]) continue;
    const kind = VIDEO_EXT.has(path.extname(src).toLowerCase()) ? 'video' : 'image';
    fresh.push({ src, hash: h, kind, captured: capturedAt(src, kind) });
  }
  fresh.sort((a, b) => a.captured - b.captured);
  console.log(`${files.length} files in ${path.relative(root, INBOX) || INBOX}, ${fresh.length} new`);
  if (!fresh.length) return;

  const client = new Anthropic();
  for (let i = 0; i < fresh.length; i += BATCH) {
    const batch = fresh.slice(i, i + BATCH);
    batch.forEach((f, k) => { f.previews = f.kind === 'video' ? previewVideo(f.src, i + k) : previewImage(f.src, i + k); });
    const results = await classify(client, batch);
    for (const r of results) {
      const f = batch[r.n]; if (!f) continue;
      const { work, dest } = place(f, r);
      const thumb = path.join(OUT, '_thumbs', `${f.hash}.jpg`);
      const row = { hash: f.hash, src: f.src, dest, thumb, kind: f.kind, captured: f.captured.toISOString(), work, new_work_title: r.new_work_title, shot_type: r.shot_type, description: r.description, confidence: r.confidence };
      console.log(`${row.captured.slice(0, 10)}  ${(work || (r.new_work_title ? 'NEW: ' + r.new_work_title : '_unsorted')).padEnd(24)} ${r.shot_type.padEnd(13)} ${r.confidence.toFixed(2)}  ${r.description}`);
      if (flag('dry')) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (!fs.existsSync(dest)) { try { fs.linkSync(f.src, dest); } catch { fs.copyFileSync(f.src, dest); } }
      fs.mkdirSync(path.dirname(thumb), { recursive: true });
      fs.copyFileSync(f.previews[f.kind === 'video' ? 1 : 0], thumb);
      index.files[f.hash] = row;
      if (work) {
        index.works[work] ||= { title: works.find((w) => w.id === work).title };
        if (r.shot_type === 'finished' && !index.works[work].cover) index.works[work].cover = dest;
      }
    }
    if (!flag('dry')) saveJson(INDEX, index);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
