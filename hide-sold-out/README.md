# Montagne: Hide Sold Out

A Chrome extension for [montagneparfums.com](https://www.montagneparfums.com/fragrance) that makes the product list easier to browse:

- **Filter by stock:** show only in-stock items, only sold-out items, or everything. The remaining products close up so there are no gaps in the grid.
- **Sort** by name, by the fragrance each one is inspired by, or by price.
- **Search** by fragrance name or by what it's inspired by (for example, "xerjoff" or "vanilla").
- **"Back in stock" tags** on items that were sold out the last time you visited and are now available.
- **"New" tags** on products that weren't on the page the last time you visited.

## Installation

The extension isn't in the Chrome Web Store, so you load it from this folder.

1. Download or copy this `hide-sold-out` folder to your computer. Keep it somewhere permanent, because Chrome loads the extension from this folder each time it starts.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** with the switch in the top-right corner.
4. Click **Load unpacked** and select the `hide-sold-out` folder.
5. Go to [montagneparfums.com/fragrance](https://www.montagneparfums.com/fragrance). A control panel appears in the bottom-right corner.

Optional: click the puzzle-piece icon in Chrome's toolbar and pin the extension so its icon is always visible.

This also works in other Chromium-based browsers such as Edge, Brave and Arc. Their extensions page is at `edge://extensions`, `brave://extensions` and so on.

## Usage

| Control | What it does |
| --- | --- |
| **In stock / Sold out / All** | Shows only in-stock items, only sold-out items, or everything. Clicking the extension's toolbar icon switches between **In stock** and **All**. The icon's badge shows **IN** or **OUT** while one of those filters is on. |
| **Sort** | Default (the site's order), Name A–Z, Inspiration A–Z, or Price: low to high. Sorting by inspiration groups products by fragrance house, since most inspirations start with the brand name. Montagne originals with no inspiration go last. |
| **Search box** | Filters products as you type. If you type several words, only products matching all of them are shown. Press `/` to jump to the search box and `Esc` to clear it. |
| **Back in stock (n)** | Shows only the items that have come back in stock. Click it again to show everything. |
| **New (n)** | Shows only new items. Click it again to show everything. |

The extension remembers your stock and sort choices across every page of the site. It starts on **In stock**.

### About the "New" and "Back in stock" tags

- On your first visit the extension records what's on the page, so you won't see any tags yet. Tags show up on later visits when something has changed.
- Each tag stays for 7 days.
- The extension only knows about pages you've opened. If you only browse one category, it only tracks the items in that category.
- All of this data is stored in your browser. Nothing is sent anywhere.

## Updating

After you change the extension's files or replace them with a newer copy, go to `chrome://extensions`, click the reload icon on the extension's card, and refresh the store page.

## Uninstalling

Go to `chrome://extensions` and click **Remove** on the extension's card. This also deletes the data it saved about which items you've seen.

## Troubleshooting

- **The panel doesn't appear:** make sure you're on a page that lists products, such as `/fragrance`, and refresh the page after installing or reloading the extension.
- **The extension stops working after the site changes:** it relies on how the site's pages are built. If the site is redesigned, the extension may need updating.
