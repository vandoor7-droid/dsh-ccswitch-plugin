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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { makeTranslator, messagesFor } from "../client/i18n.mjs";
import { DEFAULT_LOCALE } from "../client/messages.mjs";
import { groupPresetsByCategory, presetMatches } from "../domain/presets.mjs";
import { draftFromPreset, draftFromProvider, emptyDraft, ProviderEditModal } from "./ProviderEditModal.mjs";
import { presetOptionLabel } from "./preset-option.mjs";
// The table itself is cc-switch's `ProviderList`, copied verbatim — see the
// note on the component below. Everything upstream of it (the `@/` alias, the
// i18n instance, react-query's client, the prefixed stylesheet) comes in here.
import { useProvidersQuery } from "@/lib/query/queries";
import { ProviderList } from "@/components/providers/ProviderList";
import "@/i18n";
import ccsStyles from "ccswitch:styles";

const h = React.createElement;

// --- the stylesheet ----------------------------------------------------------
//
// cc-switch's utilities, compiled with a `dsh-ccs-` prefix so none of them
// reaches DSH's document. Injected once at module scope rather than on mount:
// the string is already in this bundle either way, and a `<style>` that appears
// only after the tab opens produces a flash of unstyled rows.
const STYLE_ID = "dsh-ccswitch-ccs-styles";
function installStyles() {
  if (typeof document === "undefined" || !ccsStyles) return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = ccsStyles;
  document.head.appendChild(style);
}
installStyles();

// --- the data layer the copied components expect -----------------------------
//
// `ProviderList` and everything under it reach the backend through react-query
// and Tauri's `invoke`, which `src/client/tauri-shim/` redirects onto this
// plugin's routes. One client for the whole tab: `useDragSort` invalidates
// `["providers", appId]` after a reorder, and that only works if the list was
// read through the same client.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false } },
});

/**
 * The app id the copied list is driven with.
 *
 * `ProviderList` picks one of three section builders from it, and this plugin
 * has no app switcher any more (decision #3) — so the value is not "which tool
 * we are managing" but "which per-app behaviour to run". `mcode` is the
 * additive branch with no per-app live queries: `opencode`, `openclaw`,
 * `hermes` and `pi` would each fire an `invoke` for a command this plugin does
 * not implement, and `claude`/`codex` would decide every row was an official
 * account from a `settingsConfig` shape we do not store.
 */
export const CCSWITCH_APP_ID = "mcode";

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
 * How a failed row action is worded, per operation.
 *
 * The Host's own message ("could not delete the provider") is accurate but
 * generic, and the user clicked one of four buttons — naming the operation is
 * what makes the failure readable at a glance. Keyed by operation rather than
 * by route so a new action has one obvious place to add its wording.
 */
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

function ProviderManagerSectionInner({ controller, t }) {
  const tr = makeTranslator(t);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  // The revision is captured when a dialog opens; see `useDialog`.
  const { dialog, openCreate, openEdit, openDuplicate, close } = useDialog(
    snapshot.revision,
    () => controller.clearSaveFeedback?.(),
  );
  const [presetKey, setPresetKey] = useState("");
  const [presetQuery, setPresetQuery] = useState("");
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
  // Narrowed for the picker only. An empty result is deliberately not the
  // same state as "the Host sent no presets": that one hides the whole
  // control, while this one has to say so inside the select, or the user
  // sees a dropdown holding nothing but the blank entry and no reason why.
  const matchingPresets = presets.filter((preset) => presetMatches(preset, presetQuery));
  const busy = snapshot.status === "busy" || snapshot.status === "loading";
  const notice = snapshot.notice;

  // Read through cc-switch's own query, so the rows arrive in its shape and a
  // reorder invalidates the cache they came from.
  const ccs = useProvidersQuery(CCSWITCH_APP_ID);

  /**
   * One membership or delete action, with the caches brought back in step.
   *
   * Failures are not reported here: the controller publishes them, and the
   * banner above the table is the one place a failure belongs now that the row
   * it happened on no longer has a slot for a message of its own.
   */
  const runRowAction = async (key, action) => {
    try {
      await action();
    } catch {
      return;
    } finally {
      // The list and the controller read the same catalogue from two
      // directions, so both are told: react-query, because that is what draws
      // the table, and the controller, because that holds the revision the
      // dialog will submit against.
      queryClient.invalidateQueries({ queryKey: ["providers", CCSWITCH_APP_ID] });
      const refreshed = controller.refresh?.();
      if (refreshed?.catch) void refreshed.catch(() => {});
    }
  };

  /**
   * The membership callbacks, taking the row cc-switch's list hands back.
   *
   * Its rows carry `id` (the catalogue key) rather than this plugin's flat
   * record, so each one that needs stored fields looks them up in the
   * controller's snapshot — which is also where the revision a dialog was
   * opened at lives.
   */
  const onSwitch = (row) => runRowAction(row.id, () => controller.apply(row.id));
  const onRemoveFromConfig = (row) => runRowAction(row.id, () => controller.withdraw(row.id));

  const onEdit = (row) => {
    const record = providers[row.id];
    if (record) openEdit(record);
  };
  const onDuplicate = (row) => {
    const record = providers[row.id];
    if (record) openDuplicate(record);
  };

  const onDelete = (row) => {
    const record = providers[row.id];
    const name = record?.displayName || row.name || row.id;
    // Destructive and irreversible, so it is confirmed. `window.confirm` is
    // deliberate: this runs inside the settings dialog, where a second layered
    // modal would trap focus against the first.
    if (typeof window !== "undefined" && typeof window.confirm === "function"
      && !window.confirm(tr("manager.deleteConfirm", "确定删除 provider「{name}」？该操作无法撤销。", { name }))) {
      return;
    }
    void runRowAction(row.id, () => controller.remove(row.id));
  };

  const onOpenWebsite = (url) => {
    if (typeof window !== "undefined" && typeof window.open === "function") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
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

  return h(QueryClientProvider, { client: queryClient }, h("section", { className: "dsh-ccswitch-manager", "aria-labelledby": "dsh-ccswitch-manager-title" },
    h("div", { className: "dsh-ccswitch-manager__header" },
      h("div", null,
        h("h2", { id: "dsh-ccswitch-manager-title", className: "dsh-ccswitch-manager__title" }, tr("manager.title", "供应商管理")),
        h("p", { className: "dsh-ccswitch-manager__hint" }, tr("manager.hintExpanded", "直接管理本插件拥有的 provider：新增、编辑、复制、删除、启用。")),
      ),
      h("div", { className: "dsh-ccswitch-manager__header-actions" },
        presets.length > 0
          ? h("label", { className: "dsh-ccswitch-manager__preset" },
            h("span", { className: "dsh-ccswitch-manager__preset-label" }, tr("manager.presetLabel", "预设")),
            // The catalogue is large enough that a name-only scan does not find
            // what the user is looking for: the alias table behind
            // `presetMatches` is what lets 小米 find Xiaomi MiMo and 月之暗面
            // find Kimi, neither of which the display name contains.
            h("input", {
              type: "text",
              className: "dsh-ccswitch-form__input dsh-ccswitch-manager__preset-filter",
              value: presetQuery,
              placeholder: tr("manager.presetFilter", "筛选预设（厂商 / 别名 / 域名）…"),
              "aria-label": tr("manager.presetFilterAria", "筛选预设"),
              onChange: (event) => setPresetQuery(event.target.value),
            }),
            h("select", {
              className: "dsh-ccswitch-manager__preset-select",
              value: presetKey,
              onChange: (event) => applyPreset(event.target.value),
            },
              h("option", { value: "" }, tr("manager.presetNone", "自定义（空白）")),
              // Grouped the way CC Switch's "add provider" list is sectioned.
              // A `<select>` cannot show the section names any other way.
              //
              // No match gets its own disabled option rather than an empty
              // select: a dropdown holding only "自定义（空白）" reads as a
              // broken filter, not as "nothing matched".
              ...(matchingPresets.length === 0
                ? [h("option", { key: "__none__", value: "__none__", disabled: true },
                  tr("manager.presetNoMatch", "没有匹配的预设。"))]
                : groupPresetsByCategory(matchingPresets).map((section) => h("optgroup", {
                  key: section.group,
                  // `optgroup` takes a `label` attribute, not children.
                  label: tr(`manager.group.${section.group}`, FALLBACK[`manager.group.${section.group}`]),
                },
                  ...section.presets.map((preset) => h("option", { key: preset.key, value: preset.key },
                    presetOptionLabel(preset, tr))),
                ))),
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

    notice
      ? h("div", {
        role: "status",
        className: "dsh-ccswitch-manager__activation"
          + (notice.warnings.length > 0 ? " dsh-ccswitch-manager__activation--warn" : ""),
      },
        h("div", { className: "dsh-ccswitch-manager__activation-head" },
          // `notice.name` is captured when the write happened, so a banner that
          // outlives the row it describes (a delete) still says what it was.
          h("strong", null, (() => {
            const name = notice.name ?? providers[notice.key]?.displayName ?? notice.key;
            if (notice.action === "delete") {
              return notice.wasInUse
                ? tr("manager.deletedInUse", "已删除 {name}（原本在 DSH 的路由表中，已一并移出）", { name })
                : tr("manager.deleted", "已删除 {name}", { name });
            }
            if (notice.action === "withdraw") {
              return tr("manager.withdrawn", "已从 DSH 的路由表移出 {name}", { name });
            }
            return tr("manager.applied", "已接入 DSH 的路由表：{name}", { name });
          })()),
          h("button", {
            type: "button",
            className: "dsh-ccswitch-import__link",
            onClick: () => controller.dismissNotice(),
          }, tr("manager.dismiss", "知道了")),
        ),
        notice.orphan
          ? h("p", { className: "dsh-ccswitch-manager__activation-warning" },
            tr("manager.withdrawnOrphan", "该 key 只存在于 DSH 的路由表里，目录中并没有它，已一并清理。"))
          : null,
        notice.warnings.length > 0
          ? h("div", null,
            h("p", { className: "dsh-ccswitch-manager__activation-title" }, tr("manager.membershipWarnings", "接入提示")),
            h("ul", { className: "dsh-ccswitch-manager__activation-list" },
              ...notice.warnings.map((warning, index) => h("li", { key: `${index}-${warning}` }, warning)),
            ),
          )
          : null,
      )
      : null,

    // The table is cc-switch's own `ProviderList`, copied verbatim: its
    // Added / Available sections, the card anatomy, the ⌘F search, drag
    // ordering and the empty state all come from upstream, and only the data
    // in front of it is ours. Rows arrive already in cc-switch's shape — the
    // transport is where the plugin's flat record is projected (see
    // `src/client/tauri-shim/commands.mjs`) — and the callbacks below land on
    // this plugin's own controller.
    //
    // The list reads through react-query rather than the controller because
    // `useDragSort` invalidates `["providers", appId]` after a reorder, and
    // that only reaches the cache the list was read from. The controller stays
    // the authority for the edit dialog's revision and for the banners.
    h(ProviderList, {
      providers: ccs.data?.providers ?? {},
      currentProviderId: ccs.data?.currentProviderId ?? "",
      appId: CCSWITCH_APP_ID,
      isLoading: ccs.isPending || snapshot.status === "loading" || snapshot.status === "idle",
      onSwitch,
      onRemoveFromConfig,
      onEdit,
      onDuplicate,
      onDelete,
      onCreate: () => openCreate(undefined),
      onOpenWebsite,
    }),

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
  ));
}

/**
 * The provider-manager tab.
 *
 * Split in two because `useProvidersQuery` reads a react-query client from
 * context, and a hook called in the outer component would run *before* the
 * provider that supplies it exists. The inner half owns every hook and all the
 * state; this half only supplies the client the copied list needs.
 */
export function ProviderManagerSection(props) {
  return h(QueryClientProvider, { client: queryClient }, h(ProviderManagerSectionInner, props));
}
