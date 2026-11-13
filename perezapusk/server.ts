// Подключает к bb продолжение оборванных чатов у всех и перезагрузку без обрывов там, где bb запускает служба launchd (настройка perezagruzka).
import { spawn } from "node:child_process";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { restartContract, STATE_TAG } from "./contract";
import { type ChatPort, InterruptedChats } from "./interrupted-chats";
import { RestartHold } from "./restart-hold";

const SERVICE_LABEL = process.env.BB_PUSK_LABEL ?? "ru.antonvlasov.bb";
const TICK_MS = 5_000;
const FIRST_CHECK_MS = 20_000;
const SECOND_CHECK_MS = 90_000;
const FRESH_SERVER_S = 120;
const CLOCK_MARGIN_MS = 5_000;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((done) => {
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), done()), { once: true });
  });

function chatPort(bb: BbPluginApi): ChatPort {
  return {
    async threads() {
      const threads = await bb.sdk.threads.list({ limit: 200 });
      return threads.map((thread) => ({ id: thread.id, parentThreadId: thread.parentThreadId ?? null, status: thread.status }));
    },
    async lastEvent(threadId, types) {
      const [event] = await bb.sdk.threads.events.list({ threadId, order: "desc", limit: "1", types });
      if (!event) return null;
      const data = event.data as { reason?: unknown; item?: { taskStatus?: unknown } } | null;
      return {
        type: event.type,
        sequence: event.seq,
        createdAt: event.createdAt,
        reason: typeof data?.reason === "string" ? data.reason : null,
        taskStopped: data?.item?.taskStatus === "stopped",
      };
    },
    async inputAccepted(threadId) {
      const [event] = await bb.sdk.threads.events.list({ threadId, order: "desc", limit: "1", types: ["client/turn/requested", "turn/input/accepted"] });
      return event?.type === "turn/input/accepted";
    },
    async sendText(threadId, text) {
      await bb.sdk.threads.send({ threadId, mode: "auto", input: [{ type: "text", text, mentions: [] }] });
    },
    async retryTurn(threadId, reason) {
      await bb.sdk.threads.retry({ threadId, reason });
    },
  };
}

/** Перезагрузку умеет только bb, которого держит служба launchd на Маке. У клиентов bb запущен приложением,
    кнопка придержала бы сообщения и ничего не перезапустила, поэтому настройка по умолчанию выключена. */
export const RESTART_SETTING = {
  perezagruzka: {
    type: "boolean",
    label: "Перезагрузка bb и Мака из меню",
    description: "Только для bb, который запускает служба launchd на Маке. Включение действует после перезагрузки плагина.",
    default: false,
  },
} as const;

export default async function perezapuskPlugin(bb: BbPluginApi) {
  const restartOn = (await bb.settings.define(RESTART_SETTING).get()).perezagruzka;
  const chats = new InterruptedChats(chatPort(bb), bb.storage.kv, (threadId, error) => bb.log.warn(`Чат ${threadId} не продолжен: ${error}`));
  const uptimeS = process.uptime();
  const serverStartedAt = Date.now() - uptimeS * 1000 - CLOCK_MARGIN_MS;
  const hold = new RestartHold(
    {
      async busyChats() {
        const threads = await bb.sdk.threads.list({ limit: 200, includeHidden: true });
        return threads.filter((thread) => thread.status === "active" || thread.status === "starting" || (thread.activity?.activeBackgroundAgentCount ?? 0) > 0 || (thread.activity?.activeBackgroundCommandCount ?? 0) > 0).length;
      },
      restartService() {
        bb.log.info("Перезапускаю службу bb: чаты закончили или вышел срок ожидания.");
        const uid = process.getuid?.();
        const child = spawn("/bin/launchctl", ["kickstart", "-k", `gui/${uid}/${SERVICE_LABEL}`], { detached: true, stdio: "ignore" });
        child.on("error", (error) => bb.log.warn(`launchctl не запустился: ${error}`));
        child.unref();
      },
      releaseMessages: () => bb.experimental_hooks.recheck("message.dispatch"),
      stateChanged: () => bb.rpc.experimental_invalidate([STATE_TAG]),
      warn: (message) => bb.log.warn(message),
    },
    bb.storage.kv,
  );

  if (restartOn) bb.experimental_hooks.on("message.dispatch", (ctx) => hold.decide({ attempt: ctx.attempt, text: ctx.input.text }));

  bb.events.on("thread.failed", async ({ thread }) => {
    await chats.resume({ id: thread.id, parentThreadId: thread.parentThreadId ?? null }).catch((error) => bb.log.warn(`Чат ${thread.id} не продолжен: ${error}`));
  });

  if (restartOn) bb.rpc.register(restartContract, {
    state: () => hold.state(),
    begin: ({ mode }) => hold.begin(mode),
    cancel: () => hold.cancel(),
  });

  if (restartOn) bb.cli.register({
    name: "perezapusk",
    summary: "Перезагрузка bb и Мака без оборванных чатов",
    commands: [
      { name: "bb", summary: "Дождаться конца работы чатов, не дольше 10 минут, и перезапустить bb", usage: "bb perezapusk bb" },
      { name: "mak", summary: "Дождаться конца работы чатов и сообщить, что Мак можно перезагружать", usage: "bb perezapusk mak" },
      { name: "otmena", summary: "Отменить ожидание", usage: "bb perezapusk otmena" },
      { name: "status", summary: "Показать, что сейчас происходит", usage: "bb perezapusk status" },
    ],
    async run([command]) {
      const print = (state: unknown) => ({ exitCode: 0, stdout: `${JSON.stringify(state)}\n` });
      if (command === "bb") return print(await hold.begin("bb"));
      if (command === "mak") return print(await hold.begin("mac"));
      if (command === "otmena") return print(await hold.cancel());
      if (command === "status") return print(await hold.state());
      return { exitCode: 2, stderr: "Команды: bb, mak, otmena, status\n" };
    },
  });

  const checkChats = async () => {
    await chats.resumeAll().catch((error) => bb.log.warn(`Проверка оборванных чатов не прошла: ${error}`));
    // Перезагрузка самого плагина фоновую работу не убивает, ждущие чаты смотрим только после запуска сервера.
    if (uptimeS < FRESH_SERVER_S) await chats.resumeWaiting(serverStartedAt).catch((error) => bb.log.warn(`Проверка ждущих чатов не прошла: ${error}`));
  };

  bb.background.service("startup-and-hold", {
    async start(signal) {
      // Демону нужно время подключиться и отметить обрывы. Придержанные сообщения отпускаем после просьб продолжить, чтобы они их не обогнали.
      await sleep(FIRST_CHECK_MS, signal);
      if (signal.aborted) return;
      await checkChats();
      if (restartOn) await hold.endPreviousRun(serverStartedAt).catch((error) => bb.log.warn(`Ожидание не снято: ${error}`));

      const secondCheckAt = Date.now() + SECOND_CHECK_MS - FIRST_CHECK_MS;
      let secondCheckDone = false;
      while (!signal.aborted) {
        if (!secondCheckDone && Date.now() >= secondCheckAt) {
          secondCheckDone = true;
          await checkChats();
        }
        if (restartOn) await hold.tick().catch((error) => bb.log.warn(`Проверка перезагрузки не прошла: ${error}`));
        await sleep(TICK_MS, signal);
      }
    },
  });
}
