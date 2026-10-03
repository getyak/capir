import Foundation

extension URLTalentSignalLabClient: LabCIVerificationServing {
    func verifyCI(regressionID: String, request body: LabCIRequest) async throws -> LabCIReceipt {
        let result: LabCIEnvelope = try await request(path: "v1/lab/regressions/\(regressionID)/ci-verifications", method: "POST", body: body)
        try validateContract(result.contract_version)
        return result.verification
    }
    func ciVerification(regressionID: String, id: String) async throws -> LabCIReceipt {
        let result: LabCIEnvelope = try await request(path: "v1/lab/regressions/\(regressionID)/ci-verifications/\(id)", method: "GET", body: Optional<LabEmptyBody>.none)
        try validateContract(result.contract_version)
        return result.verification
    }
}

protocol TalentSignalLabServing {
    func loadManifest() async throws -> LabManifest
    func startSession(
        scenarioID: String,
        idempotencyKey: String
    ) async throws -> LabSession
    func run(
        sessionID: String,
        variant: LabRunVariant,
        idempotencyKey: String
    ) async throws -> LabRun
    func compare(
        sessionID: String,
        idempotencyKey: String
    ) async throws -> LabComparison
    func createReceipt(
        sessionID: String,
        runID: String,
        idempotencyKey: String
    ) async throws -> RealityReceipt
    func promoteReceipt(
        receiptID: String,
        idempotencyKey: String
    ) async throws -> LabEvalCase
}

actor URLTalentSignalLabClient: TalentSignalLabServing, LabExperimentServing {
    private let baseURL: URL
    private let accountSlug: String
    private let userEmail: String
    private let session: URLSession
    private var accessToken: String?

    init(
        baseURL: URL,
        accountSlug: String,
        userEmail: String,
        accessToken: String?,
        session: URLSession = TalentSignalNetworking.session
    ) {
        self.baseURL = baseURL
        self.accountSlug = accountSlug
        self.userEmail = userEmail
        self.accessToken = accessToken
        self.session = session
    }

    func loadManifest() async throws -> LabManifest {
        let manifest: LabManifest = try await request(
            path: "v1/lab",
            method: "GET",
            body: Optional<LabEmptyBody>.none
        )
        try validateContract(manifest.contractVersion)
        return manifest
    }

    func startSession(
        scenarioID: String,
        idempotencyKey: String
    ) async throws -> LabSession {
        let response: LabSessionEnvelope = try await request(
            path: "v1/lab/sessions",
            method: "POST",
            body: LabStartSessionBody(
                scenarioID: scenarioID,
                idempotencyKey: idempotencyKey
            )
        )
        try validateContract(response.contractVersion)
        return response.session
    }

    func run(
        sessionID: String,
        variant: LabRunVariant,
        idempotencyKey: String
    ) async throws -> LabRun {
        let response: LabRunEnvelope = try await request(
            path: "v1/lab/sessions/\(sessionID)/runs",
            method: "POST",
            body: LabRunBody(
                variant: variant.rawValue,
                idempotencyKey: idempotencyKey
            )
        )
        try validateContract(response.contractVersion)
        return response.run
    }

    func compare(
        sessionID: String,
        idempotencyKey: String
    ) async throws -> LabComparison {
        let response: LabComparisonEnvelope = try await request(
            path: "v1/lab/sessions/\(sessionID)/comparisons",
            method: "POST",
            body: LabIdempotencyBody(idempotencyKey: idempotencyKey)
        )
        try validateContract(response.contractVersion)
        guard response.comparison.identicalSnapshot,
              response.comparison.baselineRun.snapshotHash
                == response.comparison.candidateRun.snapshotHash else {
            throw TalentSignalLabClientError.snapshotMismatch
        }
        return response.comparison
    }

    func createReceipt(
        sessionID: String,
        runID: String,
        idempotencyKey: String
    ) async throws -> RealityReceipt {
        let response: RealityReceiptEnvelope = try await request(
            path: "v1/lab/sessions/\(sessionID)/receipts",
            method: "POST",
            body: LabReceiptBody(runID: runID, idempotencyKey: idempotencyKey)
        )
        try validateContract(response.contractVersion)
        guard response.receipt.redactionApplied else {
            throw TalentSignalLabClientError.unredactedReceipt
        }
        return response.receipt
    }

    func promoteReceipt(
        receiptID: String,
        idempotencyKey: String
    ) async throws -> LabEvalCase {
        let response: LabEvalCaseEnvelope = try await request(
            path: "v1/lab/receipts/\(receiptID)/promotions",
            method: "POST",
            body: LabPromotionBody(
                decision: "promote",
                idempotencyKey: idempotencyKey
            )
        )
        try validateContract(response.contractVersion)
        return response.evalCase
    }

    private func request<Response: Decodable, Body: Encodable>(
        path: String,
        method: String,
        body: Body?
    ) async throws -> Response {
        let data = try await requestData(path: path, method: method, body: body)
        do { return try JSONDecoder().decode(Response.self, from: data) }
        catch { throw TalentSignalLabClientError.invalidResponse }
    }

    private func requestData<Body: Encodable>(path: String, method: String, body: Body?) async throws -> Data {
        guard accessToken != nil || URLFixtureLoader.isLoopback(baseURL) else {
            throw TalentSignalLabClientError.authenticationRequired
        }
        let token = try await authenticatedToken()
        var request = URLRequest(url: baseURL.appending(path: path))
        request.timeoutInterval = 15
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "accept")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await TalentSignalNetworking.data(for: request, using: session)
        guard let http = response as? HTTPURLResponse else {
            throw TalentSignalLabClientError.invalidResponse
        }
        guard (200...299).contains(http.statusCode) else {
            let envelope = try? JSONDecoder().decode(LabErrorEnvelope.self, from: data)
            throw TalentSignalLabClientError.backend(
                status: http.statusCode,
                code: envelope?.error.code ?? "HTTP_\(http.statusCode)",
                message: envelope?.error.message ?? "The Lab request was rejected."
            )
        }
        return data
    }

    private func authenticatedToken() async throws -> String {
        if let accessToken { return accessToken }
#if DEBUG
        guard URLFixtureLoader.isLoopback(baseURL) else {
            throw TalentSignalLabClientError.authenticationRequired
        }
        var request = URLRequest(url: baseURL.appending(path: "v1/auth/simulated-login"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONEncoder().encode(
            LabSimulatedLoginBody(
                accountSlug: accountSlug,
                userEmail: userEmail,
                clientLabel: "ios-talent-signal-lab"
            )
        )
        let (data, response) = try await TalentSignalNetworking.data(for: request, using: session)
        guard let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode),
              let login = try? JSONDecoder().decode(
                LabSimulatedLoginEnvelope.self,
                from: data
              ) else {
            throw TalentSignalLabClientError.loginFailed
        }
        accessToken = login.accessToken
        return login.accessToken
#else
        throw TalentSignalLabClientError.authenticationRequired
#endif
    }

    private func validateContract(_ version: String) throws {
        guard version == TalentSignalAPIContract.version else {
            throw TalentSignalLabClientError.contractMismatch
        }
    }

    func loadExperiments() async throws -> LabExperimentCatalog {
        let result: LabExperimentCatalog = try await request(path: "v1/lab/experiments", method: "GET", body: Optional<LabEmptyBody>.none)
        try validateContract(result.contract_version)
        return result
    }

    func startExperiment(_ body: LabExperimentRequest) async throws -> LabExperimentRecord {
        let result: LabExperimentEnvelope = try await request(path: "v1/lab/experiments", method: "POST", body: body)
        try validateContract(result.contract_version)
        return result.experiment
    }

    func experiment(id: String) async throws -> LabExperimentRecord {
        guard UUID(uuidString: id) != nil else { throw TalentSignalLabClientError.invalidResponse }
        let result: LabExperimentEnvelope = try await request(path: "v1/lab/experiments/\(id)", method: "GET", body: Optional<LabEmptyBody>.none)
        try validateContract(result.contract_version)
        return result.experiment
    }

    func reviewExperiment(id: String, review: String) async throws -> LabExperimentRecord {
        guard UUID(uuidString: id) != nil else { throw TalentSignalLabClientError.invalidResponse }
        let result: LabExperimentEnvelope = try await request(path: "v1/lab/experiments/\(id)/review", method: "POST", body: ["review": review])
        try validateContract(result.contract_version)
        return result.experiment
    }
}

enum TalentSignalLabClientError: LocalizedError, Equatable {
    case authenticationRequired
    case backend(status: Int, code: String, message: String)
    case contractMismatch
    case invalidResponse
    case loginFailed
    case snapshotMismatch
    case unredactedReceipt

    var errorDescription: String? {
        switch self {
        case .authenticationRequired:
            return "capri Lab requires an authenticated internal build."
        case let .backend(_, code, message):
            return "\(message) (\(code))"
        case .contractMismatch:
            return "The Lab contract changed. Update capri and try again."
        case .invalidResponse:
            return "The Lab response could not be verified."
        case .loginFailed:
            return "The local Lab test session could not be opened."
        case .snapshotMismatch:
            return "Baseline comparison was rejected because the evidence snapshots differ."
        case .unredactedReceipt:
            return "The Reality Receipt was rejected because redaction was not verified."
        }
    }
}

private struct LabEmptyBody: Encodable {}

extension URLTalentSignalLabClient: LabJobServing {
    func loadExperimentJobs() async throws -> LabJobCatalog {
        let result: LabJobCatalog = try await request(path: "v1/lab/experiment-jobs", method: "GET", body: Optional<LabEmptyBody>.none)
        try validateContract(result.contract_version); return result
    }
    func startExperimentJob(_ body: LabJobRequest) async throws -> LabJobRecord {
        let result: LabJobEnvelope = try await request(path: "v1/lab/experiment-jobs", method: "POST", body: body)
        try validateContract(result.contract_version); return result.job
    }
    func experimentJob(id: String) async throws -> LabJobRecord {
        guard UUID(uuidString: id) != nil else { throw TalentSignalLabClientError.invalidResponse }
        let result: LabJobEnvelope = try await request(path: "v1/lab/experiment-jobs/\(id)", method: "GET", body: Optional<LabEmptyBody>.none)
        try validateContract(result.contract_version); return result.job
    }
    func cancelExperimentJob(id: String) async throws -> LabJobRecord {
        guard UUID(uuidString: id) != nil else { throw TalentSignalLabClientError.invalidResponse }
        let result: LabJobEnvelope = try await request(path: "v1/lab/experiment-jobs/\(id)/cancel", method: "POST", body: Optional<LabEmptyBody>.none)
        try validateContract(result.contract_version); return result.job
    }
    func reviewExperimentJob(id: String, value: LabJobReview) async throws -> LabJobRecord {
        guard UUID(uuidString: id) != nil else { throw TalentSignalLabClientError.invalidResponse }
        let result: LabJobEnvelope = try await request(path: "v1/lab/experiment-jobs/\(id)/review", method: "POST", body: value)
        try validateContract(result.contract_version); return result.job
    }
}

extension URLTalentSignalLabClient: LabRegressionServing {
    func loadRegressions() async throws -> LabRegressionList {
        let result: LabRegressionList = try await request(path: "v1/lab/regressions", method: "GET", body: Optional<LabEmptyBody>.none)
        try validateContract(result.contract_version); return result
    }
    func saveRegression(_ body: LabRegressionRequest) async throws -> LabRegressionRecord {
        let result: LabRegressionEnvelope = try await request(path: "v1/lab/regressions", method: "POST", body: body)
        try validateContract(result.contract_version); return result.regression
    }
    func regression(id: String) async throws -> LabRegressionRecord {
        guard UUID(uuidString: id) != nil else { throw TalentSignalLabClientError.invalidResponse }
        let result: LabRegressionEnvelope = try await request(path: "v1/lab/regressions/\(id)", method: "GET", body: Optional<LabEmptyBody>.none)
        try validateContract(result.contract_version); return result.regression
    }
    func deleteRegression(id: String) async throws -> LabRegressionDeletion {
        guard UUID(uuidString: id) != nil else { throw TalentSignalLabClientError.invalidResponse }
        let result: LabRegressionDeletion = try await request(path: "v1/lab/regressions/\(id)", method: "DELETE", body: Optional<LabEmptyBody>.none)
        try validateContract(result.contract_version); return result
    }
    func exportRegression(id: String) async throws -> Data {
        guard UUID(uuidString: id) != nil else { throw TalentSignalLabClientError.invalidResponse }
        let data = try await requestData(path: "v1/lab/regressions/\(id)/export", method: "GET", body: Optional<LabEmptyBody>.none)
        guard data.count <= 512_000 else { throw TalentSignalLabClientError.invalidResponse }
        let result = try JSONDecoder().decode(LabRegressionExport.self, from: data)
        guard result.schema_version == "lab-regression-bundle.v1", result.execution_authority == "none", result.id == id else {
            throw TalentSignalLabClientError.invalidResponse
        }
        return data // Preserve explicit nulls and the exact content-addressed snapshot.
    }
}

private struct LabStartSessionBody: Encodable {
    let scenarioID: String
    let idempotencyKey: String

    enum CodingKeys: String, CodingKey {
        case scenarioID = "scenario_id"
        case idempotencyKey = "idempotency_key"
    }
}

private struct LabRunBody: Encodable {
    let variant: String
    let idempotencyKey: String

    enum CodingKeys: String, CodingKey {
        case variant
        case idempotencyKey = "idempotency_key"
    }
}

private struct LabIdempotencyBody: Encodable {
    let idempotencyKey: String
    enum CodingKeys: String, CodingKey { case idempotencyKey = "idempotency_key" }
}

private struct LabReceiptBody: Encodable {
    let runID: String
    let idempotencyKey: String

    enum CodingKeys: String, CodingKey {
        case runID = "run_id"
        case idempotencyKey = "idempotency_key"
    }
}

private struct LabPromotionBody: Encodable {
    let decision: String
    let idempotencyKey: String

    enum CodingKeys: String, CodingKey {
        case decision
        case idempotencyKey = "idempotency_key"
    }
}

private struct LabSessionEnvelope: Decodable {
    let contractVersion: String
    let session: LabSession
    enum CodingKeys: String, CodingKey {
        case contractVersion = "contract_version"
        case session
    }
}

private struct LabRunEnvelope: Decodable {
    let contractVersion: String
    let run: LabRun
    enum CodingKeys: String, CodingKey {
        case contractVersion = "contract_version"
        case run
    }
}

private struct LabComparisonEnvelope: Decodable {
    let contractVersion: String
    let comparison: LabComparison
    enum CodingKeys: String, CodingKey {
        case contractVersion = "contract_version"
        case comparison
    }
}

private struct RealityReceiptEnvelope: Decodable {
    let contractVersion: String
    let receipt: RealityReceipt
    enum CodingKeys: String, CodingKey {
        case contractVersion = "contract_version"
        case receipt
    }
}

private struct LabEvalCaseEnvelope: Decodable {
    let contractVersion: String
    let evalCase: LabEvalCase
    enum CodingKeys: String, CodingKey {
        case contractVersion = "contract_version"
        case evalCase = "eval_case"
    }
}

private struct LabErrorEnvelope: Decodable {
    struct ErrorBody: Decodable {
        let code: String
        let message: String
    }
    let error: ErrorBody
}

#if DEBUG
private struct LabSimulatedLoginBody: Encodable {
    let accountSlug: String
    let userEmail: String
    let clientLabel: String

    enum CodingKeys: String, CodingKey {
        case accountSlug = "account_slug"
        case userEmail = "user_email"
        case clientLabel = "client_label"
    }
}

private struct LabSimulatedLoginEnvelope: Decodable {
    let accessToken: String
    enum CodingKeys: String, CodingKey { case accessToken = "access_token" }
}
#endif

extension URLTalentSignalLabClient: LabTaskTrialServing {
    func loadTaskConfiguration() async throws -> LabTaskConfiguration {
        let result: LabTaskConfiguration = try await request(path: "v1/lab/task-configuration", method: "GET", body: Optional<LabEmptyBody>.none)
        try validateContract(result.contract_version)
        return result
    }
    func startTaskTrial(_ body: LabTaskTrialRequest) async throws -> LabTaskTrial {
        let result: LabTaskTrialEnvelope = try await request(path: "v1/lab/task-trials", method: "POST", body: body)
        try validateContract(result.contract_version)
        return result.trial
    }
    func taskTrial(id: String) async throws -> LabTaskTrial {
        let result: LabTaskTrialEnvelope = try await request(path: "v1/lab/task-trials/\(id)", method: "GET", body: Optional<LabEmptyBody>.none)
        try validateContract(result.contract_version)
        return result.trial
    }
    func stopTaskTrial(id: String) async throws -> LabTaskTrial {
        let result: LabTaskTrialEnvelope = try await request(path: "v1/lab/task-trials/\(id)/stop", method: "POST", body: Optional<LabEmptyBody>.none)
        try validateContract(result.contract_version)
        return result.trial
    }
}

extension URLTalentSignalLabClient: LabFeatureOverrideServing {
    func loadFeatureConfiguration() async throws -> LabFeatureConfiguration {
        let result: LabFeatureConfiguration = try await request(path: "v1/lab/feature-configuration", method: "GET", body: Optional<LabEmptyBody>.none)
        try validateContract(result.contract_version)
        return result
    }
    func startFeatureOverride(_ body: LabFeatureOverrideRequest) async throws -> LabFeatureOverride {
        let result: LabFeatureOverrideEnvelope = try await request(path: "v1/lab/feature-overrides", method: "POST", body: body)
        try validateContract(result.contract_version)
        return result.override
    }
    func featureOverride(id: String) async throws -> LabFeatureOverride {
        let result: LabFeatureOverrideEnvelope = try await request(path: "v1/lab/feature-overrides/\(id)", method: "GET", body: Optional<LabEmptyBody>.none)
        try validateContract(result.contract_version)
        return result.override
    }
    func stopFeatureOverride(id: String) async throws -> LabFeatureOverride {
        let result: LabFeatureOverrideEnvelope = try await request(path: "v1/lab/feature-overrides/\(id)/stop", method: "POST", body: Optional<LabEmptyBody>.none)
        try validateContract(result.contract_version)
        return result.override
    }
}
