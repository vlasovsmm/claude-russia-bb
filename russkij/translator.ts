// Заменяет английские надписи страницы bb на русские по словарю и возвращает их при остановке.
// СРЕЗ: подмена целых строк работает, пока в bb нет своего механизма языков.
// Переделать, когда get-bb/bb#3721 доедет до выпуска.

const FOREIGN_TEXT_ZONES = [
  "[data-message-column]",
  "[data-timeline-row-list]",
  "[data-timeline-items]",
  ":has(> [data-sidebar-thread-id])",
  "[data-thread-title-row]",
  "[data-sidebar-project-id]",
  "[data-file-preview-scroll-container]:not(:has([data-panel-new-tab-page]))",
  "[data-code]",
  "li[data-index]:not([data-sonner-toast])",
  "[contenteditable]",
  "select",
  "pre",
  "code",
  "script",
  "style",
  "noscript",
  ".xterm",
  ".monaco-editor",
].join(",");

const FOREIGN_TEXT_ONLY = `${FOREIGN_TEXT_ZONES},textarea`;

const TRANSLATED_ATTRIBUTES = ["title", "placeholder"];

type Replacement = { original: string; written: string };

export type PhrasePattern = { pattern: string; ru: string };

const RUSSIAN_PLURAL = new Intl.PluralRules("ru");
const PLURAL_FORM_INDEX: Record<string, number> = { one: 0, few: 1, many: 2, other: 2 };

export class Translator {
  private readonly dictionary: Map<string, string>;
  private readonly patterns: { regex: RegExp; ru: string }[];
  private readonly textReplacements = new WeakMap<Text, Replacement>();
  private readonly attributeReplacements = new WeakMap<Element, Map<string, Replacement>>();
  private readonly observer: MutationObserver;

  constructor(
    private readonly root: Element,
    dictionary: Readonly<Record<string, string>>,
    patterns: readonly PhrasePattern[] = [],
  ) {
    this.dictionary = new Map(Object.entries(dictionary));
    this.patterns = patterns.map(({ pattern, ru }) => ({ regex: new RegExp(pattern), ru }));
    this.observer = new MutationObserver((records) => this.handleRecords(records));
  }

  start(): void {
    this.guarded(() => this.translateTree(this.root));
    this.observer.observe(this.root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: TRANSLATED_ATTRIBUTES,
    });
  }

  stop(): void {
    this.observer.disconnect();
    this.guarded(() => this.restoreTree());
  }

  private handleRecords(records: MutationRecord[]): void {
    this.guarded(() => {
      for (const record of records) {
        if (record.type === "characterData") {
          this.translateText(record.target as Text);
        } else if (record.type === "attributes") {
          this.translateAttribute(record.target as Element, record.attributeName as string);
        } else {
          record.addedNodes.forEach((node) => this.translateAdded(node));
        }
      }
    });
  }

  private translateAdded(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      this.translateText(node as Text);
    } else if (node.nodeType === Node.ELEMENT_NODE && !(node as Element).closest(FOREIGN_TEXT_ZONES)) {
      this.translateTree(node as Element);
    }
  }

  private translateTree(start: Element): void {
    this.translateAttributes(start);
    const walker = this.walkOutsideForeignZones(start);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        this.translateTextInSafeZone(node as Text);
      } else {
        this.translateAttributes(node as Element);
      }
    }
  }

  private walkOutsideForeignZones(start: Element): TreeWalker {
    return start.ownerDocument.createTreeWalker(start, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.nodeType === Node.ELEMENT_NODE && (node as Element).matches(FOREIGN_TEXT_ZONES)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
  }

  private translateText(node: Text): void {
    if (node.parentElement === null || node.parentElement.closest(FOREIGN_TEXT_ONLY)) return;
    this.translateTextInSafeZone(node);
  }

  private translateTextInSafeZone(node: Text): void {
    if (node.parentElement?.tagName === "TEXTAREA") return;
    const value = node.nodeValue ?? "";
    if (this.textReplacements.get(node)?.written === value) return;
    const written = this.translated(value);
    if (written === null || written === value) return;
    this.textReplacements.set(node, { original: value, written });
    node.nodeValue = written;
  }

  private translateAttributes(element: Element): void {
    for (const name of TRANSLATED_ATTRIBUTES) this.translateAttributeInSafeZone(element, name);
  }

  private translateAttribute(element: Element, name: string): void {
    if (!element.closest(FOREIGN_TEXT_ZONES)) this.translateAttributeInSafeZone(element, name);
  }

  private translateAttributeInSafeZone(element: Element, name: string): void {
    const value = element.getAttribute(name);
    if (value === null) return;
    const replacements = this.attributeReplacements.get(element) ?? new Map<string, Replacement>();
    if (replacements.get(name)?.written === value) return;
    const written = this.translated(value);
    if (written === null || written === value) return;
    replacements.set(name, { original: value, written });
    this.attributeReplacements.set(element, replacements);
    element.setAttribute(name, written);
  }

  private translated(value: string): string | null {
    const phrase = value.trim();
    const russian = this.dictionary.get(phrase) ?? this.fromPattern(phrase);
    return russian === null ? null : value.replace(phrase, () => russian);
  }

  private fromPattern(phrase: string): string | null {
    for (const { regex, ru } of this.patterns) {
      const match = regex.exec(phrase);
      if (match !== null) return this.filled(ru, match.slice(1));
    }
    return null;
  }

  private filled(template: string, captured: string[]): string {
    const count = captured.find((value) => /^\d+$/.test(value)) ?? "0";
    const form = PLURAL_FORM_INDEX[RUSSIAN_PLURAL.select(Number(count))];
    return template
      .replace(/\{([^{}]*\|[^{}]*)\}/, (_, forms: string) => forms.split("|")[form])
      .replace(/\{(\d)\}/g, (_, index: string) => {
        const value = captured[Number(index) - 1];
        return this.dictionary.get(value) ?? value;
      });
  }

  private restoreTree(): void {
    const walker = this.root.ownerDocument.createTreeWalker(this.root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    this.restoreAttributes(this.root);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        const replacement = this.textReplacements.get(node as Text);
        if (replacement?.written === node.nodeValue) node.nodeValue = replacement.original;
      } else {
        this.restoreAttributes(node as Element);
      }
    }
  }

  private restoreAttributes(element: Element): void {
    this.attributeReplacements.get(element)?.forEach((replacement, name) => {
      if (element.getAttribute(name) === replacement.written) element.setAttribute(name, replacement.original);
    });
  }

  private guarded(work: () => void): void {
    try {
      work();
    } catch (error) {
      console.error("Русский интерфейс: сбой подмены", error);
    }
  }
}
