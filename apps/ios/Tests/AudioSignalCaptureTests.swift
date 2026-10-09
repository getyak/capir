import XCTest
@testable import TalentSignal

@MainActor
final class AudioSignalCaptureTests: XCTestCase {
    func testAuthorizationAndPurposeGateRecording() async {
        let recorder = AudioSignalRecordingSpy(permission: .granted)
        let store = AudioSignalCaptureStore(recorder: recorder)

        XCTAssertFalse(store.canStart)
        await store.start(sceneIsActive: true)
        XCTAssertEqual(recorder.startCalls, 0)
        XCTAssertEqual(
            store.notice,
            "Name the person or accountable party who authorized this recording."
        )

        store.authorizationConfirmed = true
        store.authorizingParty = "Candidate participant"
        store.authorizationBasis = "Direct verbal permission"
        store.purpose = "   "
        XCTAssertFalse(store.canStart)

        store.purpose = "Authorized interview note"
        XCTAssertTrue(store.canStart)
        await store.start(sceneIsActive: true)

        XCTAssertTrue(store.isRecording)
        XCTAssertEqual(recorder.startCalls, 1)
        XCTAssertEqual(recorder.startedPurpose, "Authorized interview note")
    }

    func testPermissionDenialNeverPresentsRecording() async {
        let recorder = AudioSignalRecordingSpy(
            permission: .undetermined,
            requestedPermission: .denied
        )
        let store = readyStore(recorder: recorder)

        await store.start(sceneIsActive: true)

        XCTAssertFalse(store.isRecording)
        XCTAssertEqual(recorder.permissionRequestCalls, 1)
        XCTAssertEqual(recorder.startCalls, 0)
        XCTAssertEqual(store.microphonePermission, .denied)
        XCTAssertEqual(
            store.phase,
            .failed("Microphone permission was not granted. No recording started.")
        )
    }

    func testBackgroundStartIsRejectedBeforePermissionRequest() async {
        let recorder = AudioSignalRecordingSpy(permission: .undetermined)
        let store = readyStore(recorder: recorder)

        await store.start(sceneIsActive: false)

        XCTAssertEqual(recorder.permissionRequestCalls, 0)
        XCTAssertEqual(recorder.startCalls, 0)
        XCTAssertEqual(
            store.phase,
            .failed("Open capri in the foreground before recording. No recording started.")
        )
    }

    func testSuccessfulStopRequiresDurableReceiptThenSupportsDeletion() async {
        let recorder = AudioSignalRecordingSpy(permission: .granted)
        let store = readyStore(recorder: recorder)

        await store.start(sceneIsActive: true)
        store.stop()

        guard case let .saved(receipt) = store.phase else {
            return XCTFail("Expected a durable local receipt")
        }
        XCTAssertEqual(receipt.status, "saved_local")
        XCTAssertEqual(receipt.purpose, "Authorized source")
        XCTAssertEqual(receipt.authorization.authorizingParty, "Candidate participant")
        XCTAssertEqual(receipt.authorization.basis, "Direct verbal permission")
        XCTAssertEqual(receipt.authorization.scope, "Authorized source")
        XCTAssertEqual(recorder.stopCalls, 1)

        store.delete()

        XCTAssertEqual(recorder.deletedReceipt, receipt)
        XCTAssertEqual(store.phase, .deleted)
        XCTAssertFalse(store.authorizationConfirmed)
    }

    func testForegroundLossStopsAndSealsRecoverablePayload() async {
        let recorder = AudioSignalRecordingSpy(permission: .granted)
        let store = readyStore(recorder: recorder)

        await store.start(sceneIsActive: true)
        store.stopForForegroundLoss()

        guard case .saved = store.phase else {
            return XCTFail("Foreground loss must stop into a saved receipt")
        }
        XCTAssertEqual(recorder.stopCalls, 1)
        XCTAssertEqual(
            store.notice,
            "Recording stopped because capri left the foreground. The completed local payload is recoverable."
        )
    }

    func testRecorderStartFailureCannotLookActive() async {
        let recorder = AudioSignalRecordingSpy(permission: .granted)
        recorder.startError = AudioSignalRecorderError.inputUnavailable
        let store = readyStore(recorder: recorder)

        await store.start(sceneIsActive: true)

        XCTAssertFalse(store.isRecording)
        XCTAssertEqual(recorder.discardCalls, 1)
        XCTAssertEqual(
            store.phase,
            .failed("No microphone input is available. No recording started.")
        )
    }

    func testRestoreUsesOnlyVerifiedReceipt() {
        let recorder = AudioSignalRecordingSpy(permission: .granted)
        recorder.latest = recorder.makeReceipt(purpose: "Prior authorized source")
        let store = AudioSignalCaptureStore(recorder: recorder)

        store.restore()

        XCTAssertEqual(store.phase, .saved(recorder.latest!))
    }

    func testCaptureIntentRouterRequiresExplicitConsumption() {
        let router = CaptureIntentRouter.shared
        router.route(to: .foregroundAudio)

        let request = router.request
        XCTAssertEqual(request?.destination, .foregroundAudio)

        router.consume(UUID())
        XCTAssertEqual(router.request, request)

        router.consume(request!.id)
        XCTAssertNil(router.request)
    }

    func testVoiceInputReturnsEditableDraftAndDeletesTemporaryAudio() async {
        let recorder = VoiceDictationRecordingSpy(permission: .granted)
        let transcriber = VoiceTranscriptionSpy(
            result: .success(
                VoiceTranscriptionDraft(
                    audioDurationMilliseconds: 1_200,
                    clientRequestID: recorder.payload.id,
                    model: "bigmodel",
                    provider: "doubao",
                    providerRequestID: UUID(),
                    status: "draft",
                    temporaryAudioStoredByTalentSignal: false,
                    transcript: "  What changed in this search?  "
                )
            )
        )
        let store = VoiceInputStore(recorder: recorder)

        await store.start(sceneIsActive: true, transcriber: transcriber)
        XCTAssertTrue(store.isRecording)
        XCTAssertEqual(recorder.startCalls, 1)

        await store.stopAndTranscribe()

        XCTAssertEqual(store.phase, .idle)
        XCTAssertEqual(store.transcript, "What changed in this search?")
        XCTAssertEqual(recorder.deletedPayload, recorder.payload)
        let transcriptionCalls = await transcriber.callCount
        XCTAssertEqual(transcriptionCalls, 1)
    }

    func testVoiceDictationOneMinuteContractFitsBackendLimit() {
        XCTAssertEqual(
            VoiceDictationAudioContract.estimatedPCMByteCount(
                durationSeconds: VoiceDictationAudioContract.maximumDurationSeconds
            ),
            1_920_044
        )
        XCTAssertLessThan(
            VoiceDictationAudioContract.estimatedPCMByteCount(
                durationSeconds: VoiceDictationAudioContract.maximumDurationSeconds
            ),
            VoiceDictationAudioContract.maximumPayloadBytes
        )
    }

    func testVoiceTranscriptionRejectsOversizedPayloadBeforeReadingAudio() async {
        let payload = VoiceDictationPayload(
            id: UUID(),
            fileURL: URL(fileURLWithPath: "/missing/oversized-voice.wav"),
            byteCount: VoiceDictationAudioContract.maximumPayloadBytes + 1,
            durationSeconds: VoiceDictationAudioContract.maximumDurationSeconds,
            mimeType: "audio/wav"
        )
        let client = URLVoiceTranscriptionClient(
            baseURL: URL(string: "https://example.invalid")!,
            accessToken: "test-token"
        )

        do {
            _ = try await client.transcribe(payload)
            XCTFail("Expected an oversized payload to be rejected locally.")
        } catch {
            XCTAssertEqual(
                error as? VoiceTranscriptionClientError,
                .payloadTooLarge
            )
        }
    }

    func testVoiceInputPublishesBestEffortLiveWordsInsideComposer() async {
        let recorder = VoiceDictationRecordingSpy(permission: .granted)
        recorder.liveTranscript = "Help me organize last week's meeting"
        let transcriber = VoiceTranscriptionSpy(
            result: .failure(CancellationError())
        )
        let store = VoiceInputStore(recorder: recorder)

        await store.start(
            sceneIsActive: true,
            locale: Locale(identifier: "en_US"),
            transcriber: transcriber
        )

        XCTAssertEqual(store.liveTranscript, recorder.liveTranscript)
        XCTAssertTrue(store.isRecording)
        store.cancel()
        XCTAssertTrue(store.liveTranscript.isEmpty)
    }

    func testVoicePermissionOverlayWaitsForActiveSceneBeforeRecording() async {
        let recorder = VoiceDictationRecordingSpy(permission: .undetermined)
        let transcriber = VoiceTranscriptionSpy(
            result: .failure(CancellationError())
        )
        let store = VoiceInputStore(recorder: recorder)
        recorder.onPermissionRequest = {
            store.updateSceneIsActive(false)
            Task { @MainActor in
                await Task.yield()
                store.updateSceneIsActive(true)
            }
        }

        await store.start(sceneIsActive: true, transcriber: transcriber)

        XCTAssertEqual(recorder.permissionRequestCalls, 1)
        XCTAssertEqual(recorder.startCalls, 1)
        XCTAssertTrue(store.isRecording)
    }

    func testVoiceInputFailureDeletesAudioAndKeepsFailureRecoverable() async {
        let recorder = VoiceDictationRecordingSpy(permission: .granted)
        let transcriber = VoiceTranscriptionSpy(
            result: .failure(
                VoiceTranscriptionClientError.backend(
                    "Voice transcription is busy. Your text draft is unchanged; try again."
                )
            )
        )
        let store = VoiceInputStore(recorder: recorder)

        await store.start(sceneIsActive: true, transcriber: transcriber)
        await store.stopAndTranscribe()

        XCTAssertEqual(
            store.phase,
            .failed(
                "Voice transcription is busy. Your text draft is unchanged; try again."
            )
        )
        XCTAssertNil(store.transcript)
        XCTAssertEqual(recorder.deletedPayload, recorder.payload)

        store.dismissFailure()
        XCTAssertEqual(store.phase, .idle)
    }

    func testVoiceInputForegroundLossCancelsWithoutTranscription() async {
        let recorder = VoiceDictationRecordingSpy(permission: .granted)
        let transcriber = VoiceTranscriptionSpy(
            result: .success(
                VoiceTranscriptionDraft(
                    audioDurationMilliseconds: nil,
                    clientRequestID: recorder.payload.id,
                    model: "bigmodel",
                    provider: "doubao",
                    providerRequestID: UUID(),
                    status: "draft",
                    temporaryAudioStoredByTalentSignal: false,
                    transcript: "Should not be returned"
                )
            )
        )
        let store = VoiceInputStore(recorder: recorder)

        await store.start(sceneIsActive: true, transcriber: transcriber)
        store.stopForForegroundLoss()

        XCTAssertEqual(recorder.cancelCalls, 1)
        XCTAssertEqual(
            store.phase,
            .failed(
                "Voice input stopped when capri left the foreground. No audio was sent."
            )
        )
        let transcriptionCalls = await transcriber.callCount
        XCTAssertEqual(transcriptionCalls, 0)
    }

    func testVoiceAudioInterruptionCancelsWithoutSendingAudio() async {
        let recorder = VoiceDictationRecordingSpy(permission: .granted)
        let transcriber = VoiceTranscriptionSpy(
            result: .failure(CancellationError())
        )
        let store = VoiceInputStore(recorder: recorder)

        await store.start(sceneIsActive: true, transcriber: transcriber)
        store.stopForAudioInterruption()

        XCTAssertEqual(recorder.cancelCalls, 1)
        XCTAssertEqual(
            store.phase,
            .failed(
                "Voice input was interrupted by another audio session. No audio was sent."
            )
        )
        let transcriptionCalls = await transcriber.callCount
        XCTAssertEqual(transcriptionCalls, 0)
    }

    func testForegroundLossInterruptsInFlightVoiceTranscription() async {
        let recorder = VoiceDictationRecordingSpy(permission: .granted)
        let transcriber = BlockingVoiceTranscriptionSpy()
        let store = VoiceInputStore(recorder: recorder)

        await store.start(sceneIsActive: true, transcriber: transcriber)
        let transcription = Task { await store.stopAndTranscribe() }
        for _ in 0 ..< 50 {
            if await transcriber.callCount == 1 { break }
            await Task.yield()
        }
        let transcriptionCalls = await transcriber.callCount
        XCTAssertEqual(transcriptionCalls, 1)
        XCTAssertEqual(store.phase, .transcribing)

        store.stopForForegroundLoss()
        await transcription.value

        XCTAssertEqual(
            store.phase,
            .failed(
                "Voice transcription was interrupted. The temporary recording was deleted; the provider result is unavailable."
            )
        )
        XCTAssertEqual(recorder.deletedPayload, recorder.payload)
    }

    private func readyStore(
        recorder: AudioSignalRecordingSpy
    ) -> AudioSignalCaptureStore {
        let store = AudioSignalCaptureStore(recorder: recorder)
        store.authorizationConfirmed = true
        store.authorizingParty = "Candidate participant"
        store.authorizationBasis = "Direct verbal permission"
        store.purpose = "Authorized source"
        return store
    }
}

@MainActor
private final class VoiceDictationRecordingSpy: VoiceDictationRecordingServing {
    var permission: AudioSignalPermission
    var requestedPermission: AudioSignalPermission
    var permissionRequestCalls = 0
    var startCalls = 0
    var stopCalls = 0
    var cancelCalls = 0
    var deletedPayload: VoiceDictationPayload?
    var isRecording = false
    var onPermissionRequest: (() -> Void)?
    var liveTranscript = ""
    private var liveTranscriptHandler: ((String) -> Void)?
    let payload = VoiceDictationPayload(
        id: UUID(),
        fileURL: URL(fileURLWithPath: "/tmp/synthetic-voice-input.wav"),
        byteCount: 1_024,
        durationSeconds: 1.2,
        mimeType: "audio/wav"
    )

    init(
        permission: AudioSignalPermission,
        requestedPermission: AudioSignalPermission = .granted
    ) {
        self.permission = permission
        self.requestedPermission = requestedPermission
    }

    func permissionStatus() -> AudioSignalPermission { permission }

    func requestPermission() async -> AudioSignalPermission {
        permissionRequestCalls += 1
        onPermissionRequest?()
        permission = requestedPermission
        return requestedPermission
    }

    func prepareLiveTranscription(
        locale: Locale,
        onUpdate: @escaping (String) -> Void
    ) async {
        liveTranscriptHandler = onUpdate
    }

    func start(recordID: UUID) throws {
        startCalls += 1
        isRecording = true
        if !liveTranscript.isEmpty { liveTranscriptHandler?(liveTranscript) }
    }

    func stop() throws -> VoiceDictationPayload {
        guard isRecording else { throw VoiceDictationRecorderError.notRecording }
        stopCalls += 1
        isRecording = false
        return payload
    }

    func cancel() throws {
        cancelCalls += 1
        isRecording = false
        liveTranscriptHandler = nil
    }

    func delete(_ payload: VoiceDictationPayload) throws {
        deletedPayload = payload
    }
}

private actor VoiceTranscriptionSpy: VoiceTranscriptionServing {
    private(set) var callCount = 0
    let result: Result<VoiceTranscriptionDraft, Error>

    init(result: Result<VoiceTranscriptionDraft, Error>) {
        self.result = result
    }

    func transcribe(
        _ payload: VoiceDictationPayload
    ) async throws -> VoiceTranscriptionDraft {
        callCount += 1
        return try result.get()
    }
}

private actor BlockingVoiceTranscriptionSpy: VoiceTranscriptionServing {
    private(set) var callCount = 0

    func transcribe(
        _ payload: VoiceDictationPayload
    ) async throws -> VoiceTranscriptionDraft {
        callCount += 1
        try await Task.sleep(for: .seconds(60))
        return VoiceTranscriptionDraft(
            audioDurationMilliseconds: nil,
            clientRequestID: payload.id,
            model: "bigmodel",
            provider: "doubao",
            providerRequestID: UUID(),
            status: "draft",
            temporaryAudioStoredByTalentSignal: false,
            transcript: "Unavailable"
        )
    }
}

@MainActor
private final class AudioSignalRecordingSpy: AudioSignalRecordingServing {
    var permission: AudioSignalPermission
    var requestedPermission: AudioSignalPermission
    var startError: Error?
    var latest: AudioSignalLocalReceipt?
    var startCalls = 0
    var permissionRequestCalls = 0
    var stopCalls = 0
    var discardCalls = 0
    var startedPurpose: String?
    var startedAuthorization: AudioSignalLocalReceipt.Authorization?
    var deletedReceipt: AudioSignalLocalReceipt?
    private var activeID: UUID?

    init(
        permission: AudioSignalPermission,
        requestedPermission: AudioSignalPermission = .granted
    ) {
        self.permission = permission
        self.requestedPermission = requestedPermission
    }

    func permissionStatus() -> AudioSignalPermission { permission }

    func requestPermission() async -> AudioSignalPermission {
        permissionRequestCalls += 1
        permission = requestedPermission
        return requestedPermission
    }

    func start(
        recordID: UUID,
        purpose: String,
        authorization: AudioSignalLocalReceipt.Authorization
    ) throws {
        startCalls += 1
        if let startError { throw startError }
        activeID = recordID
        startedPurpose = purpose
        startedAuthorization = authorization
    }

    func stop() throws -> AudioSignalLocalReceipt {
        stopCalls += 1
        guard let activeID else { throw AudioSignalRecorderError.notRecording }
        let receipt = makeReceipt(id: activeID, purpose: startedPurpose ?? "")
        latest = receipt
        self.activeID = nil
        return receipt
    }

    func discardActiveRecording() throws {
        discardCalls += 1
        activeID = nil
    }

    func latestReceipt() throws -> AudioSignalLocalReceipt? { latest }

    func delete(_ receipt: AudioSignalLocalReceipt) throws {
        deletedReceipt = receipt
        latest = nil
    }

    func makeReceipt(
        id: UUID = UUID(),
        purpose: String
    ) -> AudioSignalLocalReceipt {
        AudioSignalLocalReceipt(
            id: id,
            fileName: "\(id.uuidString.lowercased()).m4a",
            contentHash: String(repeating: "b", count: 64),
            byteCount: 2_048,
            durationSeconds: 2.4,
            createdAt: Date(timeIntervalSince1970: 1_777_777_777),
            purpose: purpose,
            authorization: startedAuthorization ?? .init(
                basis: "Direct verbal permission",
                authorizingParty: "Candidate participant",
                attestedBy: "Current local user",
                scope: purpose,
                recordedAt: Date(timeIntervalSince1970: 1_777_777_776)
            ),
            status: "saved_local"
        )
    }
}
