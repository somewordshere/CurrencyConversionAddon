const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function loadScheduler() {
  const observers = [];
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.observed = [];
      observers.push(this);
    }

    observe(target) {
      this.observed.push(target);
    }

    disconnect() {}
  }
  const context = vm.createContext({
    MutationObserver: FakeMutationObserver,
    window: {
      setTimeout,
      clearTimeout
    }
  });
  vm.runInContext(
    fs.readFileSync(path.join(root, "src/content/mutation-root-scheduler.js"), "utf8"),
    context
  );
  return { create: context.CurrencyMutationRootScheduler.create, observers };
}

function element(name, parent = null) {
  const node = {
    name,
    nodeType: 1,
    parentElement: parent,
    children: [],
    contains(candidate) {
      for (let current = candidate; current; current = current.parentElement) {
        if (current === this) return true;
      }
      return false;
    }
  };
  if (parent) parent.children.push(node);
  return node;
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test("coalesces contained mutation roots before flushing", async () => {
  const { create } = loadScheduler();
  const body = element("body");
  const parent = element("parent", body);
  const child = element("child", parent);
  const flushed = [];
  const scheduler = create({
    rootProvider: () => body,
    onFlush: (roots) => flushed.push(Array.from(roots, (node) => node.name)),
    fallbackDelay: 10000
  });
  scheduler.start(body);

  scheduler.queue(child);
  scheduler.queue(parent);
  await scheduler.flushNow();

  assert.deepEqual(flushed, [["parent"]]);
  scheduler.stop();
});

test("falls back to the bounded root when pending mutations exceed the cap", async () => {
  const { create } = loadScheduler();
  const body = element("body");
  const flushed = [];
  const scheduler = create({
    rootProvider: () => body,
    onFlush: (roots) => flushed.push(Array.from(roots, (node) => node.name)),
    maxPendingRoots: 2,
    fallbackDelay: 10000
  });
  scheduler.start(body);

  scheduler.queue(element("one"));
  scheduler.queue(element("two"));
  scheduler.queue(element("three"));
  await scheduler.flushNow();

  assert.deepEqual(flushed, [["body"]]);
  scheduler.stop();
});

test("observes an open shadow root on a newly added host", async () => {
  const { create, observers } = loadScheduler();
  const body = element("body");
  const host = element("host");
  const shadowRoot = { name: "shadow", nodeType: 11, children: [] };
  host.shadowRoot = shadowRoot;
  const flushed = [];
  const scheduler = create({
    rootProvider: () => body,
    onFlush: (roots) => flushed.push(Array.from(roots, (node) => node.name)),
    fallbackDelay: 10000
  });
  scheduler.start(body);

  observers[0].callback([{ type: "childList", addedNodes: [host] }]);
  assert.equal(observers[0].observed.includes(shadowRoot), true);
  await scheduler.flushNow();
  assert.deepEqual(flushed, [["host"]]);
  scheduler.stop();
});

test("re-observes existing shadow roots after the scheduler restarts", () => {
  const { create, observers } = loadScheduler();
  const body = element("body");
  const host = element("host", body);
  const shadowRoot = { name: "shadow", nodeType: 11, children: [] };
  host.shadowRoot = shadowRoot;
  const scheduler = create({
    rootProvider: () => body,
    onFlush: () => {},
    fallbackDelay: 10000
  });

  assert.equal(scheduler.start(body), true);
  assert.equal(scheduler.start(body), false);
  scheduler.stop();
  assert.equal(scheduler.start(body), true);

  assert.equal(observers.length, 2);
  assert.equal(observers[0].observed.includes(shadowRoot), true);
  assert.equal(observers[1].observed.includes(shadowRoot), true);
  scheduler.stop();
});

test("a restarted lifecycle flushes independently of an older pending flush", async () => {
  const { create } = loadScheduler();
  const body = element("body");
  const oldGate = deferred();
  const currentGate = deferred();
  const flushed = [];
  const scheduler = create({
    rootProvider: () => body,
    onFlush: (roots) => {
      flushed.push(Array.from(roots, (node) => node.name));
      if (flushed.length === 1) return oldGate.promise;
      if (flushed.length === 2) return currentGate.promise;
      return undefined;
    },
    fallbackDelay: 10000
  });

  scheduler.start(body);
  scheduler.queue(element("old-root"));
  const oldFlush = scheduler.flushNow();
  assert.deepEqual(flushed, [["old-root"]]);

  scheduler.stop();
  scheduler.start(body);
  scheduler.queue(element("current-root"));
  const currentFlush = scheduler.flushNow();
  assert.deepEqual(flushed, [["old-root"], ["current-root"]]);

  oldGate.resolve();
  await oldFlush;
  scheduler.queue(element("queued-during-current-flush"));
  await scheduler.flushNow();
  assert.equal(flushed.length, 2, "the old finalizer must not unlock the current lifecycle");

  currentGate.resolve();
  await currentFlush;
  await scheduler.flushNow();
  assert.deepEqual(flushed, [
    ["old-root"],
    ["current-root"],
    ["queued-during-current-flush"]
  ]);
  scheduler.stop();
});
