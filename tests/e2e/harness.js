const { expect } = require("@playwright/test");
const { createSeededExtensionState } = require("../helpers/extension-state");

const DEFAULT_SHOP_URL = "https://api.frankfurter.dev/test-shop";

async function seedExtension(extensionWorker, options = {}) {
  await expect.poll(async () => extensionWorker.evaluate(async () => (
    typeof (await chrome.storage.sync.get("enabled")).enabled === "boolean"
  )), {
    message: "extension installation to initialize sync storage",
    timeout: 15_000
  }).toBe(true);

  const state = createSeededExtensionState({
    ...options,
    settings: {
      showPagePrompt: false,
      ...(options.settings || {})
    }
  });
  await extensionWorker.evaluate(async ({ sync, local }) => {
    await chrome.storage.sync.set(sync);
    await chrome.storage.local.set(local);
  }, state);
}

async function runPageCommand(extensionWorker, type, url = DEFAULT_SHOP_URL) {
  return extensionWorker.evaluate(async ({ url, type }) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url === url);
    if (!tab?.id) throw new Error(`Could not find test page tab: ${url}`);
    await CurrencyPageActions.ensureContentScripts(tab.id);
    return chrome.tabs.sendMessage(tab.id, { type });
  }, { url, type });
}

async function openPopupForPage(context, extensionId, activePage) {
  // chrome.action.openPopup() creates a real POPUP runtime context in headless Chromium,
  // but Playwright does not expose that context as a Page. Loading the same extension
  // document in a background tab while the shop stays active exercises the popup code
  // against the real target tab and keeps its DOM inspectable.
  const popup = await context.newPage();
  await activePage.bringToFront();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await expect(popup.getByRole("heading", { name: "Currency Converter Pro" })).toBeVisible();
  return popup;
}

async function evaluateRealActionPopup(context, extensionWorker, activePage, expression) {
  await activePage.bringToFront();
  await extensionWorker.evaluate(() => chrome.action.openPopup());

  const popupUrl = new URL("/popup/popup.html", extensionWorker.url()).href;
  const cdp = await context.newCDPSession(activePage);
  let popupTarget;

  try {
    await expect.poll(async () => {
      const { targetInfos } = await cdp.send("Target.getTargets");
      popupTarget = targetInfos.find((target) => target.url === popupUrl);
      return Boolean(popupTarget);
    }).toBe(true);

    const { sessionId } = await cdp.send("Target.attachToTarget", {
      targetId: popupTarget.targetId,
      flatten: false
    });
    const commandId = 1;
    const response = new Promise((resolve, reject) => {
      const receive = ({ sessionId: source, message }) => {
        if (source !== sessionId) return;
        const payload = JSON.parse(message);
        if (payload.id !== commandId) return;
        cdp.off("Target.receivedMessageFromTarget", receive);
        if (payload.error) reject(new Error(payload.error.message));
        else resolve(payload);
      };
      cdp.on("Target.receivedMessageFromTarget", receive);
    });

    await cdp.send("Target.sendMessageToTarget", {
      sessionId,
      message: JSON.stringify({
        id: commandId,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true }
      })
    });

    const payload = await response;
    await cdp.send("Target.detachFromTarget", { sessionId });
    return payload.result.result.value;
  } finally {
    await cdp.detach();
  }
}

async function runContentUiScenario(extensionWorker, scenario, url = DEFAULT_SHOP_URL) {
  const { sync: settings } = createSeededExtensionState({
    settings: { fromCurrency: "USD", showPagePrompt: false }
  });

  return extensionWorker.evaluate(async ({ scenario, url, settings }) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url === url);
    if (!tab?.id) throw new Error(`Could not find test page tab: ${url}`);
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "ISOLATED",
      args: [scenario, settings],
      func: async (scenarioName, scenarioSettings) => {
        const ui = globalThis.CurrencyPageUi;
        if (!ui) return { ok: false, error: "CurrencyPageUi is not loaded." };

        if (scenarioName === "complete-selection-success") {
          if (typeof globalThis.__ccpCompleteSelectionConversion !== "function") {
            return { ok: false, error: "No selection conversion is waiting to complete." };
          }
          globalThis.__ccpCompleteSelectionConversion();
        } else if (scenarioName === "selection-success") {
          ui.configure({
            settings: scenarioSettings,
            runConversion: async () => ({ ok: true }),
            clearConversion: async () => ({ ok: true }),
            convertSelection: () => new Promise((resolve) => {
              globalThis.__ccpCompleteSelectionConversion = () => {
                delete globalThis.__ccpCompleteSelectionConversion;
                resolve({ ok: true, sourceCurrency: "USD", converted: "EUR 90.00" });
              };
            })
          });
        } else if (scenarioName === "rejected-actions") {
          ui.configure({
            settings: scenarioSettings,
            runConversion: async () => {
              throw new Error("Conversion callback rejected");
            },
            clearConversion: async () => {
              throw new Error("Restore callback rejected");
            },
            convertSelection: async () => {
              throw new Error("Selection callback rejected");
            }
          });
          ui.showPageConvertPrompt();
        } else if (scenarioName === "undo-rejection") {
          ui.configure({
            settings: scenarioSettings,
            runConversion: async () => ({
              ok: true,
              count: 1,
              detectedCurrency: "USD"
            }),
            clearConversion: async () => {
              throw new Error("Restore callback rejected");
            },
            convertSelection: async () => {
              throw new Error("Selection callback rejected");
            }
          });
        } else if (scenarioName === "toast-rejection") {
          ui.showToast("Converted 1 price.", {
            actionLabel: "Undo",
            onAction: async () => {
              throw new Error("Toast callback rejected");
            }
          });
        } else {
          return { ok: false, error: `Unknown scenario: ${scenarioName}` };
        }
        return { ok: true };
      }
    });
    return execution?.result;
  }, { scenario, url, settings });
}

module.exports = {
  DEFAULT_SHOP_URL,
  evaluateRealActionPopup,
  openPopupForPage,
  runContentUiScenario,
  runPageCommand,
  seedExtension
};
