const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const context = vm.createContext({});
vm.runInContext(
  fs.readFileSync(path.join(root, "src/content/conversion-registry.js"), "utf8"),
  context
);

const { create } = context.CurrencyConversionRegistry;

test("prunes every detached conversion even when a connected entry appears first", () => {
  const registry = create();
  const connected = { isConnected: true };
  const detachedOne = { isConnected: false };
  const detachedTwo = { isConnected: false };
  registry.add(connected);
  registry.add(detachedOne);
  registry.add(detachedTwo);

  assert.equal(registry.hasAny(), true);
  assert.equal(registry.size(), 1);
});

test("restores every connected conversion and clears the registry", () => {
  const restored = [];
  const registry = create({ restoreWrapper: (wrapper) => restored.push(wrapper.id) });
  registry.add({ id: "first", isConnected: true });
  registry.add({ id: "detached", isConnected: false });
  registry.add({ id: "second", isConnected: true });

  registry.restoreAll();

  assert.deepEqual(restored, ["first", "second"]);
  assert.equal(registry.size(), 0);
  assert.equal(registry.hasAny(), false);
});

test("default restoration removes appended badges and replaces inline wrappers with original text", () => {
  const replacement = { value: null };
  const appended = {
    isConnected: true,
    dataset: { ccpAppended: "true" },
    remove() {
      this.removed = true;
    }
  };
  const inline = {
    isConnected: true,
    dataset: {},
    ownerDocument: {
      createTextNode(value) {
        return { nodeValue: value };
      }
    },
    querySelector() {
      return { textContent: "$10.00" };
    },
    replaceWith(node) {
      replacement.value = node;
    }
  };
  const registry = create();
  registry.add(appended);
  registry.add(inline);

  registry.restoreAll();

  assert.equal(appended.removed, true);
  assert.deepEqual(replacement.value, { nodeValue: "$10.00" });
  assert.equal(registry.size(), 0);
});

test("updates presentation in place for connected conversions only", () => {
  const updated = [];
  const registry = create({
    updateWrapperPresentation: (wrapper, settings) => updated.push([wrapper.id, settings.displayMode])
  });
  const connected = { id: "connected", isConnected: true };
  registry.add(connected);
  registry.add({ id: "detached", isConnected: false });

  registry.updatePresentation({ displayMode: "replace" });

  assert.deepEqual(updated, [["connected", "replace"]]);
  assert.equal(registry.size(), 1);
  assert.equal(registry.hasAny(), true);
});
