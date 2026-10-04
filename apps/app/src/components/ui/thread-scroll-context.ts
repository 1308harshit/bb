import { createContext } from "react";
import type { ExperimentalThreadScroll } from "@get-bb/plugin-sdk";

export const ThreadScrollContext = createContext<
  | (ExperimentalThreadScroll & { contentArrived: (version: number) => void })
  | null
>(null);
