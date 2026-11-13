// Свой промт владельца: метка «Правила» в черновике и настройка, где лежит текст. Текст в коде не живёт.
// Метка — упоминание из черновика: только так у неё своя иконка; места from и to bb при вставке считает сам.
export const PROMT_MENTION = { kind: "plugin", pluginId: "vid", provider: "moj-promt", id: "cena-kachestvo", label: "Правила", icon: "ListTodo", from: 0, to: 0 } as const;

/** Настройка с текстом. Пустая по умолчанию: тогда значка «Правила» у поля нет. */
export const PRAVILA = "pravila";
export const PRAVILA_SETTING = {
  [PRAVILA]: {
    type: "string",
    label: "Свои правила",
    description: "Текст, который значок «Правила» у поля ответа отдаёт агенту. Пусто — значка нет.",
    experimental_multiline: true,
    default: "",
  },
} as const;
