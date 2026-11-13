// Раздел «Архивные чаты» под списком чатов: у bb архив открывается только через фильтр списка.
import {
  experimental_Icon as Icon,
  experimental_ThreadActionsMenu as ThreadActionsMenu,
  experimental_useSidebarThreads as useSidebarThreads,
  type PluginSidebarThread,
  ThreadTitle,
  useBbContext,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const LIST_AREA = '[data-sidebar="content"]:has([data-bb-plugin="thread-list"])';
const ARCHIVED = ["archived"] as const;

/** Держит раздел сразу под списком чатов: bb пересоздаёт меню на телефоне и при смене ширины окна. */
export class ArchiveAnchor {
  readonly node = document.createElement("div");
  private observer: MutationObserver | null = null;

  constructor(private readonly root: HTMLElement) {
    this.node.className = "shrink-0";
    // Стили плагина действуют только внутри узла с такими метками, а этот узел лежит вне места, куда bb ставит плагин.
    this.node.setAttribute("data-bb-plugin-root", "");
    this.node.setAttribute("data-bb-plugin", "vid");
  }

  start(): void {
    this.observer = new MutationObserver(() => this.place());
    this.observer.observe(this.root, { subtree: true, childList: true });
    this.place();
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.node.remove();
  }

  private place(): void {
    const list = this.root.querySelector(LIST_AREA);
    if (!list) this.node.remove();
    else if (this.node.previousElementSibling !== list) list.after(this.node);
  }
}

/** На телефоне меню выдвижное, и bb закрывает его только при нажатии в своём списке, поэтому закрываем его кнопкой меню. */
function closePhoneMenu(link: Element): void {
  if (link.closest('[role="dialog"]')) document.querySelector<HTMLElement>('[data-sidebar="trigger"]')?.click();
}

function ArchivedRow({ thread }: { thread: PluginSidebarThread }) {
  const navigate = useBbNavigate();
  const isCurrent = useBbContext().threadId === thread.id;
  const environment = thread.environment?.id ? { id: thread.environment.id, path: thread.environment.path } : null;
  return (
    <li className={`flex items-center rounded-md ${isCurrent ? "bg-state-active" : "hover:bg-state-hover"}`}>
      <a
        href={thread.href}
        aria-current={isCurrent ? "page" : undefined}
        data-thread-title-row=""
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey) return;
          event.preventDefault();
          navigate.toThread(thread.id);
          closePhoneMenu(event.currentTarget);
        }}
        className="min-w-0 flex-1 truncate rounded-md py-1.5 pl-2 text-sm text-foreground max-md:pointer-coarse:py-2.5"
      >
        <ThreadTitle threadId={thread.id} />
      </a>
      <ThreadActionsMenu
        thread={{ ...thread, environment }}
        align="end"
        trigger={(props) => (
          <button {...props} type="button" aria-label="Действия с чатом" className={`${props.className ?? ""} flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground max-md:pointer-coarse:size-11`}>
            <Icon name="MoreHorizontal" className="size-4" aria-hidden="true" />
          </button>
        )}
      />
    </li>
  );
}

function ArchivedThreads() {
  const { threads, experimental_archived: archive } = useSidebarThreads({ experimental_lifecycles: ARCHIVED });
  const rows = threads
    .filter((thread) => thread.isArchived && !thread.isHidden)
    .sort((left, right) => (right.archivedAt ?? 0) - (left.archivedAt ?? 0));
  const note = "px-3 py-2 text-sm text-muted-foreground";
  if (archive?.status === "error") return <p className={note}>Не удалось загрузить архив.</p>;
  if (archive?.status === "loading") return <p className={note}>Загружаем архив…</p>;
  if (rows.length === 0) return <p className={note}>В архиве пока пусто.</p>;
  return (
    <div className="max-h-[40vh] overflow-y-auto px-1 pb-1">
      <ul>{rows.map((thread) => <ArchivedRow key={thread.id} thread={thread} />)}</ul>
      {archive?.hasNextPage ? (
        <button type="button" disabled={archive.isFetchingNextPage} onClick={() => void archive.fetchNextPage()} className="w-full rounded-md py-1.5 text-sm text-muted-foreground hover:bg-state-hover">
          {archive.isFetchingNextPage ? "Загружаем…" : "Показать ещё"}
        </button>
      ) : null}
    </div>
  );
}

export function ArchiveSection() {
  const [anchor] = useState(() => new ArchiveAnchor(document.body));
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    anchor.start();
    return () => anchor.stop();
  }, [anchor]);
  return createPortal(
    <section className="border-t border-border">
      <button type="button" aria-expanded={isOpen} onClick={() => setIsOpen(!isOpen)} className="flex min-h-9 w-full items-center gap-2 px-3 text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground max-md:pointer-coarse:min-h-11">
        <Icon name={isOpen ? "ChevronDown" : "ChevronRight"} className="size-4" aria-hidden="true" />
        Архивные чаты
      </button>
      {isOpen ? <ArchivedThreads /> : null}
    </section>,
    anchor.node,
  );
}
