const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({});
for (const relativePath of ["src/shared/settings.js", "src/popup/settings-controller.js"]) {
  vm.runInContext(
    fs.readFileSync(path.resolve(__dirname, `../${relativePath}`), "utf8"),
    context,
    { filename: relativePath }
  );
}
const { create } = context.CurrencyPopupSettingsController;
const settingsSchema = context.CurrencySettings;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function setting(value) {
  return { value };
}

function normalize(value) {
  return value && typeof value.value === "string" ? setting(value.value) : null;
}

function createHarness(overrides = {}) {
  const events = {
    applied: [],
    locked: [],
    reports: [],
    saved: [],
    statuses: []
  };
  const controller = create({
    normalize,
    matches: (left, right) => left?.value === right?.value,
    persist: overrides.persist || (async (payload) => ({ ok: true, settings: payload })),
    reload: overrides.reload || (async () => setting("initial")),
    apply: (settings) => events.applied.push(settings.value),
    status: (message, kind) => events.statuses.push({ message, kind }),
    lock: (message) => events.locked.push(message),
    onSaved: async (settings, details) => {
      events.saved.push({
        value: settings.value,
        syncPage: details.syncPage,
        current: details.isCurrent()
      });
      if (overrides.onSaved) await overrides.onSaved(settings, details);
    },
    reportError: (phase, error) => events.reports.push({ phase, message: error.message }),
    describeError: (error) => error?.message || String(error)
  });
  assert.deepEqual(controller.initialize(setting("initial")), setting("initial"));
  return { controller, events };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("applies a confirmed write and forwards save context", async () => {
  const { controller, events } = createHarness();

  const saved = await controller.save(setting("updated"), { syncPage: false });

  assert.equal(saved, true);
  assert.deepEqual(events.applied, ["updated"]);
  assert.deepEqual(events.saved, [{ value: "updated", syncPage: false, current: true }]);
  assert.deepEqual(events.statuses, []);
  assert.deepEqual(events.locked, []);
});

test("suppresses stale concurrent write results and makes earlier callers await the latest write", async () => {
  const writes = new Map();
  const { controller, events } = createHarness({
    persist: (payload) => {
      const write = deferred();
      writes.set(payload.value, write);
      return write.promise;
    }
  });

  const firstSave = controller.save(setting("first"));
  const secondSave = controller.save(setting("second"));
  writes.get("first").resolve({ ok: true, settings: setting("first") });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events.applied, []);

  writes.get("second").resolve({ ok: true, settings: setting("second") });
  assert.deepEqual(await Promise.all([firstSave, secondSave]), [true, true]);
  assert.deepEqual(events.applied, ["second"]);
  assert.deepEqual(events.saved.map(({ value }) => value), ["second"]);
});

test("does not overwrite a newer unsaved draft when an older write finishes", async () => {
  const write = deferred();
  const { controller, events } = createHarness({ persist: () => write.promise });

  const save = controller.save(setting("persisted"));
  controller.markDraft();
  write.resolve({ ok: true, settings: setting("persisted") });

  assert.equal(await save, true);
  assert.deepEqual(events.applied, []);
  assert.deepEqual(events.saved, []);
});

test("reconciles local validation against the last dispatched write", async () => {
  const write = deferred();
  let reloads = 0;
  const { controller, events } = createHarness({
    persist: () => write.promise,
    reload: async () => {
      reloads += 1;
      return setting("reloaded");
    }
  });

  const validSave = controller.save(setting("persisted"));
  const invalidSave = controller.save(setting("invalid"), {
    validationError: "Choose valid settings."
  });
  write.resolve({ ok: true, settings: setting("persisted") });

  assert.deepEqual(await Promise.all([validSave, invalidSave]), [false, false]);
  assert.equal(reloads, 0);
  assert.deepEqual(events.applied, ["persisted"]);
  assert.deepEqual(events.statuses, [{ message: "Choose valid settings.", kind: "error" }]);
  assert.deepEqual(events.saved, []);
});

test("treats an ambiguous write as successful when reload confirms the payload", async () => {
  const { controller, events } = createHarness({
    persist: async () => {
      throw new Error("Message port closed");
    },
    reload: async () => setting("updated")
  });

  assert.equal(await controller.save(setting("updated")), true);
  assert.deepEqual(events.applied, ["updated"]);
  assert.deepEqual(events.saved.map(({ value }) => value), ["updated"]);
  assert.deepEqual(events.reports, [{ phase: "persist", message: "Message port closed" }]);
  assert.deepEqual(events.locked, []);
});

test("reloads and reports a rejected ambiguous write without locking the popup", async () => {
  const { controller, events } = createHarness({
    persist: async () => ({ ok: false, error: "Settings rejected." }),
    reload: async () => setting("current")
  });

  assert.equal(await controller.save(setting("requested")), false);
  assert.deepEqual(events.applied, ["current"]);
  assert.deepEqual(events.statuses, [{
    message: "Settings rejected. The popup reloaded the current settings.",
    kind: "error"
  }]);
  assert.deepEqual(events.locked, []);
});

test("locks the popup when neither a write nor its reload can be confirmed", async () => {
  const { controller, events } = createHarness({
    persist: async () => {
      throw new Error("Write failed");
    },
    reload: async () => {
      throw new Error("Reload failed");
    }
  });

  assert.equal(await controller.save(setting("updated")), false);
  assert.equal(events.locked.length, 1);
  assert.match(events.locked[0], /could not be confirmed/);
  assert.deepEqual(events.reports, [
    { phase: "persist", message: "Write failed" },
    { phase: "reload", message: "Reload failed" }
  ]);
  assert.deepEqual(events.statuses, []);
});

test("preserves every canonical settings field through ambiguous-write reconciliation", async () => {
  const initial = plain(settingsSchema.DEFAULTS);
  const requested = {
    enabled: false,
    fromCurrency: "USD",
    toCurrency: "PLN",
    displayMode: "replace",
    convertedTextColor: "#123456",
    convertedBackgroundColor: "#abcdef",
    convertedShape: "pill",
    showPagePrompt: false
  };
  const applied = [];
  const saved = [];
  const controller = create({
    normalize: settingsSchema.normalizeSnapshot,
    matches: settingsSchema.snapshotEquals,
    persist: async () => {
      throw new Error("Message port closed after the write");
    },
    reload: async () => requested,
    apply: (settings) => applied.push(plain(settings)),
    status: () => {},
    lock: () => {},
    onSaved: async (settings) => saved.push(plain(settings))
  });

  assert.deepEqual(plain(controller.initialize(initial)), initial);
  assert.equal(await controller.save(requested), true);
  assert.deepEqual(applied, [requested]);
  assert.deepEqual(saved, [requested]);
  assert.deepEqual(
    Object.keys(saved[0]).sort(),
    plain(settingsSchema.KEYS).sort()
  );
});
