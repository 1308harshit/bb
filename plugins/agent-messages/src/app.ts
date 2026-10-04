import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { NO_REPLY_DIRECTIVE } from "./no-reply.js";

export default definePluginApp((app) => {
  app.slots.messageDirective({ id: NO_REPLY_DIRECTIVE, component: () => null });
});
