const path = require("node:path");
const { test: base, chromium, expect } = require("@playwright/test");

const extensionPath = path.resolve(__dirname, "../../dist/chrome");

const test = base.extend({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });
    await use(context);
    await context.close();
  },

  extensionWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await use(worker);
  },

  extensionId: async ({ extensionWorker }, use) => {
    await use(new URL(extensionWorker.url()).hostname);
  }
});

module.exports = { test, expect };
