// Screenshot capture only. The e2e suite has its own config; keeping these
// separate means `playwright test` never writes images as a side effect.
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/capture",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list"
});
