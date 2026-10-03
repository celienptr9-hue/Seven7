(() => {
  "use strict";

  // Gestion du thème (sombre / clair / auto) et du sélecteur dans Paramètres.
  // Chargé en <head>, avant app.js, pour appliquer le thème sans flash.

  const KEY = "seven-theme";
  const CHOICES = [
    { id: "dark", label: "Sombre", hint: "Violet nocturne" },
    { id: "light", label: "Clair", hint: "Blanc et vert pelouse" },
    { id: "auto", label: "Auto", hint: "Suit l’appareil" }
  ];
  const META_COLORS = { dark: "#173d30", light: "#ffffff" };
  const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

  function readChoice() {
    try {
      const value = localStorage.getItem(KEY);
      return CHOICES.some(item => item.id === value) ? value : "dark";
    } catch {
      return "dark";
    }
  }

  let choice = readChoice();

  function resolved() {
    return choice === "auto" ? (media && media.matches ? "light" : "dark") : choice;
  }

  function apply() {
    const theme = resolved();
    document.documentElement.setAttribute("data-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", META_COLORS[theme]);
  }

  function panelHtml() {
    return `<div class="theme-panel-head"><h2 id="theme-panel-title">Apparence</h2><p>Le choix est mémorisé sur cet appareil.</p></div>
      <div class="theme-options">${CHOICES.map(item => `<button type="button" class="theme-option" data-theme-choice="${item.id}" aria-pressed="${item.id === choice}"><span class="theme-swatch swatch-${item.id}" aria-hidden="true"></span><span><strong>${item.label}</strong><small>${item.hint}</small></span></button>`).join("")}</div>`;
  }

  function syncPanel(root) {
    root.querySelectorAll("[data-theme-choice]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.themeChoice === choice));
    });
  }

  function ensurePanel(root) {
    if (root.querySelector("#theme-panel")) return;
    const layout = root.querySelector(".settings-layout");
    const head = root.querySelector(".section-head");
    if (!layout || !head) return;
    const panel = document.createElement("section");
    panel.id = "theme-panel";
    panel.className = "theme-panel";
    panel.setAttribute("aria-labelledby", "theme-panel-title");
    panel.innerHTML = panelHtml();
    head.after(panel);
  }

  apply();
  if (media) {
    const onSystemChange = () => { if (choice === "auto") apply(); };
    if (media.addEventListener) media.addEventListener("change", onSystemChange);
    else if (media.addListener) media.addListener(onSystemChange);
  }

  document.addEventListener("DOMContentLoaded", () => {
    apply();
    const root = document.getElementById("app");
    if (!root) return;
    new MutationObserver(() => ensurePanel(root)).observe(root, { childList: true, subtree: true });
    root.addEventListener("click", event => {
      const button = event.target.closest("[data-theme-choice]");
      if (!button) return;
      choice = button.dataset.themeChoice;
      try { localStorage.setItem(KEY, choice); } catch { /* stockage indisponible */ }
      apply();
      syncPanel(root);
    });
    ensurePanel(root);
  });
})();
