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
import { makeTranslator, messagesFor } from "../client/i18n.mjs";
import { DEFAULT_LOCALE } from "../client/messages.mjs";
import { groupPresetsByCategory, presetVersionKeys } from "../domain/presets.mjs";
import { moveInOrder } from "../client/manager-controller.mjs";
import { draftFromPreset, draftFromProvider, emptyDraft, ProviderEditModal } from "./ProviderEditModal.mjs";

const h = React.createElement;

/**
 * The fallback locale's catalogue, read once for the preset labels.
 *
 * Those three families — group, plan and region — are data-driven: the key is
 * built from the preset's own field, so there is nowhere to write a literal
 * fallback the way the static strings do. Reading them from the catalogue keeps
 * one copy of each; the host translator still wins whenever one is wired.
 */
const FALLBACK = messagesFor(DEFAULT_LOCALE);

/**
 * What one preset looks like in the picker: its name, plus the version suffix
 * CC Switch appends when a vendor sells several plans or serves two regions.
 *
 * A preset that declares neither dimension is shown by its name alone, which is
 * what CC Switch does — every such entry in this catalogue is the only preset
 * for its vendor, so there is no sibling to tell it apart from.
 */
export function presetOptionLabel(preset, tr) {
  const parts = presetVersionKeys(preset).map((key) => tr(key, FALLBACK[key]));
  return parts.length === 0 ? String(preset?.displayName ?? "") : `${preset.displayName} · ${parts.join(" · ")}`;
}

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
  reorder: ["manager.reorderFailed", "调整顺序失败：{message}"],
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
    // Which app this row belongs to, resolved the way the Host resolves it: an
    // absent value means `claude`. Shown on the row because the edit form can
    // now change it, and without it two same-named providers filed under
    // different apps would be indistinguishable in the list.
    appType: typeof provider?.appType === 'string' && provider.appType !== '' ? provider.appType : 'claude',
    inFailoverQueue: provider?.inFailoverQueue === true,
    // Whether this row can be probed at all. The probe route reads CC Switch's
    // database and is addressed by the `profileId` a scan produced, so a
    // provider the user added by hand or from a preset has no row to probe.
    // The button is hidden rather than shown-and-failing: there is no action
    // the user could take to make it work, and offering it would read as a
    // broken feature rather than a limit of what was imported.
    probeable: typeof provider?.sourceProfileId === 'string' && provider.sourceProfileId !== '',
    pending,
    action: pending ? snapshot?.pendingAction : undefined,
    disabled: snapshot?.status === 'busy' || snapshot?.status === 'loading',
  };
}

/**
 * Whether one provider matches a search query — CC Switch's `ProviderList`
 * filter, transcribed.
 *
 * CC Switch builds one lowercased haystack per provider out of
 * `[name, notes, websiteUrl, extractProviderBaseUrl(settingsConfig)]` and asks
 * whether it contains the trimmed, lowercased query. That is a plain substring
 * test, not a word or prefix match, so "api.deep" and "deepseek" both hit the
 * same row. This plugin stores no website, so the equivalent haystack is the
 * display name, the notes, and the endpoint.
 *
 * The provider key is deliberately not searched. CC Switch keys its list by id
 * but never shows it, so its search cannot match one; here the key is derived
 * from the display name (`newProviderKey`), so a search for the name finds the
 * row anyway and adding the key would only widen what matches.
 *
 * An empty query matches everything, which is what lets the caller run every
 * row through this without a separate "is searching" branch.
 *
 * Exported so a test can pin the searched fields without a DOM.
 */
export function providerMatches(provider, query) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (needle === "") return true;
  return [provider?.displayName, provider?.notes, provider?.baseURL]
    .filter((value) => typeof value === "string" && value !== "")
    .join("\n")
    .toLowerCase()
    .includes(needle);
}

/**
 * The fallback wording per probe reason.
 *
 * Same keys and same sentences as `CCSwitchImportSection`'s map, because the
 * Host sends the same reason codes and the catalogue entries are shared. The
 * two are separate constants only so a change to one tab's phrasing does not
 * silently rewrite the other's.
 */
const PROBE_FALLBACK = {
  ok: "连通 · {count} 个模型 · {ms}ms",
  'ok-minimal': "连通 · 最小请求 · {ms}ms",
  empty: "连通 · 上游没返回模型",
  'http-error': "失败 · HTTP {status}",
  'no-credentials': "无法测试：缺少凭据或 base URL",
  timeout: "失败 · 超时",
  network: "失败 · 网络错误",
};

/**
 * Same normalization the reasoning panel uses before building a DOM id.
 */
function domIdPart(value) {
  return String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60);
}

/**
 * How a probe verdict reads on a row.
 *
 * The importer's `probeLabel` handles the same Host payload and the same
 * `importer.probe.*` catalogue; it is re-implemented rather than imported only
 * because that one falls back to its own literal Chinese strings, and this tab
 * needs the two extra states below. The reason codes and the shape of the
 * outcome are identical, so the two read alike on screen.
 */
function probeLabel(probe, tr) {
  if (probe?.phase === 'error') {
    // The row cannot be probed at all, which is a different statement from a
    // probe that ran and failed: a hand-added provider has no CC Switch row
    // behind it, and no amount of retrying will give it one.
    if (probe.unprobeable === true) {
      return tr('manager.probeUnprobeable', '无法测试：该 provider 不是从 CC Switch 导入的，没有可探测的源记录');
    }
    const base = tr('importer.probe.requestFailed', '失败 · {message}', { message: probe.message ?? '' });
    // A 4xx from the probe route itself means the Host half is older than this
    // bundle and does not know the endpoint yet.
    return probe.staleHost
      ? `${base} · ${tr('importer.probe.hostStale', '宿主未加载该接口，重启 DSH 后重试')}`
      : base;
  }
  // A connection proved by the 1-token fallback has no model list to count.
  const reason = probe?.check === 'minimal' && probe?.ok === true
    ? 'ok-minimal'
    : typeof probe?.reason === 'string' && PROBE_FALLBACK[probe.reason] ? probe.reason : 'network';
  const base = tr(`importer.probe.${reason}`, PROBE_FALLBACK[reason], {
    count: probe?.modelCount ?? 0,
    ms: probe?.latencyMs ?? 0,
    status: probe?.httpStatus ?? 0,
  });
  // The upstream's own words are the actionable part of a failure.
  return typeof probe?.detail === 'string' && probe.detail.length > 0 ? `${base} · ${probe.detail}` : base;
}

function probeKind(probe) {
  return probe?.phase !== 'error' && probe?.ok === true ? 'ok' : 'error';
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
  // The search term lives here rather than in the controller: it filters what
  // this tab draws and has no bearing on the settings document.
  const [query, setQuery] = useState("");
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

  /**
   * Move one row by one slot.
   *
   * Resolved against the **full** order, not the filtered list on screen — the
   * same rule CC Switch's drag handler uses, where both ends of a drop are
   * looked up in `sortedProviders` even while a search hides rows. That keeps
   * "where did it go" a fact about the catalogue rather than about what the
   * filter happened to be showing, so a move made mid-search is still the move
   * the user finds after clearing it.
   *
   * `moveInOrder` returns its input when the move would leave the list, so an
   * unchanged list means there is nothing to write: re-sending it would cost a
   * round trip and a revision bump to store the order that is already there.
   */
  const onMove = (key, delta) => {
    const moved = moveInOrder(order, key, delta);
    if (moved === order) return;
    void runRowAction(key, () => controller.reorder(moved), "reorder");
  };
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
  // Filtered for display only. `rows` is still what the empty states are
  // decided from: "this plugin has no providers" and "nothing matched your
  // search" are different situations and must not share a sentence.
  const visibleRows = rows.filter((provider) => providerMatches(provider, query));

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
              // Grouped the way CC Switch's "add provider" list is sectioned.
              // A `<select>` cannot show the section names any other way, and
              // with 25-odd entries an ungrouped list is a wall.
              ...groupPresetsByCategory(presets).map((section) => h("optgroup", {
                key: section.group,
                // `optgroup` takes a `label` attribute, not children.
                label: tr(`manager.group.${section.group}`, FALLBACK[`manager.group.${section.group}`]),
              },
                ...section.presets.map((preset) => h("option", { key: preset.key, value: preset.key },
                  presetOptionLabel(preset, tr))),
              )),
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

    // The field only appears once there is something to narrow. On a tab with
    // no providers it would be a control that cannot do anything, and it would
    // sit above the empty state that is trying to explain how to get one.
    rows.length > 0
      ? h("div", { className: "dsh-ccswitch-manager__search" },
        h("input", {
          // `text`, not `search`: the latter draws the browser's own clear
          // affordance, which would sit beside the button below and clear the
          // field twice.
          type: "text",
          // The edit form's own input class, so the two controls cannot drift
          // apart in border, focus ring or font.
          className: "dsh-ccswitch-form__input",
          value: query,
          placeholder: tr("manager.searchPlaceholder", "按名称/备注/请求地址搜索供应商…"),
          "aria-label": tr("manager.searchAriaLabel", "搜索供应商"),
          disabled: busy,
          onChange: (event) => setQuery(event.target.value),
        }),
        query === ""
          ? null
          : h("button", {
            type: "button",
            className: "dsh-ccswitch-import__link",
            onClick: () => setQuery(""),
          }, tr("manager.searchClear", "清除")),
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
      // "Nothing matched" is not "nothing here": the catalogue is non-empty, so
      // neither empty state above would be true, and telling the user there are
      // no providers while a search is hiding them would be a lie.
      : visibleRows.length === 0
        ? h("p", { role: "status", className: "dsh-ccswitch-manager__empty" },
          tr("manager.noSearchResults", "没有符合搜索条件的供应商。"))
        : h("div", { className: "dsh-ccswitch-manager__list" },
        ...visibleRows.map((provider) => {
          const view = providerRowView(provider, snapshot);
          const { name, pending, action } = view;
          // Where this row sits in the whole catalogue. The buttons' disabled
          // state and the move itself both read from this, so a filtered view
          // cannot make the first *visible* row look like the first row.
          const rowIndex = order.indexOf(view.key);
          const probe = snapshot.probes?.[view.key];
          const testing = probe?.phase === 'testing';
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
                h("span", { className: "dsh-ccswitch-manager__app-type" }, view.appType),
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
              // Only a provider that came through an import has a CC Switch row
              // behind it, so only one of those can be probed — see
              // `providerRowView.probeable`. The button is hidden rather than
              // shown-and-disabled: there is nothing the user could do to make
              // it work, and a permanently dead control reads as a bug.
              view.probeable
                ? h("button", {
                  type: "button",
                  className: "dsh-ccswitch-import__link dsh-ccswitch-import__probe-btn",
                  disabled: testing || view.disabled,
                  "aria-label": tr("importer.probe.testAria", "测试 {name} 的连接", { name }),
                  onClick: () => { Promise.resolve(controller.probeOne(view.key)).catch(() => {}); },
                }, testing ? tr("importer.probe.testing", "测试中…") : tr("importer.probe.test", "测试连接"))
                : null,
              // Sitting beside the button rather than under the row, so the
              // verdict reads as the answer to the click that asked for it.
              probe && !testing
                ? h("span", {
                  role: "status",
                  className: `dsh-ccswitch-import__probe dsh-ccswitch-import__probe--${probeKind(probe)}`,
                }, probeLabel(probe, tr))
                : null,
              h("button", {
                type: "button",
                className: "dsh-ccswitch-import__link",
                // Activating the row that is already current is a no-op that
                // still costs a settings write and a full-catalogue edit.
                disabled: view.disabled || view.isCurrent,
                "aria-label": tr("manager.activateAria", "启用 {name}", { name }),
                onClick: () => onActivate(view.key),
              }, action === "activate" ? tr("manager.activating", "启用中…") : tr("manager.activate", "启用")),
              // The move pair, sitting between the primary action and the row's
              // maintenance buttons — the order CC Switch's ProviderCardActions
              // lays them out in (status, primary, up/down, edit, ⋯).
              //
              // These are buttons rather than drag handles because
              // @dnd-kit is not a dependency of this plugin, and adding one
              // would mean shipping a drag library to the browser for a single
              // list. The pair also happens to be the keyboard-accessible form
              // of the same edit, which CC Switch only gets from its dnd-kit
              // KeyboardSensor.
              h("button", {
                type: "button",
                className: "dsh-ccswitch-import__link",
                // The row's position in the whole catalogue, not in the
                // filtered view: see `onMove`.
                disabled: view.disabled || rowIndex <= 0,
                "aria-label": tr("manager.moveUpAria", "上移 {name}", { name }),
                onClick: () => onMove(view.key, -1),
              }, tr("manager.moveUp", "↑")),
              h("button", {
                type: "button",
                className: "dsh-ccswitch-import__link",
                disabled: view.disabled || rowIndex < 0 || rowIndex >= order.length - 1,
                "aria-label": tr("manager.moveDownAria", "下移 {name}", { name }),
                onClick: () => onMove(view.key, 1),
              }, tr("manager.moveDown", "↓")),
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
        appTypes: snapshot.appTypes ?? [],
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
