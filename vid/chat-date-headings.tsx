// Заголовки дат в списке чатов, по нажатию период сворачивается. Своих групп по датам у bb нет (get-bb/bb#4809), когда появятся, этот файл удаляется.
// Заголовок это своя кнопка между строками bb, а свёрнутую строку прячет стиль по метке: строки bb остаются на своих местах.
import { experimental_useSidebarThreads as useSidebarThreads, type PluginSidebarThread, useBbContext } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";

const ROWS = '[data-sidebar-visibility-group="threads"] [data-sidebar-windowed-item]';
const ROW_MARK = "[data-sidebar-windowed-item]";
const THREAD_ID = "data-sidebar-thread-id";
const OFFSCREEN_THREADS = "data-sidebar-windowed-nav";
const HEADING = "data-vid-date-heading";
const HIDDEN = "data-vid-date-hidden";
const COUNT = "data-vid-date-count";
const COLLAPSED_KEY = "bb-vid:svernutye-periody";
const DAY_MS = 86_400_000;
const REFRESH_MS = 60_000;
const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const PERIODS = [
  { label: "Сегодня", lastDay: 0 },
  { label: "Вчера", lastDay: 1 },
  { label: "7 дней", lastDay: 7 },
  { label: "30 дней", lastDay: 30 },
  { label: "Раньше", lastDay: Number.POSITIVE_INFINITY },
];

type DatedThread = Pick<PluginSidebarThread, "id" | "parentThreadId" | "status" | "latestAttentionAt" | "isUnread" | "hasPendingInteraction">;
type Period = { label: string; rows: HTMLElement[] };

/** Раскладывает чаты по периодам так же, как bb их сортирует: сначала работающие, потом по последнему событию. */
export class DatePeriods {
  constructor(private readonly now: Date) {}

  indexOf(thread: Pick<DatedThread, "status" | "latestAttentionAt">): number {
    if (thread.status === "active") return 0;
    const days = this.daysAgo(thread.latestAttentionAt);
    return PERIODS.findIndex((period) => days <= period.lastDay);
  }

  label(index: number): string {
    return PERIODS[index].label;
  }

  private daysAgo(at: number): number {
    return Math.round((this.startOfDay(this.now) - this.startOfDay(new Date(at))) / DAY_MS);
  }

  private startOfDay(date: Date): number {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }
}

/** Помнит свёрнутые периоды на этом устройстве: на телефоне и на компьютере сворачивают разное. */
export class CollapsedPeriods {
  private readonly labels: Set<string>;

  constructor(private readonly storage: () => Pick<Storage, "getItem" | "setItem"> = () => window.localStorage) {
    this.labels = new Set(this.read());
  }

  has(label: string): boolean {
    return this.labels.has(label);
  }

  toggle(label: string): void {
    if (!this.labels.delete(label)) this.labels.add(label);
    try {
      this.storage().setItem(COLLAPSED_KEY, JSON.stringify([...this.labels]));
    } catch {
      // Хранилище закрыто: период останется свёрнутым до перезагрузки страницы.
    }
  }

  private read(): string[] {
    try {
      const saved: unknown = JSON.parse(this.storage().getItem(COLLAPSED_KEY) ?? "[]");
      return Array.isArray(saved) ? saved.filter((label) => typeof label === "string") : [];
    } catch {
      return [];
    }
  }
}

/** Держит кнопку периода над первой строкой периода и прячет свёрнутые строки, пока bb пересоздаёт строки и меняется день. */
export class DateHeadings {
  private threads = new Map<string, DatedThread>();
  private openThreadId: string | null = null;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private observer: MutationObserver | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame: number | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly now: () => Date = () => new Date(),
    private readonly collapsed: CollapsedPeriods = new CollapsedPeriods(),
  ) {}

  update(threads: readonly DatedThread[], openThreadId: string | null = null): void {
    this.threads = new Map(threads.map((thread) => [thread.id, thread]));
    this.openThreadId = openThreadId;
    this.schedule();
  }

  start(): void {
    this.observer = new MutationObserver(() => this.schedule());
    this.observer.observe(this.root, { subtree: true, childList: true });
    this.timer = setInterval(() => this.refresh(), REFRESH_MS);
    this.refresh();
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    for (const button of this.buttons.values()) button.remove();
    this.buttons.clear();
    for (const row of this.root.querySelectorAll(`[${HIDDEN}]`)) row.removeAttribute(HIDDEN);
  }

  refresh(): void {
    const rows = this.rows();
    const periods = this.periods(rows);
    const attention = this.chatsNeedingAttention();
    const hidden = new Set<HTMLElement>();
    for (const period of periods) {
      const hiding = this.collapsed.has(period.label) ? period.rows.filter((row) => !attention.has(this.threadId(row))) : [];
      for (const row of hiding) hidden.add(row);
      this.drawHeading(period, hiding.length);
    }
    this.removeHeadingsExcept(periods);
    for (const row of rows) {
      if (row.hasAttribute(HIDDEN) !== hidden.has(row)) row.toggleAttribute(HIDDEN, hidden.has(row));
    }
  }

  private schedule(): void {
    if (this.frame !== null || this.observer === null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.refresh();
    });
  }

  /** Только верхние строки: вложенный чат живёт внутри своего родителя и период не разрывает. */
  private rows(): HTMLElement[] {
    return [...this.root.querySelectorAll<HTMLElement>(ROWS)].filter((row) => row.parentElement?.closest(ROW_MARK) === null);
  }

  /** Строки по периодам. Порядок не по датам значит другую сортировку: периодов нет совсем. */
  private periods(rows: readonly HTMLElement[]): Period[] {
    const dates = new DatePeriods(this.now());
    const periods: Period[] = [];
    let current = -1;
    for (const row of rows) {
      const thread = this.threads.get(this.threadId(row));
      if (thread) {
        const index = dates.indexOf(thread);
        if (index < current) return [];
        if (index > current) periods.push({ label: dates.label(index), rows: [] });
        current = index;
      }
      periods.at(-1)?.rows.push(row);
    }
    return periods;
  }

  /** Такой чат свёрнутый период не прячет: он работает, ждёт ответа, не прочитан или открыт. Родитель остаётся ради вложенного. */
  private chatsNeedingAttention(): Set<string> {
    const ids = new Set<string>();
    for (const thread of this.threads.values()) {
      if (thread.status !== "active" && !thread.isUnread && !thread.hasPendingInteraction && thread.id !== this.openThreadId) continue;
      let id: string | null = thread.id;
      while (id !== null && !ids.has(id)) {
        ids.add(id);
        id = this.threads.get(id)?.parentThreadId ?? null;
      }
    }
    return ids;
  }

  /** Пишем только разницу: наблюдатель видит и наши правки, и лишняя запись крутила бы пересчёт без конца. */
  private drawHeading(period: Period, hiddenCount: number): void {
    const button = this.button(period.label);
    if (button.nextElementSibling !== period.rows[0]) period.rows[0].before(button);
    const expanded = String(!this.collapsed.has(period.label));
    if (button.getAttribute("aria-expanded") !== expanded) button.setAttribute("aria-expanded", expanded);
    const count = hiddenCount > 0 ? String(hiddenCount) : "";
    const countNode = button.querySelector(`[${COUNT}]`);
    if (countNode && countNode.textContent !== count) countNode.textContent = count;
  }

  private button(label: string): HTMLButtonElement {
    const existing = this.buttons.get(label);
    if (existing) return existing;
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute(HEADING, label);
    button.innerHTML = `<span>${label}</span>${CHEVRON}<span ${COUNT}></span>`;
    button.addEventListener("click", () => {
      this.collapsed.toggle(label);
      this.refresh();
    });
    this.buttons.set(label, button);
    return button;
  }

  private removeHeadingsExcept(periods: readonly Period[]): void {
    for (const [label, button] of this.buttons) {
      if (periods.some((period) => period.label === label)) continue;
      button.remove();
      this.buttons.delete(label);
    }
  }

  /** У строки за краем экрана ссылки нет: bb держит её чаты в метке, первым идёт сам чат строки. */
  private threadId(row: HTMLElement): string {
    const link = row.querySelector(`a[${THREAD_ID}]`);
    if (link) return link.getAttribute(THREAD_ID) ?? "";
    return row.getAttribute(OFFSCREEN_THREADS)?.split(/[\s:]/)[0] ?? "";
  }
}

export function ChatDateHeadings() {
  const { threads } = useSidebarThreads();
  const openThreadId = useBbContext().threadId ?? null;
  const [headings] = useState(() => new DateHeadings(document.body));
  useEffect(() => {
    headings.start();
    return () => headings.stop();
  }, [headings]);
  useEffect(() => headings.update(threads, openThreadId), [headings, threads, openThreadId]);
  return null;
}
