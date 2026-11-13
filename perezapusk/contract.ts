// Договор кнопки перезагрузки: что умеет сервер плагина и в каком виде отвечает.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const STATE_TAG = "perezapusk-state";
export const holdMode = z.enum(["bb", "mac"]);

const holdState = z.object({
  mode: holdMode.nullable(),
  busy: z.number().int().nonnegative(),
  secondsLeft: z.number().int().nonnegative(),
  ready: z.boolean(),
});

export type HoldMode = z.infer<typeof holdMode>;
export type HoldState = z.infer<typeof holdState>;

export const restartContract = defineRpcContract({
  state: { input: z.object({}).strict(), output: holdState, tags: () => [STATE_TAG] },
  begin: { input: z.object({ mode: holdMode }).strict(), output: holdState },
  cancel: { input: z.object({}).strict(), output: holdState },
});
