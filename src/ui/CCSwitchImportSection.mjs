// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import React, { useEffect, useSyncExternalStore } from "react";
import { saveCollapse, withPanelToggled } from "./collapse-state.mjs";
import { makeTranslator } from "../client/i18n.mjs";

const h = React.createElement;

function isSelectable(profile) {
  return profile.status !== 'blocked' && profile.credential === 'found';
}

function statusKey(status) {
  if (status === 'new') return 'importer.status.new';
  if (status === 'update' || status === 'updated') return 'importer.status.update';
  if (status === 'unchanged') return 'importer.status.unchanged';
  if (status === 'blocked') return 'importer.status.blocked';
  if (status === 'failed') return 'importer.status.failed';
  if (status === 'skipped') return 'importer.status.skipped';
  return undefined;
}

function statusLabel(status, tr) {
  const key = statusKey(status);
  return key ? tr(key, status) : (status ?? '');
}

const SAFE_BADGES = new Set(['new', 'update', 'updated', 'unchanged', 'blocked', 'failed', 'skipped']);

function badgeClass(status) {
  const safe = SAFE_BADGES.has(status) ? status : 'unchanged';
  return `dsh-ccswitch-import__badge dsh-ccswitch-import__badge--${safe}`;
}

/**
 * The Host reports why a row is blocked as a stable code (`blockedCode`) plus a
 * variable detail. Keeping the Chinese strings here as fallbacks means the row
 * still explains itself when the Host translator is unavailable, and the codes
 * stay the single source of truth for which reason is which.
 *
 * Exported so a test can assert every code in `BLOCKED_CODES` has an entry:
 * this map is the one place a new code can silently degrade to the generic
 * message, and nothing at runtime reports the omission.
 */
export const BLOCKED_FALLBACK = {
  'invalid-settings-json': '设置内容不是合法 JSON',
  'unsupported-app-type': '不支持的 app 类型：{detail}',
  'missing-openai-key': '缺少 API key（auth.OPENAI_API_KEY）',
  'missing-codex-provider': 'config 里没有可用的 [model_providers.custom] 段',
  'missing-anthropic-key': '缺少 API key（env.ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY）',
  'missing-anthropic-base-url': '缺少 base URL（env.ANTHROPIC_BASE_URL）',
  'missing-claude-desktop-key': '缺少 API key（env.ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY）',
  'missing-claude-desktop-base-url': '缺少 base URL（顶级 baseUrl 与 env.ANTHROPIC_BASE_URL 都没有）',
  'unsupported-gemini-protocol': 'Gemini CLI 使用原生协议，DSH 没有对应适配器：{detail}；请改用 OpenAI 兼容的 Gemini 中转',
  'missing-hermes-key': '缺少 API key（api_key）',
  'missing-hermes-base-url': '缺少 base URL（base_url）',
  'missing-pi-key': '缺少 API key（apiKey）',
  'missing-pi-base-url': '缺少 base URL（baseUrl）',
  'unsupported-pi-api': 'pi 的 api 不是 DSH 支持的协议：{detail}',
  'missing-mcode-key': '缺少 API key（options.apiKey）',
  'missing-mcode-base-url': '缺少 base URL（options.baseURL）',
  'unsupported-mcode-api': 'mcode 的 api 不是 DSH 支持的协议：{detail}',
  'missing-openclaw-key': '缺少 API key（apiKey）',
  'missing-openclaw-base-url': '缺少 base URL（baseUrl）',
  'unsupported-openclaw-api': 'openclaw 的 api 不是 DSH 支持的协议：{detail}',
  'missing-opencode-key': '缺少 API key（options.apiKey）',
  'missing-opencode-base-url': '缺少 base URL（options.baseURL）',
  'unsupported-opencode-adapter': '暂不支持的 opencode 适配器：{detail}',
  'duplicate-provider-key': '本批里 provider 键重复：{detail}',
  'blocked': '该配置无法导入',
};

function blockedLabel(source, tr) {
  const code = typeof source?.blockedCode === 'string' && BLOCKED_FALLBACK[source.blockedCode]
    ? source.blockedCode
    : 'blocked';
  const detail = typeof source?.blockedDetail === 'string' ? source.blockedDetail : '';
  return tr(`importer.blocked.${code}`, BLOCKED_FALLBACK[code], { detail });
}

/**
 * An empty scan has several distinct causes (no CC Switch installed, database
 * present but no importable rows, unreadable schema, Node without node:sqlite).
 * Reporting them as one message leaves the user with no next step.
 */
function emptyMessage(snapshot, tr) {
  const probed = snapshot.probedPath || '~/.cc-switch/cc-switch.db';
  if (snapshot.source === 'not-installed') {
    return tr('importer.emptyNotInstalled', '未检测到 CC Switch 数据库（已查找 {path}）。', { path: probed });
  }
  if (snapshot.source === 'no-profiles') {
    return tr('importer.emptyNoProfiles', 'CC Switch 数据库中没有可导入的 provider。');
  }
  if (snapshot.source === 'unreadable') {
    return tr('importer.emptyUnreadable', 'CC Switch 数据库无法读取（表结构异常或文件损坏）。');
  }
  if (snapshot.source === 'unsupported-node') {
    return tr('importer.emptyUnsupportedNode', '当前 Node 版本无法加载 node:sqlite，因此读不到 CC Switch 数据库。');
  }
  return tr('importer.empty', '没有可读取的 CCSwitch provider。');
}

/** Second line of an import-result row; empty when the status says it all. */
function resultDetail(result, tr) {
  if (result.status === 'failed') {
    return result.error ? tr('importer.resultError', '错误：{message}', { message: result.error }) : '';
  }
  if (result.status === 'blocked') return blockedLabel(result, tr);
  if (result.status === 'skipped') return tr('importer.resultSkipped', '未选择，或该配置不可导入');
  return '';
}

/**
 * "Test connection" reports reach the Host the same way blocked reasons do: a
 * stable reason code plus numbers, so the wording can be localized while the
 * codes stay the single source of truth. Unknown codes degrade to "network".
 */
const PROBE_FALLBACK = {
  ok: '连通 · {count} 个模型 · {ms}ms',
  'ok-minimal': '连通 · 最小请求 · {ms}ms',
  empty: '连通 · 上游没返回模型',
  'http-error': '失败 · HTTP {status}',
  'no-credentials': '无法测试：缺少凭据或 base URL',
  timeout: '失败 · 超时',
  network: '失败 · 网络错误',
};

function probeLabel(probe, tr) {
  if (probe?.phase === 'error') {
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

/** Same normalization the reasoning panel uses before building a DOM id. */
function domIdPart(value) {
  return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60);
}

export function CCSwitchImportSection({ controller, collapse, setCollapse, t }) {
  const tr = makeTranslator(t);
  if (!controller) return null;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    if (snapshot.phase === 'idle') void controller.scan().catch(() => {});
  }, [controller, snapshot.phase]);
  const scanning = snapshot.phase === "loading";
  const importing = snapshot.phase === "importing";
  const busy = scanning || importing;
  // The first frame is `idle` with no rows yet. Treating that as "nothing to
  // import" made the panel claim there are no providers for one frame, before
  // the effect had a chance to scan, so the empty state now waits for a scan
  // that has actually finished.
  const awaitingFirstScan = snapshot.phase === "idle" || scanning;
  const selected = new Set(snapshot.selectedIds);
  const profiles = Array.isArray(snapshot.profiles) ? snapshot.profiles : [];
  const importableIds = profiles.filter(isSelectable).map((profile) => profile.profileId);
  const selectedCount = importableIds.filter((id) => selected.has(id)).length;
  const allSelected = importableIds.length > 0 && selectedCount === importableIds.length;
  const collapsed = collapse?.importPanel === true;
  const toggleCollapsed = () => {
    if (typeof setCollapse !== "function") return;
    setCollapse((current) => {
      const next = withPanelToggled(current, "importPanel");
      saveCollapse(next);
      return next;
    });
  };
  return h("section", { className: "dsh-ccswitch-import" + (collapsed ? " dsh-ccswitch-import--collapsed" : ""), "aria-labelledby": "dsh-ccswitch-import-title" },
    h("div", { className: "dsh-ccswitch-import__header" },
      h("div", null,
        h("h2", { id: "dsh-ccswitch-import-title", className: "dsh-ccswitch-import__title" }, tr('importer.title', 'CCSwitch 导入')),
        h("p", { className: "dsh-ccswitch-import__hint" }, collapsed
          ? tr('importer.hintCollapsed', '点击展开 CCSwitch 导入设置')
          : tr('importer.hintExpanded', '从本机 CCSwitch 读取 provider 配置。')),
      ),
      h("div", { className: "dsh-ccswitch-import__header-actions" },
        h("button", {
          type: "button",
          className: "dsh-ccswitch-collapse",
          "aria-expanded": !collapsed,
          "aria-controls": "dsh-ccswitch-import-body",
          "aria-label": tr('importer.collapseAria', '展开或收起 CCSwitch 导入面板'),
          onClick: toggleCollapsed,
        }, h("span", { "aria-hidden": "true" }, collapsed ? "⌄" : "⌃")),
        !collapsed && h("div", { className: "dsh-ccswitch-import__actions" },
          h("button", { className: "dsh-ccswitch-import__secondary", type: "button", disabled: busy, onClick: () => { void controller.scan().catch(() => {}); } },
            scanning ? tr('importer.scanning', '处理中…') : tr('importer.scan', '扫描')),
          h("button", { className: "dsh-ccswitch-import__primary", type: "button", disabled: busy || selected.size === 0, onClick: () => { void controller.importSelected().catch(() => {}); } },
            importing ? tr('importer.importing', '导入中…') : tr('importer.importSelected', '导入选中')),
        ),
      ),
    ),
    h("div", { id: "dsh-ccswitch-import-body", className: "dsh-ccswitch-import__body", hidden: collapsed },
      snapshot.error && h("p", { role: "alert", className: "dsh-ccswitch-import__error" }, snapshot.error),
      profiles.length === 0
        ? (awaitingFirstScan
          ? h("p", { className: "dsh-ccswitch-import__empty" }, tr('importer.loading', '正在读取 CCSwitch 配置…'))
          : h("p", { className: "dsh-ccswitch-import__empty" }, emptyMessage(snapshot, tr)))
        : h("div", { className: "dsh-ccswitch-import__list" },
          h("label", { className: "dsh-ccswitch-import__row dsh-ccswitch-import__row--select-all" },
            h("input", {
              type: "checkbox",
              checked: allSelected,
              ref: (el) => { if (el) el.indeterminate = selectedCount > 0 && !allSelected; },
              disabled: busy || importableIds.length === 0,
              onChange: () => controller.toggleSelectAll(),
            }),
            h("span", { className: "dsh-ccswitch-import__content" },
              h("strong", null, allSelected ? tr('importer.selectNone', '取消全选') : tr('importer.selectAll', '全选')),
              h("span", { className: "dsh-ccswitch-import__meta-line" },
                h("span", null, tr('importer.selectedCount', '已选 {selected} / {total} 个可导入', { selected: selectedCount, total: importableIds.length })),
              ),
            ),
          ),
          ...profiles.map((profile, index) => {
            const selectable = isSelectable(profile);
            const probe = snapshot.probes?.[profile.profileId];
            const testing = probe?.phase === 'testing';
            const canProbe = selectable && Boolean(profile.baseURL);
            const checkboxId = `dsh-ccswitch-import-select-${index}-${domIdPart(profile.profileId)}`;
            return h("div", {
              key: profile.profileId,
              className: "dsh-ccswitch-import__row" + (selectable ? "" : " dsh-ccswitch-import__row--blocked"),
            },
              h("input", {
                type: "checkbox",
                id: checkboxId,
                checked: selected.has(profile.profileId),
                disabled: !selectable || busy,
                onChange: () => controller.toggleSelected(profile.profileId),
              }),
              // The row is a plain container now and the text is a real <label>
              // for the checkbox: a button inside a wrapping <label> would also
              // toggle the checkbox when clicked.
              h("label", { htmlFor: checkboxId, className: "dsh-ccswitch-import__content" },
                h("span", { className: "dsh-ccswitch-import__primary-line" },
                  h("strong", null, profile.profileName || profile.profileId),
                  profile.baseURL ? h("code", null, profile.baseURL) : null,
                ),
                h("span", { className: "dsh-ccswitch-import__meta-line" },
                  h("code", { className: "dsh-ccswitch-import__provider-key" }, profile.providerKey || tr('importer.pendingKey', '待生成 provider key')),
                  h("span", null, `${profile.credential === "found" ? tr('importer.credentialFound', '凭据已找到') : tr('importer.credentialMissing', '缺少凭据')} · ${(profile.modelIds ?? []).join(", ") || tr('importer.noModels', '无模型')}`),
                  // A blocked row used to show only "blocked" with no reason:
                  // the Host had already worked out exactly what was wrong.
                  profile.status === 'blocked'
                    ? h("span", { className: "dsh-ccswitch-import__blocked-reason" }, blockedLabel(profile, tr))
                    : null,
                  Array.isArray(profile.warnings) && profile.warnings.length > 0
                    ? h("span", { className: "dsh-ccswitch-import__warnings" }, profile.warnings.join("；"))
                    : null,
                ),
              ),
              h("span", { className: "dsh-ccswitch-import__row-extras" },
                canProbe ? h("button", {
                  type: "button",
                  className: "dsh-ccswitch-import__link dsh-ccswitch-import__probe-btn",
                  disabled: testing || busy,
                  "aria-label": tr('importer.probe.testAria', '测试 {name} 的连接', { name: profile.profileName || profile.profileId }),
                  onClick: () => { Promise.resolve(controller.probeOne(profile.profileId)).catch(() => {}); },
                }, testing ? tr('importer.probe.testing', '测试中…') : tr('importer.probe.test', '测试连接')) : null,
                probe && !testing
                  ? h("span", {
                    role: "status",
                    className: `dsh-ccswitch-import__probe dsh-ccswitch-import__probe--${probeKind(probe)}`,
                  }, probeLabel(probe, tr))
                  : null,
                h("span", { className: badgeClass(profile.status) }, statusLabel(profile.status, tr)),
              ),
            );
          }),
        ),
      snapshot.results.length > 0 && h("div", { className: "dsh-ccswitch-import__report" },
        h("div", { className: "dsh-ccswitch-import__report-head" },
          h("strong", null, tr('importer.resultsTitle', '导入结果')),
          h("button", { type: "button", className: "dsh-ccswitch-import__link", onClick: () => controller.clearResults() }, tr('importer.resultsClear', '清除')),
        ),
        h("ul", { className: "dsh-ccswitch-import__results" },
          ...snapshot.results.map((result, index) => {
            const detail = resultDetail(result, tr);
            return h("li", {
              key: `${result.profileId ?? 'row'}-${result.status ?? 'unknown'}-${index}`,
              className: "dsh-ccswitch-import__result" + (result.status === 'failed' ? " dsh-ccswitch-import__result--failed" : ""),
            },
              h("span", { className: badgeClass(result.status) }, statusLabel(result.status, tr)),
              h("strong", null, result.profileName || result.profileId || ''),
              detail ? h("span", { className: "dsh-ccswitch-import__result-detail" }, detail) : null,
            );
          }),
        ),
      ),
    ),
  );
}
