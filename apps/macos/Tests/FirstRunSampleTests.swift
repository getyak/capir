import XCTest
@testable import TalentSignalMac

final class FirstRunSampleTests: XCTestCase {
    func testRevealingTheFictionalExampleKeepsEveryInterpretationLinkedToExactWords() {
        var sample = FirstRunSample()
        XCTAssertFalse(sample.revealed)
        XCTAssertTrue(sample.items.isEmpty)
        sample.reveal()
        XCTAssertEqual(sample.items.map(\.title), ["当前阻碍", "约定", "建议"])
        XCTAssertEqual(sample.items.map(\.detail), ["预算尚待确认。", "周四再沟通，具体日期仍需确认。", "准备一次跟进，等待你决定。"])
        XCTAssertEqual(sample.items.map(\.quote), ["预算还要和合伙人确认", "周四我们再聊", "周四我们再聊"])
        XCTAssertEqual(FirstRunSample.source, "方案我看过了，预算还要和合伙人确认。周四我们再聊。")
        XCTAssertTrue(sample.items.allSatisfy { FirstRunSample.source.contains($0.quote) && !$0.corrected })
    }

    func testInspectionAndCorrectionDoNotChangeTheSourceOrOtherInterpretations() {
        var sample = FirstRunSample()
        sample.reveal()
        sample.inspect(.agreement)
        XCTAssertEqual(sample.selectedQuote, "周四我们再聊")
        sample.beginCorrection(.agreement)
        XCTAssertEqual(sample.correctionDraft, "周四再沟通，具体日期仍需确认。")
        sample.correctionDraft = "  先核对周四的具体日期，再准备草稿。  "
        XCTAssertTrue(sample.applyCorrection())
        XCTAssertEqual(sample.items[1].detail, "先核对周四的具体日期，再准备草稿。")
        XCTAssertTrue(sample.items[1].corrected)
        XCTAssertEqual(sample.items[1].quote, "周四我们再聊")
        XCTAssertEqual(sample.items[0].detail, "预算尚待确认。")
        XCTAssertEqual(sample.items[2].detail, "准备一次跟进，等待你决定。")
        XCTAssertNil(sample.editing)
        XCTAssertTrue(sample.correctionDraft.isEmpty)
    }

    func testCancellingAnEditAndResettingCannotPromoteDraftsToSampleResults() {
        var sample = FirstRunSample()
        sample.reveal()
        sample.beginCorrection(.dependency)
        sample.correctionDraft = "未应用的草稿"
        sample.cancelCorrection()
        XCTAssertEqual(sample.items[0].detail, "预算尚待确认。")
        XCTAssertFalse(sample.items[0].corrected)
        sample.beginCorrection(.dependency)
        sample.correctionDraft = "需要合伙人核对预算。"
        XCTAssertTrue(sample.applyCorrection())
        sample.reset()
        XCTAssertFalse(sample.revealed)
        XCTAssertTrue(sample.items.isEmpty)
        XCTAssertNil(sample.selectedQuote)
        XCTAssertNil(sample.editing)
        sample.reveal()
        XCTAssertEqual(sample.items[0].detail, "预算尚待确认。")
        XCTAssertFalse(sample.items[0].corrected)
    }

    func testInvalidEditsRemainRecoverableWithoutChangingTheDisplayedResult() {
        var sample = FirstRunSample()
        sample.inspect(.suggestion)
        sample.beginCorrection(.suggestion)
        XCTAssertNil(sample.selected)
        XCTAssertNil(sample.editing)
        XCTAssertFalse(sample.applyCorrection())
        sample.reveal()
        sample.beginCorrection(.suggestion)
        for invalid in [" \n ", String(repeating: "字", count: 501)] {
            sample.correctionDraft = invalid
            XCTAssertFalse(sample.applyCorrection())
            XCTAssertEqual(sample.items[2].detail, "准备一次跟进，等待你决定。")
            XCTAssertEqual(sample.editing, .suggestion)
            XCTAssertNotNil(sample.correctionError)
        }
        sample.correctionDraft = "只准备，不发送。🕊️"
        XCTAssertTrue(sample.applyCorrection())
        XCTAssertNil(sample.correctionError)
        XCTAssertEqual(sample.items[2].detail, "只准备，不发送。🕊️")
    }
}
