/**
 * Icy Customizer — storefront integration.
 *
 * Responsibilities, all scoped strictly to customizable products:
 *   1. Replace the Add to Cart control with CUSTOMIZE on product pages.
 *   2. Replace the CTA on collection / search grid cards.
 *   3. Block Ajax cart adds for a customizable product that carries no design.
 *
 * Design principles:
 *   - Products without the icy.customizable metafield are never touched. Every
 *     code path returns early for them.
 *   - Product identity comes from Liquid-provided data (handles and ids), not
 *     from CSS classes, so this survives a theme redesign.
 *   - Failure is silent and non-destructive: if anything here throws, the theme
 *     keeps working as it did before.
 */
(function () {
  "use strict";

  var configEl = document.getElementById("icy-customizer-config");
  if (!configEl) return;

  var config;
  try {
    config = JSON.parse(configEl.textContent);
  } catch (err) {
    console.warn("[icy] Could not parse customizer config.", err);
    return;
  }

  var customizableHandles = config.customizable || {};
  var PROXY = (config.proxyBase || "/apps/icy-customizer").replace(/\/$/, "");
  var LABEL = config.buttonLabel || "CUSTOMIZE";

  function isCustomizableHandle(handle) {
    return Object.prototype.hasOwnProperty.call(customizableHandles, handle);
  }

  /** Extracts a product handle from any storefront URL shape. */
  function handleFromUrl(url) {
    if (!url) return null;
    var match = String(url).match(/\/products\/([a-z0-9-_%]+)/i);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function customizerUrl(handle, productId) {
    var params = new URLSearchParams({ product: handle });
    if (productId) params.set("productId", String(productId));
    return PROXY + "?" + params.toString();
  }

  function makeButton(handle, productId, extraClass) {
    var link = document.createElement("a");
    link.href = customizerUrl(handle, productId);
    link.className = "icy-customize-btn" + (extraClass ? " " + extraClass : "");
    link.textContent = LABEL;
    link.setAttribute("data-icy-customize", "true");
    link.setAttribute("aria-label", LABEL + " this product");
    if (config.accent) link.style.setProperty("--icy-accent", config.accent);
    return link;
  }

  // -------------------------------------------------------------------------
  // 1. Product page
  // -------------------------------------------------------------------------

  function upgradeProductPage() {
    var current = config.currentProduct;
    if (!current || !current.customizable) return;

    var forms = document.querySelectorAll('form[action*="/cart/add"]');
    if (!forms.length) return;

    // Only inject one Customize button per page — themes like Dawn render
    // a second (sticky) product form that would otherwise get its own button.
    var pageButtonAdded = false;

    Array.prototype.forEach.call(forms, function (form) {
      if (form.hasAttribute("data-icy-handled")) return;
      if (pageButtonAdded) {
        // Still mark the form as handled so we hide its submit + dynamic checkout.
        form.setAttribute("data-icy-handled", "true");
        form.setAttribute("data-icy-product-handle", current.handle);
        var extraSubmits = form.querySelectorAll('button[type="submit"], input[type="submit"], [name="add"]');
        Array.prototype.forEach.call(extraSubmits, function (btn) {
          btn.disabled = true;
          btn.setAttribute("aria-hidden", "true");
          btn.setAttribute("data-icy-disabled", "true");
          btn.style.display = "none";
        });
        var extraDynamic = form.querySelectorAll(".shopify-payment-button, [data-shopify='payment-button']");
        Array.prototype.forEach.call(extraDynamic, function (el) {
          el.style.display = "none";
          el.setAttribute("data-icy-disabled", "true");
        });
        return;
      }
      form.setAttribute("data-icy-handled", "true");

      // Mark the form so the fetch interceptor can identify it later.
      form.setAttribute("data-icy-product-handle", current.handle);

      var submits = form.querySelectorAll(
        'button[type="submit"], input[type="submit"], [name="add"]'
      );

      var anchor = null;
      Array.prototype.forEach.call(submits, function (btn) {
        // Disable rather than remove: themes often rely on these nodes existing
        // for variant-availability updates, and removing them breaks scripts.
        btn.disabled = true;
        btn.setAttribute("aria-hidden", "true");
        btn.setAttribute("data-icy-disabled", "true");
        btn.style.display = "none";
        if (!anchor) anchor = btn;
      });

      var button = makeButton(current.handle, current.id, "icy-customize-btn--block");

      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(button, anchor);
      } else {
        form.appendChild(button);
      }

      pageButtonAdded = true;

      // Dynamic checkout buttons bypass the cart entirely, so they must go too.
      var dynamic = form.querySelectorAll(
        ".shopify-payment-button, [data-shopify='payment-button']"
      );
      Array.prototype.forEach.call(dynamic, function (el) {
        el.style.display = "none";
        el.setAttribute("data-icy-disabled", "true");
      });
    });
  }

  // -------------------------------------------------------------------------
  // 2. Collection and search grids
  // -------------------------------------------------------------------------

  function upgradeGrids() {
    if (config.replaceOnCollection === false) return;
    if (!Object.keys(customizableHandles).length) return;

    var links = document.querySelectorAll('a[href*="/products/"]');

    Array.prototype.forEach.call(links, function (link) {
      var handle = handleFromUrl(link.getAttribute("href"));
      if (!handle || !isCustomizableHandle(handle)) return;

      // Find the card that contains this link, then look for a cart form
      // inside it. Walking up from the link keeps this theme-agnostic.
      var card = link.closest("li, article, .card, .grid__item, .product-card");
      if (!card || card.hasAttribute("data-icy-grid-handled")) return;

      var form = card.querySelector('form[action*="/cart/add"]');
      if (!form) return;

      card.setAttribute("data-icy-grid-handled", "true");
      form.setAttribute("data-icy-product-handle", handle);

      var submits = form.querySelectorAll(
        'button[type="submit"], input[type="submit"], [name="add"]'
      );
      var anchor = submits[0] || null;

      Array.prototype.forEach.call(submits, function (btn) {
        btn.disabled = true;
        btn.style.display = "none";
        btn.setAttribute("data-icy-disabled", "true");
      });

      var button = makeButton(
        handle,
        customizableHandles[handle],
        "icy-customize-btn--card"
      );

      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(button, anchor);
      } else {
        form.appendChild(button);
      }
    });
  }

  // -------------------------------------------------------------------------
  // 3. Cart guard
  // -------------------------------------------------------------------------

  /**
   * A customizable product may only enter the cart with a design attached.
   * The customizer itself sets the `_design_id` property, so the presence of
   * that property is what distinguishes a legitimate add from a bypass.
   *
   * This is a usability guard, not a security boundary — the server validates
   * design ownership independently before an order is fulfilled.
   */
  function payloadIsBlocked(body) {
    try {
      var items = [];

      if (typeof body === "string") {
        var parsed = JSON.parse(body);
        items = parsed.items || [parsed];
      } else if (body instanceof FormData) {
        var id = body.get("id");
        var props = {};
        body.forEach(function (value, key) {
          var m = key.match(/^properties\[(.+)\]$/);
          if (m) props[m[1]] = value;
        });
        items = [{ id: id, properties: props }];
      } else if (body && typeof body === "object") {
        items = body.items || [body];
      }

      return items.some(function (item) {
        if (!item) return false;
        var props = item.properties || {};
        if (props._design_id) return false; // customized — allow

        // Only block when we know this variant belongs to a customizable
        // product. Unknown products are always allowed through.
        return isCustomizableVariant(item.id);
      });
    } catch (err) {
      return false; // never block on a parsing failure
    }
  }

  // Variant ids seen on the current page that belong to customizable products.
  var customizableVariantIds = new Set();

  function indexVariants() {
    var forms = document.querySelectorAll("form[data-icy-product-handle]");
    Array.prototype.forEach.call(forms, function (form) {
      var inputs = form.querySelectorAll('[name="id"], [name="items[][id]"]');
      Array.prototype.forEach.call(inputs, function (input) {
        if (input.value) customizableVariantIds.add(String(input.value));
        if (input.options) {
          Array.prototype.forEach.call(input.options, function (opt) {
            if (opt.value) customizableVariantIds.add(String(opt.value));
          });
        }
      });
    });
  }

  function isCustomizableVariant(id) {
    return id != null && customizableVariantIds.has(String(id));
  }

  function notifyBlocked() {
    var current = config.currentProduct;
    if (current && current.customizable) {
      window.location.href = customizerUrl(current.handle, current.id);
    } else {
      console.warn("[icy] This product must be customized before it can be added to the cart.");
    }
  }

  function installCartGuard() {
    var originalFetch = window.fetch;
    if (typeof originalFetch === "function") {
      window.fetch = function (input, init) {
        try {
          var url = typeof input === "string" ? input : input && input.url;
          if (url && /\/cart\/add(\.js)?/.test(url)) {
            var body = init && init.body;
            if (payloadIsBlocked(body)) {
              notifyBlocked();
              return Promise.reject(
                new Error("This product must be customized before adding to cart.")
              );
            }
          }
        } catch (err) {
          /* fall through to the real request */
        }
        return originalFetch.apply(this, arguments);
      };
    }

    // Non-Ajax form submissions.
    document.addEventListener(
      "submit",
      function (event) {
        var form = event.target;
        if (!form || !form.matches || !form.matches('form[action*="/cart/add"]')) return;
        if (!form.hasAttribute("data-icy-product-handle")) return;
        if (form.querySelector('[name="properties[_design_id]"]')) return;

        event.preventDefault();
        notifyBlocked();
      },
      true
    );
  }

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------

  function run() {
    try {
      upgradeProductPage();
      upgradeGrids();
      indexVariants();
    } catch (err) {
      console.warn("[icy] Customizer integration error (theme is unaffected).", err);
    }
  }

  function boot() {
    run();
    installCartGuard();

    // Themes re-render grids on filter, sort, pagination and quick-view, so
    // re-apply after DOM changes rather than assuming a single static render.
    if (window.MutationObserver) {
      var pending = null;
      var observer = new MutationObserver(function () {
        if (pending) return;
        pending = window.setTimeout(function () {
          pending = null;
          run();
        }, 150);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
