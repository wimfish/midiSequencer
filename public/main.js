import { renderAppShell, setViewRoot, setNavActive } from "./app/shell/layout.js";
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

const router = createRouter({
  defaultRoute: "style",
  onRouteChange: async (routeKey) => {
    setNavActive(routeKey);
    await mountRoute(routeKey);
  }
});

let current = { key: null, unmount: null };

async function mountRoute(key) {
  if (!features[key]) key = "style";

  if (current.unmount) {
    try {
      current.unmount();
    } finally {
      current = { key: null, unmount: null };
    }
  }

  viewRoot.innerHTML = "";
  const { mount } = features[key];
  const unmount = await mount(viewRoot);
  current = { key, unmount: typeof unmount === "function" ? unmount : null };
}

router.start();

