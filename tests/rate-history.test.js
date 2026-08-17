const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../src/background/rate-history.js"),
  "utf8"
);

function loadService({ fetchImpl, store = {} } = {}) {
  const local = { ...store };
  const context = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    Date,
    Math,
    Number,
    JSON,
    fetch: fetchImpl,
    ExtensionAPI: {
      storage: {
        local: {
          get: async (key) => (key in local ? { [key]: local[key] } : {}),
          set: async (values) => Object.assign(local, values)
        }
      }
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(SOURCE, context, { filename: "src/background/rate-history.js" });
  return { service: context.CurrencyRateHistoryService, local };
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const SERIES = [
  { date: "2026-07-06", base: "USD", quote: "EUR", rate: 0.9 },
  { date: "2026-07-07", base: "USD", quote: "EUR", rate: 0.91 },
  { date: "2026-07-08", base: "USD", quote: "EUR", rate: 0.945 }
];

test("rate history requests the provider's time-series window and summarizes it", async () => {
  const calls = [];
  const { service } = loadService({
    fetchImpl: async (url) => {
      calls.push(url);
      return jsonResponse(SERIES);
    }
  });

  const result = await service.getHistory("USD", "EUR");
  assert.equal(result.ok, true);
  assert.equal(result.cached, false);
  assert.equal(result.points.length, 3);
  assert.equal(result.low, 0.9);
  assert.equal(result.high, 0.945);
  assert.equal(Number(result.changeRatio.toFixed(4)), 0.05);

  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/api\.frankfurter\.dev\/v2\/rates\?/);
  assert.match(calls[0], /base=USD/);
  assert.match(calls[0], /quotes=EUR/);
  assert.match(calls[0], /from=\d{4}-\d{2}-\d{2}/);
  assert.match(calls[0], /to=\d{4}-\d{2}-\d{2}/);
});

test("rate history rejects unusable currency pairs before any request", async () => {
  let requested = false;
  const { service } = loadService({
    fetchImpl: async () => {
      requested = true;
      return jsonResponse(SERIES);
    }
  });

  assert.equal((await service.getHistory("USD", "USD")).ok, false);
  assert.equal((await service.getHistory("usd", "EUR")).ok, false);
  assert.equal((await service.getHistory("", "EUR")).ok, false);
  assert.equal((await service.getHistory("USD", null)).ok, false);
  assert.equal(requested, false);
});

test("rate history serves a fresh cache without refetching", async () => {
  let fetchCount = 0;
  const { service } = loadService({
    fetchImpl: async () => {
      fetchCount += 1;
      return jsonResponse(SERIES);
    }
  });

  await service.getHistory("USD", "EUR");
  await service.getHistory("USD", "EUR");
  assert.equal(fetchCount, 1);
});

test("rate history falls back to a stale cache when the provider fails", async () => {
  let shouldFail = false;
  const { service, local } = loadService({
    fetchImpl: async () => {
      if (shouldFail) throw new Error("network down");
      return jsonResponse(SERIES);
    }
  });

  await service.getHistory("USD", "EUR");
  // Age the cached entry past its freshness window.
  local.rateHistoryCache.pairs["USD:EUR"].fetchedAt = new Date(Date.now() - 86_400_000).toISOString();
  shouldFail = true;

  const result = await service.getHistory("USD", "EUR");
  assert.equal(result.ok, true);
  assert.equal(result.cached, true);
  assert.equal(result.points.length, 3);
});

test("rate history reports failure rather than throwing when nothing is cached", async () => {
  const { service } = loadService({
    fetchImpl: async () => {
      throw new Error("network down");
    }
  });

  const result = await service.getHistory("USD", "EUR");
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, "string");
});

test("rate history refuses a provider payload with too few usable points", async () => {
  const { service } = loadService({
    fetchImpl: async () => jsonResponse([
      { date: "2026-07-06", rate: 0.9 },
      { date: "2026-07-07", rate: "not-a-number" },
      { rate: 0.92 }
    ])
  });

  assert.equal((await service.getHistory("USD", "EUR")).ok, false);
});

test("rate history sanitizes, de-duplicates and orders provider points", () => {
  const { service } = loadService({ fetchImpl: async () => jsonResponse([]) });
  const points = service.sanitizeSeries([
    { date: "2026-07-08", rate: 0.945 },
    { date: "2026-07-06", rate: 0.9 },
    { date: "2026-07-06", rate: 0.905 },
    { date: "2026-07-07", rate: -1 },
    { date: null, rate: 0.93 },
    "nonsense"
  ]);

  // Points are built inside the VM context, so round-trip them to host objects
  // before comparing: deepStrictEqual also compares prototypes.
  assert.deepEqual(JSON.parse(JSON.stringify(points)), [
    { date: "2026-07-06", rate: 0.905 },
    { date: "2026-07-08", rate: 0.945 }
  ]);
});

test("rate history shares one in-flight request per pair", async () => {
  let fetchCount = 0;
  const { service } = loadService({
    fetchImpl: async () => {
      fetchCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return jsonResponse(SERIES);
    }
  });

  const [first, second] = await Promise.all([
    service.getHistory("USD", "EUR"),
    service.getHistory("USD", "EUR")
  ]);
  assert.equal(fetchCount, 1);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
});
