// Маленький значок у микрофона: кладёт в черновик метку «Правила», а сам текст из настройки плагина bb отдаёт агенту при отправке и в чате не показывает. Настройка пуста — значка нет.
import { useComposer, useSettings } from "@get-bb/plugin-sdk/app";
import { PRAVILA } from "./moj-promt";
import { PromtPill } from "./promt-pill";

const PILL = new PromtPill();
const ICON =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1 1 1.8-2M3.5 12l1 1 1.8-2M3.5 18l1 1 1.8-2"/></svg>';

export function PromtButton() {
  const composer = useComposer();
  const text = useSettings().values?.[PRAVILA];
  const isOn = PILL.isIn(composer.draft);

  const toggle = () => {
    if (isOn) composer.replace((draft) => PILL.removedFrom(draft));
    else composer.insert(PILL.partsAfter(composer.text), { at: "end" });
    composer.focus(); // Курсор в конец: выделение, оставшееся в поле, стёрло бы метку первой же буквой.
  };

  if (typeof text !== "string" || !text.trim()) return null;

  return (
    <button
      type="button"
      data-vid-promt=""
      aria-label="Добавить мой промт"
      aria-pressed={isOn}
      onMouseDown={(event) => event.preventDefault()}
      onClick={toggle}
    >
      <span data-vid-promt-icon="" dangerouslySetInnerHTML={{ __html: ICON }} />
      {isOn ? <span data-vid-promt-word="">Правила</span> : null}
    </button>
  );
}
