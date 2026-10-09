// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
/**
 * The create/edit form for one provider.
 *
 * The draft is a flat, string-valued object so the whole form is controlled by
 * plain `useState`, and every conversion — `""` means "absent", `"12"` means
 * `12` — happens in exactly one place. `draftToProvider` is that place, and it
 * is exported so a test can pin the wire shape without a DOM.
 *
 * One field is deliberately write-only. `apiKey` is never populated from a
 * stored value, because the Host never sends one: its provider payload reports
 * only whether a credential is configured. Re-rendering a stored key would mean
 * the secret had crossed the wire outward, which is the thing the whole
 * `apiKeyEnv` reference indirection exists to prevent.
 *
 * Numeric inputs stay strings in the draft. A half-typed `-` or `1e` is a
 * legitimate intermediate state, and coercing on every keystroke would fight
 * the user by rewriting what they typed.
 */
import React, { useEffect, useId, useRef, useState } from "react";
import { makeTranslator } from "../client/i18n.mjs";

const h = React.createElement;

/** The most models one provider may carry; mirrors the Host's per-provider cap. */
const MAX_MODELS = 200;

/**
 * Readable text for every problem {@link validateDraft} can report.
 *
 * The catalogue is the real source of these strings; this map is what the form
 * falls back to when the host translator is unavailable, and it is the reason a
 * missing translation degrades to a sentence rather than to a raw code like
 * `displayName-required`. Same reasoning as `BLOCKED_FALLBACK` in
 * `CCSwitchImportSection`.
 *
 * Exported so a test can assert every code `validateDraft` emits has an entry:
 * this is the one place a new code can silently start rendering itself.
 */
/**
 * The app types the form offers when the Host sends none. Mirrors
 * `WRITER_APP_TYPES`; see `sanitizeAppTypes` in the manager controller.
 */
const FALLBACK_APP_TYPES = ["claude", "codex"];

export const PROBLEM_FALLBACK = {
  'displayName-required': '请填写名称。',
  'api-required': '请选择协议。',
  'baseURL-required': '请填写 Base URL。',
  'baseURL-invalid': 'Base URL 不是合法网址：{detail}',
  'models-required': '至少需要一个模型，且模型 ID 不能为空。',
  'model-id-required': '第 {detail} 个模型缺少 ID。',
  'costMultiplier-invalid': '费用倍率必须是不小于 0 的数字：{detail}',
  'limitDailyUsd-invalid': '每日限额必须是不小于 0 的数字：{detail}',
  'limitMonthlyUsd-invalid': '每月限额必须是不小于 0 的数字：{detail}',
};

/** A blank model row for the editor. */
export function blankModel() {
  return { id: "", name: "", contextWindow: "", maxTokens: "" };
}

/** The draft for a brand-new provider. */
export function emptyDraft() {
  return {
    key: undefined,
    displayName: "",
    api: "",
    baseURL: "",
    apiKey: "",
    category: "",
    websiteUrl: "",
    notes: "",
    icon: "",
    iconColor: "",
    costMultiplier: "",
    limitDailyUsd: "",
    limitMonthlyUsd: "",
    inFailoverQueue: false,
    models: [blankModel()],
    // Every stored provider belongs to one app, and this value decides which
    // tool's config file an activation rewrites. It is set here rather than
    // left absent: an absent one falls back to `claude` deep in the Host, so a
    // provider added by hand silently became a Claude Code provider with
    // nothing on screen saying so. The default is still `claude` — the form
    // now shows it, and the user can change it.
    appType: "claude",
    sourceProfileId: undefined,
    isCurrent: false,
  };
}

/** A number-or-undefined rendered as an input value. */
function textOf(value) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

/**
 * The draft for editing an existing provider.
 *
 * `models` always gets at least one row: the Host requires one, and a form that
 * opens with no rows makes "add a model" the user's first task on every edit.
 */
export function draftFromProvider(provider) {
  const base = emptyDraft();
  if (!provider || typeof provider !== "object") return base;
  const models = Array.isArray(provider.models) ? provider.models : [];
  return {
    ...base,
    key: typeof provider.key === "string" && provider.key !== "" ? provider.key : undefined,
    displayName: String(provider.displayName ?? ""),
    api: String(provider.api ?? ""),
    baseURL: String(provider.baseURL ?? ""),
    // Never copied from a stored value; see the module comment.
    apiKey: "",
    category: String(provider.category ?? ""),
    websiteUrl: String(provider.websiteUrl ?? ""),
    notes: String(provider.notes ?? ""),
    icon: String(provider.icon ?? ""),
    iconColor: String(provider.iconColor ?? ""),
    costMultiplier: textOf(provider.costMultiplier),
    limitDailyUsd: textOf(provider.limitDailyUsd),
    limitMonthlyUsd: textOf(provider.limitMonthlyUsd),
    inFailoverQueue: provider.inFailoverQueue === true,
    models: models.length > 0
      ? models.slice(0, MAX_MODELS).map((model) => ({
        id: String(model?.id ?? ""),
        name: String(model?.name ?? ""),
        contextWindow: textOf(model?.contextWindow),
        maxTokens: textOf(model?.maxTokens),
        // Not editable here, but preserved so saving does not erase reasoning
        // levels the user configured in the reasoning editor.
        reasoningEfforts: model?.reasoningEfforts === false ? false : model?.reasoningEfforts,
      }))
      : [blankModel()],
    appType: typeof provider.appType === "string" && provider.appType !== "" ? provider.appType : "claude",
    sourceProfileId: typeof provider.sourceProfileId === "string" ? provider.sourceProfileId : undefined,
    isCurrent: provider.isCurrent === true,
  };
}

/**
 * The draft a preset would start the form at.
 *
 * `key` stays undefined: a preset fills a *new* provider, and carrying a key
 * would make the Host treat the save as an update to whatever provider already
 * holds it.
 */
export function draftFromPreset(preset) {
  const base = emptyDraft();
  if (!preset || typeof preset !== "object") return base;
  const models = (Array.isArray(preset.models) ? preset.models : [])
    .filter((id) => typeof id === "string" && id !== "")
    .slice(0, MAX_MODELS);
  return {
    ...base,
    displayName: String(preset.displayName ?? ""),
    api: String(preset.api ?? ""),
    baseURL: String(preset.baseURL ?? ""),
    category: typeof preset.category === "string" ? preset.category : "",
    websiteUrl: typeof preset.websiteUrl === "string" ? preset.websiteUrl : "",
    icon: String(preset.icon ?? ""),
    iconColor: String(preset.iconColor ?? ""),
    appType: typeof preset.appType === "string" && preset.appType !== "" ? preset.appType : "claude",
    models: models.length > 0 ? models.map((id) => ({ ...blankModel(), id })) : [blankModel()],
  };
}

/** A form string as a number, or undefined when blank or unparseable. */
export function numberField(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalText(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? undefined : text;
}

/**
 * The `provider` object the save route expects.
 *
 * Explicit field-by-field construction, with optional fields omitted rather
 * than sent empty. That is not cosmetic: the settings layer diffs the projected
 * form to decide whether the document changed, so a field that round-trips as
 * `""` instead of absent shows up as a spurious edit on every save.
 */
export function draftToProvider(draft) {
  const source = draft && typeof draft === "object" ? draft : {};
  const models = []
    .concat(Array.isArray(source.models) ? source.models : [])
    .slice(0, MAX_MODELS)
    .map((model) => {
      const id = optionalText(model?.id);
      if (id === undefined) return undefined;
      const entry = { id };
      const name = optionalText(model?.name);
      if (name !== undefined) entry.name = name;
      const contextWindow = numberField(model?.contextWindow);
      if (contextWindow !== undefined && contextWindow >= 1) entry.contextWindow = Math.trunc(contextWindow);
      const maxTokens = numberField(model?.maxTokens);
      if (maxTokens !== undefined && maxTokens >= 1) entry.maxTokens = Math.trunc(maxTokens);
      // Preserved rather than dropped; see `draftFromProvider`.
      if (model?.reasoningEfforts === false) entry.reasoningEfforts = false;
      else if (model?.reasoningEfforts && typeof model.reasoningEfforts === "object") {
        entry.reasoningEfforts = { ...model.reasoningEfforts };
      }
      return entry;
    })
    .filter((entry) => entry !== undefined);

  const provider = {
    displayName: optionalText(source.displayName) ?? "",
    api: optionalText(source.api) ?? "",
    baseURL: optionalText(source.baseURL) ?? "",
    models,
    inFailoverQueue: source.inFailoverQueue === true,
  };
  if (source.isCurrent === true) provider.isCurrent = true;
  for (const [field, value] of [
    ["category", optionalText(source.category)],
    ["websiteUrl", optionalText(source.websiteUrl)],
    ["notes", optionalText(source.notes)],
    ["icon", optionalText(source.icon)],
    ["iconColor", optionalText(source.iconColor)],
    ["appType", optionalText(source.appType)],
    ["sourceProfileId", optionalText(source.sourceProfileId)],
  ]) {
    if (value !== undefined) provider[field] = value;
  }
  for (const field of ["costMultiplier", "limitDailyUsd", "limitMonthlyUsd"]) {
    const amount = numberField(source[field]);
    if (amount !== undefined && amount >= 0) provider[field] = amount;
  }
  return provider
}

/**
 * Problems the form can see for itself, as `{ code, detail }` rather than
 * sentences.
 *
 * Returning codes keeps this function testable and translatable; the component
 * maps each one to a `manager.error.*` key. These mirror the Host's own rules
 * so the user is told before a round trip, but they do not replace the Host's
 * verdict — a Host that is stricter still gets the last word, and its `errors`
 * array is what the modal renders after a rejected save.
 */
export function validateDraft(draft) {
  const source = draft && typeof draft === "object" ? draft : {};
  const problems = [];
  if (optionalText(source.displayName) === undefined) problems.push({ code: "displayName-required" });
  const api = optionalText(source.api);
  if (api === undefined) problems.push({ code: "api-required" });
  const baseURL = optionalText(source.baseURL);
  if (baseURL === undefined) problems.push({ code: "baseURL-required" });
  else {
    // The Host rejects a baseURL that does not parse; catching it here means the
    // user is not told only after a round trip.
    try {
      new URL(baseURL);
    } catch {
      problems.push({ code: "baseURL-invalid", detail: baseURL });
    }
  }
  const models = Array.isArray(source.models) ? source.models : [];
  const usable = models.filter((model) => optionalText(model?.id) !== undefined);
  if (usable.length === 0) problems.push({ code: "models-required" });
  models.forEach((model, index) => {
    if (optionalText(model?.id) !== undefined) return;
    // A row the user added but never filled in is a real problem (they meant to
    // add a model), but only when the row carries something else.
    const touched = optionalText(model?.name) !== undefined
      || numberField(model?.contextWindow) !== undefined
      || numberField(model?.maxTokens) !== undefined;
    if (touched) problems.push({ code: "model-id-required", detail: index + 1 });
  });
  for (const [field, code] of [
    ["costMultiplier", "costMultiplier-invalid"],
    ["limitDailyUsd", "limitDailyUsd-invalid"],
    ["limitMonthlyUsd", "limitMonthlyUsd-invalid"],
  ]) {
    const raw = source[field];
    const text = typeof raw === "string" ? raw.trim() : raw;
    if (text === "" || text === undefined) continue;
    const parsed = numberField(raw);
    if (parsed === undefined || parsed < 0) problems.push({ code, detail: String(raw) });
  }
  return problems
}

/**
 * A stable string for the draft, so "did the user change anything?" is one
 * comparison rather than a field-by-field walk that has to be kept in step with
 * the form.
 */
export function draftSignature(draft) {
  const provider = draftToProvider(draft);
  return JSON.stringify([
    provider.displayName,
    provider.api,
    provider.baseURL,
    provider.models,
    provider.category,
    provider.websiteUrl,
    provider.notes,
    provider.icon,
    provider.iconColor,
    provider.costMultiplier,
    provider.limitDailyUsd,
    provider.limitMonthlyUsd,
    provider.inFailoverQueue,
    provider.appType,
    // Included because a save replaces the record: a non-empty draft means the
    // user is about to write a key, which is always a change worth reporting.
    typeof draft?.apiKey === "string" ? draft.apiKey : "",
  ]);
}

/** Build the `{ provider, key, apiKey, expectedRevision }` body for a save. */
export function draftToSaveRequest(draft, expectedRevision) {
  const request = { provider: draftToProvider(draft) };
  const key = optionalText(draft?.key);
  if (key !== undefined) request.key = key;
  const apiKey = typeof draft?.apiKey === "string" && draft.apiKey !== "" ? draft.apiKey : undefined;
  if (apiKey !== undefined) request.apiKey = apiKey;
  if (Number.isInteger(expectedRevision)) request.expectedRevision = expectedRevision;
  return request;
}

/** One labelled form control. */
function field(label, control, hint, hintId) {
  return h("label", { className: "dsh-ccswitch-form__field" },
    h("span", { className: "dsh-ccswitch-form__label" }, label),
    control,
    hint ? h("span", { className: "dsh-ccswitch-form__hint", id: hintId }, hint) : null,
  );
}

/**
 * The provider form, rendered into a modal dialog.
 *
 * `initialDraft` is read once, when the dialog opens — the component owns the
 * draft from then on, so a background refresh landing mid-edit cannot rewrite
 * what the user is typing. The dialog is keyed by `mode`+`key` at the call site
 * so reopening it starts from the new initial value.
 *
 * @param {object} props
 * @param {object} props.initialDraft - see {@link emptyDraft}.
 * @param {'create'|'edit'} props.mode - picks the title.
 * @param {string[]} props.protocols - the Host's authoritative protocol list.
 * @param {string[]} props.appTypes - the app types with a writer, per the Host.
 * @param {boolean} [props.saving] - a save is in flight.
 * @param {string[]} [props.errors] - the Host's own validation list after a 400.
 * @param {boolean} [props.conflict] - the last save lost a revision race.
 * @param {string} [props.saveError] - any other failure message.
 * @param {(draft: object) => void} props.onSubmit
 * @param {() => void} props.onClose
 * @param {(key: string) => string} [props.t]
 */
export function ProviderEditModal({
  initialDraft,
  mode = "create",
  protocols = [],
  appTypes = [],
  saving = false,
  errors = [],
  conflict = false,
  saveError = "",
  onSubmit,
  onClose,
  t,
}) {
  const tr = makeTranslator(t);
  const [draft, setDraft] = useState(() => initialDraft ?? emptyDraft());
  // The form's own verdict, shown only once the user has tried to save: warning
  // about a half-filled form while they are still typing is noise.
  const [showProblems, setShowProblems] = useState(false);
  const dialogRef = useRef(null);
  const reactId = useId();
  const titleId = `dsh-ccswitch-modal-title-${reactId}`;
  const apiKeyHintId = `dsh-ccswitch-modal-apikey-${reactId}`;
  const appTypeHintId = `dsh-ccswitch-modal-apptype-${reactId}`;
  const modelsHeadingId = `dsh-ccswitch-modal-models-${reactId}`;

  const problems = validateDraft(draft);
  // Resolved through the fallback map, so an unregistered key still reads as a
  // sentence rather than as `models-required`.
  const problemMessages = problems.map((problem) => tr(
    `manager.error.${problem.code}`,
    PROBLEM_FALLBACK[problem.code] ?? PROBLEM_FALLBACK['models-required'],
    problem.detail === undefined ? undefined : { detail: problem.detail },
  ));
  // The Host's list and ours can overlap; the Host's is authoritative and is
  // shown as-is, so a stricter Host is never hidden behind a passing local check.
  const hostErrors = (Array.isArray(errors) ? errors : []).filter((entry) => typeof entry === "string" && entry !== "");

  useEffect(() => {
    const dialog = dialogRef.current;
    // Guarded like `installEmbedStyles`: this bundle is only ever evaluated in
    // a browser, but a component that throws from an effect when the global is
    // absent takes the whole tab down rather than degrading.
    if (!dialog || typeof document === "undefined") return undefined;
    // Move focus into the dialog on open. Without this the focus ring stays on
    // the button that opened it, behind the overlay, and a keyboard user has to
    // tab through the whole page to reach the form.
    const first = dialog.querySelector("input, select, textarea, button");
    if (first && typeof first.focus === "function") first.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose?.();
        return;
      }
      if (event.key !== "Tab") return;
      // Keep Tab inside the dialog: it is modal, so the page behind it is not
      // reachable by keyboard while it is open.
      const focusable = dialog.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const firstEl = focusable[0];
      const lastEl = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const patch = (changes) => setDraft((current) => ({ ...current, ...changes }));
  const patchModel = (index, changes) => setDraft((current) => ({
    ...current,
    models: current.models.map((model, at) => (at === index ? { ...model, ...changes } : model)),
  }));
  const addModel = () => setDraft((current) => (
    current.models.length >= MAX_MODELS ? current : { ...current, models: [...current.models, blankModel()] }
  ));
  const removeModel = (index) => setDraft((current) => {
    const models = current.models.filter((_, at) => at !== index);
    // Never leave the form with zero rows: the Host requires one model, and an
    // empty editor gives the user nothing to type into.
    return { ...current, models: models.length > 0 ? models : [blankModel()] };
  });

  const submit = (event) => {
    event.preventDefault();
    if (saving) return;
    setShowProblems(true);
    if (problems.length > 0) return;
    onSubmit?.(draft);
  };

  const protocolOptions = Array.isArray(protocols) && protocols.length > 0 ? protocols : [draft.api].filter(Boolean);
  const appTypeOptions = Array.isArray(appTypes) && appTypes.length > 0 ? appTypes : FALLBACK_APP_TYPES;

  return h("div", {
    className: "dsh-ccswitch-modal__backdrop",
    // A click that starts and ends on the backdrop closes; one that started
    // inside the panel and drifted out does not, so a drag that overshoots a
    // text selection does not throw the form away.
    onMouseDown: (event) => { if (event.target === event.currentTarget) onClose?.(); },
  },
    h("div", {
      className: "dsh-ccswitch-modal",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": titleId,
      ref: dialogRef,
    },
      h("form", { className: "dsh-ccswitch-form", onSubmit: submit, noValidate: true },
        h("div", { className: "dsh-ccswitch-modal__header" },
          h("h3", { id: titleId, className: "dsh-ccswitch-modal__title" },
            mode === "edit" ? tr("manager.editTitle", "编辑 provider") : tr("manager.createTitle", "新增 provider")),
          h("button", {
            type: "button",
            className: "dsh-ccswitch-modal__close",
            "aria-label": tr("manager.close", "关闭"),
            onClick: () => onClose?.(),
          }, "×"),
        ),

        (conflict || hostErrors.length > 0 || saveError !== "" || (showProblems && problemMessages.length > 0))
          ? h("div", { role: "alert", className: "dsh-ccswitch-modal__errors" },
            conflict
              ? h("p", { className: "dsh-ccswitch-modal__error" }, tr("manager.conflict", "设置文档已被其他地方改动，列表已刷新，请重试。"))
              : null,
            saveError !== "" ? h("p", { className: "dsh-ccswitch-modal__error" }, saveError) : null,
            (hostErrors.length > 0 || (showProblems && problemMessages.length > 0))
              ? h("div", null,
                h("p", { className: "dsh-ccswitch-modal__error-title" }, tr("manager.validationTitle", "请修正以下问题：")),
                h("ul", { className: "dsh-ccswitch-modal__error-list" },
                  // Every problem at once, not the first: revealing them one
                  // failed save at a time is the behaviour this list exists to
                  // replace.
                  ...[...hostErrors, ...(showProblems ? problemMessages : [])]
                    .map((message, index) => h("li", { key: `${index}-${message}` }, message)),
                ),
              )
              : null,
          )
          : null,

        h("div", { className: "dsh-ccswitch-form__grid" },
          field(tr("manager.fieldDisplayName", "名称"),
            h("input", {
              className: "dsh-ccswitch-form__input",
              type: "text",
              value: draft.displayName,
              onChange: (event) => patch({ displayName: event.target.value }),
            })),
          field(tr("manager.fieldApi", "协议"),
            h("select", {
              className: "dsh-ccswitch-form__input",
              value: draft.api,
              onChange: (event) => patch({ api: event.target.value }),
            },
              // A stored protocol the Host no longer offers still has to be
              // selectable, or opening the form would silently rewrite it.
              ...[...new Set([...protocolOptions, draft.api].filter((entry) => entry !== ""))]
                .map((protocol) => h("option", { key: protocol, value: protocol }, protocol)),
              draft.api === "" ? h("option", { key: "", value: "" }, "") : null,
            )),
          field(tr("manager.fieldAppType", "应用"),
            h("select", {
              className: "dsh-ccswitch-form__input",
              value: draft.appType ?? "",
              "aria-describedby": appTypeHintId,
              onChange: (event) => patch({ appType: event.target.value }),
            },
              // A stored value the Host no longer offers still has to be
              // selectable, or opening the form on an imported provider of
              // another app type would silently rewrite it. Same rule the
              // protocol select above follows.
              ...[...new Set([...appTypeOptions, draft.appType].filter((entry) => typeof entry === "string" && entry !== ""))]
                .map((appType) => h("option", { key: appType, value: appType }, appType)),
            ),
            tr("manager.appTypeHint", "决定启用时改写哪个工具的配置；只有 claude 和 codex 有写入器。"),
            appTypeHintId),
          field(tr("manager.fieldBaseUrl", "Base URL"),
            h("input", {
              className: "dsh-ccswitch-form__input",
              type: "text",
              value: draft.baseURL,
              onChange: (event) => patch({ baseURL: event.target.value }),
            })),
          field(tr("manager.fieldApiKey", "API Key"),
            h("input", {
              className: "dsh-ccswitch-form__input",
              type: "password",
              autoComplete: "off",
              value: draft.apiKey,
              "aria-describedby": apiKeyHintId,
              onChange: (event) => patch({ apiKey: event.target.value }),
            }),
            `${tr("manager.apiKeyHint", "留空表示保持当前密钥不变。")}${mode === "edit" && initialDraft?.key ? ` ${tr("manager.apiKeyStored", "已存有一个密钥，此处不会回显。")}` : ""}`,
            apiKeyHintId),
          field(tr("manager.fieldNotes", "备注"),
            h("input", {
              className: "dsh-ccswitch-form__input",
              type: "text",
              value: draft.notes,
              onChange: (event) => patch({ notes: event.target.value }),
            })),
          field(tr("manager.fieldIcon", "图标"),
            h("input", {
              className: "dsh-ccswitch-form__input",
              type: "text",
              value: draft.icon,
              onChange: (event) => patch({ icon: event.target.value }),
            })),
          field(tr("manager.fieldIconColor", "图标颜色"),
            h("input", {
              className: "dsh-ccswitch-form__input",
              type: "text",
              value: draft.iconColor,
              onChange: (event) => patch({ iconColor: event.target.value }),
            })),
          field(tr("manager.fieldCostMultiplier", "费用倍率"),
            h("input", {
              className: "dsh-ccswitch-form__input",
              type: "text",
              inputMode: "decimal",
              value: draft.costMultiplier,
              onChange: (event) => patch({ costMultiplier: event.target.value }),
            })),
          field(tr("manager.fieldLimitDaily", "每日限额（USD）"),
            h("input", {
              className: "dsh-ccswitch-form__input",
              type: "text",
              inputMode: "decimal",
              value: draft.limitDailyUsd,
              onChange: (event) => patch({ limitDailyUsd: event.target.value }),
            })),
          field(tr("manager.fieldLimitMonthly", "每月限额（USD）"),
            h("input", {
              className: "dsh-ccswitch-form__input",
              type: "text",
              inputMode: "decimal",
              value: draft.limitMonthlyUsd,
              onChange: (event) => patch({ limitMonthlyUsd: event.target.value }),
            })),
          h("label", { className: "dsh-ccswitch-form__field dsh-ccswitch-form__field--check" },
            h("input", {
              type: "checkbox",
              checked: draft.inFailoverQueue,
              onChange: (event) => patch({ inFailoverQueue: event.target.checked }),
            }),
            h("span", { className: "dsh-ccswitch-form__label" }, tr("manager.fieldFailover", "加入故障转移队列")),
          ),
        ),

        h("fieldset", { className: "dsh-ccswitch-form__models", "aria-labelledby": modelsHeadingId },
          h("legend", { id: modelsHeadingId, className: "dsh-ccswitch-form__legend" }, tr("manager.modelsHeading", "模型")),
          ...draft.models.map((model, index) => h("div", {
            // Index-keyed on purpose: two rows may legitimately hold the same
            // (or an empty) id while the user is editing, and keying by id
            // would make React reconcile the wrong row.
            key: index,
            className: "dsh-ccswitch-form__model-row",
            role: "group",
            "aria-label": tr("manager.modelRowAria", "第 {index} 个模型", { index: index + 1 }),
          },
            h("input", {
              className: "dsh-ccswitch-form__input",
              type: "text",
              placeholder: tr("manager.modelId", "模型 ID"),
              "aria-label": tr("manager.modelId", "模型 ID"),
              value: model.id,
              onChange: (event) => patchModel(index, { id: event.target.value }),
            }),
            h("input", {
              className: "dsh-ccswitch-form__input",
              type: "text",
              placeholder: tr("manager.modelName", "显示名"),
              "aria-label": tr("manager.modelName", "显示名"),
              value: model.name,
              onChange: (event) => patchModel(index, { name: event.target.value }),
            }),
            h("input", {
              className: "dsh-ccswitch-form__input",
              type: "text",
              inputMode: "numeric",
              placeholder: tr("manager.modelContext", "上下文窗口"),
              "aria-label": tr("manager.modelContext", "上下文窗口"),
              value: model.contextWindow,
              onChange: (event) => patchModel(index, { contextWindow: event.target.value }),
            }),
            h("input", {
              className: "dsh-ccswitch-form__input",
              type: "text",
              inputMode: "numeric",
              placeholder: tr("manager.modelMaxTokens", "最大输出 token"),
              "aria-label": tr("manager.modelMaxTokens", "最大输出 token"),
              value: model.maxTokens,
              onChange: (event) => patchModel(index, { maxTokens: event.target.value }),
            }),
            h("button", {
              type: "button",
              className: "dsh-ccswitch-import__link dsh-ccswitch-form__model-remove",
              "aria-label": tr("manager.modelRemoveAria", "移除模型 {id}", { id: model.id || index + 1 }),
              onClick: () => removeModel(index),
            }, tr("manager.modelRemove", "移除")),
          )),
          h("button", {
            type: "button",
            className: "dsh-ccswitch-import__secondary",
            disabled: draft.models.length >= MAX_MODELS,
            onClick: addModel,
          }, tr("manager.modelAdd", "添加模型")),
        ),

        h("div", { className: "dsh-ccswitch-modal__footer" },
          h("button", {
            type: "button",
            className: "dsh-ccswitch-import__secondary",
            onClick: () => onClose?.(),
          }, tr("manager.cancel", "取消")),
          h("button", {
            type: "submit",
            className: "dsh-ccswitch-import__primary",
            disabled: saving,
          }, saving ? tr("manager.saving", "保存中…") : tr("manager.save", "保存")),
        ),
      ),
    ),
  );
}
