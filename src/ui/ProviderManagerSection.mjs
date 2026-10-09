// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
/**
 * The provider-manager tab: what this plugin owns, and the controls to change it.
 *
 * This is the half the importer does not cover. The importer reads CC Switch's
 * database; this manages the catalogue directly, which is why it works with no
 * CC Switch installed at all.
 *
 * Everything the Host sends is treated as untrusted. `providers`, `order`,
 * `presets` and `warnings` all pass through the controller's sanitizers before
 * they reach this file, so a Host half older than this bundle degrades to an
 * empty or partial table rather than a thrown render.
 */
import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { makeTranslator } from "../client/i18n.mjs";
import { draftFromPreset, draftFromProvider, emptyDraft, ProviderEditModal } from "./ProviderEditModal.mjs";

const h = React.createElement;

/**
 * How a failed row action is worded, per operation.
 *
 * The Host's own message ("could not delete the provider") is accurate but
 * generic, and the user clicked one of four buttons — naming the operation is
 * what makes the failure readable at a glance. Keyed by operation rather than
 * by route so a new action has one obvious place to add its wording.
 */
const FAILURE_TEXT = {
  activate: ["manager.activateFailed", "启用失败：{message}"],
  delete: ["manager.deleteFailed", "删除失败：{message}"],
  save: ["manager.saveFailed", "保存失败：{message}"],
};

/**
 * Which empty state the table shows, as a key rather than a sentence.
 *
 * Three different situations look identical on screen — the first read has not
 * finished, the namespace exists but holds nothing, and the namespace does not
 * exist at all — and they need different words: only the last one explains
 * that the namespace is created on first write.
 *
 * Only a completed read earns a definite answer. `exists` is a claim about the
 * settings document, and the initial snapshot holds `false` before anything has
 * been read, so answering from it would make the tab announce "this plugin has
 * no namespace" on the very first frame. A failed or conflicted read returns
 * `null` instead: the banner above already explains that, and the empty line
 * would only contradict it.
 *
 * @param {object} snapshot
 * @returns {'loading'|'empty'|'emptyNoNamespace'|null}
 */
export function emptyState(snapshot) {
  const status = snapshot?.status;
  if (status === 'error' || status === 'conflict') return null;
  // Everything that is not a finished read — `idle` on the first frame, a read
  // in flight, a write in flight, or no snapshot at all — knows nothing yet.
  if (status !== 'ready') return 'loading';
  return snapshot.exists === true ? 'empty' : 'emptyNoNamespace';
}

/**
 * Everything one row renders, derived once.
 *
 * Exported so a test can assert the badge and pending decisions without a DOM.
 * `pending` and `action` are separate because a row shows its own verb while
 * busy ("删除中…") and a different one at rest.
 */
export function providerRowView(provider, snapshot) {
  const key = provider?.key ?? '';
  const pending = snapshot?.pendingKey !== undefined && snapshot.pendingKey === key;
  return {
    key,
    name: provider?.displayName || key,
    isCurrent: provider?.isCurrent === true,
    // Anything the Host did not explicitly report as found reads as missing:
    // the failure that matters is a provider whose key is unset, and it must
    // never be dressed up as ready.
    credentialFound: provider?.credential === 'found',
    modelCount: Array.isArray(provider?.models) ? provider.models.length : 0,
    inFailoverQueue: provider?.inFailoverQueue === true,
    pending,
    action: pending ? snapshot?.pendingAction : undefined,
    disabled: snapshot?.status === 'busy' || snapshot?.status === 'loading',
  };
}

/**
 * Which dialog is open, if any — and the document revision it was opened at.
 *
 * The revision is captured here rather than read from the live snapshot when
 * Save is pressed. That distinction is the whole point of sending one: a
 * background refresh between opening the form and submitting it moves the
 * document, and reading the *current* revision at submit time would compare the
 * write against itself and always succeed — silently overwriting whatever the
 * refresh brought in. Pinning it at open time is what makes the Host refuse.
 *
 * @param {number|undefined} revision - the revision when the form is opened.
 * @param {() => void} onOpen - clears the previous attempt's failure, so a
 *   dialog never opens showing errors from a save the user already abandoned.
 */
function useDialog(revision, onOpen) {
  const [dialog, setDialog] = useState(null);
  const open = (next) => {
    onOpen?.();
    setDialog({ revision, ...next });
  };
  return {
    dialog,
    openCreate: (preset) => open({ mode: "create", draft: preset ? draftFromPreset(preset) : emptyDraft() }),
    openEdit: (provider) => open({ mode: "edit", draft: draftFromProvider(provider) }),
    openDuplicate: (provider) => open({
      mode: "create",
      // A duplicate is a *new* provider that starts from an existing one, so the
      // key is dropped: keeping it would make the save an update to the
      // original, which is the opposite of what "Duplicate" promises.
      draft: { ...draftFromProvider(provider), key: undefined, isCurrent: false },
    }),
    close: () => setDialog(null),
  };
}

export function ProviderManagerSection({ controller, t }) {
  const tr = makeTranslator(t);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  // The revision is captured when a dialog opens; see `useDialog`.
  const { dialog, openCreate, openEdit, openDuplicate, close } = useDialog(
    snapshot.revision,
    () => controller.clearSaveFeedback?.(),
  );
  const [presetKey, setPresetKey] = useState("");
  // Per-row failure text, keyed by provider, so one row's error does not blank
  // the whole table. The controller reports the operation, not which row it was
  // for, because it cannot know how the tab groups its rows.
  const [rowError, setRowError] = useState(null);
  const loadedPresets = useRef(false);

  useEffect(() => {
    if (snapshot.status === "idle") void controller.refresh().catch(() => {});
  }, [controller, snapshot.status]);

  useEffect(() => {
    // Presets are static and optional; a failure here must not stop the tab
    // from listing the providers the user already has.
    if (loadedPresets.current) return;
    loadedPresets.current = true;
    void controller.loadPresets().catch(() => {});
  }, [controller]);

  const providers = snapshot.providers ?? {};
  const order = Array.isArray(snapshot.order) ? snapshot.order : [];
  const presets = Array.isArray(snapshot.presets) ? snapshot.presets : [];
  const busy = snapshot.status === "busy" || snapshot.status === "loading";
  const activation = snapshot.activation;

  const runRowAction = async (key, action, kind) => {
    setRowError(null);
    try {
      await action();
    } catch (error) {
      // The controller has already published the failure; this only decides
      // where it is shown. A conflict is reported once, at the top, because the
      // whole table it was attempted against is now stale.
      if (error?.conflict) return;
      // The Host refuses to delete the active provider. That is worth saying on
      // the row itself, and its own sentence is not translated, so the reason
      // code selects the localized one.
      if (error?.reason === "active-provider") {
        setRowError({ key, message: tr("manager.deleteActive", "该 provider 正在使用中，请先启用其他 provider 再删除。") });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      const [fallbackKey, fallback] = FAILURE_TEXT[kind] ?? FAILURE_TEXT.delete;
      setRowError({ key, message: tr(fallbackKey, fallback, { message }) });
    }
  };

  const onActivate = (key) => runRowAction(key, () => controller.activate(key), "activate");
  const onDelete = (provider) => {
    const name = provider.displayName || provider.key;
    // Destructive and irreversible, so it is confirmed. `window.confirm` is
    // deliberate: this runs inside the settings dialog, where a second layered
    // modal would trap focus against the first.
    if (typeof window !== "undefined" && typeof window.confirm === "function"
      && !window.confirm(tr("manager.deleteConfirm", "确定删除 provider「{name}」？该操作无法撤销。", { name }))) {
      return
    }
    void runRowAction(provider.key, () => controller.remove(provider.key), "delete");
  };

  const submitDialog = (draft) => {
    // The revision the form was *opened* at, not the one in the snapshot now: a
    // refresh that landed while the user was typing means the document moved,
    // and the Host has to be able to refuse rather than let the form overwrite
    // it. Reading the live revision here would compare the write against itself
    // and always succeed.
    void controller.save({ ...draft, expectedRevision: dialog?.revision })
      .then(() => close())
      .catch(() => {
        // Stay open: the modal renders the Host's `errors` and the conflict
        // flag, and closing it would throw away the form the user just filled.
      });
  };

  const applyPreset = (key) => {
    setPresetKey(key);
    if (key === "") return;
    const preset = presets.find((entry) => entry.key === key);
    if (preset) openCreate(preset);
    setPresetKey("");
  };

  const rows = order.map((key) => providers[key]).filter(Boolean);

  return h("section", { className: "dsh-ccswitch-manager", "aria-labelledby": "dsh-ccswitch-manager-title" },
    h("div", { className: "dsh-ccswitch-manager__header" },
      h("div", null,
        h("h2", { id: "dsh-ccswitch-manager-title", className: "dsh-ccswitch-manager__title" }, tr("manager.title", "供应商管理")),
        h("p", { className: "dsh-ccswitch-manager__hint" }, tr("manager.hintExpanded", "直接管理本插件拥有的 provider：新增、编辑、复制、删除、启用。")),
      ),
      h("div", { className: "dsh-ccswitch-manager__header-actions" },
        presets.length > 0
          ? h("label", { className: "dsh-ccswitch-manager__preset" },
            h("span", { className: "dsh-ccswitch-manager__preset-label" }, tr("manager.presetLabel", "预设")),
            h("select", {
              className: "dsh-ccswitch-manager__preset-select",
              value: presetKey,
              onChange: (event) => applyPreset(event.target.value),
            },
              h("option", { value: "" }, tr("manager.presetNone", "自定义（空白）")),
              ...presets.map((preset) => h("option", { key: preset.key, value: preset.key }, preset.displayName)),
            ),
          )
          : null,
        h("button", {
          type: "button",
          className: "dsh-ccswitch-import__secondary",
          disabled: busy,
          onClick: () => { void controller.refresh().catch(() => {}); },
        }, snapshot.status === "loading" ? tr("manager.refreshing", "刷新中…") : tr("manager.refresh", "刷新")),
        h("button", {
          type: "button",
          className: "dsh-ccswitch-import__primary",
          disabled: busy,
          onClick: () => openCreate(),
        }, tr("manager.add", "新增 provider")),
      ),
    ),

    snapshot.presetsError
      ? h("p", { className: "dsh-ccswitch-manager__note" },
        tr("manager.presetsFailed", "预设列表加载失败：{message}", { message: snapshot.presetsError }))
      : null,

    snapshot.error
      ? h("p", { role: "alert", className: "dsh-ccswitch-import__error" },
        snapshot.conflict
          // A conflict is not "your edit was wrong" — the document moved. The
          // table has already been re-read by the controller, so the actionable
          // instruction is to look at the new state and retry.
          ? tr("manager.conflict", "设置文档已被其他地方改动，列表已刷新，请重试。")
          : snapshot.error)
      : null,

    activation
      ? h("div", {
        role: "status",
        className: "dsh-ccswitch-manager__activation"
          + (activation.applied ? "" : " dsh-ccswitch-manager__activation--warn"),
      },
        h("div", { className: "dsh-ccswitch-manager__activation-head" },
          h("strong", null, tr("manager.activated", "已启用 {name}", {
            name: providers[activation.key]?.displayName ?? activation.key,
          })),
          h("button", {
            type: "button",
            className: "dsh-ccswitch-import__link",
            onClick: () => controller.dismissActivation(),
          }, tr("manager.dismiss", "知道了")),
        ),
        !activation.applied
          ? h("p", { className: "dsh-ccswitch-manager__activation-warning" },
            tr("manager.activatedNotApplied", "已标记为启用，但 DSH 没有接受该 provider，模型请求仍走原来的路由。"))
          : null,
        activation.warnings.length > 0
          ? h("div", null,
            h("p", { className: "dsh-ccswitch-manager__activation-title" }, tr("manager.activationWarnings", "启用提示")),
            h("ul", { className: "dsh-ccswitch-manager__activation-list" },
              ...activation.warnings.map((warning, index) => h("li", { key: `${index}-${warning}` }, warning)),
            ),
          )
          : null,
      )
      : null,

    rows.length === 0
      ? (() => {
        const state = emptyState(snapshot);
        // `null` means a read failed: the error banner is already on screen and
        // a second line guessing at the contents would only contradict it.
        if (state === null) return null;
        if (state === 'loading') {
          return h("p", { className: "dsh-ccswitch-manager__empty" }, tr("manager.loading", "正在读取 provider 列表…"));
        }
        // "No namespace yet" and "namespace exists but is empty" are different
        // situations: only the first is worth explaining how it gets created.
        return h("p", { className: "dsh-ccswitch-manager__empty" }, state === 'empty'
          ? tr("manager.empty", "还没有 provider，点击「新增 provider」开始。")
          : tr("manager.emptyNoNamespace", "本插件尚未创建设置命名空间；添加第一个 provider 时会一并创建。"));
      })()
      : h("div", { className: "dsh-ccswitch-manager__list" },
        ...rows.map((provider) => {
          const view = providerRowView(provider, snapshot);
          const { name, pending, action } = view;
          return h("div", {
            key: view.key,
            className: "dsh-ccswitch-manager__row"
              + (view.isCurrent ? " dsh-ccswitch-manager__row--current" : ""),
          },
            h("div", { className: "dsh-ccswitch-manager__content" },
              h("div", { className: "dsh-ccswitch-manager__primary-line" },
                h("strong", null, name),
                view.isCurrent
                  ? h("span", { className: "dsh-ccswitch-import__badge dsh-ccswitch-import__badge--new" },
                    tr("manager.active", "当前启用"))
                  : null,
              ),
              h("div", { className: "dsh-ccswitch-manager__meta-line" },
                h("code", { className: "dsh-ccswitch-manager__provider-key" }, view.key),
                h("span", { className: "dsh-ccswitch-manager__protocol" }, provider.api || "—"),
                provider.baseURL ? h("code", null, provider.baseURL) : null,
                h("span", null, view.modelCount > 0
                  ? tr("manager.modelCount", "{count} 个模型", { count: view.modelCount })
                  : tr("manager.noModels", "无模型")),
                h("span", {
                  className: "dsh-ccswitch-import__badge"
                    + (view.credentialFound ? " dsh-ccswitch-import__badge--new" : " dsh-ccswitch-import__badge--blocked"),
                }, view.credentialFound
                  ? tr("manager.credentialFound", "凭据已找到")
                  : tr("manager.credentialMissing", "缺少凭据")),
                view.inFailoverQueue
                  ? h("span", { className: "dsh-ccswitch-manager__failover" }, tr("manager.failover", "故障转移队列"))
                  : null,
              ),
              rowError && rowError.key === view.key
                ? h("p", { role: "alert", className: "dsh-ccswitch-manager__row-error" }, rowError.message)
                : null,
            ),
            h("div", { className: "dsh-ccswitch-manager__row-actions", role: "group", "aria-label": tr("manager.rowActionsAria", "{name} 的操作", { name }) },
              h("button", {
                type: "button",
                className: "dsh-ccswitch-import__link",
                // Activating the row that is already current is a no-op that
                // still costs a settings write and a full-catalogue edit.
                disabled: view.disabled || view.isCurrent,
                "aria-label": tr("manager.activateAria", "启用 {name}", { name }),
                onClick: () => onActivate(view.key),
              }, action === "activate" ? tr("manager.activating", "启用中…") : tr("manager.activate", "启用")),
              h("button", {
                type: "button",
                className: "dsh-ccswitch-import__link",
                disabled: view.disabled,
                "aria-label": tr("manager.editAria", "编辑 {name}", { name }),
                onClick: () => openEdit(provider),
              }, tr("manager.edit", "编辑")),
              h("button", {
                type: "button",
                className: "dsh-ccswitch-import__link",
                disabled: view.disabled,
                "aria-label": tr("manager.duplicateAria", "复制 {name}", { name }),
                onClick: () => openDuplicate(provider),
              }, tr("manager.duplicate", "复制")),
              h("button", {
                type: "button",
                className: "dsh-ccswitch-import__link dsh-ccswitch-manager__danger",
                disabled: view.disabled,
                "aria-label": tr("manager.deleteAria", "删除 {name}", { name }),
                onClick: () => onDelete(provider),
              }, action === "delete" ? tr("manager.deleting", "删除中…") : tr("manager.delete", "删除")),
            ),
          );
        }),
      ),

    // Keyed by which provider is being edited, so opening "edit" on a second
    // row remounts the form; without it React would reuse the first row's state
    // and the dialog would show the wrong provider. The revision is deliberately
    // NOT part of this key: a background refresh changes it, and remounting on
    // that would throw away everything the user had typed.
    dialog
      ? h(ProviderEditModal, {
        key: `${dialog.mode}:${dialog.draft?.key ?? "new"}`,
        initialDraft: dialog.draft,
        mode: dialog.mode,
        protocols: snapshot.apiProtocols ?? [],
        saving: snapshot.status === "busy" && snapshot.pendingAction === "save",
        errors: Array.isArray(snapshot.saveErrors) ? snapshot.saveErrors : [],
        conflict: snapshot.conflict === true,
        saveError: snapshot.status === "error" && snapshot.error ? snapshot.error : "",
        onSubmit: submitDialog,
        onClose: close,
        t,
      })
      : null,
  );
}
