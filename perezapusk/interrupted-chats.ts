// Находит чаты, оборванные перезапуском bb, и один раз просит их продолжить работу.
export const RESUME_TEXT =
  "bb перезапускался, и этот чат оборвался посреди работы. Сначала проверь, что из начатого успело выполниться: оплата, выкатка, отправка сообщения, команда. Уже сделанное не повторяй, дальше продолжай свою работу.";

const RESTART_REASON = "host-daemon-restarted";
const MAX_AGE_MS = 30 * 60_000;
const REPEAT_PAUSE_MS = 10 * 60_000;

/** Какие события bb решают, чем кончилась жизнь чата. Завершение фоновых задач bb пишет уже после обрыва, поэтому их здесь нет. */
export const LIFECYCLE_TYPES = ["system/thread/interrupted", "client/turn/requested", "turn/started"] as const;

/** То же плюс завершение фоновой задачи: так видно, что свободный чат потерял работу, которую ждал. */
export const WAITING_TYPES = [...LIFECYCLE_TYPES, "item/backgroundTask/completed"] as const;

export interface ThreadFacts {
  id: string;
  parentThreadId: string | null;
  status: string;
}

export interface LifecycleEvent {
  type: string;
  sequence: number;
  createdAt: number;
  reason: string | null;
  /** У завершения фоновой задачи: задачу остановили, сама она не доработала. */
  taskStopped: boolean;
}

/** Всё, что классу нужно от bb. */
export interface ChatPort {
  threads(): Promise<ThreadFacts[]>;
  lastEvent(threadId: string, types: typeof LIFECYCLE_TYPES | typeof WAITING_TYPES): Promise<LifecycleEvent | null>;
  inputAccepted(threadId: string): Promise<boolean>;
  sendText(threadId: string, text: string): Promise<void>;
  retryTurn(threadId: string, reason: string): Promise<void>;
}

export interface Memory {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

interface ResumeMark {
  sequence: number;
  at: number;
}

export class InterruptedChats {
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly port: ChatPort,
    private readonly memory: Memory,
    private readonly onFailure: (threadId: string, error: unknown) => void,
    private readonly now: () => number = Date.now,
  ) {}

  /** Проходит по всем упавшим чатам. Сбой одного чата не мешает остальным. Возвращает, сколько чатов продолжено. */
  async resumeAll(): Promise<number> {
    let resumed = 0;
    for (const thread of await this.port.threads()) {
      if (thread.status !== "error") continue;
      try {
        if (await this.resume(thread)) resumed += 1;
      } catch (error) {
        this.onFailure(thread.id, error);
      }
    }
    return resumed;
  }

  /** Продолжает один чат, если последнее, что с ним случилось, это обрыв из-за перезапуска. */
  async resume(thread: Pick<ThreadFacts, "id" | "parentThreadId">): Promise<boolean> {
    if (thread.parentThreadId !== null) return false; // дочерним чатом распоряжается родитель
    if (this.inFlight.has(thread.id)) return false;
    this.inFlight.add(thread.id);
    try {
      const last = await this.port.lastEvent(thread.id, LIFECYCLE_TYPES);
      if (!last || last.type !== "system/thread/interrupted" || last.reason !== RESTART_REASON) return false;
      if (this.now() - last.createdAt > MAX_AGE_MS) return false;
      if (!(await this.claim(thread.id, last.sequence))) return false;
      await this.deliver(thread.id, () => this.continueTurn(thread.id));
      return true;
    } finally {
      this.inFlight.delete(thread.id);
    }
  }

  /**
   * Будит свободные чаты, у которых прошлый запуск bb убил фоновую работу. Обрыв bb им не пишет, остаётся запись об остановленной задаче.
   * Смотрим только записи новее старта сервера: задачу, остановленную раньше, остановили руками.
   */
  async resumeWaiting(serverStartedAt: number): Promise<number> {
    let resumed = 0;
    for (const thread of await this.port.threads()) {
      if (thread.status !== "idle" || thread.parentThreadId !== null) continue;
      try {
        const last = await this.port.lastEvent(thread.id, WAITING_TYPES);
        if (!last || last.type !== "item/backgroundTask/completed" || !last.taskStopped || last.createdAt < serverStartedAt) continue;
        // Кнопка «Стоп» пишет обрыв, а завершение задачи bb дописывает после него: такой чат остановлен намеренно.
        const lifecycle = await this.port.lastEvent(thread.id, LIFECYCLE_TYPES);
        if (lifecycle?.type === "system/thread/interrupted") continue;
        if (!(await this.claim(thread.id, last.sequence))) continue;
        await this.deliver(thread.id, () => this.port.sendText(thread.id, RESUME_TEXT));
        resumed += 1;
      } catch (error) {
        this.onFailure(thread.id, error);
      }
    }
    return resumed;
  }

  private async continueTurn(threadId: string): Promise<void> {
    if (await this.port.inputAccepted(threadId)) await this.port.sendText(threadId, RESUME_TEXT);
    else await this.port.retryTurn(threadId, "bb перезапускался, сообщение отправлено ещё раз");
  }

  /** Отметка стоит до отправки: лучше не продолжить чат, чем отправить ему просьбу дважды. */
  private async claim(threadId: string, sequence: number): Promise<boolean> {
    const key = `resumed:${threadId}`;
    const mark = (await this.memory.get(key)) as ResumeMark | undefined;
    if (mark && (mark.sequence === sequence || this.now() - mark.at < REPEAT_PAUSE_MS)) return false;
    await this.memory.set(key, { sequence, at: this.now() } satisfies ResumeMark);
    return true;
  }

  /** Просьба не ушла: снимаем отметку, чтобы следующая проверка попробовала ещё раз. */
  private async deliver(threadId: string, send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch (error) {
      await this.memory.delete(`resumed:${threadId}`);
      throw error;
    }
  }
}
