# Handoff for the next session

**Goal.** An organizational system for Anna Douglas's art career. Brian (her husband) dictates
what she actually does on each platform; Claude schedules it and creates the events directly on
their shared Google Calendar. Anna paints; the system tells her what to post, where, when, and why.

**What exists in this repo.** A static planner app (index.html, js/engine.js, data/*.json) and a
calendar-feed builder (tools/build_calendar.mjs). The MECHANICS are worth keeping: a painting moves
idea -> in-progress -> finished -> listed -> sold; posts hang off stages and dates; weekly cadence
slots rotate; the whole thing rolls forward as paintings finish (about one every 3 days).

**What to throw out.** All the CONTENT in data/platforms.json, data/post_types.json,
data/cadence.json and data/lifecycle.json was written by Claude as placeholder defaults. Brian said
it was invented and does not reflect what they do. Do not reuse that wording or those rules. Ask
Brian for the real actions, platforms, days, and times, in his words, and build from that only.

**Platforms Anna is on.** Threads, Substack, Instagram, TikTok, Facebook, YouTube.

**Kinds of posts Brian listed.** Finished work; work in progress; studio shots; reference pictures;
work for sale; videos of paintings; print drops; newsletters; slice of life; talking to camera.
Goals: sell finished paintings, sell prints, build a fan base.

**Delivery.** Google Calendar connector was connected right before this handoff. Create events on
the Google Calendar directly (not the .ics feed). Show Brian the proposed schedule in chat first,
then create events after he approves.

**Pending.** Anna's real paintings and stages. Her timezone (config.json says America/New_York, a
guess). GitHub Pages for this repo is not enabled (Settings -> Pages -> Source: GitHub Actions);
only needed if the web app is wanted alongside the calendar.
