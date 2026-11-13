// Перезагрузка без обрывов: новые сообщения ждут, чаты заканчивают работу, потом перезапуск или разрешение перезагрузить Мак.
import type { HoldMode, HoldState } from "./contract";
import { RESUME_TEXT } from "./interrupted-chats";

const DRAIN_MS = 10 * 60_000;
const MAC_READY_MS = 15 * 60_000;
const RESTART_FAILED_MS = 2 * 60_000;
const QUIET_TICKS = 2;
const KEY = "hold";

interface StoredHold {
  mode: HoldMode;
  startedAt: number;
  readyAt: number | null;
  restartAt: number | null;
}

export interface HoldPort {
  busyChats(): Promise<number>;
  restartService(): void;
  /** Просит bb заново решить судьбу придержанных сообщений. */
  releaseMessages(): Promise<void>;
  /** Сообщает открытым окнам, что состояние изменилось. */
  stateChanged(): void;
  warn(message: string): void;
}

export interface Storage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface DispatchFacts {
  attempt: string;
  text: string;
}

export class RestartHold {
  private quietTicks = 0;
  private busy = 0;

  constructor(
    private readonly port: HoldPort,
    private readonly storage: Storage,
    private readonly now: () => number = Date.now,
  ) {}

  private stored(): Promise<StoredHold | undefined> {
    return this.storage.get(KEY) as Promise<StoredHold | undefined>;
  }

  /** Начинает ожидание. Повторная команда срок не отодвигает. */
  async begin(mode: HoldMode): Promise<HoldState> {
    if (await this.stored()) return this.state();
    await this.storage.set(KEY, { mode, startedAt: this.now(), readyAt: null, restartAt: null } satisfies StoredHold);
    this.quietTicks = 0;
    this.busy = await this.port.busyChats();
    this.port.stateChanged();
    return this.state();
  }

  /** Снимает задержку: при отмене, после загрузки bb и по истечении срока. */
  async cancel(): Promise<HoldState> {
    await this.storage.delete(KEY);
    this.quietTicks = 0;
    this.busy = 0;
    await this.port.releaseMessages();
    this.port.stateChanged();
    return this.state();
  }

  /** Снимает ожидание, начатое до этого запуска сервера. Начатое после него остаётся в силе. */
  async endPreviousRun(serverStartedAt: number): Promise<void> {
    const hold = await this.stored();
    if (hold && hold.startedAt < serverStartedAt) await this.cancel();
  }

  /** Служба зовёт раз в несколько секунд. */
  async tick(): Promise<void> {
    const hold = await this.stored();
    if (!hold) return;
    this.busy = await this.port.busyChats();
    this.quietTicks = this.busy === 0 ? this.quietTicks + 1 : 0;
    const drained = this.quietTicks >= QUIET_TICKS || this.now() - hold.startedAt >= DRAIN_MS;

    if (hold.mode === "bb") {
      if (hold.restartAt !== null) {
        if (this.now() - hold.restartAt >= RESTART_FAILED_MS) {
          this.port.warn("Служба bb не перезапустилась за 2 минуты, снимаю ожидание.");
          await this.cancel();
          return;
        }
      } else if (drained) {
        await this.storage.set(KEY, { ...hold, restartAt: this.now() } satisfies StoredHold);
        this.port.restartService();
      }
    } else if (hold.readyAt === null) {
      if (drained) await this.storage.set(KEY, { ...hold, readyAt: this.now() } satisfies StoredHold);
    } else if (this.now() - hold.readyAt >= MAC_READY_MS) {
      await this.cancel();
      return;
    }
    this.port.stateChanged();
  }

  async state(): Promise<HoldState> {
    const hold = await this.stored();
    if (!hold) return { mode: null, busy: 0, secondsLeft: 0, ready: false };
    const left = hold.readyAt === null ? hold.startedAt + DRAIN_MS - this.now() : hold.readyAt + MAC_READY_MS - this.now();
    return { mode: hold.mode, busy: this.busy, secondsLeft: Math.max(0, Math.ceil(left / 1000)), ready: hold.readyAt !== null };
  }

  /** Ответ на вопрос bb, пускать ли новое сообщение. Просьба продолжить идёт первой, раньше придержанных. */
  async decide({ attempt, text }: DispatchFacts): Promise<{ action: "proceed" } | { action: "wait"; reason: string; sendAt: number }> {
    const hold = await this.stored();
    if (!hold || attempt !== "start-turn" || text === RESUME_TEXT) return { action: "proceed" };
    const reason = hold.mode === "bb" ? "bb скоро перезапустится, сообщение уйдёт после этого" : "Мак готовится к перезагрузке, сообщение уйдёт после неё";
    return { action: "wait", reason, sendAt: this.now() + DRAIN_MS + MAC_READY_MS };
  }
}
