const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.resolve(__dirname, "../src/shared/content-script-resources.js"),
  "utf8"
);
const context = vm.createContext({});
vm.runInContext(source, context, { filename: "src/shared/content-script-resources.js" });
const { fromManifest } = context.CurrencyContentScriptResources;
const baseManifest = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, "../manifests/base.json"),
  "utf8"
));

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("derives scripting API paths from the broad HTTP and HTTPS manifest definition", () => {
  const resources = fromManifest({
    content_scripts: [
      {
        matches: ["https://docs.example/*"],
        js: ["content/ignored.js"],
        css: ["content/ignored.css"]
      },
      {
        matches: ["http://*/*", "https://*/*"],
        js: [
          "shared/browser-api.js",
          "/shared/settings.js",
          " ./content/content.js ",
          "content\\page-ui.js",
          "shared/browser-api.js",
          "",
          null
        ],
        css: ["content/styles.css", "/content/theme.css"]
      }
    ]
  });

  assert.deepEqual(plain(resources), {
    js: [
      "/shared/browser-api.js",
      "/shared/settings.js",
      "/content/content.js",
      "/content/page-ui.js"
    ],
    css: ["/content/styles.css", "/content/theme.css"]
  });
  assert.equal(Object.isFrozen(resources), true);
  assert.equal(Object.isFrozen(resources.js), true);
  assert.equal(Object.isFrozen(resources.css), true);
});

test("matches the fallback resources declared by the released base manifest", () => {
  assert.deepEqual(plain(fromManifest(baseManifest)), {
    js: baseManifest.content_scripts[0].js.map((file) => `/${file}`),
    css: baseManifest.content_scripts[0].css.map((file) => `/${file}`)
  });
});

test("returns empty resource lists when the manifest has no usable definition", () => {
  for (const manifest of [
    null,
    {},
    { content_scripts: {} },
    { content_scripts: [] },
    { content_scripts: [null] },
    { content_scripts: [{ matches: ["https://docs.example/*"], js: ["content/narrow.js"] }] }
  ]) {
    assert.deepEqual(plain(fromManifest(manifest)), { js: [], css: [] });
  }
});
