(function exposePopupSettingsController(root) {
  "use strict";

  function create(options = {}) {
    const normalize = requireFunction(options.normalize, "normalize");
    const matches = requireFunction(options.matches, "matches");
    const persist = requireFunction(options.persist, "persist");
    const reload = requireFunction(options.reload, "reload");
    const apply = requireFunction(options.apply, "apply");
    const status = requireFunction(options.status, "status");
    const lock = requireFunction(options.lock, "lock");
    const onSaved = typeof options.onSaved === "function" ? options.onSaved : async () => {};
    const reportError = typeof options.reportError === "function" ? options.reportError : () => {};
    const describeError = typeof options.describeError === "function"
      ? options.describeError
      : defaultErrorMessage;

    let confirmedSettings = null;
    let writeRevision = 0;
    let draftRevision = 0;
    let latestWrite = Promise.resolve(true);
    let latestDispatchedWrite = Promise.resolve(null);

    function initialize(settings) {
      const normalized = normalize(settings);
      if (!normalized) return null;
      confirmedSettings = normalized;
      latestDispatchedWrite = Promise.resolve({ ok: true, settings: normalized });
      return normalized;
    }

    function markDraft() {
      draftRevision += 1;
    }

    function save(payload, { validationError = null, syncPage = true } = {}) {
      const revision = ++writeRevision;
      const savedDraftRevision = draftRevision;
      let outcomePromise;

      if (validationError) {
        outcomePromise = reconcileLocalValidationFailure(validationError);
      } else {
        outcomePromise = persistAndReconcile(payload);
        latestDispatchedWrite = outcomePromise;
      }

      const completion = outcomePromise.then((outcome) => {
        if (!isCurrent(revision, savedDraftRevision)) return Boolean(outcome?.ok);
        return settleOutcome(outcome, payload, { revision, syncPage });
      }).catch((error) => {
        if (isCurrent(revision, savedDraftRevision)) {
          lock(
            `Settings could not be saved or reloaded. ${describeError(error)} ` +
            "Close and reopen the popup to try again."
          );
        }
        return false;
      });

      const waitForLatest = completion.then((saved) => {
        if (revision === writeRevision) return saved;
        return latestWrite;
      });
      latestWrite = waitForLatest;
      return waitForLatest;
    }

    function isCurrent(revision, savedDraftRevision = draftRevision) {
      return revision === writeRevision && savedDraftRevision === draftRevision;
    }

    async function reconcileLocalValidationFailure(validationError) {
      const pendingWrite = latestDispatchedWrite;
      let priorOutcome = null;
      try {
        priorOutcome = await pendingWrite;
      } catch (_error) {
        // Reload below if an unexpected write failure escaped normal reconciliation.
      }

      const priorSettings = normalize(priorOutcome?.settings);
      const actualSettings = priorSettings || await reloadNormalizedSettings();
      if (!actualSettings && priorOutcome?.fatal) {
        return {
          ok: false,
          fatal: true,
          error: `${validationError} ${priorOutcome.error || "Current settings could not be reloaded."}`
        };
      }
      return {
        ok: false,
        settings: actualSettings || confirmedSettings,
        error: validationError
      };
    }

    async function persistAndReconcile(payload) {
      let result;
      try {
        result = await persist(payload);
      } catch (error) {
        reportError("persist", error);
        return reconcileAmbiguousFailure(payload);
      }

      const returnedSettings = normalize(result?.settings);
      if (result?.ok === true && returnedSettings) {
        return { ok: true, settings: returnedSettings };
      }
      if (result?.ok === false && returnedSettings) {
        return {
          ok: false,
          settings: returnedSettings,
          error: result.error || "Could not save settings."
        };
      }
      return reconcileAmbiguousFailure(payload, result?.error);
    }

    async function reconcileAmbiguousFailure(payload, reportedError) {
      const actualSettings = await reloadNormalizedSettings();
      if (!actualSettings) {
        return {
          ok: false,
          fatal: true,
          error: "The settings update could not be confirmed, and the current settings could not be reloaded. Close and reopen the popup to try again."
        };
      }
      if (matches(actualSettings, payload)) {
        return { ok: true, settings: actualSettings, reconciled: true };
      }
      return {
        ok: false,
        settings: actualSettings,
        error: reportedError
          ? `${reportedError} The popup reloaded the current settings.`
          : "The settings update could not be confirmed. The popup reloaded the current settings."
      };
    }

    async function reloadNormalizedSettings() {
      try {
        return normalize(await reload());
      } catch (error) {
        reportError("reload", error);
        return null;
      }
    }

    async function settleOutcome(outcome, payload, { revision, syncPage }) {
      if (!outcome?.ok) {
        const recoveredSettings = normalize(outcome?.settings);
        if (recoveredSettings) {
          confirmedSettings = recoveredSettings;
          apply(confirmedSettings);
        }
        if (outcome?.fatal) lock(outcome.error);
        else status(outcome?.error || "Could not save settings.", "error");
        return false;
      }

      confirmedSettings = normalize(outcome.settings) || normalize(payload) || payload;
      apply(confirmedSettings);
      if (revision !== writeRevision) return true;

      await onSaved(confirmedSettings, {
        syncPage,
        isCurrent: () => revision === writeRevision
      });
      return true;
    }

    return Object.freeze({ initialize, markDraft, save });
  }

  function requireFunction(value, name) {
    if (typeof value !== "function") {
      throw new TypeError(`Popup settings controller requires a ${name} function.`);
    }
    return value;
  }

  function defaultErrorMessage(error) {
    return error instanceof Error && error.message
      ? error.message
      : String(error || "Unknown browser error");
  }

  root.CurrencyPopupSettingsController = Object.freeze({ create });
})(globalThis);
