/**
 * Theme toggle: overrides prefers-color-scheme via data-theme on <html>,
 * persisted to localStorage. No framework, no dependencies.
 */
(function () {
  var STORAGE_KEY = "foundation-theme";
  var root = document.documentElement;
  var stored = null;

  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    // localStorage unavailable (private mode, etc.) — fall back to system preference
  }

  if (stored === "light" || stored === "dark") {
    root.setAttribute("data-theme", stored);
  }

  function currentTheme() {
    var attr = root.getAttribute("data-theme");
    if (attr === "light" || attr === "dark") return attr;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function updateIcons(theme) {
    var button = document.querySelector("[data-theme-toggle]");
    if (!button) return;
    var sun = button.querySelector('[data-icon="sun"]');
    var moon = button.querySelector('[data-icon="moon"]');
    if (!sun || !moon) return;
    var showMoon = theme === "dark";
    sun.hidden = showMoon;
    moon.hidden = !showMoon;
  }

  document.addEventListener("DOMContentLoaded", function () {
    updateIcons(currentTheme());

    var button = document.querySelector("[data-theme-toggle]");
    if (!button) return;

    button.addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch (err) {
        // ignore
      }
      updateIcons(next);
    });
  });
})();
