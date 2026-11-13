// Сворачивает то, что bb сам раскрывает в чате на ходу: группу команд, субагента и размышление. Настройки для этого нет.
// Нажимает заголовок группы так же, как человек; открытое человеком не трогает.
const ROW = "[data-timeline-row-id]";
const GROUP_MARK = ":work-summary:";
const CHILD_MARK = ":child:";
const AUTO_OPENED_KINDS = ["delegation:", "op:reasoning:"];
const TOGGLE = "button[aria-expanded]";
const ROW_ID = "data-timeline-row-id";

export class ActivityCollapser {
  private readonly openedByPerson = new Set<string>();
  private observer: MutationObserver | null = null;

  constructor(private readonly root: HTMLElement) {}

  start(): void {
    this.root.addEventListener("click", this.onClick, true);
    this.observer = new MutationObserver(() => this.collapseGroups());
    this.observer.observe(this.root, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-expanded"] });
    this.collapseGroups();
  }

  stop(): void {
    this.root.removeEventListener("click", this.onClick, true);
    this.observer?.disconnect();
    this.observer = null;
  }

  /** Запоминает нажатие человека: заголовок группы до нажатия открыт — закрывает, закрыт — открывает. */
  rememberToggle(target: EventTarget | null): void {
    if (!(target instanceof Element)) return;
    const row = target.closest(ROW);
    const id = row?.getAttribute(ROW_ID);
    const toggle = row?.querySelector(TOGGLE);
    if (!id || !this.isAutoOpened(id) || !toggle || target.closest(TOGGLE) !== toggle) return;
    if (toggle.getAttribute("aria-expanded") === "true") this.openedByPerson.delete(id);
    else this.openedByPerson.add(id);
  }

  private readonly onClick = (event: Event): void => {
    if (event.isTrusted) this.rememberToggle(event.target);
  };

  private collapseGroups(): void {
    for (const row of this.root.querySelectorAll(ROW)) {
      const id = row.getAttribute(ROW_ID);
      if (!id || !this.isAutoOpened(id) || this.openedByPerson.has(id)) continue;
      const toggle = row.querySelector<HTMLElement>(TOGGLE);
      if (toggle?.getAttribute("aria-expanded") === "true") toggle.click();
    }
  }

  /** Номер строки: чат:вид:… , а внутри субагента чат:delegation:1:child:чат:вид:… — смотрим вид самой строки. */
  private isAutoOpened(id: string): boolean {
    if (id.includes(GROUP_MARK)) return true;
    const start = id.lastIndexOf(CHILD_MARK);
    const tail = start < 0 ? id : id.slice(start + CHILD_MARK.length);
    const own = tail.slice(tail.indexOf(":") + 1);
    return AUTO_OPENED_KINDS.some((kind) => own.startsWith(kind));
  }
}
