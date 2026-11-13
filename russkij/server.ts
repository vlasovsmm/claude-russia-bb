// Серверная часть плагина: bb требует этот файл, вся работа идёт на странице в app.ts.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default function russkijPlugin(bb: BbPluginApi) {
  bb.log.info("Русский интерфейс загружен");
}
