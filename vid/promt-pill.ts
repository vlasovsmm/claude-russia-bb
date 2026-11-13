// Метка своего промта в черновике: есть ли она и как её убрать, не задев текст и другие упоминания.
import type { ComposerDraft, ComposerMention } from "@get-bb/plugin-sdk/app";
import { PROMT_MENTION } from "./moj-promt";

export class PromtPill {
  isIn(draft: ComposerDraft): boolean {
    return draft.mentions.some((mention) => this.isPromt(mention));
  }

  /** Что дописать в конец черновика. Пробел перед меткой свой всегда: при снятии метки убирается ровно он, и текст возвращается знак в знак. */
  partsAfter(text: string) {
    return text ? [" ", PROMT_MENTION] : [PROMT_MENTION];
  }

  removedFrom(draft: ComposerDraft): ComposerDraft {
    const pill = draft.mentions.find((mention) => this.isPromt(mention));
    if (!pill) return draft;
    const from = draft.text[pill.from - 1] === " " ? pill.from - 1 : pill.from;
    const removed = pill.to - from;
    return {
      text: draft.text.slice(0, from) + draft.text.slice(pill.to),
      mentions: draft.mentions
        .filter((mention) => mention !== pill)
        .map((mention) => (mention.from < pill.from ? mention : { ...mention, from: mention.from - removed, to: mention.to - removed })),
    };
  }

  private isPromt(mention: ComposerMention): boolean {
    return mention.kind === "plugin" && mention.provider === PROMT_MENTION.provider && mention.id === PROMT_MENTION.id;
  }
}
