// Запускает на странице bb подмену надписей и убирает её при выключении плагина.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import "./app.css";
import patterns from "./ru-patterns.json";
import dictionary from "./ru.json";
import { Translator } from "./translator";

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "russkij-interfejs",
    mount() {
      const translator = new Translator(document.body, dictionary, patterns);
      translator.start();
      return () => translator.stop();
    },
  });
});
