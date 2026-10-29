// Shared restock history. The repo's GitHub Actions crawler (scripts/crawl.py)
// checks the store hourly and every minute during the Friday drop, and
// publishes every change to data/events.csv. Loaded before content.js.
const HISTORY_URL =
  "https://raw.githubusercontent.com/jnees/montagne-filter-plugin/main/data/events.csv";
const HISTORY_CACHE_KEY = "sharedHistory";
const HISTORY_MAX_AGE_MS = 15 * 60 * 1000;
const HISTORY_TIMEOUT_MS = 8000;
// First crawler snapshot; history before this is unknown.
const TRACKING_SINCE = Date.parse("2026-10-22T03:44:51Z");

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

// Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF or LF.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Event times are when the crawler noticed a change, not when the store made
// it: within a minute or so during the Friday watch, up to about an hour late
// otherwise. Captions only claim the precision the data has.
//
// Folds the event log into per-product facts:
//   firstSeen       when a product first appeared (only products added after tracking began)
//   lastRestocked   when it was last noticed back in stock
//   restockedInDrop whether that was during the Friday drop window
//   lastSoldOut     when it was last noticed sold out
//   lastRunMs       time between those two for its most recent restock
//   lastRunPrecise  true if both were noticed during the drop window (minute checks)
//   restocks        number of restocks seen
//   state           "in" | "out" after the latest event, if known
function buildHistory(text) {
  const [header, ...rows] = parseCsv(text);
  const col = Object.fromEntries((header || []).map((name, i) => [name, i]));
  const byId = {};
  const summary = { new: 0, restocked: 0, soldOut: 0 };
  const weekStartMs = Date.now() - 7 * DAY_MS;

  for (const r of rows) {
    const id = r[col.id];
    const time = Date.parse(r[col.time]);
    if (!id || Number.isNaN(time)) continue;

    if (time >= weekStartMs) {
      switch (r[col.event]) {
        case "new":
          summary.new++;
          break;
        case "restocked":
          summary.restocked++;
          break;
        case "sold_out":
          summary.soldOut++;
          break;
      }
    }

    const h = (byId[id] ||= { restocks: 0, events: [] });
    h.name = h.name || r[col.name];
    const eventName = r[col.event];
    h.events.push({ time, kind: eventName, detail: r[col.detail] || "" });
    switch (eventName) {
      case "new":
        h.firstSeen = time;
        h.state = r[col.detail] === "sold out" ? "out" : "in";
        h.name = h.name || r[col.name];
        break;
      case "restocked":
        h.lastRestocked = time;
        h.restockedInDrop = inDropWindow(new Date(time));
        h.restocks++;
        h.state = "in";
        h.name = h.name || r[col.name];
        break;
      case "sold_out":
        if (h.state === "in" && h.lastRestocked) {
          h.lastRunMs = time - h.lastRestocked;
          h.lastRunPrecise = h.restockedInDrop && inDropWindow(new Date(time));
        }
        h.lastSoldOut = time;
        h.state = "out";
        h.name = h.name || r[col.name];
        break;
    }
  }
  Object.defineProperty(byId, "summary", {
    value: summary,
    enumerable: false,
    configurable: true,
  });
  return byId;
}

// Returns { byId, fetchedAt, stale } or null if no history is available.
// Uses a 15-minute cache, and falls back to the last good copy when offline.
async function loadHistory() {
  let cached;
  try {
    cached = (await chrome.storage.local.get(HISTORY_CACHE_KEY))[HISTORY_CACHE_KEY];
  } catch {
    cached = undefined;
  }
  const fromCache = (stale) => {
    const byId = buildHistory(cached.text);
    return {
      byId,
      summary: byId.summary,
      fetchedAt: cached.fetchedAt,
      stale,
    };
  };
  if (cached && Date.now() - cached.fetchedAt < HISTORY_MAX_AGE_MS) return fromCache(false);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HISTORY_TIMEOUT_MS);
    const res = await fetch(HISTORY_URL, { signal: controller.signal, cache: "no-cache" });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text.startsWith("time,event,id")) throw new Error("unexpected file format");
    cached = { text, fetchedAt: Date.now() };
    await chrome.storage.local.set({ [HISTORY_CACHE_KEY]: cached });
    return fromCache(false);
  } catch (e) {
    console.debug("[Monty Filters] shared history unavailable:", e);
    return cached ? fromCache(true) : null;
  }
}

// The weekly restock is Fridays at 5:00 PM New York time; the crawler checks
// every minute or few from 4:55 to 5:50 PM.
const DROP_MINUTE = 17 * 60;
const WINDOW_START = DROP_MINUTE - 5;
const WINDOW_END = DROP_MINUTE + 50;

// Weekday (0 = Sunday) and minutes since midnight in New York.
function newYorkClock(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return {
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function inDropWindow(date) {
  const { weekday, minutes } = newYorkClock(date);
  return weekday === 5 && minutes >= WINDOW_START && minutes < WINDOW_END;
}

// { live: true } during the drop window, otherwise { live: false, minutes }
// until the next drop.
function nextDrop(now = new Date()) {
  if (inDropWindow(now)) return { live: true };
  const { weekday, minutes } = newYorkClock(now);
  let days = (5 - weekday + 7) % 7;
  if (days === 0 && minutes >= DROP_MINUTE) days = 7;
  return { live: false, minutes: days * 24 * 60 + DROP_MINUTE - minutes };
}

const monthDayFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const fullFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

// "today", "yesterday" or "Oct 23", in the viewer's time zone.
function formatDay(time) {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  if (time >= startOfToday) return "today";
  if (time >= startOfToday - DAY_MS) return "yesterday";
  return monthDayFormat.format(time);
}

// Drops are named by their date in New York, where they happen.
const dropDateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "America/New_York",
});

function describeRestock(h) {
  return h.restockedInDrop
    ? `Restocked in the ${dropDateFormat.format(h.lastRestocked)} drop`
    : `Restocked ${formatDay(h.lastRestocked)}`;
}

// How long a restock lasted. Minute-checked runs get minutes; anything timed
// by an hourly check is rounded and hedged, since it can be about an hour off.
function describeRun(ms, precise) {
  const minutes = Math.max(1, Math.round(ms / MINUTE_MS));
  if (precise && minutes < 60) return `about ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (!precise && minutes < 120) return "under 2 hr";
  if (hours < 48) return `about ${hours} hr`;
  return `about ${Math.round(hours / 24)} days`;
}

function formatCountdown(minutes) {
  const d = Math.floor(minutes / (24 * 60));
  const h = Math.floor((minutes % (24 * 60)) / 60);
  const m = minutes % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}
