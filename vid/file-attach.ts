// Прикрепляет файл одним нажатием и перетаскиванием: у bb плюса нет в свёрнутом поле, он открывает лишнее меню, а файл мимо поля браузер открывает вместо чата.
// Файл идёт через скрытый выбор файла самого bb, поэтому загрузка и вид вложений остаются его.
const COMPOSER = "form[data-promptbox]";
const COMPACT = "data-promptbox-compact";
const MAIN = "[data-promptbox-main]";
const FILE_INPUT = 'input[type="file"]';
const OWN_PLUS = "data-vid-attach";
const PLUS_BUTTON = `button[aria-label="Prompt actions"], [${OWN_PLUS}]`;
const MENU_KEYS = new Set(["Enter", " ", "ArrowDown"]);
const DROP_TARGET = "data-vid-drop-target";
const DROP_HINT = "data-vid-drop-hint";
const HINT_LIFETIME_MS = 500;
const PLUS_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

export class FileAttach {
  private observer: MutationObserver | null = null;
  private hintTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly page: Document) {}

  start(): void {
    for (const type of ["pointerdown", "mousedown"]) this.page.addEventListener(type, this.onPress, true);
    this.page.addEventListener("click", this.onClick, true);
    this.page.addEventListener("keydown", this.onKeydown, true);
    this.page.addEventListener("dragover", this.onDragOver, true);
    this.page.addEventListener("drop", this.onDrop, true);
    this.observer = new MutationObserver(() => this.syncPlusButtons());
    this.observer.observe(this.page.body, { subtree: true, childList: true, attributes: true, attributeFilter: [COMPACT] });
    this.syncPlusButtons();
  }

  stop(): void {
    for (const type of ["pointerdown", "mousedown"]) this.page.removeEventListener(type, this.onPress, true);
    this.page.removeEventListener("click", this.onClick, true);
    this.page.removeEventListener("keydown", this.onKeydown, true);
    this.page.removeEventListener("dragover", this.onDragOver, true);
    this.page.removeEventListener("drop", this.onDrop, true);
    this.observer?.disconnect();
    this.observer = null;
    this.hideHint();
    for (const plus of this.page.querySelectorAll(`[${OWN_PLUS}]`)) plus.remove();
  }

  /** Свой плюс живёт только в свёрнутом поле: у развёрнутого есть плюс самого bb. */
  private syncPlusButtons(): void {
    for (const form of this.page.querySelectorAll(COMPOSER)) {
      const main = form.querySelector(MAIN);
      const plus = main?.querySelector(`[${OWN_PLUS}]`);
      if (!form.hasAttribute(COMPACT)) plus?.remove();
      else if (main && !plus) main.prepend(this.createPlus());
    }
  }

  private createPlus(): HTMLButtonElement {
    const plus = this.page.createElement("button");
    plus.type = "button";
    plus.setAttribute(OWN_PLUS, "");
    plus.setAttribute("aria-label", "Прикрепить файл");
    plus.innerHTML = PLUS_ICON;
    return plus;
  }

  private plusButtonOf(event: Event): Element | null {
    return event.target instanceof Element ? event.target.closest(PLUS_BUTTON) : null;
  }

  private readonly onPress = (event: Event): void => {
    if (!this.plusButtonOf(event)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  private readonly onClick = (event: Event): void => {
    const plus = this.plusButtonOf(event);
    if (!plus) return;
    event.preventDefault();
    event.stopPropagation();
    plus.closest(COMPOSER)?.querySelector<HTMLInputElement>(FILE_INPUT)?.click();
  };

  private readonly onKeydown = (event: Event): void => {
    if (MENU_KEYS.has((event as KeyboardEvent).key) && this.plusButtonOf(event)) event.stopPropagation();
  };

  private readonly onDragOver = (event: Event): void => {
    const drag = event as DragEvent;
    const form = this.fileDropTarget(drag);
    if (!form) return;
    drag.preventDefault();
    drag.dataTransfer!.dropEffect = "copy";
    this.showHint(form);
  };

  private readonly onDrop = (event: Event): void => {
    const drag = event as DragEvent;
    const form = this.fileDropTarget(drag);
    if (!form) return;
    drag.preventDefault();
    drag.stopPropagation();
    this.hideHint();
    const input = form.querySelector<HTMLInputElement>(FILE_INPUT);
    if (!input || !drag.dataTransfer!.files.length) return;
    input.files = drag.dataTransfer!.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  /** Поле, куда пойдёт файл: под указателем в раскладке из нескольких чатов, иначе последнее видимое. */
  private fileDropTarget(event: DragEvent): HTMLElement | null {
    if (!event.dataTransfer?.types.includes("Files")) return null;
    const forms = [...this.page.querySelectorAll<HTMLElement>(COMPOSER)];
    const visible = forms.filter((form) => form.getBoundingClientRect().width > 0);
    const under = visible.find((form) => {
      const box = form.getBoundingClientRect();
      return event.clientX >= box.left && event.clientX <= box.right;
    });
    return under ?? visible.at(-1) ?? forms.at(-1) ?? null;
  }

  private showHint(form: HTMLElement): void {
    if (!this.page.querySelector(`[${DROP_HINT}]`)) {
      const hint = this.page.createElement("div");
      hint.setAttribute(DROP_HINT, "");
      hint.textContent = "Отпусти файл, он прикрепится к сообщению";
      this.page.body.append(hint);
    }
    for (const other of this.page.querySelectorAll(`[${DROP_TARGET}]`)) if (other !== form) other.removeAttribute(DROP_TARGET);
    form.setAttribute(DROP_TARGET, "");
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.hideHint(), HINT_LIFETIME_MS);
  }

  private hideHint(): void {
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = null;
    this.page.querySelector(`[${DROP_HINT}]`)?.remove();
    for (const form of this.page.querySelectorAll(`[${DROP_TARGET}]`)) form.removeAttribute(DROP_TARGET);
  }
}
