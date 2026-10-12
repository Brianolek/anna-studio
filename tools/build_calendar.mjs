#!/usr/bin/env node
// Builds anna/calendar.ics from the data files, using the same engine as the web app.
// Run: node anna/tools/build_calendar.mjs   (from the repo root; run automatically by .github/workflows/anna-calendar.yml)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRange, addDays, ymd, summary, instructions } from '../js/engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const load = (n) => JSON.parse(fs.readFileSync(path.join(root, 'data', `${n}.json`), 'utf8'));
const data = { config: load('config'), platforms: load('platforms'), postTypes: load('post_types'), cadence: load('cadence'), lifecycle: load('lifecycle'), works: load('works') };
const tz = data.config.timezone || 'UTC';
const horizon = data.config.calendarHorizonDays || 56;

// Wall-clock time in `tz` -> UTC Date, without any timezone library.
function tzOffsetMs(ts) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ts));
  const o = {}; for (const p of parts) o[p.type] = p.value;
  return Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute, +o.second) - Math.floor(ts / 1000) * 1000;
}
function toUtc(dateStr, hhmm) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let utc = wall - tzOffsetMs(wall);
  const o2 = tzOffsetMs(utc);
  if (wall - o2 !== utc) utc = wall - o2;
  return new Date(utc);
}
const stamp = (dt) => dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const escText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line) {
  // RFC 5545: lines at most 75 octets, continuation lines start with a space.
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out = []; let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) { out.push(cur); cur = ch; } else cur += ch;
  }
  out.push(cur);
  return out.map((l, i) => (i ? ' ' + l : l)).join('\r\n');
}

const start = addDays(ymd(new Date()), -1); // include yesterday so a late-night check still sees the day
const now = stamp(new Date());
const lines = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Studio Days//anna//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
  `X-WR-CALNAME:${escText(data.config.artist)} · Studio Days`, `X-WR-TIMEZONE:${tz}`, 'X-PUBLISHED-TTL:PT12H', 'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
];
let count = 0;
for (const { date, events } of buildRange(start, horizon + 1, data)) {
  for (const e of events) {
    const begin = toUtc(date, e.time);
    const end = new Date(begin.getTime() + e.minutes * 60000);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id.replace(/[^A-Za-z0-9:._-]/g, '_')}@studio-days`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(begin)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${escText(summary(e))}`,
      `DESCRIPTION:${escText(instructions(e, data) + `\n\nOpen the app: ${data.config.siteUrl}`)}`,
      `CATEGORIES:${escText(e.platformName)},${escText(e.kind)}`,
      `URL:${data.config.siteUrl}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escText(summary(e))}`, 'TRIGGER:-PT10M', 'END:VALARM',
      'END:VEVENT',
    );
    count++;
  }
}
lines.push('END:VCALENDAR');
const out = lines.map(fold).join('\r\n') + '\r\n';
fs.writeFileSync(path.join(root, 'calendar.ics'), out);
console.log(`calendar.ics: ${count} events, ${start} + ${horizon} days, ${tz}`);
