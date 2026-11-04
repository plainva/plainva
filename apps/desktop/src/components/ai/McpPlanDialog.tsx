import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { PlugZap } from "lucide-react";
import { AiPlanDetails, Button, ICON, Modal, toast } from "@plainva/ui";
import { mcpPlans } from "../../services/ai/mcpPlans";

/**
 * The question about a plan of an AI app on this computer (plan KI-Harness
 * §17.3 stage 2): a rename, a move or a deletion it asked Plainva's MCP
 * server for. The dialog names the app and shows what would happen — in the
 * rows the assistant's own plan card uses —; the app itself was only told
 * that input is required. A yes here carries nothing out: Plainva does it
 * when the app comes back for this very plan, and for a deletion the app's
 * own delete dialog opens then, which decides. Closing the dialog is a no.
 */
export function McpPlanDialog() {
  const { t } = useTranslation();
  const plan = useSyncExternalStore(mcpPlans.subscribe, mcpPlans.current, mcpPlans.current);
  if (!plan) return null;
  const kind = plan.question.plan;
  const decide = (decision: "yes" | "no") => {
    mcpPlans.decide(plan.handle, decision);
    if (decision === "yes") toast.info(t("ai.mcp.plan.allowed", { client: plan.client }));
  };

  return (
    <Modal
      title={t(`ai.mcp.plan.${kind}Title`, { client: plan.client })}
      icon={<PlugZap size={ICON.ui} />}
      onClose={() => decide("no")}
      closeOnOverlay={false}
      testId="mcp-plan"
      footer={
        <>
          <Button variant="ghost" onClick={() => decide("no")} data-testid="mcp-plan-deny">
            {t("ai.mcp.pairDeny")}
          </Button>
          {/* A deletion is no step this dialog makes look like the obvious one. */}
          <Button variant={kind === "delete" ? "secondary" : "primary"} onClick={() => decide("yes")} data-testid="mcp-plan-allow">
            {t("ai.mcp.pairAllow")}
          </Button>
        </>
      }
    >
      <div className="pv-mcp-plan" data-plan={kind}>
        <AiPlanDetails question={plan.question} />
        <p className="pv-mcp-note" data-testid="mcp-plan-hint">
          {t(`ai.mcp.plan.${kind}Hint`, { client: plan.client })}
        </p>
      </div>
    </Modal>
  );
}
