// Adds a control panel to Montagne product lists: filter by stock, search by
// name, sort, and tag items that are new or restocked since earlier visits.
const STOCK_KEY = "stockFilter"; // "in" | "out" | "all"
const LEGACY_HIDE_KEY = "hideSoldOut";
const SORT_KEY = "sortOrder"; // "default" | "name" | "inspiration" | "price"
const SEEN_KEY = "seenItems";
const TAG_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const root = document.documentElement;
const ITEM = ".ProductList-item[data-item-id]";

let stock = "in";
let sort = "default";
let query = "";
let tagFilter = null; // null | "new" | "restocked"
let panel;

// Default to in-stock only; applied at document_start so hidden items never
// flash. Falls back to the older on/off setting if that's all that's stored.
chrome.storage.local.get(
  { [STOCK_KEY]: null, [LEGACY_HIDE_KEY]: true, [SORT_KEY]: "default" },
  (data) => {
    stock = data[STOCK_KEY] || (data[LEGACY_HIDE_KEY] ? "in" : "all");
    sort = data[SORT_KEY];
    render();
  }
);

chrome.storage.onChanged.addListener((changes) => {
  if (STOCK_KEY in changes) stock = changes[STOCK_KEY].newValue;
  if (SORT_KEY in changes) sort = changes[SORT_KEY].newValue;
  if (STOCK_KEY in changes || SORT_KEY in changes) render();
});

function isHiddenByStock(item) {
  const soldOut = item.classList.contains("sold-out");
  return (stock === "in" && soldOut) || (stock === "out" && !soldOut);
}

function normalize(text) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Records each item's stock state and tags items that are new or restocked
// since the last snapshot. Tags stay visible for TAG_WINDOW_MS.
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
      if (soldOut) delete rec.restockedAt;
      rec.soldOut = soldOut;
    }

    if (rec.firstSeen && now - rec.firstSeen < TAG_WINDOW_MS) {
      addTag(item, "new", "New");
    }
    if (!soldOut && rec.restockedAt && now - rec.restockedAt < TAG_WINDOW_MS) {
      addTag(item, "restocked", "Back in stock");
    }
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
};

// Reorders visually via flex `order`, leaving the site's DOM untouched.
// Ties keep the site's default order because Array#sort is stable.
function applySort(items) {
  const compare = COMPARATORS[sort];
  if (!compare) {
    for (const item of items) item.style.removeProperty("order");
    return;
  }
  [...items]
    .sort((a, b) => compare(itemInfo(a), itemInfo(b)))
    .forEach((item, i) => item.style.setProperty("order", String(i)));
}

function addTag(item, kind, label) {
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
      </select>
    </label>
    <div class="mhso-row">
      <button type="button" class="mhso-chip" data-filter="restocked"></button>
      <button type="button" class="mhso-chip" data-filter="new"></button>
    </div>
    <div class="mhso-status" aria-live="polite"></div>
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
      render();
    });
  });

  panel.querySelector(".mhso-sort").addEventListener("change", (e) => {
    chrome.storage.local.set({ [SORT_KEY]: e.target.value });
  });

  panel.querySelectorAll("[data-stock]").forEach((button) => {
    button.addEventListener("click", () => {
      chrome.storage.local.set({ [STOCK_KEY]: button.dataset.stock });
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

function render() {
  root.classList.toggle("mhso-stock-in", stock === "in");
  root.classList.toggle("mhso-stock-out", stock === "out");
  const items = [...document.querySelectorAll(ITEM)];
  // Flex layout is what makes gap-free filtering and `order` sorting work.
  root.classList.toggle(
    "mhso-filtering",
    stock !== "all" || !!query || !!tagFilter || sort !== "default"
  );
  if (!panel) return;
  applySort(items);
  // Re-observing makes the observer report each card's current visibility,
  // so cards revealed by this render get their images checked.
  for (const item of items) {
    imageObserver.unobserve(item);
    imageObserver.observe(item);
  }
  panel.querySelector(".mhso-sort").value = sort;

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
    button.setAttribute("aria-pressed", String(stock === button.dataset.stock));
  }

  for (const chip of panel.querySelectorAll("[data-filter]")) {
    const kind = chip.dataset.filter;
    const count = items.filter((i) => i.classList.contains(`mhso-${kind}`)).length;
    chip.hidden = count === 0;
    chip.textContent = `${kind === "new" ? "New" : "Back in stock"} (${count})`;
    chip.setAttribute("aria-pressed", String(tagFilter === kind));
  }

  panel.querySelector(".mhso-status").textContent =
    `Showing ${shown} of ${items.length}`;
}

async function init() {
  const items = [...document.querySelectorAll(ITEM)].filter((i) => !i.mhsoTracked);
  if (!items.length) return;
  items.forEach((i) => (i.mhsoTracked = true));
  if (!panel) buildPanel();
  render();
  await trackItems(items);
  render();
}

function start() {
  init();
  // Re-run if the site swaps in a new product list without a full page load.
  let pending;
  new MutationObserver(() => {
    clearTimeout(pending);
    pending = setTimeout(init, 200);
  }).observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
