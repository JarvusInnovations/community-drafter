(function () {
  "use strict";
  var POLL_MS = 5 * 60 * 1000;
  var scriptEl = document.currentScript;
  var ORIGIN = scriptEl && scriptEl.src ? new URL(scriptEl.src).origin : "";

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function countsSentence(data) {
    var orgs = data.organizations || 0;
    var indiv = data.individuals || 0;
    var text =
      "Signed by " +
      orgs +
      " organization" +
      (orgs === 1 ? "" : "s") +
      " and " +
      indiv +
      " individual" +
      (indiv === 1 ? "" : "s");
    if (data.unlisted > 0) {
      text +=
        ", and " +
        data.unlisted +
        " other" +
        (data.unlisted === 1 ? "" : "s") +
        " who asked not to be listed";
    }
    return text;
  }

  function itemLabel(item) {
    if (item.capacity === "official") {
      var who = item.title ? item.display_name + ", " + item.title : item.display_name;
      return esc(item.org) + " — " + esc(who);
    }
    return item.descriptor
      ? esc(item.display_name) + ", " + esc(item.descriptor)
      : esc(item.display_name);
  }

  function render(el, data) {
    var html = "<p>" + esc(countsSentence(data)) + "</p>";
    if (el.hasAttribute("data-drafter-list") && Array.isArray(data.list)) {
      html +=
        "<ul>" +
        data.list
          .map(function (item) {
            return "<li>" + itemLabel(item) + "</li>";
          })
          .join("") +
        "</ul>";
    }
    el.innerHTML = html;
  }

  function load(el) {
    var slug = el.getAttribute("data-drafter-doc");
    if (!slug) return;
    fetch(ORIGIN + "/d/" + encodeURIComponent(slug) + "/signatories.json")
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (data) render(el, data);
      })
      .catch(function () {
        // Renders nothing on failure.
      });
  }

  function tick() {
    var els = document.querySelectorAll("[data-drafter-doc]");
    for (var i = 0; i < els.length; i++) load(els[i]);
  }

  tick();
  var timer = setInterval(tick, POLL_MS);
  if (timer && typeof timer.unref === "function") timer.unref();
})();
