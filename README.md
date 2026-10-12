# Studio Days — Anna Douglas

A daily operating system for an art career. It answers one question every morning: **what do I post, where, about which work, and how.** Anna paints; this decides the rest.

Lives at `brianolek.github.io/anna-studio/` (GitHub Pages from this repo, branch main). Static, no build step, no backend. Everything is a JSON file she or Brian can edit.

## How it works

```
data/*.json  ──►  js/engine.js  ──►  index.html (phone app: Today / Week / Pipeline / Playbook)
                                └──►  tools/build_calendar.mjs ──► calendar.ics ──► Google Calendar (subscribe once)
```

- **Cadence** (`data/cadence.json`): recurring slots. "Every day 8:00 Threads post, pick from WIP / concept / studio / story." "Mondays 18:00 TikTok process video." "Sunday 17:00 weekly review."
- **Lifecycle** (`data/lifecycle.json`): dated posts generated per painting. Set `finished` and the reveal (3 platforms), painting video and story posts appear. Set `listed` and the for-sale posts (twice) and prints post do. Set `drop` and the teaser (T-7), story (T-3), reminder (T-1, Substack first), drop-live (T0) and last-call (T+2) posts do. At one painting every 3 days these cycles overlap; that overlap is the content ecosystem.
- **Pipeline** (`data/works.json`): the works and their stage: `idea → in-progress → finished → listed → sold`. The engine draws the right work for each post type (WIP posts only pull from in-progress work, reveals from finished, collector posts from sold).
- **Playbook** (`data/post_types.json`, `data/platforms.json`): the how. Purpose, shot list, caption formula, call to action, and format rules per platform. This text shows up in the app and inside every calendar event.

A milestone (drop day, reveal day) takes over the regular slot on that platform, so she is never asked to post twice in one window.

## Daily use (Anna)

1. Open the app on your phone. Add it to the home screen.
2. Today tab: each card is one thing to do, with the time, the platform, the work, and (tap) the how. Check it off when posted.
3. Sunday 17:00: Pipeline tab. Move works to their real stage, set drop dates. Takes 10 minutes. The whole next week reschedules itself.
4. Or ignore the app and live from Google Calendar: every slot is an event with a 10-minute reminder and the instructions in the description.

## Per-painting coverage

The Pipeline tab shows a row under each painting: reference, WIP, video, finished, story, for sale, talking, prints, collector. Green means a post of that kind about that painting was checked off. Red means it is due in the painting's current stage. The Sunday review is: look for red.

## Media library (runs on the Mac)

Anna's photos and videos go into one folder (`inbox/` by default, or any folder such as an iCloud album export). The sorting job files each one by painting and shot type and writes `media/index.json`:

```
node tools/serve.mjs              # starts the app at http://localhost:3324 with the Library tab live
node tools/ingest.mjs             # or press "Sort inbox" in the Library tab
node tools/ingest.mjs --inbox ~/Pictures/Studio --dry   # preview without filing
```

Shot types: reference, wip, finished, detail, process_video, print, studio, photoshoot, other. Sorted copies land in `media/<painting>/<type>/`; originals are untouched. Low-confidence calls are flagged in the Library tab; tap a photo to re-file it. Needs `ANTHROPIC_API_KEY` in the environment and ffmpeg installed (`brew install ffmpeg`).

## Google Calendar

Google Calendar → Other calendars → **+** → **From URL** → `https://brianolek.github.io/anna-studio/calendar.ics`.
Google re-fetches subscribed feeds roughly every 12-24 hours, so a pipeline change shows up in the calendar the next day. The app is always live.

The site and the feed are deployed by `.github/workflows/site.yml` on every push to main, and daily so the 8-week calendar horizon keeps rolling. To rebuild by hand: `node tools/build_calendar.mjs`.

## Editing

- **Add a work**: Pipeline tab → type a title → Add. That saves on the phone only. To get it into the calendar feed, tap *Download works.json* and replace `data/works.json` in the repo (or edit the file directly on GitHub; it is short).
- **Change the schedule**: edit `cadence.json`. Each slot has a `time`, a `platform`, and either a fixed `type` or a `pool` the engine rotates through.
- **Change the advice**: edit `post_types.json` and `platforms.json`. Plain English.
- **Turn a platform off**: `"enabled": false` in `platforms.json`. Its slots disappear everywhere.
- **Timezone**: `config.json`.

Run locally: `python3 -m http.server 3324` from the repo root, open `http://localhost:3324/`.

## What is deliberately not here

No login, no database, no API keys, no posting on her behalf. The platforms punish automated posting and reward a person showing up. This system makes showing up effortless; it does not replace it. Check-offs live in the phone's local storage.
