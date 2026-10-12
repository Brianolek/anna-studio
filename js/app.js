import { buildDay, buildRange, addDays, ymd, summary, instructions, weekLoad, validateWorks, STAGES, CAMPAIGN } from './engine.js';

const $ = (s) => document.querySelector(s);
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const state = { data: null, repoWorks: [], date: ymd(new Date()), weekStart: null, tab: 'today' };
const done = LS.get('anna:done', {});
const open = new Set();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function load() {
  const get = (n) => fetch(`data/${n}.json`, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`${n}.json ${r.status}`); return r.json(); });
  const [config, platforms, postTypes, cadence, lifecycle, works] = await Promise.all(['config', 'platforms', 'post_types', 'cadence', 'lifecycle', 'works'].map(get));
  state.repoWorks = works;
  state.data = { config, platforms, postTypes, cadence, lifecycle, works: LS.get('anna:works', null) || works };
  document.title = `${config.artist} · Studio Days`;
  $('#artist').textContent = `${config.artist} · Studio Days`;
  $('#icsUrl').textContent = `${config.siteUrl.replace(/\/?$/, '/')}calendar.ics`;
  state.weekStart = mondayOf(state.date);
  renderAll();
}

function mondayOf(d) { const dt = new Date(d + 'T12:00:00'); const off = (dt.getDay() + 6) % 7; return addDays(d, -off); }
function niceDate(d) { return new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }); }
function shortDate(d) { return new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }

// ---------- Today ----------
function isCountable(e) { return e.kind !== 'ritual'; }
function streak(upTo) {
  let n = 0;
  for (let i = 1; i <= 365; i++) {
    const d = addDays(upTo, -i);
    const evs = buildDay(d, state.data).filter(isCountable);
    if (!evs.length) continue;
    if (evs.every((e) => done[e.id])) n++; else break;
  }
  const todayEvs = buildDay(upTo, state.data).filter(isCountable);
  if (todayEvs.length && todayEvs.every((e) => done[e.id])) n++;
  return n;
}

function renderToday() {
  const d = state.date;
  const today = ymd(new Date());
  const events = buildDay(d, state.data);
  $('#dayname').textContent = d === today ? 'Today' : niceDate(d);
  $('#daymeta').textContent = d === today ? niceDate(d) : d < today ? 'past' : `in ${Math.round((new Date(d) - new Date(today)) / 86400000)} days`;
  const countable = events.filter(isCountable);
  $('#doneCount').textContent = `${countable.filter((e) => done[e.id]).length}/${countable.length}`;
  $('#streak').textContent = streak(today);
  $('#minutes').textContent = events.reduce((a, e) => a + (done[e.id] ? 0 : e.minutes), 0);

  const problems = validateWorks(state.data.works);
  $('#warnings').innerHTML = problems.length ? `<div class="note">${problems.map(esc).join('<br>')}</div>` : '';

  $('#agenda').innerHTML = events.map((e) => `
    <li class="card ${e.kind} ${done[e.id] ? 'done' : ''} ${open.has(e.id) ? 'open' : ''}" data-id="${esc(e.id)}">
      <div class="time">${e.time}</div>
      <div class="main">
        <span class="chip ${e.platform}">${esc(e.platformName)}${e.label ? ' · ' + esc(e.label) : ''}</span>
        <div class="title">${esc(e.typeName)}</div>
        ${e.work ? `<div class="wname">${esc(e.work.title)}</div>` : ''}
        ${e.kind === 'milestone' ? `<div class="why">${esc(e.why)}</div>` : ''}
        ${e.needsWork ? `<div class="warn">No work in the right stage. Update the pipeline or post a studio shot.</div>` : ''}
        <div class="how">${esc(instructions(e, state.data))}</div>
      </div>
      <button class="check ${done[e.id] ? 'on' : ''}" aria-label="Mark done">${done[e.id] ? '✓' : ''}</button>
    </li>`).join('') || '<li class="muted">Nothing scheduled. A day off.</li>';
}

$('#agenda').addEventListener('click', (ev) => {
  const card = ev.target.closest('.card'); if (!card) return;
  const id = card.dataset.id;
  if (ev.target.closest('.check')) {
    if (done[id]) delete done[id];
    else {
      const e = buildDay(state.date, state.data).find((x) => x.id === id);
      done[id] = { t: Date.now(), work: e && e.work ? e.work.id : null, type: e ? e.type : null };
    }
    LS.set('anna:done', done);
    renderToday();
  } else if (ev.target.closest('.main')) {
    if (open.has(id)) open.delete(id); else open.add(id);
    card.classList.toggle('open', open.has(id));
  }
});
$('#prev').onclick = () => { state.date = addDays(state.date, -1); renderToday(); };
$('#next').onclick = () => { state.date = addDays(state.date, 1); renderToday(); };
$('#dayname').onclick = () => { state.date = ymd(new Date()); renderToday(); };

// ---------- Week ----------
function renderWeek() {
  const ws = state.weekStart;
  const today = ymd(new Date());
  $('#weektitle').textContent = `${shortDate(ws)} – ${shortDate(addDays(ws, 6))}`;
  $('#load').innerHTML = weekLoad(ws, state.data).map((l) => {
    const t = l.target || 0;
    const under = t && l.planned < t;
    return `<span class="${under ? 'under' : ''}">${esc(l.platform)} ${l.planned}${t ? ' / ' + t : ''}</span>`;
  }).join('');
  $('#week').innerHTML = buildRange(ws, 7, state.data).map(({ date, events }) => `
    <div class="day">
      <h4 class="${date === today ? 'today' : ''}" data-date="${date}">${shortDate(date)}</h4>
      ${events.map((e) => `<div class="${e.kind === 'milestone' ? 'm' : e.kind === 'ritual' ? 'r' : ''} ${done[e.id] ? 'done' : ''}">${e.time} ${esc(summary(e))}</div>`).join('')}
    </div>`).join('');
}
$('#week').addEventListener('click', (ev) => {
  const h = ev.target.closest('h4'); if (!h) return;
  state.date = h.dataset.date; switchTab('today');
});
$('#wprev').onclick = () => { state.weekStart = addDays(state.weekStart, -7); renderWeek(); };
$('#wnext').onclick = () => { state.weekStart = addDays(state.weekStart, 7); renderWeek(); };

// ---------- Pipeline ----------
function saveWorks() { LS.set('anna:works', state.data.works); renderAll(); }
function coverage(w) {
  const T = new Map(state.data.postTypes.map((t) => [t.id, t]));
  const hits = new Set(Object.values(done).filter((d) => d && d.work === w.id).map((d) => d.type));
  return CAMPAIGN.filter((id) => T.has(id)).map((id) => ({ id, name: T.get(id).name, done: hits.has(id), due: T.get(id).stages.includes(w.stage) }));
}
function rhythm() {
  const { paintingEveryDays: every = 3, campaignDays: span = 14 } = state.data.config;
  const today = ymd(new Date());
  const since = addDays(today, -span);
  const running = state.data.works.filter((w) => w.finished && w.finished >= since && w.finished <= today).length;
  const onEasel = state.data.works.filter((w) => w.stage === 'in-progress').length;
  const expected = Math.ceil(span / every);
  return `One painting every ${every} days means about ${expected} paintings in their ${span}-day content cycle at any time. Right now: ${running} finished in the last ${span} days, ${onEasel} on the easel.` + (running < expected ? ' Behind the rhythm: finish or log a painting.' : '');
}
function renderPipeline() {
  const works = state.data.works;
  const local = !!LS.get('anna:works', null);
  $('#pipelineNote').textContent = (local ? 'Showing edits saved on this device. The calendar feed still uses the repo version until works.json is updated there. ' : '') + rhythm();
  const sel = $('#addWork select');
  if (!sel.options.length) sel.innerHTML = STAGES.map((s) => `<option ${s === 'in-progress' ? 'selected' : ''}>${s}</option>`).join('');
  const groups = STAGES.map((s) => [s, works.filter((w) => w.stage === s)]).filter(([, l]) => l.length);
  $('#pipeline').innerHTML = groups.map(([s, list]) => `
    <div class="stagehead">${s} · ${list.length}</div>
    ${list.map((w) => `
      <div class="work" data-id="${esc(w.id)}">
        <div class="t"><span>${esc(w.title)}</span><button data-act="del">remove</button></div>
        <div class="fields">
          <label>Stage <select data-f="stage">${STAGES.map((x) => `<option ${x === w.stage ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
          <label class="inline"><input type="checkbox" data-f="prints" ${w.prints ? 'checked' : ''}> Prints available</label>
          <label>Started <input type="date" data-f="started" value="${w.started || ''}"></label>
          <label>Finished <input type="date" data-f="finished" value="${w.finished || ''}"></label>
          <label>Listed <input type="date" data-f="listed" value="${w.listed || ''}"></label>
          <label>Drop date <input type="date" data-f="drop" value="${w.drop || ''}"></label>
          <label>Sold <input type="date" data-f="sold" value="${w.sold || ''}"></label>
        </div>
        <div class="cov">${coverage(w).map((c) => `<span class="${c.done ? 'on' : c.due ? 'due' : ''}" title="${esc(c.name)}">${c.done ? '✓ ' : ''}${esc(c.name)}</span>`).join('')}</div>
      </div>`).join('')}`).join('') || '<p class="muted">No works yet. Add one above.</p>';
}
$('#pipeline').addEventListener('change', (ev) => {
  const card = ev.target.closest('.work'); if (!card) return;
  const w = state.data.works.find((x) => x.id === card.dataset.id); if (!w) return;
  const f = ev.target.dataset.f;
  if (f === 'prints') w.prints = ev.target.checked;
  else if (ev.target.value) w[f] = ev.target.value;
  else delete w[f];
  // Keep stage and dates coherent: a finished date implies at least 'finished', a sold date implies 'sold'.
  if (f === 'finished' && w.finished && ['idea', 'in-progress'].includes(w.stage)) w.stage = 'finished';
  if (f === 'listed' && w.listed && ['idea', 'in-progress', 'finished'].includes(w.stage)) w.stage = 'listed';
  if (f === 'sold' && w.sold) w.stage = 'sold';
  if (f === 'stage' && w.stage === 'finished' && !w.finished) w.finished = ymd(new Date());
  if (f === 'stage' && w.stage === 'listed' && !w.listed) w.listed = ymd(new Date());
  if (f === 'stage' && w.stage === 'sold' && !w.sold) w.sold = ymd(new Date());
  saveWorks();
});
$('#pipeline').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-act="del"]'); if (!b) return;
  const card = b.closest('.work');
  const w = state.data.works.find((x) => x.id === card.dataset.id);
  if (w && confirm(`Remove "${w.title}" from the pipeline?`)) { state.data.works = state.data.works.filter((x) => x !== w); saveWorks(); }
});
$('#addWork').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const title = String(fd.get('title')).trim(); if (!title) return;
  const stage = String(fd.get('stage'));
  const id = 'a' + Date.now().toString(36);
  const w = { id, title, stage };
  if (stage === 'idea' || stage === 'in-progress') w.started = ymd(new Date());
  if (['finished', 'listed', 'sold'].includes(stage)) w.finished = ymd(new Date());
  if (['listed', 'sold'].includes(stage)) w.listed = ymd(new Date());
  if (stage === 'sold') w.sold = ymd(new Date());
  state.data.works.push(w);
  ev.target.reset();
  saveWorks();
});
$('#exportWorks').onclick = () => {
  const blob = new Blob([JSON.stringify(state.data.works, null, 2) + '\n'], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'works.json' });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('#resetWorks').onclick = () => {
  if (!confirm('Discard edits on this device and go back to the repo version?')) return;
  LS.del('anna:works'); state.data.works = state.repoWorks; renderAll();
};

// ---------- Playbook ----------
function renderPlaybook() {
  const { platforms, postTypes } = state.data;
  $('#platforms').innerHTML = platforms.map((p) => `
    <div class="pf">
      <h3><span class="chip ${p.id}">${esc(p.name)}</span>${p.enabled === false ? '<span class="off">off</span>' : ''}<span class="k small">${p.targetPerWeek ? p.targetPerWeek + '/wk' : ''} · ${(p.bestWindows || []).join(', ')}</span></h3>
      <p>${esc(p.role)}</p>
      <p><span class="k">Format.</span> ${esc(p.format)}</p>
      ${p.rules && p.rules.length ? `<ul>${p.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    </div>`).join('');
  $('#types').innerHTML = postTypes.map((t) => `
    <div class="pf">
      <h3>${esc(t.name)} <span class="k small">${esc(t.phase)} · ${t.minutes} min · ${t.platforms.join(', ')}</span></h3>
      <p>${esc(t.purpose)}</p>
      ${t.shots && t.shots.length ? `<p><span class="k">Shot.</span> ${t.shots.map(esc).join(' / ')}</p>` : ''}
      ${t.caption ? `<p><span class="k">Caption.</span> ${esc(t.caption)}</p>` : ''}
      ${t.cta ? `<p><span class="k">Ask.</span> ${esc(t.cta)}</p>` : ''}
      ${t.stages.length ? `<p class="k small">Draws from works in stage: ${t.stages.join(', ')}</p>` : ''}
    </div>`).join('');
}
$('#copyIcs').onclick = async () => {
  try { await navigator.clipboard.writeText($('#icsUrl').textContent); $('#copyIcs').textContent = 'Copied'; } catch { $('#copyIcs').textContent = 'Select and copy'; }
};

// ---------- Tabs ----------
function switchTab(name) {
  state.tab = name;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.id === `tab-${name}`));
  renderAll();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));
function renderAll() {
  if (!state.data) return;
  if (state.tab === 'today') renderToday();
  if (state.tab === 'week') renderWeek();
  if (state.tab === 'pipeline') renderPipeline();
  if (state.tab === 'playbook') renderPlaybook();
}

load().catch((err) => { $('#agenda').innerHTML = `<li class="note">Could not load data: ${esc(err.message)}. Serve this folder over http (python3 -m http.server) rather than opening the file directly.</li>`; });
