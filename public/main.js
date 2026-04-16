import { renderAppShell, setViewRoot } from "./app/shell/layout.js";
import { createRouter } from "./app/shell/router.js";
import { styleSequencerFeature } from "./app/features/styleSequencer/index.js";
import { fmSequencerFeature } from "./app/features/fmSequencer/index.js";

const appRoot = document.getElementById("app");
if (!appRoot) {
  throw new Error("Missing #app root");
}

renderAppShell(appRoot);
const viewRoot = setViewRoot();

const features = {
  style: styleSequencerFeature(),
  fm: fmSequencerFeature()
};

const routeRoots = Object.fromEntries(
  Object.keys(features).map((key) => {
    const el = document.createElement("div");
    el.dataset.routeRoot = key;
    el.hidden = true;
    viewRoot.appendChild(el);
    return [key, el];
  })
);

const mounted = Object.create(null);

const router = createRouter({
  defaultRoute: "style",
  onRouteChange: async (routeKey) => {
    await ensureMounted(routeKey);
    showRoute(routeKey);
  }
});

async function ensureMounted(key) {
  const routeKey = features[key] ? key : "style";
  if (mounted[routeKey]) return;
  const { mount } = features[routeKey];
  const unmount = await mount(routeRoots[routeKey]);
  mounted[routeKey] = typeof unmount === "function" ? unmount : null;
}

function showRoute(key) {
  const routeKey = features[key] ? key : "style";
  Object.entries(routeRoots).forEach(([candidate, el]) => {
    el.hidden = candidate !== routeKey;
  });
  document.body.classList.toggle("fm-prototype-page", routeKey === "fm");

  if (routeKey === "fm") {
    const fmVolcaSelect = routeRoots.fm?.querySelector("#fmVolcaSelect");
    if (fmVolcaSelect) fmVolcaSelect.value = "fm";
    return;
  }

  const styleVolcaSelect = routeRoots.style?.querySelector("#volcaSelect");
  if (!styleVolcaSelect) return;
  const savedVolca = localStorage.getItem("volca-selected");
  const targetVolca = savedVolca && savedVolca !== "fm" ? savedVolca : "drum";
  if (styleVolcaSelect.value !== targetVolca) {
    styleVolcaSelect.value = targetVolca;
    styleVolcaSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

router.start();

