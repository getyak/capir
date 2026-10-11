import { describe, expect, it } from "vitest";
import { parseResearchNotebook, researchRecordId } from "./researchNotebookImport.js";
const packet = () => ({ schema: "research-notebook.v1", namespace: "synthetic-test", people: [{ key: "person-a", name: "Synthetic Person", notes: [{ key: "identity", text: "An attributed research proposal.", section: "identity", metadata: {} }] }] });
describe("research notebook ingress", () => {
  it("keeps name duplicates distinct with stable account-scoped IDs", () => {
    const input = packet(); input.people.push({ ...input.people[0]!, key: "person-b" });
    expect(parseResearchNotebook(input).people).toHaveLength(2);
    expect(researchRecordId("account-a", "fixture", "person-a")).toBe(researchRecordId("account-a", "fixture", "person-a"));
    expect(researchRecordId("account-a", "fixture", "person-a")).not.toBe(researchRecordId("account-b", "fixture", "person-a"));
  });
  it("rejects duplicate person/note keys, oversized prose and unsupported sections", () => {
    const duplicate = packet(); duplicate.people.push(duplicate.people[0]!);
    expect(() => parseResearchNotebook(duplicate)).toThrow("INVALID_PERSON");
    const notes = packet(); notes.people[0]!.notes.push(notes.people[0]!.notes[0]!);
    expect(() => parseResearchNotebook(notes)).toThrow("INVALID_NOTE");
    const long = packet(); long.people[0]!.notes[0]!.text = "a".repeat(1001);
    expect(() => parseResearchNotebook(long)).toThrow("INVALID_NOTE");
    const bad = packet(); bad.people[0]!.notes[0]!.section = "confirmed_fact";
    expect(() => parseResearchNotebook(bad)).toThrow("INVALID_NOTE");
    expect(() => parseResearchNotebook({ ...packet(), namespace: "../../private" })).toThrow("INVALID_NOTEBOOK");
    expect(() => parseResearchNotebook({ ...packet(), namespace: undefined })).toThrow("INVALID_NOTEBOOK");
  });
});
