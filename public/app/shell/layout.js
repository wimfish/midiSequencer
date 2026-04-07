let viewRootEl = null;

export function renderAppShell(root) {
  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar card">
        <div>
          <h1>Volca Sequencer</h1>
          <p class="sub">
            Kies een view: <strong>Style</strong> (drums) of <strong>FM</strong> (melodie).
            Alles draait in één app met gedeelde MIDI/audio/storage.
          </p>
        </div>

        <div class="topbar-actions">
          <nav class="buttons-wrap" aria-label="Views">
            <a class="secondary app-nav-btn" data-route="style" href="#/style">Style</a>
            <a class="secondary app-nav-btn" data-route="fm" href="#/fm">FM</a>
          </nav>
        </div>
      </header>

      <div id="viewRoot"></div>
    </div>
  `;
}

export function setViewRoot() {
  viewRootEl = document.getElementById("viewRoot");
  if (!viewRootEl) throw new Error("Missing #viewRoot");
  return viewRootEl;
}

export function setNavActive(routeKey) {
  const buttons = document.querySelectorAll(".app-nav-btn");
  buttons.forEach((el) => {
    el.classList.toggle("accent", el.dataset.route === routeKey);
    el.classList.toggle("secondary", el.dataset.route !== routeKey);
    if (el.dataset.route === routeKey) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
}

