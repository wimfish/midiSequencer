let viewRootEl = null;

export function renderAppShell(root) {
  root.innerHTML = `
    <div class="app-shell">
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

