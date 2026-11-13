// Закрепление перетаскиванием мышью: брошенный в область закреплённых чат закрепляется. Пока закреплённых нет, блока у bb нет, и на время переноса появляется зона.
// Блоку bb бросок не доверяем: при одном закреплённом он только рисует линию, а при задержке над строкой вкладывает чат вместо закрепления.
import { experimental_useSidebarThreads as useSidebarThreads, useSdk } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";

const THREADS_GROUP = '[data-sidebar-visibility-group="threads"]';
const ROW = "[data-sidebar-rename-row]";
const SECTION = "[data-sidebar-sticky-group][data-sidebar-rename-row]";
const THREAD_ID = "data-sidebar-thread-id";
const OVER = "data-vid-pin-over";
const LABEL = "Закрепить здесь";
const GAP_BELOW_BLOCK_PX = 16;

export class PinDropZone {
  readonly node = document.createElement("div");
  private observer: MutationObserver | null = null;
  private pinnedIds: readonly string[] = [];
  private fromTouch = false;
  private pressed: string | null = null;
  private dragged: string[] = [];
  private over: Element | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly pin: (threadIds: string[]) => void,
  ) {
    this.node.setAttribute("data-vid-pin-zone", "");
    this.node.textContent = LABEL;
  }

  start(): void {
    this.observer = new MutationObserver(() => this.sync());
    this.observer.observe(this.root, { attributes: true, attributeFilter: ["data-sidebar-dragging"] });
    window.addEventListener("pointerdown", this.onDown, true);
    window.addEventListener("pointermove", this.onMove, true);
    window.addEventListener("pointerup", this.onUp, true);
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    window.removeEventListener("pointerdown", this.onDown, true);
    window.removeEventListener("pointermove", this.onMove, true);
    window.removeEventListener("pointerup", this.onUp, true);
    this.reset();
  }

  setPinned(pinnedIds: readonly string[]): void {
    this.pinnedIds = pinnedIds;
    this.sync();
  }

  /** Чат запоминаем при нажатии: автопрокрутка bb при переносе уносит строку за край экрана, и из страницы она пропадает. */
  private readonly onDown = (event: Event): void => {
    this.fromTouch = (event as PointerEvent).pointerType === "touch";
    this.pressed = event.target instanceof Element ? this.pressedThreadId(event.target) : null;
  };

  private readonly onMove = (event: Event): void => {
    const { clientX, clientY } = event as PointerEvent;
    const target = this.dropTarget();
    this.setOver(target && this.contains(target, clientX, clientY) ? target : null);
  };

  private readonly onUp = (event: Event): void => {
    const { clientX, clientY } = event as PointerEvent;
    const target = this.dropTarget();
    if (!target || !this.contains(target, clientX, clientY)) return;
    const threadIds = this.unpinnedDragged();
    this.cancelBbDrag();
    this.reset();
    this.pin(threadIds);
  };

  private sync(): void {
    if (this.root.dataset.sidebarDragging !== "true") {
      this.reset();
      return;
    }
    if (this.dragged.length === 0) this.dragged = this.draggedThreadIds();
    if (this.pinnedIds.length === 0 && this.unpinnedDragged().length > 0 && !this.fromTouch) this.show();
    else this.hideZone();
  }

  /** Куда бросок закрепит чат: своя зона или блок закреплённых. Мимо касаний и переноса уже закреплённых чатов. */
  private dropTarget(): Element | null {
    if (this.root.dataset.sidebarDragging !== "true" || this.fromTouch || this.unpinnedDragged().length === 0) return null;
    if (this.node.isConnected) return this.node;
    for (const id of this.pinnedIds) {
      const block = this.root.querySelector(`a[${THREAD_ID}="${id}"]`)?.closest(SECTION);
      if (block) return block;
    }
    return null;
  }

  private show(): void {
    if (this.node.isConnected) return;
    this.root.querySelector(THREADS_GROUP)?.parentElement?.prepend(this.node);
  }

  private hideZone(): void {
    if (this.over === this.node) this.setOver(null);
    this.node.remove();
  }

  private reset(): void {
    this.dragged = [];
    this.setOver(null);
    this.node.remove();
  }

  private setOver(target: Element | null): void {
    if (this.over === target) return;
    this.over?.removeAttribute(OVER);
    target?.setAttribute(OVER, "");
    this.over = target;
  }

  /** Просвет под блоком считается блоком: мимо него при броске не промахнуться. */
  private contains(target: Element, x: number, y: number): boolean {
    const box = target.getBoundingClientRect();
    const bottom = target === this.node ? box.bottom : box.bottom + GAP_BELOW_BLOCK_PX;
    return x >= box.left && x <= box.right && y >= box.top && y <= bottom;
  }

  private unpinnedDragged(): string[] {
    return this.dragged.filter((id) => !this.pinnedIds.includes(id));
  }

  /** Тащат выделенный чат, значит едут все выделенные, как и при переносе самого bb. */
  private draggedThreadIds(): string[] {
    if (!this.pressed) return [];
    const selected = [...this.root.querySelectorAll(`${ROW}[data-sidebar-thread-selected]`)].map((row) => this.threadIdOf(row)).filter((id) => id !== null);
    return selected.includes(this.pressed) ? selected : [this.pressed];
  }

  /** Заголовок раздела тоже несёт метку строки, но чатом не является: раздел зону не показывает. */
  private pressedThreadId(target: Element): string | null {
    const row = target.closest(ROW);
    return row && !row.matches(SECTION) ? this.threadIdOf(row) : null;
  }

  private threadIdOf(row: Element): string | null {
    return row.querySelector(`a[${THREAD_ID}]`)?.getAttribute(THREAD_ID) ?? null;
  }

  /** Перенос bb отменяется клавишей Esc: иначе после отпускания он сам решил бы, куда положить чат под курсором. */
  private cancelBbDrag(): void {
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape" }));
  }
}

export function PinZone() {
  const { threads } = useSidebarThreads();
  const sdk = useSdk();
  const [zone] = useState(
    () =>
      new PinDropZone(document.body, (threadIds) => {
        for (const threadId of threadIds) sdk.threads.pin({ threadId }).catch((error: unknown) => console.error("Чат не закрепился", threadId, error));
      }),
  );
  const pinnedKey = threads
    .filter((thread) => thread.isPinned && !thread.isArchived && !thread.isHidden)
    .map((thread) => thread.id)
    .join(" ");
  useEffect(() => {
    zone.start();
    return () => zone.stop();
  }, [zone]);
  useEffect(() => zone.setPinned(pinnedKey ? pinnedKey.split(" ") : []), [zone, pinnedKey]);
  return null;
}
