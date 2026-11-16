// Чат в архив свайпом влево по строке списка чатов, только пальцем: мышью bb переносит чаты.
// Архивирует родное действие bb: оно само убирает строку и вложенные чаты, уводит с открытого чата и показывает «Отменить».
import {
  experimental_useSidebarThreads as useSidebarThreads,
  experimental_useThreadActions as useThreadActions,
  type PluginThreadActionsOptions,
  type PluginThreadActionTarget,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState } from "react";
import { threadActionTarget } from "./archive-section";

const ROW = "[data-sidebar-rename-row]";
const SECTION = "[data-sidebar-sticky-group]";
const THREAD_ID = "data-sidebar-thread-id";
const SWIPE = "data-vid-swipe";
const SHIFT = "--vid-swipe-shift";
const NO_DRAWER_DRAG = "data-vaul-no-drag";
const ARCHIVE_ONLY: PluginThreadActionsOptions = { keys: ["bb--core/archive"] };
const DECIDE_PX = 10;
// Сколько строки протянуть до архива: владелец 15 ноября 2026 попросил тянуть вдвое меньше половины.
const READY_SHARE = 0.25;
// Строку чата к переносу пальцем bb готовит, если палец простоял 500 мс, сдвинувшись не дальше 6 точек: SidebarTouchSensor во встроенном плагине thread-list bb 0.48.1.
const BB_TOUCH_DRAG_DELAY_MS = 500;
const SETTLE_MS = 200;
const POLL_MS = 100;
const GIVE_UP_MS = 5000;

/** Отдаёт чат в архив и отвечает, взялся ли за это bb. */
type Archive = (threadId: string) => Promise<boolean>;

/** Вид строки: ведут пальцем, дотянули до порога, возвращается на место, уезжает в архив. */
type Look = "pull" | "ready" | "back" | "away";

interface Touch {
  row: HTMLElement;
  threadId: string;
  pointerId: number;
  x: number;
  y: number;
  time: number;
  swiping: boolean;
  width: number;
}

export class SwipeArchive {
  private touch: Touch | null = null;
  private swallowClick = false;
  /** Строки, которые возвращаются на место или ждут архива, и таймер каждой. */
  private readonly settling = new Map<HTMLElement, number>();

  constructor(private readonly archive: Archive) {}

  start(): void {
    window.addEventListener("pointerdown", this.onDown, true);
    window.addEventListener("pointermove", this.onMove, true);
    window.addEventListener("pointerup", this.onUp, true);
    window.addEventListener("pointercancel", this.onCancel, true);
    window.addEventListener("click", this.onClick, true);
  }

  stop(): void {
    window.removeEventListener("pointerdown", this.onDown, true);
    window.removeEventListener("pointermove", this.onMove, true);
    window.removeEventListener("pointerup", this.onUp, true);
    window.removeEventListener("pointercancel", this.onCancel, true);
    window.removeEventListener("click", this.onClick, true);
    if (this.touch) this.clear(this.touch.row);
    this.touch = null;
    for (const row of [...this.settling.keys()]) this.clear(row);
    this.swallowClick = false;
  }

  private readonly onDown = (event: Event): void => {
    const pointer = event as PointerEvent;
    // Новое первое касание значит, что прошлое кончилось, даже если его конца браузер не прислал.
    if (pointer.isPrimary && this.touch) this.letGo(this.touch);
    this.swallowClick = false;
    if (pointer.pointerType !== "touch" || !pointer.isPrimary) return;
    const row = this.chatRow(pointer.target);
    const threadId = row ? this.threadIdOf(row) : null;
    if (!row || !threadId) return;
    // Свайп влево по меню на телефоне закрывает меню: эта метка просит выдвижную панель bb не тянуться за пальцем.
    row.setAttribute(NO_DRAWER_DRAG, "");
    this.touch = { row, threadId, pointerId: pointer.pointerId, x: pointer.clientX, y: pointer.clientY, time: pointer.timeStamp, swiping: false, width: 0 };
  };

  private readonly onMove = (event: Event): void => {
    const pointer = event as PointerEvent;
    const touch = this.touch;
    if (!touch || pointer.pointerId !== touch.pointerId) return;
    const dx = pointer.clientX - touch.x;
    const dy = pointer.clientY - touch.y;
    if (!touch.swiping) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < DECIDE_PX) return;
      // Вверх-вниз листают список, вправо жеста нет, а держать и вести — это перенос чата самим bb.
      if (-dx <= Math.abs(dy) || pointer.timeStamp - touch.time >= BB_TOUCH_DRAG_DELAY_MS) {
        this.letGo(touch);
        return;
      }
      touch.swiping = true;
      touch.width = touch.row.getBoundingClientRect().width;
    }
    const shift = Math.max(0, -dx);
    this.paint(touch.row, shift >= touch.width * READY_SHARE ? "ready" : "pull", shift);
  };

  private readonly onUp = (event: Event): void => {
    const pointer = event as PointerEvent;
    const touch = this.touch;
    if (!touch || pointer.pointerId !== touch.pointerId) return;
    if (touch.swiping && touch.x - pointer.clientX >= touch.width * READY_SHARE) this.archiveRow(touch);
    else this.letGo(touch);
  };

  private readonly onCancel = (event: Event): void => {
    const touch = this.touch;
    if (touch && (event as PointerEvent).pointerId === touch.pointerId) this.letGo(touch);
  };

  /** Клик после свайпа открыл бы чат, который человек только что уводил в сторону. */
  private readonly onClick = (event: Event): void => {
    if (!this.swallowClick) return;
    this.swallowClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  /** Касание кончилось без архива: сдвинутая строка возвращается на место, несдвинутая просто отпускается. */
  private letGo(touch: Touch): void {
    this.touch = null;
    touch.row.removeAttribute(NO_DRAWER_DRAG);
    if (!touch.swiping) return;
    this.swallowClick = true;
    this.paint(touch.row, "back", 0);
    this.later(touch.row, SETTLE_MS, () => this.clear(touch.row));
  }

  private archiveRow(touch: Touch): void {
    this.touch = null;
    touch.row.removeAttribute(NO_DRAWER_DRAG);
    this.swallowClick = true;
    this.paint(touch.row, "away", touch.width);
    this.later(touch.row, SETTLE_MS, () => {
      void this.archive(touch.threadId).then((started) => {
        if (!this.settling.has(touch.row)) return;
        if (started) this.waitUntilGone(touch.row, touch.threadId, Date.now());
        else this.clear(touch.row);
      });
    });
  }

  /** bb не сообщает плагину, чем кончилось архивирование: строка ушла из списка — вышло, стоит на месте 5 с — не вышло, и она возвращается. */
  private waitUntilGone(row: HTMLElement, threadId: string, since: number): void {
    // срез: архив дольше 5 с вернёт строку на миг до того, как bb её уберёт, переделать когда bb начнёт отдавать плагину итог архивирования
    const gone = !row.isConnected || this.threadIdOf(row) !== threadId;
    if (gone || Date.now() - since >= GIVE_UP_MS) this.clear(row);
    else this.later(row, POLL_MS, () => this.waitUntilGone(row, threadId, since));
  }

  private paint(row: HTMLElement, look: Look, shift: number): void {
    row.setAttribute(SWIPE, look);
    row.style.setProperty(SHIFT, `${shift}px`);
  }

  private later(row: HTMLElement, ms: number, run: () => void): void {
    window.clearTimeout(this.settling.get(row));
    this.settling.set(row, window.setTimeout(run, ms));
  }

  /** Снимает со строки всё своё: bb может отдать этот же узел другому чату. */
  private clear(row: HTMLElement): void {
    window.clearTimeout(this.settling.get(row));
    this.settling.delete(row);
    row.removeAttribute(SWIPE);
    row.removeAttribute(NO_DRAWER_DRAG);
    row.style.removeProperty(SHIFT);
  }

  /** Заголовок раздела тоже несёт метку строки, но чатом не является. */
  private chatRow(target: EventTarget | null): HTMLElement | null {
    const row = target instanceof Element ? target.closest<HTMLElement>(ROW) : null;
    return row && !row.matches(SECTION) && !this.settling.has(row) ? row : null;
  }

  private threadIdOf(row: Element): string | null {
    return row.querySelector(`a[${THREAD_ID}]`)?.getAttribute(THREAD_ID) ?? null;
  }
}

interface ArchiveJob {
  target: PluginThreadActionTarget;
  done: (started: boolean) => void;
}

/** Один запуск родного архивирования. Хук действий bb нельзя звать по условию, поэтому каждый чат получает свой компонент на время запуска. */
function ArchiveRun({ job, onFinish }: { job: ArchiveJob; onFinish: (job: ArchiveJob) => void }) {
  const archive = useThreadActions(job.target, ARCHIVE_ONLY).at(0);
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void (archive ? archive.action.run() : Promise.resolve()).then(() => {
      job.done(archive !== undefined);
      onFinish(job);
    });
  });
  return null;
}

export function SwipeToArchive() {
  const { threads } = useSidebarThreads();
  const latestThreads = useRef(threads);
  const [jobs, setJobs] = useState<readonly ArchiveJob[]>([]);
  const [swipe] = useState(
    () =>
      new SwipeArchive(
        (threadId) =>
          new Promise((done) => {
            const thread = latestThreads.current.find((item) => item.id === threadId);
            if (thread) setJobs((list) => [...list, { target: threadActionTarget(thread), done }]);
            else done(false);
          }),
      ),
  );
  useEffect(() => {
    latestThreads.current = threads;
  }, [threads]);
  useEffect(() => {
    swipe.start();
    return () => swipe.stop();
  }, [swipe]);
  const finish = (job: ArchiveJob) => setJobs((list) => list.filter((item) => item !== job));
  return jobs.map((job) => <ArchiveRun key={job.target.id} job={job} onFinish={finish} />);
}
