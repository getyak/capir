import {describe,it,expect} from "vitest";
import {publicSubjectRegistry,isBoundedPublicName} from "./publicSubjectRegistry.js";
describe("public topic admission",()=>{
 it("registers requested full public names without forwarding the user's note",()=>{
  const registry=publicSubjectRegistry("查一下 Lilian Weng 和 Shunyu Yao 的背景，我准备离职还没告诉老板。");
  expect(registry.subjects().map(s=>s.name)).toEqual(["Lilian Weng","Shunyu Yao"]);
  expect(isBoundedPublicName("Simon Willison 我准备离职还没告诉老板")).toBe(false);
  expect(publicSubjectRegistry("帮我了解 Andrew").subjects()).toEqual([]);
 });
 it("does not admit negated research or unrelated private contacts",()=>{
  expect(publicSubjectRegistry("帮我总结与 Alice Smith 的私聊，不要搜索或查询她的背景。").subjects()).toEqual([]);
  expect(publicSubjectRegistry("查一下明天见面的背景").subjects()).toEqual([]);
  expect(publicSubjectRegistry("查一下 Simon Willison 的背景。另一个联系人是 Alice Smith。").subjects().map(s=>s.name)).toEqual(["Simon Willison"]);
  expect(publicSubjectRegistry("查一下聊天提到的 Fei-Fei Li 和 Andrew Ng，给出处。").subjects().map(s=>s.name)).toEqual(["Fei-Fei Li","Andrew Ng"]);
 });
 it("registers only exact third-party reading topics from a current image",()=>{
  const registry=publicSubjectRegistry("帮我看看聊天");
  const input={name:"Simon Willison",excerpt:"正在读 Simon Willison 的文章",visibleText:["正在读 Simon Willison 的文章"],artifactID:"image",isCurrent:async()=>true};
  expect(registry.registerImage({...input,counterparty:"Simon Willison"})).toBeNull();
  expect(registry.registerImage({...input,excerpt:"invented quote"})).toBeNull();
  expect(registry.registerImage(input)?.name).toBe("Simon Willison");
  expect(registry.subjects()[0]?.isCurrent).toBe(input.isCurrent);
 });
 it("bounds hostile clauses while preserving explicit whitespace-separated names",()=>{
  for(const objective of ["查查"+"\t".repeat(100_000),"查查a的背景"+"a的作品".repeat(100_000)]){
   expect(publicSubjectRegistry(objective).subjects()).toEqual([]);
  }
  expect(publicSubjectRegistry("请\t研究\tSimon Willison\tand\tCraig Mod 的文章").subjects().map(s=>s.name)).toEqual(["Simon Willison","Craig Mod"]);
 });
});

describe("first-contact context boundary",()=>{
 it("admits exact header and nanoGPT while refusing private/context instructions",()=>{
  const registry=publicSubjectRegistry("");
  const result=registry.registerCounterparty({name:"Andrej Karpathy",excerpt:"Andrej Karpathy",visibleText:["Andrej Karpathy","Reproduce nanoGPT on a small dataset.","HIV positive","家住北京朝阳区","Divorce pending","NeedsTherapy"],artifactID:"image",isCurrent:async()=>true,anchors:[{kind:"work",text:"nanoGPT"},{kind:"work",text:"HIV positive"},{kind:"role",text:"家住北京朝阳区"},{kind:"work",text:"Divorce pending"},{kind:"work",text:"NeedsTherapy"}]});
  expect(result?.anchors).toEqual([{kind:"work",text:"nanoGPT"}]);
  expect(registry.registerCounterparty({name:"Andrej Karpathy",excerpt:"Andrej Karpathy",visibleText:["Mentioned Andrej Karpathy yesterday"],artifactID:"other",isCurrent:async()=>true})).toBeNull();
 });
 it.each(["http://192.168.1.4/profile","https://example.test/profile/test%40gmail.com","https://example.test/profile#token=SecretExample","https://github.com/karpathy?token=abc","https://github.com:8443/karpathy","https://github.com/karpathy%40gmail.com"])("refuses private/noncanonical handles: %s",url=>{
  const registry=publicSubjectRegistry("");
  expect(registry.registerTentative({name:"Andrej Karpathy",binding:"message",groundingTexts:[url],anchors:[{kind:"handle",text:url}]})?.anchors).toBeUndefined();
 });
 it("keeps only a canonical public profile handle",()=>{
  const url="https://github.com/karpathy";
  expect(publicSubjectRegistry("").registerTentative({name:"Andrej Karpathy",binding:"message",groundingTexts:[url],anchors:[{kind:"handle",text:url}]})?.anchors).toEqual([{kind:"handle",text:url}]);
 });
});
