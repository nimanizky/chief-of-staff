import {
  buildTaskRouterContext,
  isPreprocessedMessageEvent,
  logTaskRouterStart
} from "./context.ts";
import { routeTask } from "../../dist/task-router/task-router.js";
import type { TaskConfirmation, TaskRouterLogger } from "../../dist/task-router/task.types.js";
import { logStep, preview } from "./logging.ts";
import { suppressDownstreamProcessing } from "./openclaw-event.ts";
import {
  resolveChannelPolicy,
  shouldLetDefaultAgentHandle,
  shouldRunTaskModule,
  shouldSuppressDefaultAgent
} from "./routing-policy.ts";
import { sendControlledText, sendTelegramInlineConfirmation } from "./telegram.ts";

const handler = async (event: any) => {
  if (!isPreprocessedMessageEvent(event)) return;

  const context = buildTaskRouterContext(event);
  logTaskRouterStart(context);
  // General WhatsApp uses the standard OpenClaw agent instead of local task routing.
  if (context.sourcePlatform === "whatsapp" && /^(1|true|yes|on)$/i.test(process.env.OPENCLAW_GENERAL_WHATSAPP ?? "")) {
    logStep("routing.default_agent", { reason: "general_whatsapp_mode" });
    return;
  }
  const policy = resolveChannelPolicy(context);
  logStep("routing.policy", {
    key: policy.key,
    name: policy.name,
    modules: policy.modules,
    media: policy.media,
    unknownText: policy.unknownText
  });

  if (shouldSuppressDefaultAgent(context, policy)) {
    suppressDownstreamProcessing(context.event, "routing_policy");
  }

  if (shouldLetDefaultAgentHandle(context, policy)) {
    logStep("routing.default_agent", {
      key: policy.key,
      reason: "policy_allows_general_chat"
    });
    return;
  }

  if (!shouldRunTaskModule(context, policy)) {
    logStep("routing.no_task_module", {
      key: policy.key,
      modules: policy.modules
    });
    return;
  }

  const result = await routeTask(
    {
      text: context.text,
      mediaCandidates: context.mediaCandidates,
      sourcePlatform: context.sourcePlatform,
      chatId: context.chatId,
      baseMessageId: context.baseMessageId,
      receivedAt: context.receivedAt
    },
    taskRouterLogger
  );

  if (!result.handled) return;
  suppressDownstreamProcessing(context.event, result.suppressReason ?? "task_router_handled");

  const responses = [...result.messages];
  for (const confirmation of result.confirmations) {
    const sentDirect = await presentConfirmation(context.telegramChatId, confirmation);
    if (!sentDirect) {
      responses.push(formatConfirmationFallback(confirmation));
    }
  }

  if (responses.length > 0) {
    await sendControlledText(context.event, context.telegramChatId, responses.join("\n\n"));
  }
};

async function presentConfirmation(
  telegramChatId: string | null,
  confirmation: TaskConfirmation
): Promise<boolean> {
  if (telegramChatId === null) return false;
  return sendTelegramInlineConfirmation({
    chatId: telegramChatId,
    text: confirmation.previewText,
    token: confirmation.token,
    paymentMethod: confirmation.paymentMethod,
    optionLabel: confirmation.optionLabel,
    methodButtons: confirmation.methodCommands.map((method) => ({
      text: method.paymentMethod,
      callbackData: method.callbackData
    })),
    confirmCallbackData: confirmation.confirmCallbackData,
    rejectCallbackData: confirmation.rejectCallbackData
  });
}

function formatConfirmationFallback(confirmation: TaskConfirmation): string {
  if (!confirmation.paymentMethod) {
    const optionLabel = confirmation.optionLabel ?? "payment method";
    const methods = confirmation.methodCommands
      .map((method) => `${method.paymentMethod}: ${method.command}`)
      .join("\n");
    return `${confirmation.previewText}

Choose ${optionLabel}:
${methods}
Cancel: ${confirmation.rejectCommand}`;
  }

  return `${confirmation.previewText}

Confirm: ${confirmation.confirmCommand}
Cancel: ${confirmation.rejectCommand}`;
}

const taskRouterLogger: TaskRouterLogger = {
  log(step, data) {
    const normalizedData = data
      ? Object.fromEntries(
          Object.entries(data).map(([key, value]) => [
            key,
            key.toLowerCase().includes("url") || key.toLowerCase().includes("from")
              ? preview(value, 160)
              : value
          ])
        )
      : undefined;
    logStep(step, normalizedData);
  }
};

export default handler;
