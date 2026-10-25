import CryptoKit
import Foundation
import XCTest
@testable import TalentSignal

final class ConversationImageClientTests: XCTestCase {
    func testAdmissionHTTPFailureRetainsSanitizedStatusAndClearRecovery() async throws {
        let (client, network) = makeClient()
        defer { network.invalidateAndCancel(); ImageWireURLProtocol.handler = nil; ImageWireURLProtocol.responseStatus = 200 }
        let upload = try ConversationImageUpload(id: UUID(), data: Data([1]), fileName: "synthetic.png", mediaType: "image/png")
        ImageWireURLProtocol.handler = { _ in (Data("PRIVATE_DATABASE_DETAIL".utf8), "text/plain") }
        for status in [500, 422] {
            ImageWireURLProtocol.responseStatus = status
            do {
                _ = try await client.admitConversationImages(sessionID: UUID(), messageID: UUID(),
                    idempotencyKey: "same-protected-message", objective: "", images: [upload])
                XCTFail("An HTTP failure is never an admission receipt")
            } catch let error as ConversationImageRequestError {
                XCTAssertEqual(error, .http(status))
                let copy = ImageConversationError.recoveryMessage(for: error, admissionAttempted: true)
                XCTAssertFalse(copy.contains("PRIVATE_DATABASE_DETAIL"))
                XCTAssertFalse(copy.contains("may still be processing"))
                XCTAssertTrue(copy.contains("retry"))
            }
        }
    }
    func testOrderedFlatUploadUsesStableLowercaseIdentityAndOriginalBytes() async throws {
        let (client, network) = makeClient(); defer { network.invalidateAndCancel(); ImageWireURLProtocol.handler = nil }
        let sid = UUID(), mid = UUID(), queue = UUID()
        let uploads = try [Data([1,2,3]),Data([4,5,6])].enumerated().map { index, data in
            try ConversationImageUpload(id: UUID(), data: data, fileName: "image-\(index).png", mediaType: "image/png")
        }
        var requestBodies: [Data] = []
        ImageWireURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/v1/agent-sessions/\(sid.uuidString.lowercased())/conversation-queue")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer synthetic-image-token")
            let data = self.body(request); requestBodies.append(data)
            let body = try JSONSerialization.jsonObject(with: data) as! [String:Any]
            XCTAssertEqual(body["session_id"] as? String, sid.uuidString.lowercased())
            XCTAssertEqual(body["message_id"] as? String, mid.uuidString.lowercased())
            XCTAssertEqual(body["idempotency_key"] as? String, "same-image-intent")
            XCTAssertEqual(body["objective"] as? String, "")
            XCTAssertEqual(body["time_zone"] as? String, "Pacific/Honolulu")
            let images = try XCTUnwrap(body["images"] as? [[String:Any]])
            XCTAssertEqual(images.count,2)
            for (index, image) in images.enumerated() {
                XCTAssertNil(image["manifest"])
                XCTAssertEqual(image["attachment_id"] as? String,uploads[index].manifest.attachmentID.uuidString.lowercased())
                XCTAssertEqual(image["content_hash"] as? String,uploads[index].manifest.contentHash)
                XCTAssertEqual(Data(base64Encoded:image["data_base64"] as! String), Data(index == 0 ? [1,2,3] : [4,5,6]))
            }
            return (try self.receipt(sid:sid,mid:mid,queue:queue), "application/json")
        }
        for _ in 0..<2 {
            let result = try await client.admitConversationImages(sessionID:sid,messageID:mid,
                idempotencyKey:"same-image-intent",objective:"",images:uploads,timeZone:"Pacific/Honolulu")
            XCTAssertEqual(result.messageID,mid); XCTAssertEqual(result.queueEntryID,queue)
        }
        XCTAssertEqual(requestBodies.count,2)
        let a = try JSONSerialization.jsonObject(with:requestBodies[0]) as! NSDictionary
        let b = try JSONSerialization.jsonObject(with:requestBodies[1]) as! NSDictionary
        XCTAssertEqual(a,b)
    }

    func testReceiptForAnotherMessageIsRejected() async throws {
        let (client, network) = makeClient(); defer { network.invalidateAndCancel(); ImageWireURLProtocol.handler = nil }
        ImageWireURLProtocol.handler = { _ in (try self.receipt(sid:UUID(),mid:UUID(),queue:UUID()),"application/json") }
        let upload = try ConversationImageUpload(id:UUID(),data:Data([1]),fileName:"image.png",mediaType:"image/png")
        do { _ = try await client.admitConversationImages(sessionID:UUID(),messageID:UUID(),
                idempotencyKey:"same-intent",objective:"Read it",images:[upload]); XCTFail("Wrong identity must not be admitted locally") }
        catch PursuitWorkspaceClientError.invalidResponse { }
    }

    func testOriginalRequiresExactHashSizeAndMediaType() async throws {
        let (client, network) = makeClient(); defer { network.invalidateAndCancel(); ImageWireURLProtocol.handler = nil }
        let sid=UUID(),mid=UUID(),bytes=Data([1,2,3])
        let upload=try ConversationImageUpload(id:UUID(),data:bytes,fileName:"image.png",mediaType:"image/png")
        var corrupt=false
        ImageWireURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path,"/v1/agent-sessions/\(sid.uuidString.lowercased())/conversation-images/\(mid.uuidString.lowercased())/0")
            XCTAssertEqual(request.value(forHTTPHeaderField:"Authorization"),"Bearer synthetic-image-token")
            return (corrupt ? Data([3,2,1]) : bytes,"image/png")
        }
        let content=try await client.loadConversationImage(sessionID:sid,messageID:mid,index:0,manifest:upload.manifest)
        XCTAssertEqual(content.data,bytes)
        corrupt=true
        do { _ = try await client.loadConversationImage(sessionID:sid,messageID:mid,index:0,manifest:upload.manifest); XCTFail("Changed original must not render") }
        catch PursuitWorkspaceClientError.invalidResponse { }
    }

    func testUnknownQueueStatusCannotBecomeACompletedObservation() throws {
        let payload:[String:Any]=["queue_entry_id":UUID().uuidString,"message_id":UUID().uuidString,"status":"unknown-success","images":[]]
        XCTAssertThrowsError(try JSONDecoder().decode(ConversationImageQueueEntry.self,
            from:JSONSerialization.data(withJSONObject:payload)))
    }

    func testOversizeQuestionIsRejectedWithoutNetworkAdmission() async throws {
        let (client, network) = makeClient(); defer { network.invalidateAndCancel(); ImageWireURLProtocol.handler = nil }
        var requests = 0
        ImageWireURLProtocol.handler = { _ in requests += 1; throw URLError(.badServerResponse) }
        let upload = try ConversationImageUpload(id: UUID(), data: Data([1]), fileName: "synthetic.png", mediaType: "image/png")
        do {
            _ = try await client.admitConversationImages(sessionID: UUID(), messageID: UUID(),
                idempotencyKey: "same-intent", objective: String(repeating: "x", count: 1001), images: [upload])
            XCTFail("An invalid question must never reach admission")
        } catch ImageConversationError.invalidInput { }
        XCTAssertEqual(requests, 0)
    }

    func testAuthenticatedStreamYieldsBoundMetadataAndEOFDoesNotClaimCompletion() async throws {
        let (client, network) = makeClient(); defer { network.invalidateAndCancel(); ImageWireURLProtocol.handler = nil }
        let sid = UUID(), mid = UUID(), run = UUID()
        ImageWireURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/v1/agent-sessions/\(sid.uuidString.lowercased())/conversation-queue/stream")
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer synthetic-image-token")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "text/event-stream")
            let row: [String: Any] = ["queue_entry_id": mid.uuidString, "message_id": mid.uuidString,
                "run_id": run.uuidString, "status": "running", "images": []]
            let snapshot = try JSONSerialization.data(withJSONObject: ["contract_version": TalentSignalAPIContract.version,
                "session_id": sid.uuidString, "revision": 1, "paused": false, "active": row, "queued": []])
            let preview = try JSONSerialization.data(withJSONObject: ["run_id": run.uuidString,
                "message_id": mid.uuidString, "revision": 1, "stage": "contact_read", "text": "UNVALIDATED_TEXT"])
            let body = "event: snapshot\ndata: \(String(decoding: snapshot, as: UTF8.self))\n\n"
                + "event: preview\ndata: \(String(decoding: preview, as: UTF8.self))\n\n"
            return (Data(body.utf8), "text/event-stream")
        }
        var updates: [ConversationImageQueueUpdate] = []
        let stream = try await client.conversationImageUpdates(sessionID: sid, messageID: mid)
        for try await update in stream { updates.append(update) }
        let last = try XCTUnwrap(updates.last)
        XCTAssertEqual(last.sessionID, sid); XCTAssertEqual(last.messageID, mid)
        XCTAssertEqual(last.entry?.queueStatus, .running)
        XCTAssertEqual(last.observedStage, .contactRead)
        XCTAssertFalse(updates.contains { $0.entry?.queueStatus == .completed }, "EOF only ends observation.")
    }

    func testStreamUnavailableIsAReadbackConditionAndWrongMediaTypeIsRejected() async throws {
        let (client, network) = makeClient(); defer { network.invalidateAndCancel(); ImageWireURLProtocol.handler = nil }
        ImageWireURLProtocol.handler = { _ in (Data("event: unavailable\ndata: {}\n\n".utf8), "text/event-stream") }
        do {
            let stream = try await client.conversationImageUpdates(sessionID: UUID(), messageID: UUID())
            for try await _ in stream { XCTFail("Unavailable is never a processing update") }
            XCTFail("Unavailable must end observation")
        } catch ConversationImageStreamError.unavailable(410) { }
        ImageWireURLProtocol.handler = { _ in (Data("event: snapshot\ndata: {}\n\n".utf8), "text/html") }
        do {
            let stream = try await client.conversationImageUpdates(sessionID: UUID(), messageID: UUID())
            for try await _ in stream { XCTFail("HTML is not a verified stream") }
            XCTFail("Wrong media type must be rejected")
        } catch ConversationImageStreamError.invalidFrame { }
    }

    @MainActor
    func testCancellationBeforeStreamAdmissionMakesNoRequest() async throws {
        let (client, network) = makeClient(); defer { network.invalidateAndCancel(); ImageWireURLProtocol.handler = nil }
        var requests = 0
        ImageWireURLProtocol.handler = { _ in requests += 1; throw URLError(.badServerResponse) }
        let task = Task {
            let stream = try await client.conversationImageUpdates(sessionID: UUID(), messageID: UUID())
            for try await _ in stream { XCTFail("A cancelled observation cannot publish") }
        }
        task.cancel()
        do { try await task.value; XCTFail("Cancelled observation must stop") }
        catch is CancellationError { }
        XCTAssertEqual(requests, 0)
    }

    func testCancellingObservationClosesItsLiveTransport() async throws {
        let (client, network) = makeClient()
        defer {
            ImageWireURLProtocol.holdOpen = false; ImageWireURLProtocol.onStop = nil
            network.invalidateAndCancel(); ImageWireURLProtocol.handler = nil
        }
        let started = expectation(description: "Stream connected")
        let stopped = expectation(description: "Only this observation transport stopped")
        ImageWireURLProtocol.holdOpen = true
        ImageWireURLProtocol.onStop = { stopped.fulfill() }
        ImageWireURLProtocol.handler = { _ in
            started.fulfill()
            return (Data(": heartbeat\n\n".utf8), "text/event-stream")
        }
        let task = Task {
            let stream = try await client.conversationImageUpdates(sessionID: UUID(), messageID: UUID())
            for try await _ in stream { XCTFail("A heartbeat contains no message update") }
        }
        await fulfillment(of: [started], timeout: 3)
        task.cancel()
        _ = try? await task.value
        await fulfillment(of: [stopped], timeout: 3)
    }

    @MainActor
    func testQueueReadStillRejectsExpiredCanonicalSession() async throws {
        let (client, network) = makeClient(); defer { network.invalidateAndCancel(); ImageWireURLProtocol.handler = nil }
        let store = AgentSessionStore(persistence: ImageClientSessionPersistence())
        let sid = try XCTUnwrap(store.beginUnscopedSession(objective: "Synthetic")), mid = UUID()
        let saved = PersistedAgentSession(try XCTUnwrap(store.session(id: sid)))
        let payload = try JSONSerialization.jsonObject(with: JSONEncoder.agentSession.encode(saved))
        let envelope = try JSONSerialization.data(withJSONObject: ["contract_version": TalentSignalAPIContract.version,
            "session": ["session_id": sid.uuidString, "revision": 1, "updated_at": "2026-01-01T00:00:00Z",
                "expires_at": "2026-01-02T00:00:00Z", "deleted_at": NSNull(), "payload": payload]])
        let snapshot = try JSONSerialization.data(withJSONObject: ["contract_version": TalentSignalAPIContract.version,
            "session_id": sid.uuidString, "active": NSNull(), "queued": []])
        ImageWireURLProtocol.handler = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer synthetic-image-token")
            return (request.url!.path.hasSuffix("/conversation-queue") ? snapshot : envelope, "application/json")
        }
        do {
            _ = try await client.readConversationImageState(sessionID: sid, messageID: mid)
            XCTFail("Queue availability cannot extend canonical Session expiry")
        } catch PursuitWorkspaceClientError.invalidResponse { }
    }

    private func receipt(sid:UUID,mid:UUID,queue:UUID) throws -> Data {
        try JSONSerialization.data(withJSONObject:["contract_version":TalentSignalAPIContract.version,
            "session_id":sid.uuidString.lowercased(),"message_id":mid.uuidString.lowercased(),
            "queue_entry_id":queue.uuidString.lowercased(),"run_id":NSNull(),"status":"queued",
            "sequence":1,"revision":1,"snapshot_revision":1,"accepted_at":"2026-10-22T10:00:00Z"])
    }
    private func makeClient() -> (URLPursuitWorkspaceClient,URLSession) {
        let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[ImageWireURLProtocol.self]
        let session=URLSession(configuration:config)
        return (URLPursuitWorkspaceClient(baseURL:URL(string:"https://example.invalid")!,
            accessToken:"synthetic-image-token",accountID:UUID().uuidString,userID:UUID().uuidString,
            userDisplayName:"Synthetic",session:session),session)
    }
    private func body(_ request:URLRequest)->Data {
        if let data=request.httpBody{return data}
        guard let stream=request.httpBodyStream else{return Data()}
        stream.open();defer{stream.close()}
        var data=Data(),buffer=[UInt8](repeating:0,count:4096)
        while stream.hasBytesAvailable {let n=stream.read(&buffer,maxLength:buffer.count);if n<=0{break};data.append(contentsOf:buffer.prefix(n))}
        return data
    }
}

private final class ImageWireURLProtocol: URLProtocol {
    static var responseStatus = 200
    static var handler: ((URLRequest)throws -> (Data,String))?
    static var holdOpen = false
    static var onStop: (() -> Void)?
    override class func canInit(with request:URLRequest)->Bool {true}
    override class func canonicalRequest(for request:URLRequest)->URLRequest {request}
    override func startLoading() {
        do {
            let (data,type)=try Self.handler!(request)
            let response=HTTPURLResponse(url:request.url!,statusCode:Self.responseStatus,httpVersion:nil,headerFields:["Content-Type":type])!
            client?.urlProtocol(self,didReceive:response,cacheStoragePolicy:.notAllowed)
            client?.urlProtocol(self,didLoad:data)
            if !Self.holdOpen { client?.urlProtocolDidFinishLoading(self) }
        } catch {client?.urlProtocol(self,didFailWithError:error)}
    }
    override func stopLoading() { Self.onStop?() }
}

private final class ImageClientSessionPersistence: AgentSessionPersisting {
    var data: Data?
    func load() throws -> Data? { data }
    func save(_ data: Data) throws { self.data = data }
    func deletionPending() throws -> Bool { false }
    func beginDeletion() throws { }
    func completeDeletion() throws { data = nil }
}
