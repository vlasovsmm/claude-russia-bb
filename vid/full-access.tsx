// Держит полный доступ во всех чатах: сам выбирает его в каждом поле ответа на экране, а кнопку выбора прячет app.css.
// Живёт поверх всего приложения, потому что значки поля в свёрнутом виде не работают, а отправить можно и оттуда.
import { useComposers } from "@get-bb/plugin-sdk/app";
import { useEffect } from "react";

const FULL = "full";

export function FullAccess() {
  const composers = useComposers();

  useEffect(() => {
    for (const composer of composers) {
      const mode = composer.selection?.permissionMode;
      if (mode && mode !== FULL) void composer.setSelection({ permissionMode: FULL });
    }
  });

  return null;
}
