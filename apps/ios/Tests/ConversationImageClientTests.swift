import CryptoKit
import Foundation
import XCTest
@testable import TalentSignal

final class ConversationImageClientTests: XCTestCase {
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
    static var handler: ((URLRequest)throws -> (Data,String))?
    override class func canInit(with request:URLRequest)->Bool {true}
    override class func canonicalRequest(for request:URLRequest)->URLRequest {request}
    override func startLoading() {
        do {
            let (data,type)=try Self.handler!(request)
            let response=HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:nil,headerFields:["Content-Type":type])!
            client?.urlProtocol(self,didReceive:response,cacheStoragePolicy:.notAllowed)
            client?.urlProtocol(self,didLoad:data);client?.urlProtocolDidFinishLoading(self)
        } catch {client?.urlProtocol(self,didFailWithError:error)}
    }
    override func stopLoading() { }
}
