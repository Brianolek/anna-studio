# Handoff: read this first

**Who.** Brian (the user) and Anna Douglas, a painter. Brian is building an organizational tool so Anna
follows a fixed daily routine for posting and the rest of her day is painting.

**Rules Brian has set, do not break them:**
- Do not invent content, advice, cadences, or rules. Brian dictates what they do; Claude schedules it.
- Calendar events and task text are robotic and minimal: platform, post type, painting, file. No prose.
- One block per day, at a fixed time, with 1 to 3 tasks in it. Not a feed of slots across the day.
  The three-posts-a-day cadence, reply blocks, and all text currently in data/cadence.json,
  data/post_types.json, data/platforms.json and data/lifecycle.json are PLACEHOLDERS Claude wrote.
  Replace them with Brian's inputs; do not reuse the wording.
- Everything runs on the Mac. No dragging files into chat.

**Inputs still needed from Brian (ask for these, briefly):**
1. Daily block time and length. 2. Tasks per day (1-3). 3. Days off.
4. Rotation: how often each post type happens. 5. Timezone city.
6. Anna's paintings with stages and dates (replace data/works.json examples).
7. Past posts, for a performance evaluation that weights the rotation.

**Platforms:** Threads, Substack, Instagram, TikTok, Facebook, YouTube.
**Post types Brian listed:** finished work; work in progress; studio shot; reference picture vs finished
painting; painting process video; finished work for sale; new prints for sale; print drop; newsletter;
photo shoot; talking to camera. Goals: sell paintings, sell prints, build a fan base.

**What is built (all in this repo):**
- `index.html`, `js/app.js`, `js/engine.js`: planner app. Tabs: Today, Week, Pipeline (paintings and
  stages; dates drive per-painting posts), Library (sorted media), Playbook.
- `tools/ingest.mjs`: sorts photos/videos from a folder by painting and shot type using the Claude API
  (model claude-opus-5-5, structured output). Writes `media/index.json`, files copies under
  `media/<painting>/<type>/`, thumbnails in `media/_thumbs/`. Originals untouched. Needs ffmpeg and
  `.env` with ANTHROPIC_API_KEY. NOT YET RUN ON REAL PHOTOS: first real run is the test.
- `tools/serve.mjs`: local server, `npm start` -> http://localhost:3324, with re-file and sort APIs.
- `tools/schedule_mac.sh`: LaunchAgent that runs the sorter daily. Brian has scheduled it for
  ~/Desktop/Studio at 20:00 (verify with `launchctl list | grep anna`).
- `tools/build_calendar.mjs` + `.github/workflows/site.yml`: ICS feed, GitHub Pages deploy (Pages not
  enabled yet; only needed for the phone-hosted app).
- Google Calendar: Brian connected it in the cloud session (calendar annadouglasartist@gmail.com,
  account timezone is UTC, so set an explicit timezone on events). In a Mac session, connect it again
  or write events through whatever calendar access that session has. Show Brian the schedule as a
  table and get approval before creating events.

**Next steps, in order:** run the sorter once on real photos and fix what it gets wrong; collect the
seven inputs above; rebuild the cadence as one daily block with rotation; write the schedule table;
create calendar events after approval.
