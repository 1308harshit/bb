import { createContext, useContext } from "react";
import type { ComposerTypeaheadApi } from "@get-bb/plugin-sdk";
import type { ResolvedComposerTypeahead } from "@/lib/plugin-slot-resolvers";
import { PluginSlotMount } from "./PluginSlotMount";

const ComposerTypeaheadContext = createContext<ComposerTypeaheadApi | null>(
  null,
);

export function useComposerTypeaheadApi(): ComposerTypeaheadApi {
  const api = useContext(ComposerTypeaheadContext);
  if (api === null) {
    throw new Error(
      "experimental_useComposerTypeahead() must be called inside an experimental_typeaheads component",
    );
  }
  return api;
}

export function PluginComposerTypeaheadMount({
  contribution,
  api,
}: {
  contribution: ResolvedComposerTypeahead;
  api: ComposerTypeaheadApi;
}) {
  const { pluginId, customizationId, typeahead } = contribution;
  const Component = typeahead.component;
  return (
    <div
      role="dialog"
      aria-label={typeahead.label}
      data-plugin-composer-typeahead={`${pluginId}/${customizationId}/${typeahead.id}`}
      className="overflow-hidden rounded-md border border-border bg-popover text-popover-foreground"
    >
      <PluginSlotMount
        pluginId={pluginId}
        slotKind="composerTypeahead"
        slotId={`${customizationId}/${typeahead.id}`}
        crashFallback={<></>}
      >
        <ComposerTypeaheadContext.Provider value={api}>
          <Component />
        </ComposerTypeaheadContext.Provider>
      </PluginSlotMount>
    </div>
  );
}

interface ComposerTypeaheadOpener {
  open(pluginId: string, typeaheadId: string): boolean;
}

const composerTypeaheadOpeners: symbol[] = [];
const composerTypeaheadOpenersByOwner = new Map<
  symbol,
  ComposerTypeaheadOpener
>();

export function registerComposerTypeaheadOpener(
  owner: symbol,
  opener: ComposerTypeaheadOpener,
): () => void {
  composerTypeaheadOpenersByOwner.set(owner, opener);
  if (!composerTypeaheadOpeners.includes(owner)) {
    composerTypeaheadOpeners.push(owner);
  }
  return () => {
    composerTypeaheadOpenersByOwner.delete(owner);
    const index = composerTypeaheadOpeners.indexOf(owner);
    if (index !== -1) composerTypeaheadOpeners.splice(index, 1);
  };
}

export function markComposerTypeaheadOpenerFocused(owner: symbol): void {
  const index = composerTypeaheadOpeners.indexOf(owner);
  if (index === -1 || index === composerTypeaheadOpeners.length - 1) return;
  composerTypeaheadOpeners.splice(index, 1);
  composerTypeaheadOpeners.push(owner);
}

export function openComposerTypeahead(
  pluginId: string,
  typeaheadId: string,
): boolean {
  const owner = composerTypeaheadOpeners.at(-1);
  if (owner === undefined) return false;
  return (
    composerTypeaheadOpenersByOwner.get(owner)?.open(pluginId, typeaheadId) ??
    false
  );
}
