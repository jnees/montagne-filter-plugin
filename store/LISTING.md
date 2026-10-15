# Chrome Web Store submission

Everything to paste into the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), section by section.

Upload: `dist/montagne-browsing-<version>.zip` (build it with `./scripts/package.sh`).

---

## Store listing tab

**Name** (from the manifest): Improved Browsing for Montagne Parfums

**Summary** (from the manifest, max 132 characters):
Hide sold-out items, search, sort, and spot new or restocked fragrances on montagneparfums.com. Unofficial.

**Category:** Shopping

**Language:** English

**Description:**

```
A fan-made tool for browsing the Montagne Parfums catalog. It adds a small control panel to the product list on montagneparfums.com, so you can quickly find what's available, search by name or inspiration, and catch new releases and restocks.

FEATURES
• Stock filter: show only in-stock items, only sold-out items, or everything. The grid closes up so there are no gaps.
• Search: filter by fragrance name or by what it's inspired by, for example "xerjoff" or "vanilla". Press / to jump to the search box.
• Sort: by name, by inspiration (groups fragrances by house), or by price.
• "Back in stock" tags: items that were sold out on an earlier visit and are available now are tagged for 7 days.
• "New" tags: products that weren't on the page on an earlier visit are tagged for 7 days.
• Toolbar button: click the extension icon to switch between in-stock and all items.

Your settings are remembered across visits.

PRIVACY
The extension collects no personal data. It runs only on montagneparfums.com, stores its settings and the list of products you've seen in your own browser, and sends nothing anywhere.

This is an independent project and is not affiliated with, endorsed by or sponsored by Montagne Parfums.
```

**Graphic assets:**
- Store icon (128×128): `hide-sold-out/icons/icon128.png`
- Screenshots (1280×800 or 640×400, 1–5 images): `store/screenshot-1.png`. Fresh captures are recommended; see "Screenshots" below.
- Small promo tile (440×280): optional.

**Additional fields:**
- Homepage URL: https://github.com/jnees/montagne-filter-plugin
- Support URL: https://github.com/jnees/montagne-filter-plugin/issues

---

## Privacy tab

**Single purpose description:**

```
Improves browsing of the product list on montagneparfums.com by letting the user hide sold-out items, search, sort, and see which products are new or back in stock.
```

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `storage` | Saves the user's stock-filter and sort settings, and a local list of product IDs and their stock status so the extension can tag new and restocked products on later visits. Stored only in the user's browser. |
| Host permission (content script on `montagneparfums.com`) | The extension's only function is to filter, search, sort and tag the product list on montagneparfums.com, so it must run on that site's pages. It runs on no other site. |

**Are you using remote code?** No. All JavaScript is included in the package.

**Data usage:** check none of the data-type boxes. The extension does not collect or transmit user data.

Then tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:**
https://github.com/jnees/montagne-filter-plugin/blob/main/PRIVACY.md

---

## Distribution tab

- Visibility: **Public**, or **Unlisted** to share by link only.
- Regions: all regions.
- Pricing: free.

---

## Screenshots

Take these at a browser window size that gives a 16:10 shape. Then resize to exactly 1280×800 (Preview → Tools → Adjust Size works).

1. The product grid in **In stock** view with the panel visible.
2. A search, such as "creed", with **Sort: Inspiration A–Z**.
3. Cards showing the "Back in stock" and "New" tags.
