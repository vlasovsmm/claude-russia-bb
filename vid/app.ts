// Подключает стили вида чата, сворачивание команд, раздел архива, заголовки дат, зону закрепления, прикрепление файлов, постоянный заголовок вкладки, значок своего промта и полный доступ и убирает их при выключении плагина.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ActivityCollapser } from "./activity-collapser";
import { ArchiveSection } from "./archive-section";
import { ChatDateHeadings } from "./chat-date-headings";
import { FileAttach } from "./file-attach";
import { FullAccess } from "./full-access";
import { PinZone } from "./pin-drop-zone";
import { PromtButton } from "./promt-button";
import { TabTitle } from "./tab-title";
import "./app.css";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "arhiv-chatov", component: ArchiveSection });
  app.slots.experimental_appOverlay({ id: "polnyj-dostup", component: FullAccess });
  app.slots.experimental_appOverlay({ id: "daty-chatov", component: ChatDateHeadings });
  app.slots.experimental_appOverlay({ id: "zona-zakrepleniya", component: PinZone });
  app.composer.customize({
    id: "moj-promt",
    actions: [{ id: "znachok-promta", component: PromtButton }],
  });
  app.contentScripts.register({
    id: "svorachivanie-komand",
    mount() {
      const collapser = new ActivityCollapser(document.body);
      collapser.start();
      return () => collapser.stop();
    },
  });
  app.contentScripts.register({
    id: "prikreplenie-faylov",
    mount() {
      const attach = new FileAttach(document);
      attach.start();
      return () => attach.stop();
    },
  });
  app.contentScripts.register({
    id: "zagolovok-vkladki",
    mount() {
      const tabTitle = new TabTitle(document);
      tabTitle.start();
      return () => tabTitle.stop();
    },
  });
});
