// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import React, { useState } from "react";
import { ReasoningSettingsSection } from "./ReasoningSettingsSection.mjs";
import { CCSwitchImportSection } from "./CCSwitchImportSection.mjs";
import { loadCollapse, saveCollapse, withPanelToggled } from "./collapse-state.mjs";
import { makeTranslator } from "../client/i18n.mjs";

const h = React.createElement;

/**
 * Footer occupant of the built-in models settings page. The page itself is
 * rendered by the built-in ModelsSection (no shadowing since Plan A), so this
 * component only draws the CCSwitch import panel and the per-model reasoning
 * editor below the provider list. The framework injects our props via inject().
 */
export function ModelsFooterPanel({ controller, importer, t }) {
  const tr = makeTranslator(t);
  const [collapse, setCollapse] = useState(() => loadCollapse());
  const reasoningCollapsed = collapse.reasoningPanel === true;
  const toggleReasoning = () => {
    setCollapse((current) => {
      const next = withPanelToggled(current, "reasoningPanel");
      saveCollapse(next);
      return next;
    });
  };

  return h("div", { className: "dsh-reasoning-composite" },
    h(CCSwitchImportSection, { controller: importer, collapse, setCollapse, t }),
    h("section", { className: "dsh-reasoning-embed" + (reasoningCollapsed ? " dsh-reasoning-embed--collapsed" : ""), "aria-label": tr('nav', 'Model reasoning') },
      h("button", {
        type: "button",
        className: "dsh-reasoning-embed__toggle",
        "aria-expanded": !reasoningCollapsed,
        "aria-controls": "dsh-reasoning-embed-body",
        onClick: toggleReasoning,
      },
        h("span", { className: "dsh-reasoning-embed__title" }, tr('nav', 'Model reasoning')),
        h("span", { className: "dsh-reasoning-embed__hint" }, reasoningCollapsed
          ? tr('reasoning.hintCollapsed', '点击展开模型推理设置')
          : tr('reasoning.hintExpanded', '为自定义 provider 的每个模型设置推理等级；保存后即可在模型选择器中切换。')),
        h("span", { className: "dsh-reasoning-embed__toggle-chevron", "aria-hidden": "true" }, reasoningCollapsed ? "⌄" : "⌃"),
      ),
      h("div", { id: "dsh-reasoning-embed-body", hidden: reasoningCollapsed },
        h(ReasoningSettingsSection, { controller, embedded: true, collapse, setCollapse, t }),
      ),
    ),
  );
}
