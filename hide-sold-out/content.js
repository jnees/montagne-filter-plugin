// Adds a control panel to Montagne product lists: filter by stock, search by
// name, sort, and tag items that are new, recently restocked or recently sold
// out. Tags and history
// captions come from the shared crawler history (history.js) when available,
// combined with this browser's own tracking, which also works offline.
const STOCK_KEY = "stockFilter"; // "in" | "out" | "all"
const LEGACY_HIDE_KEY = "hideSoldOut";
const SORT_KEY = "sortOrder"; // "default" | "name" | "inspiration" | "price" | "restocked" | "soldout"
const RECAP_KEY = "weeklyRecap"; // true when the local report view is active
const SEEN_KEY = "seenItems";
const TAG_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const root = document.documentElement;
const ITEM = ".ProductList-item[data-item-id]";

let stock = "in";
let sort = "default";
let recap = false;
let query = "";
let tagFilter = null; // null | "new" | "restocked" | "sellout"
// While the "Recent restock" or "Recent sellout" chip is on, it picks the stock
// view and sort that suit it (sold-out items, latest sell-outs first, for
// example). These replace the saved choices without overwriting them, and the
// user can still change either for as long as the chip stays on.
let stockOverride = null;
let sortOverride = null;
const TAG_VIEWS = {
  restocked: { stock: "in", sort: "restocked" },
  sellout: { stock: "out", sort: "soldout" },
};
const TAG_LABELS = { restocked: "Recent restock", sellout: "Recent sellout", new: "New" };

function activeStock() {
  return stockOverride || stock;
}

function activeSort() {
  const choice = sortOverride || sort;
  // A saved sort from an older version may no longer exist.
  return choice in COMPARATORS ? choice : "default";
}
let panel;
let localStatus = {}; // id -> { isNew, restockedAt, soldOutAt } from this browser's tracking
let shared = null; // result of loadHistory(), once loaded
let historyRequest = null;

// Default to in-stock only; applied at document_start so hidden items never
// flash. Falls back to the older on/off setting if that's all that's stored.
chrome.storage.local.get(
  { [STOCK_KEY]: null, [LEGACY_HIDE_KEY]: true, [SORT_KEY]: "default", [RECAP_KEY]: false },
  (data) => {
    stock = data[STOCK_KEY] || (data[LEGACY_HIDE_KEY] ? "in" : "all");
    sort = data[SORT_KEY];
    recap = !!data[RECAP_KEY];
    render();
  }
);

chrome.storage.onChanged.addListener((changes) => {
  if (STOCK_KEY in changes) stock = changes[STOCK_KEY].newValue;
  if (SORT_KEY in changes) sort = changes[SORT_KEY].newValue;
  if (RECAP_KEY in changes) recap = !!changes[RECAP_KEY].newValue;
  if (STOCK_KEY in changes || SORT_KEY in changes || RECAP_KEY in changes) render();
});

function isHiddenByStock(item) {
  const soldOut = item.classList.contains("sold-out");
  const view = activeStock();
  return (view === "in" && soldOut) || (view === "out" && !soldOut);
}

function normalize(text) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Records each item's stock state in this browser and notes items that are
// new or restocked since earlier visits (within TAG_WINDOW_MS).
async function trackItems(items) {
  const stored = await chrome.storage.local.get(SEEN_KEY);
  const firstRun = !stored[SEEN_KEY];
  const seen = stored[SEEN_KEY] || {};
  const now = Date.now();

  for (const item of items) {
    const id = item.dataset.itemId;
    const soldOut = item.classList.contains("sold-out");
    let rec = seen[id];
    if (!rec) {
      // Items present on the first run are the baseline, not "new".
      rec = seen[id] = { soldOut, firstSeen: firstRun ? 0 : now };
    } else {
      if (rec.soldOut && !soldOut) rec.restockedAt = now;
      if (!rec.soldOut && soldOut) rec.soldOutAt = now;
      if (soldOut) delete rec.restockedAt;
      if (!soldOut) delete rec.soldOutAt;
      rec.soldOut = soldOut;
    }

    localStatus[id] = {
      isNew: !!rec.firstSeen && now - rec.firstSeen < TAG_WINDOW_MS,
      restockedAt: !soldOut && rec.restockedAt ? rec.restockedAt : null,
      soldOutAt: soldOut && rec.soldOutAt ? rec.soldOutAt : null,
    };
  }

  await chrome.storage.local.set({ [SEEN_KEY]: seen });
}

// Titles look like "CANNOLI INSPIRED BY XERJOFF ITALICA". Parsed once per item.
function itemInfo(item) {
  if (!item.mhsoInfo) {
    const title = item.querySelector(".ProductList-title");
    const text = normalize(title ? title.textContent : item.textContent).trim();
    // Tolerates the site's typos ("isnpired by", "inspired tom ford").
    const [name, inspiration = ""] = text.split(/\s+(?:inspired|isnpired)(?:\s+by)?\s+/);
    // Sale items list both prices; sort by the lower one.
    const priceEl = item.querySelector(".product-price");
    const prices = (priceEl ? priceEl.textContent : "")
      .match(/\d[\d,]*(\.\d+)?/g)?.map((p) => parseFloat(p.replace(/,/g, ""))) || [];
    item.mhsoInfo = {
      text,
      name,
      inspiration,
      price: prices.length ? Math.min(...prices) : Infinity,
    };
  }
  return item.mhsoInfo;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const COMPARATORS = {
  name: (a, b) => collator.compare(a.name, b.name),
  // Items without an "inspired by" part go last.
  inspiration: (a, b) =>
    !a.inspiration - !b.inspiration || collator.compare(a.inspiration, b.inspiration),
  price: (a, b) => a.price - b.price,
  // Most recent restock first; never-restocked items keep default order last.
  restocked: (a, b) => (b.restockedAt || 0) - (a.restockedAt || 0),
  // Currently sold-out items, most recent sell-out first. Items sold out since
  // before tracking began follow, then in-stock items (default order).
  soldout: (a, b) => (b.soldOutRank || 0) - (a.soldOutRank || 0),
};

// Reorders visually via flex `order`, leaving the site's DOM untouched.
// Ties keep the site's default order because Array#sort is stable.
function applySort(items) {
  const compare = COMPARATORS[activeSort()];
  if (!compare) {
    for (const item of items) item.style.removeProperty("order");
    return;
  }
  [...items]
    .sort((a, b) => compare(itemInfo(a), itemInfo(b)))
    .forEach((item, i) => item.style.setProperty("order", String(i)));
}

// Decides each card's tags, caption and sort times.
//
// With the shared history loaded, it is the only source: the crawler checks
// hourly, while this browser only notices changes when the user visits, and
// records them at that moment. (A restock that happened before tracking began
// would otherwise look brand new on the user's next visit.) A product with no
// shared events hasn't changed since tracking began.
//
// The page itself is newer than the shared file, so a mismatch between the two
// means the item changed since the file was published; this browser's record
// then supplies the time, if it noticed the change after the last shared event.
//
// Without the shared history (offline, GitHub down), this browser's record is
// used on its own, as in earlier versions.
function itemStatus(item) {
  const id = item.dataset.itemId;
  const soldOut = item.classList.contains("sold-out");
  const now = Date.now();
  const local = localStatus[id] || {};
  const status = { isNew: false, restockedAt: null, soldOutAt: null, caption: "", title: "" };
  if (!shared) {
    Object.assign(status, {
      isNew: !!local.isNew,
      restockedAt: local.restockedAt,
      soldOutAt: local.soldOutAt,
    });
    return finishStatus(status, soldOut, now);
  }
  const h = shared.byId[id];
  if (!h) return finishStatus(status, soldOut, now);
  const lastSharedEvent = Math.max(h.lastRestocked || 0, h.lastSoldOut || 0, h.firstSeen || 0);
  const noticedSince = (time) => (time && time > lastSharedEvent ? time : now);

  if (h.firstSeen && now - h.firstSeen < TAG_WINDOW_MS) status.isNew = true;
  if (!soldOut) {
    if (h.state === "out") {
      status.restockedAt = noticedSince(local.restockedAt);
      status.caption = "Restocked today";
      status.title = "Back in stock since the last shared update";
    } else if (h.lastRestocked) {
      status.restockedAt = h.lastRestocked;
      status.caption = describeRestock(h);
      status.title = `First seen back in stock: ${fullFormat.format(h.lastRestocked)}`;
    }
  } else if (h.state === "in" && h.lastRestocked) {
    status.soldOutAt = noticedSince(local.soldOutAt);
    status.caption = `Sold out today · lasted ${describeRun(now - h.lastRestocked, false)}`;
    status.title = "Sold out since the last shared update";
  } else if (h.lastSoldOut) {
    status.soldOutAt = h.lastSoldOut;
    status.caption = `Sold out ${formatDay(h.lastSoldOut)}`;
    status.title = `First seen sold out: ${fullFormat.format(h.lastSoldOut)}`;
    if (h.lastRunMs != null) {
      status.caption += ` · last restock lasted ${describeRun(h.lastRunMs, h.lastRunPrecise)}`;
    }
  }
  if (h.restocks > 1) status.title += ` (restocked ${h.restocks} times since tracking began)`;
  return finishStatus(status, soldOut, now);
}

function finishStatus(status, soldOut, now) {
  status.isRestocked =
    !soldOut && !!status.restockedAt && now - status.restockedAt < TAG_WINDOW_MS;
  status.isSoldRecent =
    soldOut && !!status.soldOutAt && now - status.soldOutAt < TAG_WINDOW_MS;
  return status;
}

// Replaces any earlier tags and captions on these cards with current ones.
function decorate(items) {
  for (const item of items) {
    const status = itemStatus(item);
    item.querySelectorAll(".mhso-tags, .mhso-caption").forEach((el) => el.remove());
    item.classList.remove("mhso-new", "mhso-restocked");
    // No image tag for sell-outs: the site already badges sold-out items.
    item.classList.toggle("mhso-sellout", status.isSoldRecent);
    if (status.isRestocked) addTag(item, "restocked", "Recent restock", status.title);
    if (status.isNew) addTag(item, "new", "New");
    if (status.caption) {
      const caption = document.createElement("div");
      caption.className = "mhso-caption";
      caption.textContent = status.caption;
      if (status.title) caption.title = status.title;
      const meta = item.querySelector(".ProductList-meta") || item;
      meta.appendChild(caption);
    }
    const info = itemInfo(item);
    info.restockedAt = status.restockedAt || 0;
    // 0 = in stock; 1 = sold out, time unknown; otherwise the sell-out time.
    info.soldOutRank = item.classList.contains("sold-out") ? status.soldOutAt || 1 : 0;
  }
}

function addTag(item, kind, label, title = "") {
  item.classList.add(`mhso-${kind}`);
  const figure = item.querySelector(".ProductList-outerImageWrapper") || item;
  let tags = figure.querySelector(".mhso-tags");
  if (!tags) {
    tags = document.createElement("div");
    tags.className = "mhso-tags";
    figure.appendChild(tags);
  }
  const tag = document.createElement("span");
  tag.className = `mhso-tag mhso-tag--${kind}`;
  tag.textContent = label;
  if (title) tag.title = title;
  tags.appendChild(tag);
}

function buildPanel() {
  panel = document.createElement("div");
  panel.id = "mhso-panel";
  panel.innerHTML = `
    <input type="search" class="mhso-search" placeholder="Search name or inspiration  ( / )" aria-label="Search fragrances">
    <div class="mhso-stock" role="group" aria-label="Stock">
      <button type="button" data-stock="in"></button>
      <button type="button" data-stock="out"></button>
      <button type="button" data-stock="all"></button>
    </div>
    <label class="mhso-sort-label">
      Sort
      <select class="mhso-sort">
        <option value="default">Default</option>
        <option value="name">Name A–Z</option>
        <option value="inspiration">Inspiration A–Z</option>
        <option value="price">Price: low to high</option>
        <option value="restocked">Recently restocked</option>
        <option value="soldout">Recently sold out</option>
      </select>
    </label>
    <div class="mhso-row">
      <button type="button" class="mhso-chip" data-filter="restocked"></button>
      <button type="button" class="mhso-chip" data-filter="sellout"></button>
      <button type="button" class="mhso-chip" data-filter="new"></button>
    </div>
    <button type="button" class="mhso-recap-toggle">Weekly recap</button>
    <div class="mhso-recap" aria-live="polite" hidden></div>
    <div class="mhso-status" aria-live="polite"></div>
    <div class="mhso-meta">
      <div class="mhso-drop"></div>
      <div class="mhso-source"></div>
    </div>
  `;

  const search = panel.querySelector(".mhso-search");
  search.addEventListener("input", () => {
    query = normalize(search.value.trim());
    render();
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      search.value = "";
      query = "";
      search.blur();
      render();
    }
  });

  panel.querySelectorAll("[data-filter]").forEach((chip) => {
    chip.addEventListener("click", () => {
      tagFilter = tagFilter === chip.dataset.filter ? null : chip.dataset.filter;
      const view = TAG_VIEWS[tagFilter] || {};
      stockOverride = view.stock || null;
      sortOverride = view.sort || null;
      render();
    });
  });

  panel.querySelector(".mhso-sort").addEventListener("change", (e) => {
    if (tagFilter) {
      sortOverride = e.target.value; // temporary, for as long as the chip is on
      render();
    } else {
      chrome.storage.local.set({ [SORT_KEY]: e.target.value });
    }
  });

  panel.querySelector(".mhso-recap-toggle").addEventListener("click", () => {
    recap = !recap;
    chrome.storage.local.set({ [RECAP_KEY]: recap });
    render();
  });

  panel.querySelector(".mhso-recap").addEventListener("click", (e) => {
    const back = e.target.closest(".mhso-back");
    if (!back) return;
    recap = false;
    chrome.storage.local.set({ [RECAP_KEY]: false });
    render();
  });

  panel.querySelectorAll("[data-stock]").forEach((button) => {
    button.addEventListener("click", () => {
      if (tagFilter) {
        stockOverride = button.dataset.stock; // temporary, for as long as the chip is on
        render();
      } else {
        chrome.storage.local.set({ [STOCK_KEY]: button.dataset.stock });
      }
    });
  });

  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (e.key === "/" && !typing) {
      e.preventDefault();
      search.focus();
    }
  });

  document.body.appendChild(panel);
}

// Squarespace sizes each product image with inline styles measured from its
// card. Cards that were hidden at that moment measure 0x0, so once revealed
// the image is missing (never loaded) or loaded at zero size. Repair any
// revealed image that isn't showing: load it at a sensible resolution and
// make it fill its card via the `mhso-img` class.
const IMAGE_WIDTHS = [100, 300, 500, 750, 1000, 1500, 2500];

function fixImages(item) {
  for (const img of item.querySelectorAll("img.ProductList-image")) {
    const box = img.parentElement;
    if (!box.offsetWidth) continue; // still hidden
    const showing =
      img.classList.contains("loaded") && img.offsetWidth > 0 && img.offsetHeight > 0;
    if (showing || img.classList.contains("mhso-img")) continue;

    const url = img.dataset.src || img.dataset.image;
    if (!url) continue;
    const needed = box.offsetWidth * (window.devicePixelRatio || 1);
    const width = IMAGE_WIDTHS.find((w) => w >= needed) || 2500;
    img.classList.add("mhso-img");
    img.classList.remove("loaded");
    img.addEventListener("load", () => img.classList.add("loaded"), { once: true });
    img.src = `${url}?format=${width}w`;
  }
}

// Fires when a card scrolls into view or is revealed by a filter. The short
// delay lets the site's own loader go first.
const imageObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) setTimeout(() => fixImages(entry.target), 300);
    }
  },
  { rootMargin: "300px" }
);

function recapName(name) {
  if (!name) return "";
  const match = String(name).split(/\s+(?:inspired|isnpired)(?:\s+by)?\s+/i)[0];
  return match || String(name);
}

function buildRecapData() {
  const now = Date.now();
  const restocked = [];
  const soldOut = [];
  if (!shared || !shared.byId) return { restocked, soldOut };

  for (const item of Object.values(shared.byId)) {
    if (!item || !item.name) continue;
    const name = recapName(item.name);
    if (item.lastRestocked && item.lastRestocked >= now - TAG_WINDOW_MS) {
      restocked.push({
        name,
        time: item.lastRestocked,
      });
    }
    if (item.lastSoldOut && item.lastSoldOut >= now - TAG_WINDOW_MS) {
      soldOut.push({
        name,
        time: item.lastSoldOut,
        lasted: item.lastRunMs ? `lasted ${describeRun(item.lastRunMs, item.lastRunPrecise)}` : "",
      });
    }
  }

  restocked.sort((a, b) => b.time - a.time);
  soldOut.sort((a, b) => b.time - a.time);
  return { restocked, soldOut };
}

function renderRecap() {
  const recapEl = panel.querySelector(".mhso-recap");
  const recapToggle = panel.querySelector(".mhso-recap-toggle");
  if (!recapEl || !recapToggle) return;

  recapToggle.setAttribute("aria-pressed", String(recap));
  recapToggle.textContent = recap ? "Back to browse" : "Weekly recap";

  if (!recap) {
    recapEl.hidden = true;
    recapEl.innerHTML = "";
    return;
  }

  const data = buildRecapData();
  const hasRecap = data.restocked.length || data.soldOut.length;
  recapEl.hidden = !hasRecap;
  if (!hasRecap) {
    recapEl.innerHTML = '<div class="mhso-recap-empty">No stock changes in the last 7 days.</div>';
    return;
  }

  const makeRow = (label, value, extra = "") => {
    const row = document.createElement("div");
    row.className = "mhso-recap-row";
    const name = document.createElement("span");
    name.className = "mhso-recap-name";
    name.textContent = label;
    const time = document.createElement("span");
    time.className = "mhso-recap-time";
    time.textContent = value;
    if (extra) time.title = extra;
    row.append(name, time);
    return row;
  };

  const buildColumn = (title, items, accent = "") => {
    const col = document.createElement("div");
    col.className = "mhso-recap-col";
    const heading = document.createElement("div");
    heading.className = "mhso-recap-title";
    heading.textContent = `${title} (${items.length})`;
    if (accent) heading.style.color = accent;
    const list = document.createElement("div");
    list.className = "mhso-recap-list";
    for (const item of items) {
      const row = makeRow(item.name, monthDayFormat.format(item.time), item.lasted || "");
      if (item.lasted) {
        row.classList.add("mhso-recap-row--soldout");
        const time = row.querySelector(".mhso-recap-time");
        time.textContent = item.lasted;
        time.classList.add("mhso-recap-time--soldout");
      }
      list.appendChild(row);
    }
    col.append(heading, list);
    return col;
  };

  recapEl.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "mhso-recap-grid";
  grid.append(buildColumn("RESTOCKED", data.restocked, "#1f7a4d"));
  grid.append(buildColumn("SOLD OUT", data.soldOut, "#b3261e"));
  recapEl.appendChild(grid);
}

function render() {
  root.classList.toggle("mhso-stock-in", activeStock() === "in");
  root.classList.toggle("mhso-stock-out", activeStock() === "out");
  root.classList.toggle("mhso-recap-mode", recap);
  const items = [...document.querySelectorAll(ITEM)];
  // Flex layout is what makes gap-free filtering and `order` sorting work.
  root.classList.toggle(
    "mhso-filtering",
    activeStock() !== "all" || !!query || !!tagFilter || activeSort() !== "default"
  );
  if (!panel) return;
  applySort(items);
  // Re-observing makes the observer report each card's current visibility,
  // so cards revealed by this render get their images checked.
  for (const item of items) {
    imageObserver.unobserve(item);
    imageObserver.observe(item);
  }
  panel.querySelector(".mhso-sort").value = activeSort();

  const search = panel.querySelector(".mhso-search");
  const stockWrap = panel.querySelector(".mhso-stock");
  const sortWrap = panel.querySelector(".mhso-sort-label");
  const chips = panel.querySelector(".mhso-row");
  [search, stockWrap, sortWrap, chips].forEach((el) => {
    if (el) el.hidden = recap;
  });

  let shown = 0;
  for (const item of items) {
    const { text } = itemInfo(item);
    const matches =
      query.split(/\s+/).every((word) => text.includes(word)) &&
      (!tagFilter || item.classList.contains(`mhso-${tagFilter}`));
    item.classList.toggle("mhso-out", !matches);
    if (matches && !isHiddenByStock(item)) shown++;
  }

  const soldOut = items.filter((i) => i.classList.contains("sold-out")).length;
  const stockLabels = {
    in: `In stock (${items.length - soldOut})`,
    out: `Sold out (${soldOut})`,
    all: `All (${items.length})`,
  };
  for (const button of panel.querySelectorAll("[data-stock]")) {
    button.textContent = stockLabels[button.dataset.stock];
    button.setAttribute("aria-pressed", String(activeStock() === button.dataset.stock));
  }

  for (const chip of panel.querySelectorAll("[data-filter]")) {
    const kind = chip.dataset.filter;
    const count = items.filter((i) => i.classList.contains(`mhso-${kind}`)).length;
    chip.hidden = count === 0;
    chip.textContent = `${TAG_LABELS[kind]} (${count})`;
    chip.setAttribute("aria-pressed", String(tagFilter === kind));
  }

  panel.querySelector(".mhso-status").textContent =
    `Showing ${shown} of ${items.length}`;
  renderRecap();
  renderMeta();
}

function weeklySummaryText(summary) {
  if (!summary) return "";
  const parts = [];
  if (summary.new) parts.push(`${summary.new} new`);
  if (summary.restocked) parts.push(`${summary.restocked} restocked`);
  if (summary.soldOut) parts.push(`${summary.soldOut} sold out`);
  return parts.length ? `Weekly recap: ${parts.join(" · ")}` : "";
}

function renderMeta() {
  if (!panel) return;
  const drop = nextDrop();
  panel.querySelector(".mhso-drop").textContent = drop.live
    ? "Friday drop is happening now (5:00 PM ET)"
    : `Next drop: Fri 5:00 PM ET · in ${formatCountdown(drop.minutes)}`;

  const source = panel.querySelector(".mhso-source");
  if (shared) {
    const recap = weeklySummaryText(shared.summary);
    source.textContent =
      `Restock history since ${monthDayFormat.format(TRACKING_SINCE)}` +
      (recap ? ` · ${recap}` : "") +
      (shared.stale ? " (offline copy)" : "");
    source.title = `Shared history, fetched ${fullFormat.format(shared.fetchedAt)}`;
  } else {
    source.textContent = historyRequest ? "Loading restock history…" : "";
    source.title = "";
  }
}

async function init() {
  const items = [...document.querySelectorAll(ITEM)].filter((i) => !i.mhsoTracked);
  if (!items.length) return;
  items.forEach((i) => (i.mhsoTracked = true));
  if (!panel) {
    buildPanel();
    setInterval(renderMeta, 60 * 1000); // keep the drop countdown current
  }
  render();
  await trackItems(items);
  decorate(items);
  render();

  if (!historyRequest) {
    historyRequest = loadHistory().then((result) => {
      shared = result;
      if (!result) historyRequest = null; // allows a retry on the next init
      decorate([...document.querySelectorAll(ITEM)]);
      render();
    });
  }
}

// Product pages: show how many are left under the price, from the inventory
// the store already has on the page. The store often switches pages without
// reloading, so the count comes from its live product data via page-stock.js
// (which runs in the page's own context) and is re-checked whenever the page
// content changes. The count is as of page load, and only shown while some
// is left.
const STOCK_RETRIES = 10;
const stockAttempts = {};

// Asks page-stock.js for the variants of the product with this id. The two
// events are dispatched synchronously, so the answer arrives before return.
function requestStock(itemId) {
  let answer = null;
  const onAnswer = (event) => {
    try {
      answer = JSON.parse(event.detail);
    } catch {
      answer = null;
    }
  };
  document.addEventListener("mhso:stock", onAnswer);
  document.dispatchEvent(new CustomEvent("mhso:get-stock", { detail: itemId }));
  document.removeEventListener("mhso:stock", onAnswer);
  return answer && answer.itemId === itemId ? answer : null;
}

function stockText(variants) {
  if (variants.some((v) => !v.stock || v.stock.unlimited)) return null;
  const inStock = variants.filter((v) => v.stock.quantity > 0);
  if (!inStock.length) return null; // the site already shows "Sold out"
  const label = (v) => Object.values(v.attributes || {}).join(" ");
  return {
    text:
      variants.length === 1
        ? `${variants[0].stock.quantity} left`
        : variants.map((v) => `${label(v) || "Option"}: ${v.stock.quantity} left`).join(" · "),
    low: inStock.every((v) => v.stock.quantity <= 5),
  };
}

function showStockCount() {
  const article = document.querySelector("article.ProductItem[data-item-id]");
  if (!article) return;
  const prices = article.querySelectorAll(".ProductItem-details .product-price");
  if (!prices.length) return;
  const itemId = article.dataset.itemId;

  if (article.mhsoStock === undefined) {
    const answer = requestStock(itemId);
    if (!answer) {
      // The store may update its product data just after swapping the page in.
      stockAttempts[itemId] = (stockAttempts[itemId] || 0) + 1;
      if (stockAttempts[itemId] < STOCK_RETRIES) setTimeout(showStockCount, 300);
      return;
    }
    article.mhsoStock = stockText(answer.variants);
  }
  if (!article.mhsoStock) return;

  // Re-adds the badge if the store re-rendered the price area.
  for (const price of prices) {
    if (price.parentElement.querySelector(".mhso-stock-count")) continue;
    const badge = document.createElement("div");
    badge.className = "mhso-stock-count" + (article.mhsoStock.low ? " mhso-stock-count--low" : "");
    badge.textContent = article.mhsoStock.text;
    badge.title = "Inventory when this page loaded. Refresh for the latest count.";
    price.insertAdjacentElement("afterend", badge);
  }
}

function start() {
  showStockCount();
  init();
  // Re-run if the site swaps in a new product list without a full page load.
  let pending;
  new MutationObserver(() => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      showStockCount();
      init();
    }, 200);
  }).observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
