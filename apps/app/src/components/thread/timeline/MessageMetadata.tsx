import { memo, useSyncExternalStore } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import type { ExperimentalMessageMetadataContext } from "@get-bb/plugin-sdk";
import type { PluginMessageMetadataSlot } from "@/lib/plugin-slots.js";

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let localDay = currentLocalDay();

function currentLocalDay(): string {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
}

function scheduleDayBoundary(): void {
  if (timer !== null) clearTimeout(timer);
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  timer = setTimeout(
    () => {
      timer = null;
      localDay = currentLocalDay();
      for (const listener of listeners) listener();
      if (listeners.size > 0) scheduleDayBoundary();
    },
    Math.max(1, next.getTime() - now.getTime()),
  );
}

function subscribeDay(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) scheduleDayBoundary();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

function getDay(): string {
  return localDay;
}

export function resolveMessageMetadata(
  slots: readonly PluginMessageMetadataSlot[],
  message: ExperimentalMessageMetadataContext,
): readonly { key: string; label: string; title?: string }[] {
  const results: { key: string; label: string; title?: string }[] = [];
  for (const slot of slots) {
    if (slot.roles !== undefined && !slot.roles.includes(message.role))
      continue;
    try {
      const value = slot.resolve(message);
      if (value === null) continue;
      if (
        typeof value.label !== "string" ||
        value.label.length === 0 ||
        value.label.length > 80 ||
        (value.title !== undefined &&
          (typeof value.title !== "string" || value.title.length > 160))
      ) {
        console.warn(
          `[plugin:${slot.pluginId}] messageMetadata "${slot.id}" returned invalid text`,
        );
        continue;
      }
      results.push({
        key: `${slot.pluginId}/${slot.id}/${slot.generation}`,
        label: value.label,
        ...(value.title === undefined ? {} : { title: value.title }),
      });
    } catch (error) {
      console.warn(
        `[plugin:${slot.pluginId}] messageMetadata "${slot.id}" failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return results;
}

export const MessageMetadata = memo(function MessageMetadata({
  slots,
  id,
  threadId,
  role,
  createdAt,
}: {
  slots: readonly PluginMessageMetadataSlot[];
  id: string;
  threadId: string;
  role: "user" | "assistant";
  createdAt: number;
}) {
  useSyncExternalStore(subscribeDay, getDay, getDay);
  const values = resolveMessageMetadata(slots, {
    id,
    threadId,
    role,
    createdAt,
  });
  if (values.length === 0) return null;
  return (
    <div
      className={cn(
        "flex w-full flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground",
        role === "user" ? "justify-end" : "justify-start",
      )}
      aria-label="Message metadata"
    >
      {values.map((value) => (
        <span key={value.key} title={value.title}>
          {value.label}
        </span>
      ))}
    </div>
  );
});
