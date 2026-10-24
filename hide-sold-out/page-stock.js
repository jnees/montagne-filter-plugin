// Runs in the store page's own JavaScript context (manifest "world": "MAIN"),
// so it can read Static.SQUARESPACE_CONTEXT. The store keeps that object
// current as it moves between pages without reloading; it's what its own
// Add to Cart button uses. content.js asks for the product on screen by id,
// and this answers only if the context is for that same product.
document.addEventListener("mhso:get-stock", (event) => {
  const itemId = event.detail;
  const ctx = window.Static && window.Static.SQUARESPACE_CONTEXT;
  let answer = null;
  if (ctx && ctx.item && ctx.item.id === itemId && ctx.product && Array.isArray(ctx.product.variants)) {
    answer = {
      itemId,
      variants: ctx.product.variants.map((v) => ({
        attributes: v.attributes || {},
        stock: v.stock || null,
      })),
    };
  }
  // A string, so it crosses from the page's context to the extension's intact.
  document.dispatchEvent(new CustomEvent("mhso:stock", { detail: JSON.stringify(answer) }));
});
