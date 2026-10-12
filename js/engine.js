// Pure scheduling engine. No DOM, no fetch. Used by the web app and by tools/build_calendar.mjs.
// Given the data files and a date, it answers: what should Anna do today, on which platform, about which work, and how.

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const STAGES = ['idea', 'in-progress', 'finished', 'listed', 'sold', 'archived'];
// The posts every painting should get over its life. Used for the per-work coverage row in the Pipeline tab.
export const CAMPAIGN = ['reference', 'wip', 'process', 'reveal', 'story', 'forsale', 'talking', 'prints', 'collector'];

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0); // local noon: immune to DST edge cases
}

export function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function dayIndex(s) {
  // Whole days since 2000-01-01. Stable rotation key shared by the app and the calendar.
  const [y, m, d] = s.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2000, 0, 1)) / 86400000);
}

export function weekdayKey(s) {
  return DAY_KEYS[parseYmd(s).getDay()];
}

function byId(list) {
  const m = new Map();
  for (const x of list) m.set(x.id, x);
  return m;
}

function pick(list, n) {
  if (!list.length) return null;
  return list[((n % list.length) + list.length) % list.length];
}

function eligibleWorks(type, works) {
  if (!type || !type.stages || !type.stages.length) return [];
  return works.filter((w) => type.stages.includes(w.stage));
}

function describeMilestone(rule, work) {
  const when = rule.offsetDays === 0 ? 'today' : rule.offsetDays < 0 ? `${-rule.offsetDays} days out` : `${rule.offsetDays} days after`;
  return `${rule.anchor} ${when}`;
}

/**
 * Build the agenda for one day.
 * @returns {Array<Event>} sorted by time. Event = { id, date, time, minutes, platform, platformName, type, typeName,
 *   work, label, kind: 'post'|'milestone'|'ritual', why, needsWork }
 */
export function buildDay(date, data) {
  const { platforms, postTypes, cadence, lifecycle, works } = data;
  const P = byId(platforms);
  const T = byId(postTypes);
  const enabled = (pid) => P.get(pid) && P.get(pid).enabled !== false;
  const di = dayIndex(date);
  const dow = weekdayKey(date);
  const events = [];

  // 1. Lifecycle milestones: dated events for specific works (drops, reveals, prints, sold).
  for (const w of works) {
    for (const rule of lifecycle.rules) {
      const anchor = w[rule.anchor];
      if (!anchor) continue;
      if (rule.requires && !w[rule.requires]) continue;
      if (addDays(anchor, rule.offsetDays) !== date) continue;
      const type = T.get(rule.type);
      for (const pid of rule.platforms) {
        if (!enabled(pid)) continue;
        events.push({
          id: `${date}:${rule.id}:${w.id}:${pid}`,
          date,
          time: rule.time || null, // null = takes the day's first regular slot on this platform
          minutes: rule.minutes || (type && type.minutes) || 15,
          platform: pid,
          platformName: P.get(pid).name,
          type: rule.type,
          typeName: type ? type.name : rule.type,
          work: w,
          label: null,
          kind: 'milestone',
          why: `${w.title}: ${describeMilestone(rule, w)}`,
          needsWork: false,
        });
      }
    }
  }

  // 2. Recurring cadence slots. Milestones without a fixed time take over the first post slot on their platform.
  const slots = [...(cadence.daily || []), ...((cadence.weekly || {})[dow] || [])];
  // Rotate through eligible works, but do not show the same work twice in a day while another qualifies.
  const usedToday = new Set(events.filter((e) => e.work).map((e) => e.work.id));
  const chooseWork = (cands, rot) => {
    if (!cands.length) return null;
    const fresh = cands.filter((w) => !usedToday.has(w.id));
    const w = pick(fresh.length ? fresh : cands, rot);
    usedToday.add(w.id);
    return w;
  };
  const active = slots.filter((slot) => enabled(slot.platform) && !(slot.every && Math.floor(di / 7) % slot.every !== (slot.phase || 0)));

  // A milestone on a platform takes over one of that platform's regular post slots instead of adding to it.
  // It prefers a slot whose pool already includes its type (a reveal goes to the Feed slot, not the Story slot).
  const taken = new Set();
  for (const m of events.filter((e) => e.kind === 'milestone')) {
    const cands = active.filter((sl) => sl.pool && sl.platform === m.platform && !taken.has(sl));
    const slot = cands.find((sl) => sl.pool.includes(m.type)) || cands[0];
    if (!slot) continue;
    taken.add(slot);
    if (!m.time) {
      m.time = slot.time;
      m.label = slot.label || null;
    }
  }

  const usedTypes = new Set();
  active.forEach((slot) => {
    if (taken.has(slot)) return;
    const si = slots.indexOf(slot);
    const isPostSlot = !!slot.pool;
    let typeId = slot.type;
    let work = null;
    let needsWork = false;
    if (isPostSlot) {
      const rot = di + si;
      const pool = slot.pool.map((id) => T.get(id)).filter(Boolean);
      // Prefer the rotation pick if it has an eligible work (or needs none) and has not run today; else the first that does.
      const ok = (t) => !t.stages.length || eligibleWorks(t, works).length > 0;
      const fresh = pool.filter((t) => ok(t) && !usedTypes.has(t.id));
      const chosen = fresh.length ? pick(fresh, rot) : pool.find(ok) || pick(pool, rot);
      usedTypes.add(chosen.id);
      typeId = chosen.id;
      work = chooseWork(eligibleWorks(chosen, works), rot);
      needsWork = chosen.stages.length > 0 && !work;
    } else {
      const t = T.get(typeId);
      work = chooseWork(t ? eligibleWorks(t, works) : [], di + si);
      needsWork = !!(t && t.stages.length && !work);
    }
    const type = T.get(typeId);
    const kind = slot.kind || (type && (type.phase === 'Ops' || typeId === 'engage') ? 'ritual' : 'post');
    events.push({
      id: `${date}:${slot.id}:${slot.platform}`,
      date,
      time: slot.time,
      minutes: slot.minutes || (type && type.minutes) || 10,
      platform: slot.platform,
      platformName: P.get(slot.platform).name,
      type: typeId,
      typeName: type ? type.name : typeId,
      work,
      label: slot.label || null,
      kind,
      why: isPostSlot ? 'regular slot' : 'routine',
      needsWork,
    });
  });

  // Any milestone that found no slot gets the platform's first best window.
  for (const e of events) {
    if (e.kind !== 'milestone') continue;
    if (!e.time) {
      const p = P.get(e.platform);
      e.time = (p.bestWindows && p.bestWindows[0]) || '12:00';
    }
  }

  events.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : a.kind === 'milestone' ? -1 : 1));
  return events;
}

export function buildRange(start, days, data) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    out.push({ date: d, events: buildDay(d, data) });
  }
  return out;
}

/** One-line title for an event, e.g. `[Threads] Work in progress: "Red interior"`. */
export function summary(e) {
  const label = e.label ? ` (${e.label})` : '';
  const w = e.work ? `: "${e.work.title}"` : '';
  return `[${e.platformName}${label}] ${e.typeName}${w}`;
}

/** Full plain-text instructions for an event. Shared by the app and the calendar feed. */
export function instructions(e, data) {
  const T = byId(data.postTypes);
  const P = byId(data.platforms);
  const t = T.get(e.type);
  const p = P.get(e.platform);
  const lines = [];
  if (e.kind === 'milestone') lines.push(`WHY TODAY: ${e.why}`);
  if (e.needsWork) lines.push('NO WORK IN THE RIGHT STAGE. Update the pipeline, or post a studio shot instead.');
  if (e.work) {
    const bits = [];
    if (e.work.stage) bits.push(`stage ${e.work.stage}`);
    if (e.work.drop) bits.push(`drop ${e.work.drop}`);
    if (e.work.prints) bits.push('prints');
    if (e.work.notes) bits.push(e.work.notes);
    lines.push(`WORK: ${e.work.title} (${bits.join(', ')})`);
  }
  if (t) {
    if (t.purpose) lines.push(`WHY: ${t.purpose}`);
    if (t.shots && t.shots.length) lines.push(`SHOT: ${t.shots.join(' / ')}`);
    if (t.caption) lines.push(`CAPTION: ${t.caption}`);
    if (t.cta) lines.push(`ASK: ${t.cta}`);
  }
  if (p && p.format) lines.push(`FORMAT (${p.name}): ${p.format}`);
  lines.push(`TIME: about ${e.minutes} min`);
  return lines.join('\n');
}

/** Weekly counts per platform vs targets, for the Week view and the Sunday review. */
export function weekLoad(start, data) {
  const days = buildRange(start, 7, data);
  const counts = {};
  for (const { events } of days) for (const e of events) if (e.kind !== 'ritual') counts[e.platform] = (counts[e.platform] || 0) + 1;
  return data.platforms.filter((p) => p.enabled !== false).map((p) => ({ platform: p.name, planned: counts[p.id] || 0, target: p.targetPerWeek }));
}

/** Loose validation of works.json so a typo surfaces in the UI instead of silently dropping events. */
export function validateWorks(works) {
  const problems = [];
  const seen = new Set();
  for (const w of works) {
    if (!w.id) problems.push(`A work has no id: ${JSON.stringify(w).slice(0, 60)}`);
    else if (seen.has(w.id)) problems.push(`Duplicate id ${w.id}`);
    seen.add(w.id);
    if (!STAGES.includes(w.stage)) problems.push(`${w.id}: unknown stage "${w.stage}" (use ${STAGES.join(', ')})`);
    for (const f of ['started', 'finished', 'listed', 'drop', 'sold']) {
      if (w[f] && !/^\d{4}-\d{2}-\d{2}$/.test(w[f])) problems.push(`${w.id}: ${f} should be YYYY-MM-DD, got "${w[f]}"`);
    }
  }
  return problems;
}
