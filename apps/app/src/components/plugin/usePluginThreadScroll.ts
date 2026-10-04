import { useContext, useMemo } from "react";
import type { ExperimentalThreadScroll } from "@get-bb/plugin-sdk";
import { ThreadScrollContext } from "@/components/ui/thread-scroll-context";
import { PluginSlotElementContext, usePluginId } from "./plugin-context";

export function usePluginThreadScroll(): ExperimentalThreadScroll {
  usePluginId();
  const slotRef = useContext(PluginSlotElementContext);
  const timeline = useContext(ThreadScrollContext);
  return useMemo<ExperimentalThreadScroll>(
    () => ({
      scrollIntoView(element, options) {
        const root = slotRef?.current;
        if (
          !root ||
          !element.isConnected ||
          element.closest("[data-bb-plugin-root]") !== root
        ) {
          return false;
        }
        return timeline?.scrollIntoView(element, options) ?? false;
      },
    }),
    [slotRef, timeline],
  );
}
