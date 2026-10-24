# Privacy Policy

**Monty Filters: Improved Browsing for Montagne Parfums** (the "extension")
Last updated: October 23, 2026

## Summary

The extension does not collect, transmit, sell or share any personal data. Everything it stores stays in your own browser. Its only network request of its own is downloading a public restock-history file from GitHub, which sends nothing about you beyond what any web request does.

## What the extension stores

The extension runs only on pages of montagneparfums.com. It saves the following in your browser's local extension storage (`chrome.storage.local`):

- Your display settings: the stock filter (In stock, Sold out or All) and the sort order.
- A list of the product IDs shown on the pages you've visited, with whether each one was sold out and when it first appeared or came back in stock. This powers the "New" and "Recent restock" tags.

- A cached copy of the public restock-history file described below.

This data never leaves your device. The extension has no servers of its own and uses no analytics or tracking.

## Network requests

The extension makes two kinds of network request:

- **Restock history.** At most every 15 minutes while you're on montagneparfums.com, it downloads `data/events.csv` from this project's public GitHub repository (`raw.githubusercontent.com`). The file is the same for everyone and contains only product names, IDs, stock changes and times. The request includes no cookies, account details, product IDs, browsing history or other information from the extension. Like any web request, it reveals your IP address and browser type to GitHub, which handles them under the [GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
- **Product images.** If the store's page skipped loading a product image, the extension loads it from the store's own image server, as the page itself would.

## What the extension does not do

- It doesn't read or store your account details, cart, orders, payment information or anything you type on the site, except the text you enter in the extension's own search box. That text is used only to filter the product list and is never saved.
- It doesn't run on any other website.
- On product pages, it reads the inventory count that the store already includes in the page, to show "N left" under the price. That count is only displayed; it isn't stored or sent anywhere.
- It doesn't share data with the store, with the developer or with anyone else.

## Deleting your data

Removing the extension from Chrome (`chrome://extensions` → **Remove**) deletes everything it stored.

## Affiliation

This extension is an independent project. It is not affiliated with, endorsed by or sponsored by Montagne Parfums.

## Contact

Questions about this policy: open an issue at https://github.com/jnees/montagne-filter-plugin/issues
