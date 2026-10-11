import { describe, expect, it } from "vitest";
import { reconcileComposerMentions, type ComposerMention } from "./composer-mentions";
const person = { id: "one", label: "Alex", detail: "联系人", avatarUrl: null, contexts: [] };
const mention = (start = 0, id = "one"): ComposerMention => ({ start, end: start + 5, text: "@Alex", person: { ...person, id } });

describe("explicit composer references", () => {
  it("preserves boundaries when adding prose before and after a selection", () => {
    expect(reconcileComposerMentions("@Alex ", "关于 @Alex ", [mention()])[0]).toMatchObject({ start: 3, end: 8 });
    expect(reconcileComposerMentions("@Alex ", "@Alex 请看看", [mention()])[0]).toMatchObject({ start: 0, end: 5 });
  });
  it("removes edited, partially deleted and cleared references without guessing", () => {
    expect(reconcileComposerMentions("@Alex ", "@Alix ", [mention()])).toEqual([]);
    expect(reconcileComposerMentions("@Alex ", "@Alexx ", [mention()])).toEqual([mention()]);
    expect(reconcileComposerMentions("@Alex ", "@A lex ", [mention()])).toEqual([]);
    expect(reconcileComposerMentions("@Alex ", "", [mention()])).toEqual([]);
    expect(reconcileComposerMentions("", "@Alex ", [])).toEqual([]);
  });
  it("never chooses an identity when one of two identical spellings disappears", () => {
    expect(reconcileComposerMentions("@Alex @Alex ", "@Alex ", [mention(0), mention(6, "two")])).toEqual([]);
  });
  it("preserves distinct identical choices while the text is untouched", () => {
    expect(reconcileComposerMentions("@Alex @Alex ", "@Alex @Alex ", [mention(0), mention(6, "two")]).map(m => m.person.id)).toEqual(["one", "two"]);
  });
});
