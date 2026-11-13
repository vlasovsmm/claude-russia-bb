// Держит в заголовке вкладки браузера постоянное «bb»: сам bb при каждом переключении пишет туда название открытого чата.
const TITLE = "bb";

export class TabTitle {
  private observer: MutationObserver | null = null;

  constructor(private readonly page: Document) {}

  start(): void {
    this.restore();
    const element = this.page.querySelector("title");
    if (!element) return;
    this.observer = new MutationObserver(() => this.restore());
    this.observer.observe(element, { subtree: true, childList: true, characterData: true });
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private restore(): void {
    if (this.page.title !== TITLE) this.page.title = TITLE;
  }
}
