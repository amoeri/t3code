import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { canSnooze, effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { type ReactNode, useState } from "react";

import type { AppBarMenu } from "../../components/ui/AppBar.types";
import * as Dialog from "../../components/ui/Dialog";
import { threadListEnvironmentsAtom } from "../../state/presentation";
import { useEnvironmentScope } from "../../state/session";
import { useThreadListActions } from "../home/useThreadListActions";
import { CustomSnoozeSheet } from "./CustomSnoozeSheet";
import {
  resolveThreadListV2SnoozeMenuSelection,
  resolveThreadListV2SnoozePresets,
} from "./threadListV2";
import { useThreadListNow } from "./use-thread-list-now";

const NO_THREADS: ReadonlyArray<EnvironmentThreadShell> = [];

/** Resolves a chosen preset at selection time, so a stale menu cannot snooze into the past. */
function pickedSnoozeUntil(input: {
  readonly id: string;
  readonly presets: ReturnType<typeof resolveThreadListV2SnoozePresets>;
  readonly presetSettings: Parameters<typeof resolveThreadListV2SnoozePresets>[0]["presets"];
}): string | null {
  const selection = resolveThreadListV2SnoozeMenuSelection({
    event: `snooze:${input.id}`,
    displayedPresets: input.presets,
    now: new Date(),
    presets: input.presetSettings,
  });
  return selection._tag === "selected" ? selection.preset.snoozedUntil : null;
}

/**
 * The thread list's Settle and Snooze, for the open thread's bar. A successful
 * action calls `onDone` so the screen can leave the thread it just put away.
 */
export function useThreadLifecycleMenu(input: {
  readonly thread: EnvironmentThreadShell | null;
  readonly onDone: () => void;
}): { readonly menu: AppBarMenu | null; readonly customSnoozeSheet: ReactNode } {
  const { thread, onDone } = input;
  const { settlementEnvironmentIds, snoozeEnvironmentIds, snoozePresetsByEnvironmentId } =
    useAtomValue(threadListEnvironmentsAtom);
  const { settleThread, snoozeThread } = useThreadListActions();
  const canOperate = useEnvironmentScope(
    thread?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );
  const now = useThreadListNow(thread ? [thread] : NO_THREADS);
  const [customSnoozeOpen, setCustomSnoozeOpen] = useState(false);

  // A settled or snoozed thread already offers Un-settle or Wake in its status bar.
  if (
    thread === null ||
    !canOperate ||
    thread.settledOverride === "settled" ||
    effectiveSnoozed(thread, { now })
  ) {
    return { menu: null, customSnoozeSheet: null };
  }
  const settleSupported = settlementEnvironmentIds.has(thread.environmentId);
  const snoozeSupported =
    snoozeEnvironmentIds.has(thread.environmentId) && canSnooze(thread, { now });
  if (!settleSupported && !snoozeSupported) return { menu: null, customSnoozeSheet: null };

  const presetSettings = snoozePresetsByEnvironmentId.get(thread.environmentId);
  const presets = resolveThreadListV2SnoozePresets({
    secondary: snoozeSupported ? "snooze" : null,
    now,
    presets: presetSettings,
  });
  const snooze = async (snoozedUntil: string) => {
    if (await snoozeThread(thread, snoozedUntil)) onDone();
  };
  const snoozePreset = (id: string) => {
    const snoozedUntil = pickedSnoozeUntil({ id, presets, presetSettings });
    if (snoozedUntil !== null) void snooze(snoozedUntil);
    else
      Dialog.alert("Could not snooze thread", "That snooze time has passed. Choose another time.");
  };

  return {
    menu: {
      title: "Settle or snooze",
      icon: "clock",
      items: [
        ...(settleSupported
          ? [
              {
                id: "settle",
                title: "Settle",
                icon: "checkmark",
                onPress: () => {
                  void settleThread(thread).then((settled) => {
                    if (settled) onDone();
                  });
                },
              },
            ]
          : []),
        ...(snoozeSupported
          ? [
              {
                id: "snooze",
                title: "Snooze",
                icon: "clock",
                items: [
                  ...presets.map((preset) => ({
                    id: `snooze:${preset.id}`,
                    title: preset.label,
                    subtitle: preset.whenLabel,
                    onPress: () => snoozePreset(preset.id),
                  })),
                  {
                    id: "snooze:custom",
                    title: "Custom…",
                    onPress: () => setCustomSnoozeOpen(true),
                  },
                ],
              },
            ]
          : []),
      ],
    },
    customSnoozeSheet: customSnoozeOpen ? (
      <CustomSnoozeSheet
        onClose={() => setCustomSnoozeOpen(false)}
        onSnooze={(snoozedUntil) => void snooze(snoozedUntil)}
      />
    ) : null,
  };
}
