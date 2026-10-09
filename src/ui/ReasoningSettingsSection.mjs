// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LEVELS } from "../domain/validation.mjs";
import { draftForModel, draftSignature, reconcileDraft, rebaseDraft, reloadDraft } from "./reasoning-editor-state.mjs";
import { loadCollapse, saveCollapse, withModelToggled, isModelCollapsed } from "./collapse-state.mjs";
import { makeTranslator } from "../client/i18n.mjs";

const h = React.createElement;

/**
 * `saved` means the document matches what the user is looking at. When the user
 * kept editing while a save was in flight, the newer edits are deliberately kept
 * (rebaseDraft) but they are NOT written — reporting `saved` there would tell the
 * user their work is safe when it is not.
 */
const STATUS_SAVED_DIRTY = "saved-dirty";

/** The draft has diverged from the last document the user saw saved. */
const STATUS_DIRTY = "dirty";

function displayStatus(status, tr, rawError) {
  if (status === "saving") return tr("reasoning.saving", "保存中…");
  if (status === "saved") return tr("reasoning.saved", "已保存");
  if (status === STATUS_SAVED_DIRTY) return tr("reasoning.savedDirty", "已保存，但仍有未保存的改动");
  if (status === STATUS_DIRTY) return tr("reasoning.unsaved", "有未保存的改动");
  if (!status) return "";
  return tr("reasoning.saveFailed", "保存失败：{message}", { message: rawError ?? status });
}

function ModelEditor({ route, model, controller, writable, revision, collapsed = false, onToggleCollapsed, tr }) {
  const initial = draftForModel(model);
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [baselineRevision, setBaselineRevision] = useState(revision);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [status, setStatus] = useState("");
  const [saveError, setSaveError] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const draftRef = useRef(draft);
  const baselineRef = useRef(baseline);
  const baselineRevisionRef = useRef(baselineRevision);
  const remoteChangedRef = useRef(remoteChanged);
  const saveInFlightRef = useRef(false);
  draftRef.current = draft;
  baselineRef.current = baseline;
  baselineRevisionRef.current = baselineRevision;
  remoteChangedRef.current = remoteChanged;

  const applyReconciledState = (next) => {
    const currentDraft = draftRef.current;
    const currentBaseline = baselineRef.current;
    if (draftSignature(next.draft) !== draftSignature(currentDraft)) {
      draftRef.current = next.draft;
      setDraft(next.draft);
    }
    if (draftSignature(next.baseline) !== draftSignature(currentBaseline)) {
      baselineRef.current = next.baseline;
      setBaseline(next.baseline);
    }
    if (next.baselineRevision !== baselineRevisionRef.current) {
      baselineRevisionRef.current = next.baselineRevision;
      setBaselineRevision(next.baselineRevision);
    }
    if (next.remoteChanged !== remoteChangedRef.current) {
      remoteChangedRef.current = next.remoteChanged;
      setRemoteChanged(next.remoteChanged);
    }
  };

  useEffect(() => {
    const next = reconcileDraft({
      draft: draftRef.current,
      baseline: baselineRef.current,
      baselineRevision: baselineRevisionRef.current,
      remoteModel: model,
      remoteRevision: revision,
      remoteChanged: remoteChangedRef.current,
    });
    applyReconciledState(next);
  }, [controller, model.id, model.reasoningEfforts, revision]);

  const setMode = (mode) => setDraft((current) => ({ ...current, mode }));
  const toggleLevel = (level, checked) => {
    setDraft((current) => {
      const efforts = { ...current.efforts };
      if (!checked) delete efforts[level];
      else efforts[level] = level === "off" ? null : level;
      return { ...current, efforts };
    });
  };

  // Same notion of "changed" the save path uses, so the badge, the save
  // button and the reload guard all agree.
  const dirty = draftSignature(draft) !== draftSignature(baseline);

  const reload = () => {
    // Reload replaces the draft with the remote document, so unsaved edits
    // would vanish without a trace. Ask first when there is something to lose.
    if (dirty && typeof globalThis.confirm === "function"
      && !globalThis.confirm(tr("reasoning.reloadDirty", "丢弃本地改动并重新载入"))) {
      return;
    }
    const remoteSnapshot = controller.getSnapshot();
    const remoteModel = remoteSnapshot.providers[route]?.models?.find((entry) => entry.id === model.id) ?? model;
    applyReconciledState(reloadDraft({ remoteModel, remoteRevision: remoteSnapshot.revision }));
    setStatus("");
    setSaveError("");
  };

  const save = async () => {
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    const draftToSave = draftRef.current;
    const savingSignature = draftSignature(draftToSave);
    const savingRevision = baselineRevisionRef.current;
    setStatus("saving");
    setSaveError("");
    try {
      const nextSnapshot = await controller.save(route, model.id, draftToSave.mode, draftToSave.efforts, savingRevision);
      const savedModel = nextSnapshot.providers[route]?.models?.find((entry) => entry.id === model.id) ?? model;
      if (draftSignature(draftRef.current) === savingSignature) {
        applyReconciledState(reloadDraft({ remoteModel: savedModel, remoteRevision: nextSnapshot.revision }));
        setStatus("saved");
      } else {
        applyReconciledState(rebaseDraft({ draft: draftRef.current, savedModel, savedRevision: nextSnapshot.revision }));
        setStatus(STATUS_SAVED_DIRTY);
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
      setStatus("error");
    } finally {
      saveInFlightRef.current = false;
    }
  };

  const modelName = model.name || model.id;
  const selectedCount = Object.keys(draft.efforts).length;
  // Levels whose wire value differs from the level name (the default), so a
  // collapsed row still shows that a mapping was customised.
  const customCount = Object.entries(draft.efforts).filter(([level, value]) => {
    const normalized = value === "" || value === undefined ? null : value;
    return normalized !== (level === "off" ? null : level);
  }).length;
  const customBodyId = ("dsh-reasoning-custom-" + route + "-" + model.id).replace(/[^a-zA-Z0-9_-]/g, "-");
  // A save result describes the document only until the user edits again: the
  // badge used to keep reporting "Saved" while the draft had already diverged.
  const effectiveStatus = dirty && (status === "saved" || status === "") ? STATUS_DIRTY : status;
  const statusClass = effectiveStatus === "saving"
    ? "dsh-reasoning-status dsh-reasoning-status--saving"
    : effectiveStatus === "saved"
      ? "dsh-reasoning-status dsh-reasoning-status--success"
      : effectiveStatus === STATUS_SAVED_DIRTY || effectiveStatus === STATUS_DIRTY
        ? "dsh-reasoning-status dsh-reasoning-status--dirty"
        : effectiveStatus
          ? "dsh-reasoning-status dsh-reasoning-status--error"
          : "dsh-reasoning-status";
  return h("article", { className: "dsh-reasoning-model" + (collapsed ? " dsh-reasoning-model--collapsed" : "") },
    h("header", { className: "dsh-reasoning-model__header" },
      h("div", { className: "dsh-reasoning-model__identity" },
        h("strong", null, modelName),
        model.id !== modelName && h("code", null, model.id),
      ),
      h("div", { className: "dsh-reasoning-model__mode-area" },
        h("span", { className: "dsh-reasoning-model__mode-label" }, tr("reasoning.mode", "推理模式")),
        h("div", { className: "dsh-reasoning-mode", role: "group", "aria-label": tr("reasoning.modeAria", "{model} 推理模式", { model: model.id }) },
          h("button", {
            type: "button",
            className: draft.mode === "disabled" ? "dsh-reasoning-mode__option dsh-reasoning-mode__option--active" : "dsh-reasoning-mode__option",
            "aria-pressed": draft.mode === "disabled",
            disabled: !writable,
            onClick: () => setMode("disabled"),
          }, tr("reasoning.modeDisabled", "关闭")),
          h("button", {
            type: "button",
            className: draft.mode === "enabled" ? "dsh-reasoning-mode__option dsh-reasoning-mode__option--active" : "dsh-reasoning-mode__option",
            "aria-pressed": draft.mode === "enabled",
            disabled: !writable,
            onClick: () => setMode("enabled"),
          }, tr("reasoning.modeEnabled", "启用")),
        ),
      ),
      h("button", {
        type: "button",
        className: "dsh-reasoning-collapse",
        "aria-expanded": !collapsed,
        "aria-controls": "dsh-reasoning-model-body-" + customBodyId,
        "aria-label": tr("reasoning.collapseAria", "{action} {model} 推理设置", {
          action: collapsed ? tr("reasoning.expand", "展开") : tr("reasoning.collapse", "收起"),
          model: modelName,
        }),
        onClick: () => onToggleCollapsed?.(route, model.id, !collapsed),
      }, h("span", { "aria-hidden": "true" }, collapsed ? "⌄" : "⌃")),
    ),
    h("div", { id: "dsh-reasoning-model-body-" + customBodyId, className: "dsh-reasoning-model__body", hidden: collapsed || draft.mode !== "enabled" },
      h("div", { className: "dsh-reasoning-levels", "aria-label": tr("reasoning.levelsAria", "{model} 可用推理等级", { model: model.id }) },
        h("div", { className: "dsh-reasoning-levels__heading" },
          h("span", { className: "dsh-reasoning-levels__label" }, tr("reasoning.levelsHeading", "可用等级")),
          h("span", { className: "dsh-reasoning-levels__summary" }, tr("reasoning.levelsSelected", "已选 {count} 项", { count: selectedCount })),
          customCount > 0
            ? h("span", { className: "dsh-reasoning-levels__custom" }, tr("reasoning.customMarker", "已自定义 {count} 项", { count: customCount }))
            : null,
        ),
        h("div", { className: "dsh-reasoning-levels__options" },
          ...LEVELS.map((level) => {
            const checked = Object.hasOwn(draft.efforts, level);
            return h("label", { key: level, className: "dsh-reasoning-level" + (checked ? " dsh-reasoning-level--active" : "") },
              h("input", {
                type: "checkbox",
                checked,
                disabled: !writable,
                onChange: (event) => toggleLevel(level, event.target.checked),
              }),
              h("span", null, level),
            );
          }),
        ),
      ),
      h("div", { className: "dsh-reasoning-custom" },
        h("button", {
          type: "button",
          className: customOpen ? "dsh-reasoning-custom__toggle dsh-reasoning-custom__toggle--active" : "dsh-reasoning-custom__toggle",
          "aria-expanded": customOpen,
          "aria-controls": customBodyId,
          onClick: () => setCustomOpen((current) => !current),
        }, h("span", null, customOpen ? tr("reasoning.customHide", "收起自定义映射") : tr("reasoning.customShow", "自定义 wire 值")),
        h("span", { "aria-hidden": "true" }, customOpen ? "⌃" : "⌄")),
        customOpen && h("div", { id: customBodyId, className: "dsh-reasoning-custom__body" },
          ...LEVELS.filter((level) => Object.hasOwn(draft.efforts, level)).map((level) => h("label", { key: level, className: "dsh-reasoning-custom__field" },
            h("span", null, level === "off" ? "off" : level),
            h("input", {
              type: "text",
              value: draft.efforts[level] ?? "",
              placeholder: level === "off" ? tr("reasoning.customNullPlaceholder", "留空表示 null") : level,
              disabled: !writable,
              onChange: (event) => setDraft((current) => ({ ...current, efforts: { ...current.efforts, [level]: event.target.value } })),
              "aria-label": tr("reasoning.customWireAria", "{model} {level} wire 值", { model: model.id, level }),
            }),
          )),
        ),
      ),
    ),
    !collapsed && h("footer", { className: "dsh-reasoning-model__footer" },
      h("span", { className: "dsh-reasoning-remote-status", role: "status", "aria-live": "polite" }, remoteChanged ? tr("reasoning.remoteUpdated", "远端已更新") : ""),
      remoteChanged && h("button", {
        className: "dsh-reasoning-reload",
        type: "button",
        title: dirty ? tr("reasoning.reloadDirty", "丢弃本地改动并重新载入") : undefined,
        onClick: reload,
      }, tr("reasoning.reload", "重新载入")),
      h("span", { role: "status", "aria-live": "polite", className: statusClass }, displayStatus(effectiveStatus, tr, saveError)),
      // Saving an unchanged draft costs a settings.write and a full describe()
      // round trip without changing anything, so the button tracks the draft.
      h("button", { className: "dsh-reasoning-save", type: "button", disabled: !writable || status === "saving" || !dirty, onClick: save }, status === "saving" ? tr("reasoning.saving", "保存中…") : tr("reasoning.save", "保存")),
    ),
  );
}

function renderProvider([route, provider], controller, writable, revision, collapse, onToggleCollapsed, tr) {
  return h(
    "section",
    { key: route, className: "dsh-reasoning-provider" },
    h("div", { className: "dsh-reasoning-provider__header" },
      h("h3", null, route),
      h("span", null, tr("reasoning.modelCount", "{count} 个模型", { count: provider.models.length })),
    ),
    h("div", { className: "dsh-reasoning-provider__models" },
      ...provider.models.map((model) => h(ModelEditor, {
        key: model.id,
        route,
        model,
        controller,
        writable,
        revision,
        collapsed: isModelCollapsed(collapse, route, model.id),
        onToggleCollapsed,
        tr,
      })),
    ),
  );
}

export function ReasoningSettingsSection({ controller, embedded = false, collapse: collapseProp, setCollapse: setCollapseProp, t }) {
  const tr = makeTranslator(t);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const providers = Object.entries(snapshot.providers).filter(([, provider]) => Array.isArray(provider?.models));
  const [localCollapse, setLocalCollapse] = useState(() => loadCollapse());
  const collapse = collapseProp ?? localCollapse;
  const updateCollapse = setCollapseProp ?? setLocalCollapse;
  const toggleModelCollapsed = (route, modelId, collapsed) => {
    updateCollapse((current) => {
      const next = withModelToggled(current, route, modelId, collapsed);
      saveCollapse(next);
      return next;
    });
  };
  useEffect(() => {
    if (snapshot.status === "idle") void controller.refresh();
  }, [controller, snapshot.status]);
  if (snapshot.status === "loading" && providers.length === 0) return h("p", null, tr("reasoning.loading", "正在加载模型推理设置…"));
  if (snapshot.status === "error") return h("p", { role: "alert" }, snapshot.error);
  return h(
    "section",
    { className: embedded ? "dsh-reasoning-settings dsh-reasoning-settings--embedded" : "dsh-reasoning-settings" },
    !embedded && h("header", null,
      h("h2", null, tr("reasoning.title", "模型推理")),
      h("p", null, tr("reasoning.intro", "为自定义 provider 的每个模型设置推理等级。")),
    ),
    providers.length === 0
      ? h("p", null, tr("reasoning.empty", "暂无自定义 provider 模型。"))
      : providers.map((entry) => renderProvider(entry, controller, snapshot.writable, snapshot.revision, collapse, toggleModelCollapsed, tr)),
  );
}
