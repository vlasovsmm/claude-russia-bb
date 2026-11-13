// Серверная часть плагина: отдаёт агенту текст своих правил из настройки при отправке сообщения со значком. Остальная работа идёт на странице в app.ts.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { PRAVILA_SETTING, PROMT_MENTION } from "./moj-promt";

export default function vidPlugin(bb: BbPluginApi) {
  const settings = bb.settings.define(PRAVILA_SETTING);
  bb.ui.registerMentionProvider({
    id: PROMT_MENTION.provider,
    label: PROMT_MENTION.label,
    search: () => [],
    resolve: async () => ({ context: (await settings.get()).pravila }),
  });
  bb.log.info("Вид чата загружен");
}
