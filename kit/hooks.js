/*
 * Hook covers setup, loaded by the hook templates before kit.js. kit.js calls window.kitLayoutSetup(content, canvas)
 * after the background is placed and before the content is bound. It:
 *   - switches the look (content.look, one of LOOKS) and the brand opt-ins (brand_colors, brand_fonts)
 *   - turns content.background.tint (0 to 1) into the even tint layer over the photo
 *   - fills the slide counter pill ("2/8") when show_counter is on, and hides it otherwise
 *   - marks the slide when the footer has something in it, so the copy stops above it
 * Keep LOOKS in step with HOOK_LOOKS in lib/deck-schema.js and the palettes in kit/hooks.css.
 */
(function () {
  "use strict";
  var LOOKS = ["navy-orange", "noir-white", "red-blue", "noir-green", "noir-mint", "street-mint"];
  function filled(v) { return v !== undefined && v !== null && String(v).trim() !== ""; }

  window.kitLayoutSetup = function (c) {
    var slide = document.querySelector(".slide");
    if (!slide) return;
    if (LOOKS.indexOf(c.look) !== -1) slide.setAttribute("data-look", c.look);
    if (c.brand_colors === true) slide.classList.add("is-brand-colors");
    if (c.brand_fonts === true) slide.classList.add("is-brand-fonts");

    var bg = c.background;
    if (bg && typeof bg === "object" && filled(bg.tint)) {
      var tint = Number(bg.tint);
      if (isFinite(tint)) slide.style.setProperty("--h-tint", String(Math.max(0, Math.min(1, tint))));
    }

    var count = slide.querySelector(".hook-count");
    if (count) {
      if (c.show_counter === true) {
        var total = Math.max(1, Math.floor(Number(c.total)) || 1);
        var n = Math.min(Math.max(1, Math.floor(Number(c.slide)) || 1), total);
        count.textContent = n + "/" + total;
        slide.classList.add("has-count");
      } else {
        count.classList.add("is-empty");
      }
    }

    if (slide.querySelector(".hook-foot") && (filled(c.handle) || filled(c.save))) slide.classList.add("has-foot");
  };
})();
