// Clicking the toolbar icon switches between in-stock only and all items,
// using the same setting as the on-page panel.
const STOCK_KEY = "stockFilter"; // "in" | "out" | "all"
const LEGACY_HIDE_KEY = "hideSoldOut";
const BADGES = { in: "IN", out: "OUT", all: "" };

async function getStock() {
  const data = await chrome.storage.local.get({ [STOCK_KEY]: null, [LEGACY_HIDE_KEY]: true });
  return data[STOCK_KEY] || (data[LEGACY_HIDE_KEY] ? "in" : "all");
}

function setBadge(stock) {
  chrome.action.setBadgeText({ text: BADGES[stock] ?? "" });
  chrome.action.setBadgeBackgroundColor({ color: "#222" });
}

chrome.action.onClicked.addListener(async () => {
  const stock = await getStock();
  await chrome.storage.local.set({ [STOCK_KEY]: stock === "in" ? "all" : "in" });
});

chrome.storage.onChanged.addListener((changes) => {
  if (STOCK_KEY in changes) setBadge(changes[STOCK_KEY].newValue);
});

chrome.runtime.onInstalled.addListener(async () => setBadge(await getStock()));
chrome.runtime.onStartup.addListener(async () => setBadge(await getStock()));
