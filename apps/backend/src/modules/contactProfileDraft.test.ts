import { describe, expect, it } from "vitest";
import type { ContactChatExtraction } from "@talent-signal/agent";
import { profileUnderstanding } from "./contactProfileDraft.js";

const profile=(platform:string,handle:string):ContactChatExtraction=>({platform,conversation_kind:"not_chat",contact_name:"Chen Xia",
  identity_clues:[{kind:"handle",value:handle,source_excerpt:handle}],messages:[],uncertainties:[]});
describe("profile image account provenance",()=>{
  it("offers a name-only profile draft without professional fields or stable handles",()=>{
    const result=profileUnderstanding([{...profile("LinkedIn",""),contact_name:"Peter Yang",identity_clues:[]}]);
    expect(result?.draft).toMatchObject({display_name:"Peter Yang",fields:[]});
    expect(result?.extraction.messages).toEqual([]);
  });
  it("preserves explicit profile classification and never invents messages",()=>{
    const result=profileUnderstanding([{...profile("LinkedIn","chen-1"),conversation_kind:"profile"}]);
    expect(result?.extraction.conversation_kind).toBe("profile");expect(result?.extraction.messages).toEqual([]);
    expect(result?.draft.fields[0]?.source_image_index).toBe(0);
  });
  it("does not relabel a second platform account with the first image platform",()=>{
    expect(profileUnderstanding([profile("LinkedIn","chen-ln"),profile("Twitter","chen-x")])).toBeNull();
  });
  it("rejects different accounts on the same platform even when display names match",()=>{
    expect(profileUnderstanding([profile("LinkedIn","chen-1"),profile("LinkedIn","chen-2")])).toBeNull();
  });
  it("keeps the displayed platform and every retained clue's original image index",()=>{
    const result=profileUnderstanding([profile("LinkedIn","chen-1"),profile("LinkedIn","chen-1")]);
    expect(result?.draft.platform).toBe("LinkedIn");expect(result?.draft.fields.map(f=>f.source_image_index)).toEqual([0,1]);
    expect(result?.extraction.messages).toEqual([]);
  });
});
