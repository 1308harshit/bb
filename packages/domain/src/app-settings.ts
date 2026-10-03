import { z } from "zod";
import { completedTurnDisplaySchema } from "./completed-turn-display.js";
import { isValidGitBranchName } from "./git-checkout.js";

export const DEFAULT_THREAD_NAMING_PROMPT =
  "You create concise titles for coding tasks.\nReply with only the title: short, clear, sentence case, in the same language as the task. Keep it under about 40 characters; for scripts that do not separate words with spaces, that is roughly 20 characters. Summarize the task in your own words instead of copying its text. No quotes, no trailing punctuation, no explanation.\n\nConsider the user's intent when titling to make it useful. For instance, if they detail specific tools to use to solve a problem, it is the problem that should be the title, not the tools that should be used.";

export const THREAD_NAMING_PROMPT_MAX_LENGTH = 8000;

export const MANAGED_BRANCH_PREFIX_MAX_LENGTH = 64;

export const DEFAULT_MANAGED_BRANCH_PREFIX = "bb/";

export const managedBranchPrefixSchema = z
  .string()
  .max(MANAGED_BRANCH_PREFIX_MAX_LENGTH)
  .refine((prefix) => isValidGitBranchName(`${prefix}slug-thr_id`), {
    message: "Prefix must start a valid git branch name",
  });

export const appSettingsSchema = z
  .object({
    showKeyboardHints: z.boolean(),
    steerActiveThreadOnEnter: z.boolean(),
    confirmThreadArchive: z.boolean(),
    showDiagnosticEvents: z.boolean(),
    providerOrder: z.array(z.string().min(1)),
    defaultProviderId: z.string().min(1).nullable(),
    providerCompletedTurnDisplay: z.record(
      z.string().min(1),
      completedTurnDisplaySchema,
    ),
    streamerMode: z.boolean(),
    allowFastServiceTier: z.boolean(),
    telemetryEnabled: z.boolean(),
    managedBranchPrefix: managedBranchPrefixSchema,
    threadNamingPrompt: z
      .string()
      .trim()
      .min(1)
      .max(THREAD_NAMING_PROMPT_MAX_LENGTH)
      .nullable()
      .default(null),
    machineServerUrl: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password
        );
      })
      .nullable(),
    machineGitCredentialsEnabled: z.boolean(),
    defaultMachineAccess: z.string().min(1).nullable(),
  })
  .strict();
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const defaultAppSettings: AppSettings = {
  showKeyboardHints: true,
  steerActiveThreadOnEnter: true,
  confirmThreadArchive: true,
  showDiagnosticEvents: false,
  providerOrder: [],
  defaultProviderId: null,
  providerCompletedTurnDisplay: {},
  streamerMode: false,
  allowFastServiceTier: true,
  telemetryEnabled: true,
  managedBranchPrefix: DEFAULT_MANAGED_BRANCH_PREFIX,
  threadNamingPrompt: null,
  machineServerUrl: null,
  defaultMachineAccess: null,
  machineGitCredentialsEnabled: true,
};

export const disabledProviderIdsSchema = z.array(z.string().min(1));

export const appSettingsUpdateSchema = z.union([
  appSettingsSchema.extend({
    threadNamingPrompt: appSettingsSchema.shape.threadNamingPrompt
      .removeDefault()
      .optional(),
    allowFastServiceTier: z.boolean().optional(),
    telemetryEnabled: z.boolean().optional(),
    confirmThreadArchive: z.boolean().optional(),
    showUnhandledProviderEvents: z.boolean().optional(),
  }),
  appSettingsSchema.omit({ showDiagnosticEvents: true }).extend({
    threadNamingPrompt: appSettingsSchema.shape.threadNamingPrompt
      .removeDefault()
      .optional(),
    allowFastServiceTier: z.boolean().optional(),
    telemetryEnabled: z.boolean().optional(),
    confirmThreadArchive: z.boolean().optional(),
    showUnhandledProviderEvents: z.boolean(),
  }),
]);
export type AppSettingsUpdate = z.infer<typeof appSettingsUpdateSchema>;
