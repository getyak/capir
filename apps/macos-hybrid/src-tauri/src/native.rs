use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc,
    },
    thread,
    time::Duration,
};

use chrono::{DateTime, Utc};
use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_notification::NotificationExt;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::{
    backend::{PersistentBinding, canonical_uuid, validate_token, validate_uuid, verify_backend},
    models::{
        ActivateBindingRequest, BindingStatus, CapabilityAvailability, CapabilityReport,
        CaptureRequest, CaptureResult, NotificationRequest, NotificationResult, NotificationState,
        OcrRequest, OcrResult, PlatformScope, QuickPanelRequest, QuickPanelResult,
    },
};

const KEYCHAIN_SERVICE: &str = "com.talentsignal.hybrid.backend-token";
const BINDING_FILE: &str = "hybrid-binding.json";
const PENDING_KEYCHAIN_FILE: &str = "hybrid-keychain-pending.json";
const REVOCATION_FILE: &str = "hybrid-binding-revocation.json";
const MAX_CAPTURE_BYTES: u64 = 12_000_000;
const MAX_CAPTURE_CACHE_BYTES: u64 = 48_000_000;
const MAX_CAPTURE_ARTIFACTS: usize = 8;
const CAPTURE_TTL_MINUTES: i64 = 10;
const KEYCHAIN_TIMEOUT_SECONDS: u64 = 3;
const OCR_TIMEOUT_SECONDS: u64 = 20;
const MAX_OCR_OUTPUT_BYTES: u64 = 256_000;
const CAPTURE_MARKER_FILE: &str = "active-capture.json";
const CAPTURE_RECEIPTS_FILE: &str = "capture-intent-receipts.json";
const CAPTURE_RECEIPTS_LOCK_FILE: &str = "capture-intent-receipts.lock";
const CAPTURE_RECEIPT_RETENTION_HOURS: i64 = 24;
const MAX_CAPTURE_RECEIPTS: usize = 256;
const MAX_OWNED_KEYCHAIN_KEYS: usize = 64;

static KEYCHAIN_BUSY: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
type OcrStdoutReader = thread::JoinHandle<Result<Vec<u8>, String>>;

pub struct AppState {
    credential: Mutex<Option<NativeCredential>>,
    lifecycle_commit: Mutex<()>,
    lifecycle_epoch: AtomicU64,
    verification_gate: tokio::sync::Mutex<()>,
    active_capture: Mutex<Option<ActiveCapture>>,
    active_ocr: Mutex<Option<ActiveOcr>>,
    artifacts: Mutex<HashMap<String, CaptureArtifact>>,
    notification_keys: Mutex<HashSet<String>>,
}

struct NativeCredential {
    binding: PersistentBinding,
    token: Zeroizing<String>,
}

struct VerifiedLease {
    binding: PersistentBinding,
    epoch: u64,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PendingKeychainJournal {
    key_ids: Vec<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PendingRevocation {
    #[serde(default)]
    key_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    key_id: Option<String>,
}

impl AppState {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            credential: Mutex::new(None),
            lifecycle_commit: Mutex::new(()),
            lifecycle_epoch: AtomicU64::new(0),
            verification_gate: tokio::sync::Mutex::new(()),
            active_capture: Mutex::new(None),
            active_ocr: Mutex::new(None),
            artifacts: Mutex::new(HashMap::new()),
            notification_keys: Mutex::new(HashSet::new()),
        })
    }
}

#[derive(Clone)]
struct ActiveCapture {
    account_id: String,
    session_id: String,
    intent_id: String,
    output: PathBuf,
    binding_key_id: Arc<Mutex<Option<String>>>,
    child: Arc<Mutex<Option<Child>>>,
    cancelled: Arc<AtomicBool>,
}

#[derive(Clone)]
struct ActiveOcr {
    account_id: String,
    session_id: String,
    local_handle: String,
    child: Arc<Mutex<Option<Child>>>,
    stdout_reader: Arc<Mutex<Option<OcrStdoutReader>>>,
    cancelled: Arc<AtomicBool>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActiveCaptureMarker {
    pid: u32,
    output: PathBuf,
}

#[derive(Clone)]
struct CaptureArtifact {
    account_id: String,
    session_id: String,
    intent_id: String,
    path: PathBuf,
    expires_at: DateTime<Utc>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CaptureReceiptJournal {
    receipts: Vec<CaptureReceipt>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CaptureReceipt {
    account_id: String,
    session_id: String,
    intent_id: String,
    status: CaptureReceiptStatus,
    retain_until: DateTime<Utc>,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum CaptureReceiptStatus {
    Cancelled,
    Captured,
    Denied,
    Failed,
    Started,
}

#[tauri::command]
pub async fn activate_session_binding(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ActivateBindingRequest,
) -> Result<BindingStatus, String> {
    let _verification = state.verification_gate.lock().await;
    let epoch = state.lifecycle_epoch.fetch_add(1, Ordering::SeqCst) + 1;
    {
        let _commit = lock(&state.lifecycle_commit)?;
        invalidate_native_effects(&app, &state)?;
        recover_pending_revocation(&app)?;
        cleanup_pending_keychain_entries(&app)?;
    }
    let mut verified = verify_backend(
        &request.base_url,
        &request.server_certificate_pem,
        &request.access_token,
        &request.session_id,
    )
    .await
    .map_err(|failure| failure.message().to_string())?;
    let _commit = lock(&state.lifecycle_commit)?;
    assert_epoch(&state, epoch)?;
    let old_key_id = current_binding_key_id(&app, &state);
    verified.key_id = Uuid::new_v4().to_string();
    add_pending_keychain_entry(&app, &verified.key_id)?;
    if let Some(old_key_id) = old_key_id.as_deref() {
        add_pending_keychain_entry(&app, old_key_id)?;
    }
    write_token(
        &verified.key_id,
        Zeroizing::new(request.access_token.clone()),
    )?;
    // The journal remains durable if this fails. A late Keychain write or a
    // crash is recovered without touching the previous committed binding.
    write_binding(&app, &verified)?;
    *lock(&state.credential)? = Some(NativeCredential {
        binding: verified.clone(),
        token: Zeroizing::new(request.access_token),
    });
    // A failed backend verification must leave the old generation's Started
    // receipt intact. Clear it only after the new verified binding commits.
    let mut cleanup_warnings = Vec::new();
    if clear_capture_receipts(&app).is_err() {
        cleanup_warnings.push(
            "旧窗口采集回执尚未确认清理；窗口采集保持失败关闭，后续状态检查可重试。".to_string(),
        );
    }
    // Keep the committed key in the durable inventory. If binding metadata is
    // later corrupt or missing, disconnect can still locate and delete every
    // bearer owned by this app.
    if let Some(old_key_id) = old_key_id.filter(|value| value != &verified.key_id) {
        match delete_token(&old_key_id) {
            Ok(()) => {
                if remove_pending_keychain_entry(&app, &old_key_id).is_err() {
                    cleanup_warnings.push(
                        "旧 Keychain 令牌已删除，但本机令牌索引尚未确认更新；后续状态检查会继续清理。"
                            .to_string(),
                    );
                }
            }
            Err(_) => cleanup_warnings.push(
                "旧 Keychain 令牌尚未确认删除；新连接可用，但后续状态检查会继续清理。".to_string(),
            ),
        }
    }
    Ok(verified
        .status_with_warning((!cleanup_warnings.is_empty()).then(|| cleanup_warnings.join(" "))))
}

#[tauri::command]
pub async fn session_binding_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BindingStatus, String> {
    let _verification = state.verification_gate.lock().await;
    let epoch = state.lifecycle_epoch.load(Ordering::SeqCst);
    let pending_cleanup_error = {
        let _commit = lock(&state.lifecycle_commit)?;
        assert_epoch(&state, epoch)?;
        if let Some(status) = recover_pending_revocation_status(&app, &state)? {
            return Ok(status);
        }
        cleanup_pending_keychain_entries(&app).err()
    };
    let persisted = match read_binding(&app)? {
        Some(value) => value,
        None => {
            *lock(&state.credential)? = None;
            return Ok(BindingStatus::Unbound {
                reason: pending_cleanup_error,
            });
        }
    };
    if validate_uuid("Keychain binding", &persisted.key_id).is_err() {
        *lock(&state.credential)? = None;
        return Ok(BindingStatus::Unbound {
            reason: Some("旧的本机连接不包含可核验的 Keychain 引用，请重新连接。".into()),
        });
    }
    let cached_token = lock(&state.credential)?.as_ref().and_then(|credential| {
        same_binding_identity(&credential.binding, &persisted).then(|| credential.token.clone())
    });
    let token = match cached_token {
        Some(value) => value,
        None => match read_token(&persisted.key_id) {
            Ok(value) => value,
            Err(error) => {
                *lock(&state.credential)? = None;
                return Ok(BindingStatus::Unbound {
                    reason: Some(error),
                });
            }
        },
    };
    match verify_backend(
        &persisted.base_url,
        &persisted.server_certificate_pem,
        token.as_str(),
        &persisted.session_id,
    )
    .await
    {
        Ok(verified) => {
            let verified = PersistentBinding {
                key_id: persisted.key_id.clone(),
                ..verified
            };
            let _commit = lock(&state.lifecycle_commit)?;
            assert_epoch_and_binding(&app, &state, epoch, &persisted)?;
            write_binding(&app, &verified)?;
            *lock(&state.credential)? = Some(NativeCredential {
                binding: verified.clone(),
                token,
            });
            Ok(verified.status_with_warning(pending_cleanup_error))
        }
        Err(failure) => {
            let _commit = lock(&state.lifecycle_commit)?;
            assert_epoch_and_binding(&app, &state, epoch, &persisted)?;
            advance_epoch_after_verification_failure(&state, epoch)?;
            invalidate_native_effects(&app, &state)?;
            Ok(failure.status())
        }
    }
}

#[tauri::command]
pub fn disconnect_session_binding(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BindingStatus, String> {
    state.lifecycle_epoch.fetch_add(1, Ordering::SeqCst);
    let _commit = lock(&state.lifecycle_commit)?;
    let key_id = current_binding_key_id(&app, &state);
    let pending_journal = read_pending_keychain_journal(&app);
    let mut revocation_keys = pending_journal
        .as_ref()
        .map(|journal| journal.key_ids.clone())
        .unwrap_or_default();
    if let Some(key_id) = key_id.as_ref()
        && !revocation_keys.contains(key_id)
    {
        revocation_keys.push(key_id.clone());
    }
    write_pending_revocation(&app, &revocation_keys)?;
    invalidate_native_effects(&app, &state)?;
    if pending_journal.is_err() {
        return Ok(BindingStatus::Revoked {
            reason: "Keychain 清理记录不可读取；原生能力已停用，但无法确认所有旧令牌已删除。"
                .into(),
        });
    }
    let path = binding_path(&app)?;
    let mut warnings = Vec::new();
    let retained_keys = failed_keychain_deletions(&revocation_keys, delete_token)?;
    let token_removed = retained_keys.is_empty();
    if !token_removed {
        for pending_key in &retained_keys {
            add_pending_keychain_entry(&app, pending_key)?;
        }
        warnings.push("Keychain 令牌未能确认删除");
    }
    let inventory_removed =
        token_removed && remove_keychain_inventory_entries(&app, &revocation_keys).is_ok();
    if !inventory_removed {
        warnings.push("Keychain 令牌索引未能确认清除");
    }
    let mut binding_removed = true;
    if remove_file_confirmed(&path, "本机连接记录").is_err() {
        binding_removed = false;
        warnings.push("本机连接记录未能确认删除");
    }
    let receipt_removed = clear_capture_receipts(&app).is_ok();
    if !receipt_removed {
        warnings.push("窗口采集意图回执未能确认删除");
    }
    *lock(&state.credential)? = None;

    // Revocation remains durable until every current or superseded bearer and
    // the binding metadata have both been confirmed removed.
    if !token_removed || !inventory_removed || !binding_removed || !receipt_removed {
        return Ok(BindingStatus::Revoked {
            reason: format!(
                "本机连接已停用，但{}；重启或重试断开前不会恢复原生能力。",
                warnings.join("，")
            ),
        });
    }
    if clear_pending_revocation(&app).is_err() {
        return Ok(BindingStatus::Revoked {
            reason: "本机凭据与连接已清理，但解绑恢复记录未能确认删除；原生能力保持关闭。".into(),
        });
    }
    Ok(BindingStatus::Unbound {
        reason: (!warnings.is_empty()).then(|| format!("已断开；{}。", warnings.join("，"))),
    })
}

#[tauri::command]
pub fn desktop_capabilities(app: AppHandle) -> CapabilityReport {
    let capture = if screen_capture_permission_granted() {
        CapabilityAvailability::Available
    } else {
        CapabilityAvailability::PermissionRequired
    };
    CapabilityReport {
        window_capture: capture,
        local_ocr: if vision_binary_path(&app).is_ok() {
            CapabilityAvailability::Available
        } else {
            CapabilityAvailability::Unavailable
        },
        quick_panel: CapabilityAvailability::Available,
        notification: CapabilityAvailability::Available,
    }
}

#[tauri::command]
pub async fn capture_selected_window(
    app: AppHandle,
    state: State<'_, AppState>,
    request: CaptureRequest,
) -> Result<CaptureResult, String> {
    let intent_id = canonical_uuid("intentId", &request.intent_id)?;
    let account_id = canonical_uuid("accountId", &request.account_id)?;
    let session_id = canonical_uuid("sessionId", &request.session_id)?;
    purge_expired_artifacts(&state)?;
    let output_dir = capture_directory(&app)?;
    let output = output_dir.join(format!("{}.png", Uuid::new_v4()));

    let active = ActiveCapture {
        account_id: account_id.clone(),
        session_id: session_id.clone(),
        intent_id: intent_id.clone(),
        output: output.clone(),
        binding_key_id: Arc::new(Mutex::new(None)),
        child: Arc::new(Mutex::new(None)),
        cancelled: Arc::new(AtomicBool::new(false)),
    };
    {
        let mut slot = lock(&state.active_capture)?;
        if let Some(current) = slot.as_ref() {
            if same_capture_request(current, &account_id, &session_id, &intent_id) {
                return Err("同一窗口采集意图仍在系统选择器中；保留该意图，稍后重试核验。".into());
            }
            return Ok(CaptureResult::Failed {
                reason: "已有窗口采集正在进行；未启动第二次系统选择。".into(),
            });
        }
        *slot = Some(active.clone());
    }

    let verified = match require_verified_scope(&app, &state, &request.scope()).await {
        Ok(verified) => verified,
        Err(error) => {
            let _ = release_capture_reservation(&state, &active)?;
            return Err(error);
        }
    };
    *lock(&active.binding_key_id)? = Some(verified.binding.key_id.clone());
    if active.cancelled.load(Ordering::SeqCst) {
        return finish_cancelled_capture(&app, &state, &active);
    }
    let replay = match lock(&state.artifacts) {
        Ok(artifacts) => {
            replay_capture_for_intent(&artifacts, &account_id, &session_id, &intent_id)
        }
        Err(error) => {
            let _ = release_capture_reservation(&state, &active)?;
            return Err(error);
        }
    };
    if let Some(replay) = replay {
        return finish_replayed_capture(&state, &active, replay);
    }
    match replay_capture_receipt(&app, &active) {
        Ok(Some(replay)) => return finish_replayed_capture(&state, &active, replay),
        Ok(None) => {}
        Err(error) => {
            let _ = release_capture_reservation(&state, &active)?;
            return Err(error);
        }
    }
    if let Err(reason) = enforce_capture_quota(&state, 0) {
        return finish_capture_without_artifact(
            &app,
            &state,
            &active,
            CaptureResult::Failed { reason },
        );
    }
    let effect_commit = lock(&state.lifecycle_commit)?;
    assert_epoch_and_binding(&app, &state, verified.epoch, &verified.binding)?;
    if !lock(&state.active_capture)?
        .as_ref()
        .is_some_and(|current| same_capture(current, &active))
    {
        return Ok(CaptureResult::Cancelled);
    }
    if active.cancelled.load(Ordering::SeqCst) {
        return finish_cancelled_capture(&app, &state, &active);
    }
    if let Err(error) = claim_capture_intent(
        &app,
        &active.account_id,
        &active.session_id,
        &active.intent_id,
        &verified.binding.key_id,
    ) {
        let _ = release_capture_reservation(&state, &active)?;
        return Err(error);
    }

    let child = match Command::new("/usr/sbin/screencapture")
        .args(["-i", "-W", "-x"])
        .arg(&output)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => {
            return finish_capture_without_artifact(
                &app,
                &state,
                &active,
                CaptureResult::Failed {
                    reason: "无法启动系统窗口选择器。".into(),
                },
            );
        }
    };
    if let Err(error) = write_capture_marker(&app, child.id(), &output) {
        *lock(&active.child)? = Some(child);
        active.cancelled.store(true, Ordering::SeqCst);
        terminate_child(&active.child, "系统窗口选择器")?;
        return finish_capture_without_artifact(
            &app,
            &state,
            &active,
            CaptureResult::Failed { reason: error },
        );
    }
    {
        let mut child_slot = lock(&active.child)?;
        *child_slot = Some(child);
    }
    drop(effect_commit);
    if active.cancelled.load(Ordering::SeqCst) {
        terminate_child(&active.child, "系统窗口选择器")?;
        return finish_cancelled_capture(&app, &state, &active);
    }

    let wait_capture = active.clone();
    let exit =
        match tauri::async_runtime::spawn_blocking(move || wait_for_capture(&wait_capture)).await {
            Ok(exit) => exit,
            Err(_) => {
                active.cancelled.store(true, Ordering::SeqCst);
                terminate_child(&active.child, "系统窗口选择器")?;
                return finish_capture_without_artifact(
                    &app,
                    &state,
                    &active,
                    CaptureResult::Failed {
                        reason: "系统窗口选择器异常结束。".into(),
                    },
                );
            }
        };
    match exit {
        CaptureExit::TerminationUnconfirmed(reason) => Err(reason),
        CaptureExit::Cancelled => {
            let _ = clear_capture_marker(&app);
            finish_cancelled_capture(&app, &state, &active)
        }
        CaptureExit::Failed => {
            let _ = clear_capture_marker(&app);
            let result = if screen_capture_permission_granted() {
                CaptureResult::Failed {
                    reason: "系统没有生成窗口图像。".into(),
                }
            } else {
                CaptureResult::Denied {
                    reason: "macOS 屏幕录制权限未授予。".into(),
                }
            };
            finish_capture_without_artifact(&app, &state, &active, result)
        }
        CaptureExit::Succeeded => {
            let _ = clear_capture_marker(&app);
            if active.cancelled.load(Ordering::SeqCst) {
                return finish_cancelled_capture(&app, &state, &active);
            }
            if let Err(reason) = secure_capture_file(&output) {
                return finish_capture_without_artifact(
                    &app,
                    &state,
                    &active,
                    CaptureResult::Failed { reason },
                );
            }
            let byte_size = fs::metadata(&output).map(|value| value.len()).unwrap_or(0);
            if byte_size == 0 || byte_size > MAX_CAPTURE_BYTES {
                return finish_capture_without_artifact(
                    &app,
                    &state,
                    &active,
                    CaptureResult::Failed {
                        reason: "窗口图像为空或超过 12 MB 上限。".into(),
                    },
                );
            }
            if let Err(reason) = enforce_capture_quota(&state, byte_size) {
                return finish_capture_without_artifact(
                    &app,
                    &state,
                    &active,
                    CaptureResult::Failed { reason },
                );
            }
            if let Err(error) = require_verified_scope(&app, &state, &request.scope()).await {
                finish_capture_without_artifact(
                    &app,
                    &state,
                    &active,
                    CaptureResult::Failed {
                        reason: "Session 在采集期间失效；窗口图像已删除。".into(),
                    },
                )?;
                return Err(error);
            }
            if active.cancelled.load(Ordering::SeqCst) {
                return finish_cancelled_capture(&app, &state, &active);
            }
            let handle = Uuid::new_v4().to_string();
            let expires_at = Utc::now() + chrono::Duration::minutes(CAPTURE_TTL_MINUTES);
            let mut active_slot = lock(&state.active_capture)?;
            if active.cancelled.load(Ordering::SeqCst)
                || active_slot
                    .as_ref()
                    .is_none_or(|value| value.intent_id != intent_id)
            {
                drop(active_slot);
                return finish_cancelled_capture(&app, &state, &active);
            }
            let result = CaptureResult::Captured {
                local_handle: handle.clone(),
                expires_at: expires_at.to_rfc3339(),
            };
            if let Err(error) = record_capture_receipt(&app, &active, &result) {
                active.cancelled.store(true, Ordering::SeqCst);
                remove_file_confirmed(&output, "窗口采集缓存")?;
                *active_slot = None;
                return Err(error);
            }
            lock(&state.artifacts)?.insert(
                handle.clone(),
                CaptureArtifact {
                    account_id,
                    session_id,
                    intent_id,
                    path: output,
                    expires_at,
                },
            );
            *active_slot = None;
            Ok(result)
        }
    }
}

#[tauri::command]
pub fn cancel_capture(
    app: AppHandle,
    state: State<'_, AppState>,
    request: CaptureRequest,
) -> Result<CaptureResult, String> {
    let intent_id = canonical_uuid("intentId", &request.intent_id)?;
    let account_id = canonical_uuid("accountId", &request.account_id)?;
    let session_id = canonical_uuid("sessionId", &request.session_id)?;
    let _commit = lock(&state.lifecycle_commit)?;
    let mut slot = lock(&state.active_capture)?;
    let Some(active) = slot.as_ref() else {
        if matches!(
            capture_receipt_status(&app, &account_id, &session_id, &intent_id)?,
            Some(CaptureReceiptStatus::Started)
        ) {
            return Err(
                "上次采集的进程状态不可恢复，未确认取消；已保留同一意图且不会重启选择器，任何迟到图像会被清理。"
                    .into(),
            );
        }
        return Ok(CaptureResult::Failed {
            reason: "没有正在进行的同一采集意图；未确认取消。".into(),
        });
    };
    if active.account_id != account_id
        || active.session_id != session_id
        || active.intent_id != intent_id
    {
        return Err("取消请求与正在进行的采集意图不一致。".into());
    }
    active.cancelled.store(true, Ordering::SeqCst);
    terminate_child(&active.child, "系统窗口选择器")?;
    remove_file_confirmed(&active.output, "窗口采集缓存")?;
    let _ = clear_capture_marker(&app);
    record_capture_receipt(&app, active, &CaptureResult::Cancelled)?;
    *slot = None;
    Ok(CaptureResult::Cancelled)
}

#[tauri::command]
pub async fn recognize_local_text(
    app: AppHandle,
    state: State<'_, AppState>,
    request: OcrRequest,
) -> Result<OcrResult, String> {
    validate_uuid("localHandle", &request.local_handle)?;
    let account_id = canonical_uuid("accountId", &request.account_id)?;
    let session_id = canonical_uuid("sessionId", &request.session_id)?;
    purge_expired_artifacts(&state)?;
    let artifact = lock(&state.artifacts)?
        .get(&request.local_handle)
        .cloned()
        .ok_or_else(|| "采集句柄不存在或已经过期。".to_string())?;
    if artifact.account_id != account_id || artifact.session_id != session_id {
        return Ok(OcrResult::Denied {
            reason: "采集句柄不属于当前账号与 Session。".into(),
        });
    }
    let active = ActiveOcr {
        account_id,
        session_id,
        local_handle: request.local_handle.clone(),
        child: Arc::new(Mutex::new(None)),
        stdout_reader: Arc::new(Mutex::new(None)),
        cancelled: Arc::new(AtomicBool::new(false)),
    };
    {
        let mut slot = lock(&state.active_ocr)?;
        if slot.is_some() {
            return Ok(OcrResult::Failed {
                reason: "已有本地识别正在进行；未启动第二个 helper。".into(),
            });
        }
        *slot = Some(active.clone());
    }
    let verified = match require_verified_scope(&app, &state, &request.scope()).await {
        Ok(verified) => verified,
        Err(error) => {
            finish_ocr(&state, &active)?;
            return Err(error);
        }
    };
    let binary = match vision_binary_path(&app) {
        Ok(binary) => binary,
        Err(reason) => {
            finish_ocr(&state, &active)?;
            return Ok(OcrResult::Failed { reason });
        }
    };
    let effect_commit = lock(&state.lifecycle_commit)?;
    if let Err(error) = assert_epoch_and_binding(&app, &state, verified.epoch, &verified.binding) {
        finish_ocr(&state, &active)?;
        return Err(error);
    }
    if !lock(&state.active_ocr)?
        .as_ref()
        .is_some_and(|current| same_ocr(current, &active))
        || active.cancelled.load(Ordering::SeqCst)
    {
        finish_ocr(&state, &active)?;
        return Ok(OcrResult::Cancelled);
    }
    let mut child = match Command::new(binary)
        .arg(&artifact.path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => {
            finish_ocr(&state, &active)?;
            return Ok(OcrResult::Failed {
                reason: "无法启动本地 Vision helper。".into(),
            });
        }
    };
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        finish_ocr(&state, &active)?;
        return Ok(OcrResult::Failed {
            reason: "无法读取本地 Vision helper 输出。".into(),
        });
    };
    *lock(&active.stdout_reader)? = Some(spawn_capped_stdout_reader(stdout));
    {
        let mut slot = lock(&active.child)?;
        *slot = Some(child);
    }
    drop(effect_commit);
    let waiter = active.clone();
    let output = match tauri::async_runtime::spawn_blocking(move || wait_for_ocr(&waiter)).await {
        Ok(result) => result,
        Err(_) => {
            active.cancelled.store(true, Ordering::SeqCst);
            match terminate_child(&active.child, "本地 Vision helper") {
                Ok(()) => {
                    let _ = finish_ocr_stdout_reader(&active);
                    OcrProcessExit::Failed("本地 Vision helper 异常结束。".into())
                }
                Err(reason) => OcrProcessExit::TerminationUnconfirmed(reason),
            }
        }
    };
    let output = match output {
        OcrProcessExit::Cancelled => {
            return finish_ocr_result(&state, &active, OcrResult::Cancelled);
        }
        OcrProcessExit::Failed(reason) => {
            return finish_ocr_result(&state, &active, OcrResult::Failed { reason });
        }
        OcrProcessExit::TerminationUnconfirmed(reason) => return Err(reason),
        OcrProcessExit::Completed(output) => output,
    };
    if let Err(error) = require_verified_scope(&app, &state, &request.scope()).await {
        finish_ocr(&state, &active)?;
        return Err(format!("Session 在识别期间失效；未返回识别文本。{error}"));
    }

    let helper = serde_json::from_slice::<VisionHelperResult>(&output.stdout).ok();
    if !output.status.success() {
        return finish_ocr_result(
            &state,
            &active,
            OcrResult::Failed {
                reason: helper
                    .and_then(|value| value.reason)
                    .unwrap_or_else(|| "本地 Vision 识别失败；没有云端回退。".into()),
            },
        );
    }
    let Some(text) = helper.and_then(|value| value.text) else {
        return finish_ocr_result(
            &state,
            &active,
            OcrResult::Failed {
                reason: "本地 Vision 没有返回文字；没有云端回退。".into(),
            },
        );
    };
    if text.trim().is_empty() || text.chars().count() > 12_000 {
        return finish_ocr_result(
            &state,
            &active,
            OcrResult::Failed {
                reason: "本地 Vision 输出为空或超过 12,000 字上限。".into(),
            },
        );
    }
    finish_ocr_result(
        &state,
        &active,
        OcrResult::Recognized {
            local_text: text,
            is_provisional: true,
        },
    )
}

#[tauri::command]
pub fn cancel_ocr(state: State<'_, AppState>, request: OcrRequest) -> Result<OcrResult, String> {
    validate_uuid("localHandle", &request.local_handle)?;
    let account_id = canonical_uuid("accountId", &request.account_id)?;
    let session_id = canonical_uuid("sessionId", &request.session_id)?;
    cancel_matching_ocr(&state, &account_id, &session_id, &request.local_handle)
}

fn cancel_matching_ocr(
    state: &AppState,
    account_id: &str,
    session_id: &str,
    local_handle: &str,
) -> Result<OcrResult, String> {
    let _commit = lock(&state.lifecycle_commit)?;
    let slot = lock(&state.active_ocr)?;
    let Some(active) = slot.as_ref() else {
        return Ok(OcrResult::Failed {
            reason: "没有正在进行的同一本地识别；未确认取消。".into(),
        });
    };
    if active.account_id != account_id
        || active.session_id != session_id
        || active.local_handle != local_handle
    {
        return Err("取消请求与正在进行的本地识别不一致。".into());
    }
    active.cancelled.store(true, Ordering::SeqCst);
    terminate_child(&active.child, "本地 Vision helper")?;
    Ok(OcrResult::Cancelled)
}

#[tauri::command]
pub async fn open_quick_panel(
    app: AppHandle,
    state: State<'_, AppState>,
    request: QuickPanelRequest,
) -> Result<QuickPanelResult, String> {
    canonical_uuid("activityId", &request.activity_id)?;
    if request.label.chars().count() > 120 {
        return Err("快捷面板标签过长。".into());
    }
    let verified = require_verified_scope(&app, &state, &request.scope()).await?;
    let _commit = lock(&state.lifecycle_commit)?;
    assert_epoch_and_binding(&app, &state, verified.epoch, &verified.binding)?;

    if let Some(panel) = app.get_webview_window("quick-panel") {
        panel.show().map_err(|_| "无法显示快捷面板。".to_string())?;
        panel
            .set_focus()
            .map_err(|_| "无法聚焦快捷面板。".to_string())?;
        return Ok(QuickPanelResult::Opened {
            panel_id: "quick-panel".into(),
        });
    }
    WebviewWindowBuilder::new(
        &app,
        "quick-panel",
        WebviewUrl::App("quick-panel.html".into()),
    )
    .title("继续当前 Session")
    .inner_size(420.0, 260.0)
    .min_inner_size(360.0, 220.0)
    .resizable(false)
    .always_on_top(true)
    .center()
    .build()
    .map_err(|_| "无法创建本地快捷面板。".to_string())?;
    Ok(QuickPanelResult::Opened {
        panel_id: "quick-panel".into(),
    })
}

#[tauri::command]
pub async fn notify_state(
    app: AppHandle,
    state: State<'_, AppState>,
    request: NotificationRequest,
) -> Result<NotificationResult, String> {
    let verified = require_verified_scope(&app, &state, &request.scope()).await?;
    let _commit = lock(&state.lifecycle_commit)?;
    assert_epoch_and_binding(&app, &state, verified.epoch, &verified.binding)?;
    let key = notification_dedupe_key(
        &request.account_id,
        &request.session_id,
        &request.activity_id,
        request.state,
    )?;
    {
        let mut keys = lock(&state.notification_keys)?;
        if !keys.insert(key.clone()) {
            return Ok(NotificationResult::Suppressed {
                reason: "相同 Session 状态的系统投递请求已经提交。".into(),
            });
        }
    }
    let body = match request.state {
        NotificationState::Ready => "当前 Session 的本机草稿已就绪。",
        NotificationState::Failed => "当前 Session 的本机处理失败。",
    };
    if app
        .notification()
        .builder()
        .title("capri")
        .body(body)
        .show()
        .is_err()
    {
        lock(&state.notification_keys)?.remove(&key);
        return Ok(NotificationResult::Denied {
            reason: "系统未接受通知请求；没有泄露 Session 内容。".into(),
        });
    }
    Ok(NotificationResult::Requested)
}

fn notification_dedupe_key(
    account_id: &str,
    session_id: &str,
    activity_id: &str,
    state: NotificationState,
) -> Result<String, String> {
    let account_id = canonical_uuid("accountId", account_id)?;
    let session_id = canonical_uuid("sessionId", session_id)?;
    let activity_id = canonical_uuid("activityId", activity_id)?;
    let state_name = match state {
        NotificationState::Ready => "ready",
        NotificationState::Failed => "failed",
    };
    Ok(format!(
        "{account_id}:{session_id}:{activity_id}:{state_name}"
    ))
}

async fn require_verified_scope(
    app: &AppHandle,
    state: &State<'_, AppState>,
    scope: &PlatformScope,
) -> Result<VerifiedLease, String> {
    let _verification = state.verification_gate.lock().await;
    let epoch = state.lifecycle_epoch.load(Ordering::SeqCst);
    {
        let _commit = lock(&state.lifecycle_commit)?;
        assert_epoch(state, epoch)?;
        if read_pending_revocation(app)?.is_some() {
            return Err("本机连接存在未完成的撤销记录；原生能力保持关闭。".into());
        }
    }
    let persisted =
        read_binding(app)?.ok_or_else(|| "没有已核验的本机 Session 连接。".to_string())?;
    let token = if let Some(credential) = lock(&state.credential)?.as_ref() {
        if !same_binding_identity(&credential.binding, &persisted) {
            return Err("磁盘中的本机连接已变更；缓存凭据未被使用。".into());
        }
        credential.token.clone()
    } else {
        read_token(&persisted.key_id)?
    };
    persisted.assert_scope(scope)?;
    validate_uuid("Keychain binding", &persisted.key_id)?;
    let verified_result = verify_backend(
        &persisted.base_url,
        &persisted.server_certificate_pem,
        token.as_str(),
        &persisted.session_id,
    )
    .await;
    let verified = match verified_result {
        Ok(value) => value,
        Err(failure) => {
            let message = failure.message().to_string();
            let _commit = lock(&state.lifecycle_commit)?;
            assert_epoch_and_binding(app, state, epoch, &persisted)?;
            advance_epoch_after_verification_failure(state, epoch)?;
            invalidate_native_effects(app, state)?;
            return Err(message);
        }
    };
    let verified = PersistentBinding {
        key_id: persisted.key_id.clone(),
        ..verified
    };
    verified.assert_scope(scope)?;
    let _commit = lock(&state.lifecycle_commit)?;
    assert_epoch_and_binding(app, state, epoch, &persisted)?;
    if read_pending_revocation(app)?.is_some() {
        return Err("本机连接在核验期间进入撤销状态；原生能力保持关闭。".into());
    }
    write_binding(app, &verified)?;
    *lock(&state.credential)? = Some(NativeCredential {
        binding: verified.clone(),
        token,
    });
    Ok(VerifiedLease {
        binding: verified,
        epoch,
    })
}

fn assert_epoch(state: &AppState, expected: u64) -> Result<(), String> {
    if state.lifecycle_epoch.load(Ordering::SeqCst) != expected {
        return Err("本机连接已在核验期间变更；旧结果未提交。".into());
    }
    Ok(())
}

fn advance_epoch_after_verification_failure(
    state: &AppState,
    verified_epoch: u64,
) -> Result<(), String> {
    assert_epoch(state, verified_epoch)?;
    state.lifecycle_epoch.fetch_add(1, Ordering::SeqCst);
    Ok(())
}

fn same_binding_identity(left: &PersistentBinding, right: &PersistentBinding) -> bool {
    left.key_id == right.key_id
        && left.account_id == right.account_id
        && left.user_id == right.user_id
        && left.session_id == right.session_id
        && left.base_url == right.base_url
        && left.server_certificate_pem == right.server_certificate_pem
}

fn assert_epoch_and_binding(
    app: &AppHandle,
    state: &AppState,
    expected_epoch: u64,
    expected_binding: &PersistentBinding,
) -> Result<(), String> {
    assert_epoch(state, expected_epoch)?;
    if read_pending_revocation(app)?.is_some() {
        return Err("本机连接正在撤销；旧核验结果未提交。".into());
    }
    if let Some(current) = lock(&state.credential)?.as_ref()
        && !same_binding_identity(&current.binding, expected_binding)
    {
        return Err("本机连接作用域已变更；旧核验结果未提交。".into());
    }
    match read_binding(app)? {
        Some(current) if same_binding_identity(&current, expected_binding) => {}
        _ => return Err("磁盘中的本机连接已移除或变更；旧核验结果未提交。".into()),
    }
    Ok(())
}

fn current_binding_key_id(app: &AppHandle, state: &AppState) -> Option<String> {
    lock(&state.credential)
        .ok()
        .and_then(|credential| {
            credential
                .as_ref()
                .map(|value| value.binding.key_id.clone())
        })
        .or_else(|| read_binding(app).ok().flatten().map(|value| value.key_id))
}

fn close_quick_panel(app: &AppHandle) {
    if let Some(panel) = app.get_webview_window("quick-panel") {
        let _ = panel.close();
    }
}

fn invalidate_native_effects(app: &AppHandle, state: &AppState) -> Result<(), String> {
    *lock(&state.credential)? = None;
    close_quick_panel(app);
    let mut errors = Vec::new();
    if let Err(error) = cancel_any_capture(app, state) {
        errors.push(error);
    }
    if let Err(error) = cancel_any_ocr(state) {
        errors.push(error);
    }
    if let Err(error) = cleanup_artifacts(state) {
        errors.push(error);
    }
    match lock(&state.notification_keys) {
        Ok(mut keys) => keys.clear(),
        Err(error) => errors.push(error),
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("；"))
    }
}

fn token_entry(key_id: &str) -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, &format!("binding-{key_id}"))
        .map_err(|_| "无法访问 macOS Keychain。".to_string())
}

fn read_token(key_id: &str) -> Result<Zeroizing<String>, String> {
    let token = keychain_operation(key_id, |entry| {
        entry
            .get_password()
            .map(Zeroizing::new)
            .map_err(keychain_read_error)
    })?;
    validate_token(&token)?;
    Ok(token)
}

fn keychain_read_error(error: KeyringError) -> String {
    match error {
        KeyringError::NoEntry => "Keychain 中没有可用的本机连接令牌。".to_string(),
        KeyringError::NoStorageAccess(_) => {
            "macOS Keychain 当前不可访问；本机连接保持关闭，请解锁 Keychain 后重试。".to_string()
        }
        _ => "无法从 macOS Keychain 读取本机连接令牌；本机连接保持关闭。".to_string(),
    }
}

fn write_token(key_id: &str, token: Zeroizing<String>) -> Result<(), String> {
    keychain_operation(key_id, move |entry| {
        entry
            .set_password(&token)
            .map_err(|_| "无法将令牌写入 macOS Keychain。".to_string())
    })
}

fn delete_token(key_id: &str) -> Result<(), String> {
    keychain_operation(key_id, |entry| match entry.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(_) => Err("无法删除 Keychain 中的本机令牌。".to_string()),
    })
}

fn keychain_operation<T, F>(key_id: &str, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(Entry) -> Result<T, String> + Send + 'static,
{
    validate_uuid("Keychain binding", key_id)?;
    let key_id = key_id.to_string();
    let busy = KEYCHAIN_BUSY.get_or_init(|| Mutex::new(HashSet::new()));
    {
        let mut operations = busy
            .lock()
            .map_err(|_| "Keychain 状态暂时不可用。".to_string())?;
        if !operations.insert(key_id.clone()) {
            return Err("该本机连接的 Keychain 操作仍在处理中。".into());
        }
    }

    let (sender, receiver) = mpsc::sync_channel(1);
    let worker_key = key_id.clone();
    thread::spawn(move || {
        let result = token_entry(&worker_key).and_then(operation);
        if let Ok(mut operations) = KEYCHAIN_BUSY
            .get_or_init(|| Mutex::new(HashSet::new()))
            .lock()
        {
            operations.remove(&worker_key);
        }
        let _ = sender.send(result);
    });

    receiver
        .recv_timeout(Duration::from_secs(KEYCHAIN_TIMEOUT_SECONDS))
        .map_err(|_| "macOS Keychain 未在 3 秒内响应；未扩大任何本机权限。".to_string())?
}

fn binding_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|_| "无法解析 App 配置目录。".to_string())?
        .join(BINDING_FILE))
}

fn pending_keychain_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|_| "无法解析 App 配置目录。".to_string())?
        .join(PENDING_KEYCHAIN_FILE))
}

fn revocation_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|_| "无法解析 App 配置目录。".to_string())?
        .join(REVOCATION_FILE))
}

fn write_pending_revocation(app: &AppHandle, key_ids: &[String]) -> Result<(), String> {
    let key_ids = normalize_owned_key_ids(key_ids.to_vec())?;
    let path = revocation_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "解绑恢复记录路径无效。".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "无法创建 App 配置目录。".to_string())?;
    let bytes = serde_json::to_vec(&PendingRevocation {
        key_ids,
        key_id: None,
    })
    .map_err(|_| "无法编码解绑恢复记录。".to_string())?;
    atomic_write_private_file(&path, &bytes)
}

fn read_pending_revocation(app: &AppHandle) -> Result<Option<PendingRevocation>, String> {
    match read_private_file(&revocation_path(app)?, "解绑恢复记录")? {
        Some(bytes) => {
            let pending = serde_json::from_slice::<PendingRevocation>(&bytes)
                .map_err(|_| "解绑恢复记录损坏；本机连接保持关闭。".to_string())?;
            let mut key_ids = pending.key_ids;
            if let Some(legacy_key_id) = pending.key_id {
                key_ids.push(legacy_key_id);
            }
            Ok(Some(PendingRevocation {
                key_ids: normalize_owned_key_ids(key_ids)?,
                key_id: None,
            }))
        }
        None => Ok(None),
    }
}

fn clear_pending_revocation(app: &AppHandle) -> Result<(), String> {
    remove_file_confirmed(&revocation_path(app)?, "解绑恢复记录")
}

fn recover_pending_revocation(app: &AppHandle) -> Result<(), String> {
    let Some(pending) = read_pending_revocation(app)? else {
        return Ok(());
    };
    let key_ids = pending.key_ids;
    if read_binding(app)?
        .as_ref()
        .is_some_and(|binding| !key_ids.contains(&binding.key_id))
    {
        return Err("解绑恢复记录与当前连接不一致；本机连接保持关闭。".into());
    }
    let retained_keys = failed_keychain_deletions(&key_ids, delete_token)?;
    let token_removed = retained_keys.is_empty();
    let binding_removed =
        remove_file_confirmed(&binding_path(app)?, "已撤销的本机连接记录").is_ok();
    let receipt_removed = clear_capture_receipts(app).is_ok();
    let inventory_removed =
        token_removed && remove_keychain_inventory_entries(app, &key_ids).is_ok();
    if token_removed && inventory_removed && binding_removed && receipt_removed {
        clear_pending_revocation(app)?;
        Ok(())
    } else {
        for key_id in retained_keys {
            add_pending_keychain_entry(app, &key_id)?;
        }
        Err("上一次解绑尚未完成；本机连接保持关闭，请重试。".into())
    }
}

fn recover_pending_revocation_status(
    app: &AppHandle,
    state: &AppState,
) -> Result<Option<BindingStatus>, String> {
    if read_pending_revocation(app)?.is_none() {
        return Ok(None);
    }
    Ok(Some(revocation_recovery_status(
        invalidate_native_effects(app, state),
        || recover_pending_revocation(app),
    )))
}

fn revocation_recovery_status<F>(
    native_cleanup: Result<(), String>,
    recover_durable_state: F,
) -> BindingStatus
where
    F: FnOnce() -> Result<(), String>,
{
    if let Err(reason) = native_cleanup {
        return BindingStatus::Revoked {
            reason: format!(
                "上一次解绑的本机进程或敏感缓存尚未确认清理：{reason}；原生能力保持关闭。"
            ),
        };
    }
    match recover_durable_state() {
        Ok(()) => BindingStatus::Unbound {
            reason: Some("已完成上一次未结束的本机解绑。".into()),
        },
        Err(reason) => BindingStatus::Revoked { reason },
    }
}

fn read_pending_keychain_journal(app: &AppHandle) -> Result<PendingKeychainJournal, String> {
    let path = pending_keychain_path(app)?;
    match read_private_file(&path, "Keychain 清理记录")? {
        Some(bytes) => {
            let journal = serde_json::from_slice::<PendingKeychainJournal>(&bytes)
                .map_err(|_| "Keychain 清理记录损坏；没有创建新的本机连接。".to_string())?;
            Ok(PendingKeychainJournal {
                key_ids: normalize_owned_key_ids(journal.key_ids)?,
            })
        }
        None => Ok(PendingKeychainJournal::default()),
    }
}

fn write_pending_keychain_journal(
    app: &AppHandle,
    journal: &PendingKeychainJournal,
) -> Result<(), String> {
    let journal = PendingKeychainJournal {
        key_ids: normalize_owned_key_ids(journal.key_ids.clone())?,
    };
    let path = pending_keychain_path(app)?;
    if journal.key_ids.is_empty() {
        return remove_file_confirmed(&path, "Keychain 清理记录");
    }
    let parent = path
        .parent()
        .ok_or_else(|| "Keychain 清理记录路径无效。".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "无法创建 App 配置目录。".to_string())?;
    let bytes =
        serde_json::to_vec(&journal).map_err(|_| "无法编码 Keychain 清理记录。".to_string())?;
    atomic_write_private_file(&path, &bytes)
}

fn normalize_owned_key_ids(key_ids: Vec<String>) -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for key_id in key_ids {
        validate_uuid("Keychain binding", &key_id)?;
        if seen.insert(key_id.clone()) {
            normalized.push(key_id);
            if normalized.len() > MAX_OWNED_KEYCHAIN_KEYS {
                return Err(format!(
                    "本机令牌索引超过 {MAX_OWNED_KEYCHAIN_KEYS} 项安全上限；原生能力保持关闭。"
                ));
            }
        }
    }
    Ok(normalized)
}

fn add_pending_keychain_entry(app: &AppHandle, key_id: &str) -> Result<(), String> {
    validate_uuid("Keychain binding", key_id)?;
    let mut journal = read_pending_keychain_journal(app)?;
    if !journal.key_ids.iter().any(|value| value == key_id) {
        journal.key_ids.push(key_id.to_string());
    }
    write_pending_keychain_journal(app, &journal)
}

fn remove_pending_keychain_entry(app: &AppHandle, key_id: &str) -> Result<(), String> {
    let mut journal = read_pending_keychain_journal(app)?;
    journal.key_ids.retain(|value| value != key_id);
    write_pending_keychain_journal(app, &journal)
}

fn cleanup_pending_keychain_entries(app: &AppHandle) -> Result<(), String> {
    let mut journal = read_pending_keychain_journal(app)?;
    let committed_key_id = read_binding(app)?.map(|binding| binding.key_id);
    let mut retained = Vec::new();
    let mut cleanup_failed = false;
    for key_id in journal.key_ids.drain(..) {
        validate_uuid("Keychain binding", &key_id)?;
        if committed_key_id.as_deref() == Some(key_id.as_str()) {
            retained.push(key_id);
            continue;
        }
        if delete_token(&key_id).is_err() {
            retained.push(key_id);
            cleanup_failed = true;
        }
    }
    journal.key_ids = retained;
    write_pending_keychain_journal(app, &journal)?;
    if cleanup_failed {
        Err("上一次 Keychain 写入尚未完成清理；没有创建新的本机连接。".into())
    } else {
        Ok(())
    }
}

fn remove_keychain_inventory_entries(app: &AppHandle, key_ids: &[String]) -> Result<(), String> {
    let mut journal = read_pending_keychain_journal(app)?;
    journal.key_ids.retain(|key_id| !key_ids.contains(key_id));
    write_pending_keychain_journal(app, &journal)
}

fn failed_keychain_deletions<F>(key_ids: &[String], mut delete: F) -> Result<Vec<String>, String>
where
    F: FnMut(&str) -> Result<(), String>,
{
    let mut retained = Vec::new();
    for key_id in key_ids {
        validate_uuid("Keychain binding", key_id)?;
        if delete(key_id).is_err() {
            retained.push(key_id.clone());
        }
    }
    Ok(retained)
}

fn read_binding(app: &AppHandle) -> Result<Option<PersistentBinding>, String> {
    let path = binding_path(app)?;
    let Some(bytes) = read_private_file(&path, "本机连接记录")? else {
        return Ok(None);
    };
    let value = serde_json::from_slice(&bytes)
        .map_err(|_| "本机连接记录损坏；未授予原生能力。".to_string())?;
    Ok(Some(value))
}

fn read_private_file(path: &Path, label: &str) -> Result<Option<Vec<u8>>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("无法检查{label}：{error}")),
    };
    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return Err(format!("{label}不是受控普通文件。"));
    }
    if metadata.len() > 64 * 1024 {
        return Err(format!("{label}超过 64 KiB 上限。"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        // SAFETY: geteuid has no preconditions and only reads the effective uid.
        let current_uid = unsafe { libc::geteuid() };
        if metadata.uid() != current_uid || metadata.permissions().mode() & 0o077 != 0 {
            return Err(format!("{label}不属于当前用户或权限过宽。"));
        }
    }
    fs::read(path)
        .map(Some)
        .map_err(|error| format!("无法读取{label}：{error}"))
}

fn write_binding(app: &AppHandle, binding: &PersistentBinding) -> Result<(), String> {
    validate_uuid("Keychain binding", &binding.key_id)?;
    let path = binding_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "本机连接路径无效。".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "无法创建 App 配置目录。".to_string())?;
    let bytes = serde_json::to_vec(binding).map_err(|_| "无法编码本机连接记录。".to_string())?;
    atomic_write_private_file(&path, &bytes)
}

#[cfg(unix)]
fn write_private_file_create_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::{io::Write, os::unix::fs::OpenOptionsExt};
    let mut file = fs::OpenOptions::new()
        .create(true)
        .create_new(true)
        .truncate(false)
        .write(true)
        .mode(0o600)
        .open(path)
        .map_err(|_| "无法写入本机连接记录。".to_string())?;
    file.write_all(bytes)
        .map_err(|_| "无法写入本机连接记录。".to_string())?;
    file.sync_all()
        .map_err(|_| "无法持久化本机连接记录。".to_string())
}

#[cfg(not(unix))]
fn write_private_file_create_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|_| "无法写入本机连接记录。".to_string())?;
    file.write_all(bytes)
        .map_err(|_| "无法写入本机连接记录。".to_string())?;
    file.sync_all()
        .map_err(|_| "无法持久化本机连接记录。".to_string())
}

fn atomic_write_private_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "本机连接路径无效。".to_string())?;
    let temp = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name().and_then(|v| v.to_str()).unwrap_or("state"),
        Uuid::new_v4()
    ));
    if let Err(error) = write_private_file_create_new(&temp, bytes) {
        let _ = remove_file_confirmed(&temp, "临时本机连接记录");
        return Err(error);
    }
    if let Err(error) = fs::rename(&temp, path) {
        let _ = remove_file_confirmed(&temp, "临时本机连接记录");
        return Err(format!("无法原子保存本机连接记录：{error}"));
    }
    fs::File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("本机连接记录已替换，但无法持久化目录更新：{error}"))
}

fn wait_for_capture(active: &ActiveCapture) -> CaptureExit {
    let cancellation_deadline =
        std::time::Instant::now() + Duration::from_secs(KEYCHAIN_TIMEOUT_SECONDS + 2);
    loop {
        if active.cancelled.load(Ordering::SeqCst) {
            match terminate_child(&active.child, "系统窗口选择器") {
                Ok(()) => return CaptureExit::Cancelled,
                Err(reason) if std::time::Instant::now() >= cancellation_deadline => {
                    return CaptureExit::TerminationUnconfirmed(reason);
                }
                Err(_) => {
                    thread::sleep(Duration::from_millis(35));
                    continue;
                }
            }
        }
        let result = {
            let mut slot = match active.child.lock() {
                Ok(value) => value,
                Err(_) => return CaptureExit::Failed,
            };
            let Some(child) = slot.as_mut() else {
                return if active.cancelled.load(Ordering::SeqCst) {
                    CaptureExit::Cancelled
                } else {
                    CaptureExit::Failed
                };
            };
            match child.try_wait() {
                Ok(Some(status)) => {
                    *slot = None;
                    Some(status.success())
                }
                Ok(None) => None,
                Err(error) => {
                    active.cancelled.store(true, Ordering::SeqCst);
                    return CaptureExit::TerminationUnconfirmed(format!(
                        "无法确认系统窗口选择器状态：{error}"
                    ));
                }
            }
        };
        if let Some(success) = result {
            return if success && active.output.exists() {
                CaptureExit::Succeeded
            } else if success {
                CaptureExit::Cancelled
            } else {
                CaptureExit::Failed
            };
        }
        thread::sleep(Duration::from_millis(35));
    }
}

fn same_capture(left: &ActiveCapture, right: &ActiveCapture) -> bool {
    left.account_id == right.account_id
        && left.session_id == right.session_id
        && left.intent_id == right.intent_id
        && left.output == right.output
}

fn same_capture_request(
    active: &ActiveCapture,
    account_id: &str,
    session_id: &str,
    intent_id: &str,
) -> bool {
    active.account_id == account_id
        && active.session_id == session_id
        && active.intent_id == intent_id
}

fn release_capture_reservation(state: &AppState, active: &ActiveCapture) -> Result<bool, String> {
    let mut slot = lock(&state.active_capture)?;
    if slot
        .as_ref()
        .is_some_and(|current| same_capture(current, active))
    {
        remove_file_confirmed(&active.output, "窗口采集缓存")?;
        *slot = None;
        return Ok(true);
    }
    Ok(false)
}

fn finish_cancelled_capture(
    app: &AppHandle,
    state: &AppState,
    active: &ActiveCapture,
) -> Result<CaptureResult, String> {
    let owned = release_capture_reservation(state, active)?;
    if owned {
        record_capture_receipt(app, active, &CaptureResult::Cancelled)?;
    }
    Ok(CaptureResult::Cancelled)
}

fn finish_capture_without_artifact(
    app: &AppHandle,
    state: &AppState,
    active: &ActiveCapture,
    result: CaptureResult,
) -> Result<CaptureResult, String> {
    let owned = release_capture_reservation(state, active)?;
    if owned {
        record_capture_receipt(app, active, &result)?;
        Ok(result)
    } else {
        Ok(CaptureResult::Cancelled)
    }
}

fn finish_replayed_capture(
    state: &AppState,
    active: &ActiveCapture,
    replay: CaptureResult,
) -> Result<CaptureResult, String> {
    if active.cancelled.load(Ordering::SeqCst) {
        let _ = release_capture_reservation(state, active)?;
        return Ok(CaptureResult::Cancelled);
    }
    if release_capture_reservation(state, active)? {
        Ok(replay)
    } else {
        Ok(CaptureResult::Cancelled)
    }
}

fn cancel_any_capture(app: &AppHandle, state: &AppState) -> Result<(), String> {
    let mut slot = lock(&state.active_capture)?;
    let Some(active) = slot.as_ref().cloned() else {
        return Ok(());
    };
    active.cancelled.store(true, Ordering::SeqCst);
    terminate_child(&active.child, "系统窗口选择器")?;
    remove_file_confirmed(&active.output, "窗口采集缓存")?;
    let _ = clear_capture_marker(app);
    let receipt_result = if read_pending_revocation(app)?.is_none() {
        record_capture_receipt(app, &active, &CaptureResult::Cancelled)
    } else {
        // Disconnect owns the pending revocation and clears the whole receipt
        // journal after native effects are confirmed stopped.
        Ok(())
    };
    if slot
        .as_ref()
        .is_some_and(|current| same_capture(current, &active))
    {
        *slot = None;
    }
    receipt_result
}

fn cancel_any_ocr(state: &AppState) -> Result<(), String> {
    let mut slot = lock(&state.active_ocr)?;
    let reader_result = if let Some(active) = slot.as_ref() {
        active.cancelled.store(true, Ordering::SeqCst);
        terminate_child(&active.child, "本地 Vision helper")?;
        finish_ocr_stdout_reader(active).map(|_| ())
    } else {
        Ok(())
    };
    *slot = None;
    reader_result
}

fn terminate_child(child: &Mutex<Option<Child>>, label: &str) -> Result<(), String> {
    let mut slot = lock(child)?;
    let Some(process) = slot.as_mut() else {
        return Ok(());
    };
    match process.try_wait() {
        Ok(Some(_)) => {
            *slot = None;
            return Ok(());
        }
        Ok(None) => {}
        Err(error) => return Err(format!("无法确认{label}状态：{error}")),
    }
    process
        .kill()
        .map_err(|error| format!("无法终止{label}：{error}"))?;
    process
        .wait()
        .map_err(|error| format!("无法等待{label}终止：{error}"))?;
    *slot = None;
    Ok(())
}

fn finish_ocr(state: &AppState, active: &ActiveOcr) -> Result<(), String> {
    let mut slot = lock(&state.active_ocr)?;
    let matches = slot
        .as_ref()
        .is_some_and(|current| same_ocr(current, active));
    if matches {
        *slot = None;
    }
    Ok(())
}

fn finish_ocr_result(
    state: &AppState,
    active: &ActiveOcr,
    result: OcrResult,
) -> Result<OcrResult, String> {
    let mut slot = lock(&state.active_ocr)?;
    let matches = slot
        .as_ref()
        .is_some_and(|current| same_ocr(current, active));
    let cancelled = active.cancelled.load(Ordering::SeqCst);
    if matches {
        *slot = None;
    }
    if cancelled {
        Ok(OcrResult::Cancelled)
    } else if matches {
        Ok(result)
    } else {
        Ok(OcrResult::Cancelled)
    }
}

fn same_ocr(left: &ActiveOcr, right: &ActiveOcr) -> bool {
    left.account_id == right.account_id
        && left.session_id == right.session_id
        && left.local_handle == right.local_handle
        && Arc::ptr_eq(&left.child, &right.child)
}

fn spawn_capped_stdout_reader(
    mut stdout: impl Read + Send + 'static,
) -> thread::JoinHandle<Result<Vec<u8>, String>> {
    thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .by_ref()
            .take(MAX_OCR_OUTPUT_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "无法读取本地 Vision helper 输出。".to_string())?;
        if bytes.len() as u64 > MAX_OCR_OUTPUT_BYTES {
            return Err("本地 Vision helper 输出超过 256 KB 上限。".into());
        }
        Ok(bytes)
    })
}

fn finish_ocr_stdout_reader(active: &ActiveOcr) -> Result<Vec<u8>, String> {
    let reader = lock(&active.stdout_reader)?
        .take()
        .ok_or_else(|| "本地 Vision helper 输出状态不可用。".to_string())?;
    reader
        .join()
        .map_err(|_| "本地 Vision helper 输出读取异常结束。".to_string())?
}

fn wait_for_ocr(active: &ActiveOcr) -> OcrProcessExit {
    let deadline = std::time::Instant::now() + Duration::from_secs(OCR_TIMEOUT_SECONDS);
    let mut termination_deadline = None;
    loop {
        if active.cancelled.load(Ordering::SeqCst) {
            let retry_deadline = *termination_deadline.get_or_insert_with(|| {
                std::time::Instant::now() + Duration::from_secs(KEYCHAIN_TIMEOUT_SECONDS + 2)
            });
            match terminate_child(&active.child, "本地 Vision helper") {
                Ok(()) => {
                    let _ = finish_ocr_stdout_reader(active);
                    return OcrProcessExit::Cancelled;
                }
                Err(reason) if std::time::Instant::now() >= retry_deadline => {
                    return OcrProcessExit::TerminationUnconfirmed(reason);
                }
                Err(_) => {
                    thread::sleep(Duration::from_millis(35));
                    continue;
                }
            }
        }
        let completed = {
            let mut slot = match active.child.lock() {
                Ok(value) => value,
                Err(_) => return OcrProcessExit::Failed("本地 Vision 状态不可用。".into()),
            };
            let Some(child) = slot.as_mut() else {
                return if active.cancelled.load(Ordering::SeqCst) {
                    OcrProcessExit::Cancelled
                } else {
                    OcrProcessExit::Failed("本地 Vision helper 提前结束。".into())
                };
            };
            match child.try_wait() {
                Ok(Some(status)) => Ok(Some((status, slot.take().expect("child was present")))),
                Ok(None) => Ok(None),
                Err(error) => Err(format!("无法读取本地 Vision helper 状态：{error}")),
            }
        };
        let completed = match completed {
            Ok(value) => value,
            Err(reason) => {
                active.cancelled.store(true, Ordering::SeqCst);
                return match terminate_child(&active.child, "本地 Vision helper") {
                    Ok(()) => {
                        let _ = finish_ocr_stdout_reader(active);
                        OcrProcessExit::Failed(reason)
                    }
                    Err(termination) => OcrProcessExit::TerminationUnconfirmed(termination),
                };
            }
        };
        if let Some((status, _child)) = completed {
            let bytes = match finish_ocr_stdout_reader(active) {
                Ok(bytes) => bytes,
                Err(reason) => return OcrProcessExit::Failed(reason),
            };
            return OcrProcessExit::Completed(std::process::Output {
                status,
                stdout: bytes,
                stderr: Vec::new(),
            });
        }
        if std::time::Instant::now() >= deadline {
            active.cancelled.store(true, Ordering::SeqCst);
            return match terminate_child(&active.child, "超时的本地 Vision helper") {
                Ok(()) => {
                    let _ = finish_ocr_stdout_reader(active);
                    OcrProcessExit::Failed(
                        "本地 Vision helper 超过 20 秒，已终止；没有云端回退。".into(),
                    )
                }
                Err(reason) => OcrProcessExit::TerminationUnconfirmed(reason),
            };
        }
        thread::sleep(Duration::from_millis(35));
    }
}

fn purge_expired_artifacts(state: &AppState) -> Result<(), String> {
    let now = Utc::now();
    let mut artifacts = lock(&state.artifacts)?;
    let expired = artifacts
        .iter()
        .filter(|(_, artifact)| artifact.expires_at <= now)
        .map(|(handle, artifact)| (handle.clone(), artifact.path.clone()))
        .collect::<Vec<_>>();
    let mut errors = Vec::new();
    for (handle, path) in expired {
        match remove_file_confirmed(&path, "过期窗口采集缓存") {
            Ok(()) => {
                artifacts.remove(&handle);
            }
            Err(error) => errors.push(error),
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("；"))
    }
}

fn enforce_capture_quota(state: &AppState, additional_bytes: u64) -> Result<(), String> {
    let artifacts = lock(&state.artifacts)?;
    if artifacts.len() >= MAX_CAPTURE_ARTIFACTS {
        return Err("本机窗口采集缓存已达到 8 个上限；请完成或断开当前 Session 后再试。".into());
    }
    let total_bytes = artifacts.values().try_fold(0_u64, |total, artifact| {
        let bytes = fs::metadata(&artifact.path)
            .map_err(|_| "无法核验本机窗口采集缓存总量。".to_string())?
            .len();
        total
            .checked_add(bytes)
            .ok_or_else(|| "本机窗口采集缓存总量溢出；已拒绝新的采集。".to_string())
    })?;
    if total_bytes
        .checked_add(additional_bytes)
        .is_none_or(|value| value > MAX_CAPTURE_CACHE_BYTES)
    {
        return Err("本机窗口采集缓存已达到 48 MB 上限；请完成或断开当前 Session 后再试。".into());
    }
    Ok(())
}

fn replay_capture_for_intent(
    artifacts: &HashMap<String, CaptureArtifact>,
    account_id: &str,
    session_id: &str,
    intent_id: &str,
) -> Option<CaptureResult> {
    artifacts.iter().find_map(|(handle, artifact)| {
        (artifact.account_id == account_id
            && artifact.session_id == session_id
            && artifact.intent_id == intent_id
            && artifact.expires_at > Utc::now()
            && artifact.path.is_file())
        .then(|| CaptureResult::Captured {
            local_handle: handle.clone(),
            expires_at: artifact.expires_at.to_rfc3339(),
        })
    })
}

fn cleanup_artifacts(state: &AppState) -> Result<(), String> {
    let mut artifacts = lock(&state.artifacts)?;
    let handles = artifacts.keys().cloned().collect::<Vec<_>>();
    let mut errors = Vec::new();
    for handle in handles {
        let path = artifacts.get(&handle).expect("handle exists").path.clone();
        match remove_file_confirmed(&path, "窗口采集缓存") {
            Ok(()) => {
                artifacts.remove(&handle);
            }
            Err(error) => errors.push(error),
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("；"))
    }
}

fn remove_file_confirmed(path: &Path, label: &str) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() || metadata.file_type().is_symlink() => {
            fs::remove_file(path).map_err(|error| format!("无法删除{label}：{error}"))?;
            let parent = path
                .parent()
                .ok_or_else(|| format!("{label}路径没有可持久化的父目录。"))?;
            fs::File::open(parent)
                .and_then(|directory| directory.sync_all())
                .map_err(|error| format!("已删除{label}，但无法持久化目录更新：{error}"))
        }
        Ok(_) => Err(format!("{label}不是可安全删除的文件。")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("无法检查{label}：{error}")),
    }
}

pub fn purge_capture_cache_on_startup(app: &AppHandle) -> Result<(), String> {
    let directory = capture_directory(app)?;
    let _ = clear_capture_marker(app);
    let _ = read_capture_receipts(app)?;
    purge_capture_directory(&directory)
}

fn purge_capture_directory(directory: &Path) -> Result<(), String> {
    let metadata = match fs::symlink_metadata(directory) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err("无法检查残留采集缓存目录。".into()),
    };
    if metadata.file_type().is_symlink() || !metadata.file_type().is_dir() {
        return Err("采集缓存路径不是受控目录；拒绝清理。".into());
    }
    let entries = fs::read_dir(directory).map_err(|_| "无法检查残留采集缓存。".to_string())?;
    let mut errors = Vec::new();
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                errors.push("无法检查残留采集缓存条目。".to_string());
                continue;
            }
        };
        let path = entry.path();
        let is_app_capture = path.extension().and_then(|value| value.to_str()) == Some("png")
            && path
                .file_stem()
                .and_then(|value| value.to_str())
                .is_some_and(|value| Uuid::parse_str(value).is_ok());
        let is_regular_file = match entry.file_type() {
            Ok(file_type) => file_type.is_file(),
            Err(_) => {
                errors.push("无法检查残留采集缓存类型。".to_string());
                continue;
            }
        };
        if is_app_capture
            && is_regular_file
            && let Err(error) = remove_file_confirmed(&path, "残留窗口采集缓存")
        {
            errors.push(error);
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("；"))
    }
}

fn capture_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|_| "无法解析 App 缓存目录。".to_string())?
        .join("captures");
    match fs::symlink_metadata(&directory) {
        Ok(metadata) if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() => {}
        Ok(_) => return Err("采集缓存路径不是受控目录；拒绝采集。".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(&directory).map_err(|_| "无法创建受控采集目录。".to_string())?;
            let metadata = fs::symlink_metadata(&directory)
                .map_err(|_| "无法确认受控采集目录。".to_string())?;
            if metadata.file_type().is_symlink() || !metadata.file_type().is_dir() {
                return Err("采集缓存路径不是受控目录；拒绝采集。".into());
            }
        }
        Err(_) => return Err("无法检查受控采集目录。".into()),
    }
    secure_capture_directory(&directory)?;
    Ok(directory)
}

#[cfg(unix)]
fn secure_capture_directory(directory: &Path) -> Result<(), String> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let metadata =
        fs::symlink_metadata(directory).map_err(|_| "无法确认受控采集目录。".to_string())?;
    // SAFETY: geteuid has no preconditions and only reads the effective uid.
    let current_uid = unsafe { libc::geteuid() };
    if metadata.file_type().is_symlink() || !metadata.is_dir() || metadata.uid() != current_uid {
        return Err("采集缓存目录不属于当前用户；拒绝采集。".into());
    }
    fs::set_permissions(directory, fs::Permissions::from_mode(0o700))
        .map_err(|_| "无法将采集缓存目录限制为当前用户可访问。".to_string())
}

#[cfg(not(unix))]
fn secure_capture_directory(_directory: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn secure_capture_file(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let metadata =
        fs::symlink_metadata(path).map_err(|_| "系统没有生成可核验的窗口图像。".to_string())?;
    // SAFETY: geteuid has no preconditions and only reads the effective uid.
    let current_uid = unsafe { libc::geteuid() };
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.uid() != current_uid {
        return Err("窗口图像不是当前用户拥有的普通文件；已拒绝。".into());
    }
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|_| "无法将窗口图像限制为当前用户可访问。".to_string())
}

#[cfg(not(unix))]
fn secure_capture_file(path: &Path) -> Result<(), String> {
    if path.is_file() {
        Ok(())
    } else {
        Err("窗口图像不是普通文件；已拒绝。".into())
    }
}

fn capture_marker_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|_| "无法解析 App 缓存目录。".to_string())?
        .join(CAPTURE_MARKER_FILE))
}

fn capture_receipts_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|_| "无法解析 App 配置目录。".to_string())?
        .join(CAPTURE_RECEIPTS_FILE))
}

fn capture_receipts_lock_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|_| "无法解析 App 配置目录。".to_string())?
        .join(CAPTURE_RECEIPTS_LOCK_FILE))
}

struct CaptureReceiptFileLock(fs::File);

impl Drop for CaptureReceiptFileLock {
    fn drop(&mut self) {
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            // SAFETY: flock only reads the valid owned file descriptor.
            let _ = unsafe { libc::flock(self.0.as_raw_fd(), libc::LOCK_UN) };
        }
    }
}

fn acquire_capture_receipt_lock(app: &AppHandle) -> Result<CaptureReceiptFileLock, String> {
    let path = capture_receipts_lock_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "窗口采集意图锁路径无效。".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "无法创建 App 配置目录。".to_string())?;
    #[cfg(unix)]
    let file = {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let file = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&path)
            .map_err(|_| "无法打开窗口采集意图锁。".to_string())?;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|_| "无法限制窗口采集意图锁权限。".to_string())?;
        use std::os::fd::AsRawFd;
        // SAFETY: flock only reads the valid owned file descriptor.
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } != 0 {
            return Err("无法锁定窗口采集意图回执。".into());
        }
        file
    };
    #[cfg(not(unix))]
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(&path)
        .map_err(|_| "无法打开窗口采集意图锁。".to_string())?;
    Ok(CaptureReceiptFileLock(file))
}

fn clear_capture_receipts(app: &AppHandle) -> Result<(), String> {
    let _receipt_lock = acquire_capture_receipt_lock(app)?;
    remove_file_confirmed(&capture_receipts_path(app)?, "窗口采集意图回执")
}

fn read_capture_receipts(app: &AppHandle) -> Result<CaptureReceiptJournal, String> {
    let _receipt_lock = acquire_capture_receipt_lock(app)?;
    read_capture_receipts_unlocked(app)
}

fn read_capture_receipts_unlocked(app: &AppHandle) -> Result<CaptureReceiptJournal, String> {
    let path = capture_receipts_path(app)?;
    let mut journal = match read_private_file(&path, "窗口采集意图回执")? {
        Some(bytes) => serde_json::from_slice::<CaptureReceiptJournal>(&bytes)
            .map_err(|_| "窗口采集意图回执损坏；已拒绝启动新的系统选择器。".to_string())?,
        None => CaptureReceiptJournal::default(),
    };
    if journal.receipts.len() > MAX_CAPTURE_RECEIPTS {
        return Err("窗口采集意图回执超出安全上限；已拒绝启动新的系统选择器。".into());
    }
    for receipt in &journal.receipts {
        validate_uuid("回执 accountId", &receipt.account_id)?;
        validate_uuid("回执 sessionId", &receipt.session_id)?;
        validate_uuid("回执 intentId", &receipt.intent_id)?;
    }
    let original_len = journal.receipts.len();
    journal
        .receipts
        .retain(|receipt| receipt.retain_until > Utc::now());
    if journal.receipts.len() != original_len {
        write_capture_receipts_unlocked(app, &journal)?;
    }
    Ok(journal)
}

fn write_capture_receipts_unlocked(
    app: &AppHandle,
    journal: &CaptureReceiptJournal,
) -> Result<(), String> {
    let path = capture_receipts_path(app)?;
    if journal.receipts.is_empty() {
        return remove_file_confirmed(&path, "窗口采集意图回执");
    }
    let parent = path
        .parent()
        .ok_or_else(|| "窗口采集意图回执路径无效。".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "无法创建 App 配置目录。".to_string())?;
    let bytes =
        serde_json::to_vec(journal).map_err(|_| "无法编码窗口采集意图回执。".to_string())?;
    atomic_write_private_file(&path, &bytes)
}

fn receipt_status(result: &CaptureResult) -> CaptureReceiptStatus {
    match result {
        CaptureResult::Cancelled => CaptureReceiptStatus::Cancelled,
        CaptureResult::Captured { .. } => CaptureReceiptStatus::Captured,
        CaptureResult::Denied { .. } => CaptureReceiptStatus::Denied,
        CaptureResult::Failed { .. } => CaptureReceiptStatus::Failed,
    }
}

fn record_capture_receipt(
    app: &AppHandle,
    active: &ActiveCapture,
    result: &CaptureResult,
) -> Result<(), String> {
    let binding_key_id = lock(&active.binding_key_id)?
        .clone()
        .ok_or_else(|| "窗口采集没有可核验的连接代次；未写入终态回执。".to_string())?;
    record_capture_receipt_status(
        app,
        &active.account_id,
        &active.session_id,
        &active.intent_id,
        &binding_key_id,
        receipt_status(result),
    )
}

fn record_capture_receipt_status(
    app: &AppHandle,
    account_id: &str,
    session_id: &str,
    intent_id: &str,
    binding_key_id: &str,
    status: CaptureReceiptStatus,
) -> Result<(), String> {
    let _receipt_lock = acquire_capture_receipt_lock(app)?;
    assert_receipt_binding_current(app, account_id, session_id, binding_key_id)?;
    let mut journal = read_capture_receipts_unlocked(app)?;
    upsert_capture_receipt(&mut journal, account_id, session_id, intent_id, status)?;
    write_capture_receipts_unlocked(app, &journal)
}

fn claim_capture_intent(
    app: &AppHandle,
    account_id: &str,
    session_id: &str,
    intent_id: &str,
    binding_key_id: &str,
) -> Result<(), String> {
    let _receipt_lock = acquire_capture_receipt_lock(app)?;
    assert_receipt_binding_current(app, account_id, session_id, binding_key_id)?;
    let mut journal = read_capture_receipts_unlocked(app)?;
    if scope_has_started_receipt(&journal, account_id, session_id) {
        return Err("当前账号与 Session 仍有终态未知的窗口采集；未启动新的系统选择器。".into());
    }
    upsert_capture_receipt(
        &mut journal,
        account_id,
        session_id,
        intent_id,
        CaptureReceiptStatus::Started,
    )?;
    write_capture_receipts_unlocked(app, &journal)
}

fn assert_receipt_binding_current(
    app: &AppHandle,
    account_id: &str,
    session_id: &str,
    binding_key_id: &str,
) -> Result<(), String> {
    if read_pending_revocation(app)?.is_some() {
        return Err("本机连接正在撤销；未写入窗口采集回执。".into());
    }
    let binding =
        read_binding(app)?.ok_or_else(|| "本机连接已经移除；未写入窗口采集回执。".to_string())?;
    if binding.key_id != binding_key_id
        || canonical_uuid("bound accountId", &binding.account_id)? != account_id
        || canonical_uuid("bound sessionId", &binding.session_id)? != session_id
    {
        return Err("本机连接代次或作用域已变更；未写入窗口采集回执。".into());
    }
    Ok(())
}

fn scope_has_started_receipt(
    journal: &CaptureReceiptJournal,
    account_id: &str,
    session_id: &str,
) -> bool {
    journal.receipts.iter().any(|receipt| {
        receipt.account_id == account_id
            && receipt.session_id == session_id
            && matches!(receipt.status, CaptureReceiptStatus::Started)
    })
}

fn upsert_capture_receipt(
    journal: &mut CaptureReceiptJournal,
    account_id: &str,
    session_id: &str,
    intent_id: &str,
    status: CaptureReceiptStatus,
) -> Result<(), String> {
    journal.receipts.retain(|receipt| {
        receipt.account_id != account_id
            || receipt.session_id != session_id
            || receipt.intent_id != intent_id
    });
    if journal.receipts.len() >= MAX_CAPTURE_RECEIPTS {
        let evict = journal
            .receipts
            .iter()
            .enumerate()
            .filter(|(_, receipt)| !matches!(receipt.status, CaptureReceiptStatus::Started))
            .min_by_key(|(_, receipt)| receipt.retain_until)
            .map(|(index, _)| index)
            .ok_or_else(|| {
                "所有窗口采集回执都处于终态未知状态；已拒绝新的系统选择器。".to_string()
            })?;
        journal.receipts.remove(evict);
    }
    journal.receipts.push(CaptureReceipt {
        account_id: account_id.to_string(),
        session_id: session_id.to_string(),
        intent_id: intent_id.to_string(),
        status,
        retain_until: Utc::now() + chrono::Duration::hours(CAPTURE_RECEIPT_RETENTION_HOURS),
    });
    Ok(())
}

fn replay_capture_receipt(
    app: &AppHandle,
    active: &ActiveCapture,
) -> Result<Option<CaptureResult>, String> {
    let journal = read_capture_receipts(app)?;
    let matched = journal.receipts.iter().find(|receipt| {
        receipt.account_id == active.account_id
            && receipt.session_id == active.session_id
            && receipt.intent_id == active.intent_id
    });
    let Some(receipt) = matched else {
        return Ok(None);
    };
    replay_capture_receipt_status(receipt.status).map(Some)
}

fn replay_capture_receipt_status(status: CaptureReceiptStatus) -> Result<CaptureResult, String> {
    match status {
        CaptureReceiptStatus::Started => {
            Err("同一采集意图已启动但终态未知；未启动新的系统选择器，请重试核验或取消。".into())
        }
        CaptureReceiptStatus::Cancelled => Ok(CaptureResult::Cancelled),
        CaptureReceiptStatus::Captured => Ok(CaptureResult::Failed {
            reason: "同一采集意图已完成，但受控图像缓存已过期或不可用；未启动新的系统选择器。"
                .into(),
        }),
        CaptureReceiptStatus::Denied => Ok(CaptureResult::Denied {
            reason: "同一采集意图先前已被系统权限拒绝；未启动新的系统选择器。".into(),
        }),
        CaptureReceiptStatus::Failed => Ok(CaptureResult::Failed {
            reason: "同一采集意图先前已经失败；未启动新的系统选择器。".into(),
        }),
    }
}

fn capture_receipt_status(
    app: &AppHandle,
    account_id: &str,
    session_id: &str,
    intent_id: &str,
) -> Result<Option<CaptureReceiptStatus>, String> {
    Ok(read_capture_receipts(app)?
        .receipts
        .iter()
        .find(|receipt| {
            receipt.account_id == account_id
                && receipt.session_id == session_id
                && receipt.intent_id == intent_id
        })
        .map(|receipt| receipt.status))
}

fn write_capture_marker(app: &AppHandle, pid: u32, output: &Path) -> Result<(), String> {
    let directory = capture_directory(app)?;
    if output.parent() != Some(directory.as_path())
        || output.extension().and_then(|value| value.to_str()) != Some("png")
        || output
            .file_stem()
            .and_then(|value| value.to_str())
            .is_none_or(|value| Uuid::parse_str(value).is_err())
    {
        return Err("窗口采集输出不在受控缓存目录。".into());
    }
    let bytes = serde_json::to_vec(&ActiveCaptureMarker {
        pid,
        output: output.to_path_buf(),
    })
    .map_err(|_| "无法编码窗口采集恢复记录。".to_string())?;
    atomic_write_private_file(&capture_marker_path(app)?, &bytes)
}

fn clear_capture_marker(app: &AppHandle) -> Result<(), String> {
    remove_file_confirmed(&capture_marker_path(app)?, "窗口采集恢复记录")
}

pub fn start_capture_janitor(app: AppHandle) {
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_secs(5));
            let state = app.state::<AppState>();
            let _ = purge_expired_artifacts(&state);
            let _ = read_capture_receipts(&app);
            let cancelled_capture = lock(&state.active_capture)
                .ok()
                .and_then(|slot| slot.as_ref().cloned())
                .is_some_and(|active| active.cancelled.load(Ordering::SeqCst));
            if cancelled_capture {
                let _ = cancel_any_capture(&app, &state);
            }
            let cancelled_ocr = lock(&state.active_ocr)
                .ok()
                .and_then(|slot| slot.as_ref().cloned())
                .is_some_and(|active| active.cancelled.load(Ordering::SeqCst));
            if cancelled_ocr {
                let _ = cancel_any_ocr(&state);
            }
            // A process crash can leave screencapture alive. We deliberately do
            // not kill a persisted PID because macOS may have reused it; strict
            // UUID cache cleanup removes any late output without risking another
            // process.
            if lock(&state.active_capture)
                .ok()
                .is_some_and(|slot| slot.is_none())
                && let Ok(directory) = capture_directory(&app)
            {
                let _ = purge_untracked_capture_files(&state, &directory);
            }
        }
    });
}

fn purge_untracked_capture_files(state: &AppState, directory: &Path) -> Result<(), String> {
    let tracked = lock(&state.artifacts)?
        .values()
        .map(|artifact| artifact.path.clone())
        .collect::<HashSet<_>>();
    let entries = fs::read_dir(directory).map_err(|_| "无法检查采集缓存。".to_string())?;
    let mut errors = Vec::new();
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                errors.push("无法检查采集缓存条目。".to_string());
                continue;
            }
        };
        let path = entry.path();
        let app_named = path.extension().and_then(|value| value.to_str()) == Some("png")
            && path
                .file_stem()
                .and_then(|value| value.to_str())
                .is_some_and(|value| Uuid::parse_str(value).is_ok());
        let is_regular_file = match entry.file_type() {
            Ok(file_type) => file_type.is_file(),
            Err(_) => {
                errors.push("无法检查采集缓存类型。".to_string());
                continue;
            }
        };
        if app_named
            && is_regular_file
            && !tracked.contains(&path)
            && let Err(error) = remove_file_confirmed(&path, "未跟踪窗口采集缓存")
        {
            errors.push(error);
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("；"))
    }
}

pub fn shutdown_native_state(app: &AppHandle) {
    let state = app.state::<AppState>();
    state.lifecycle_epoch.fetch_add(1, Ordering::SeqCst);
    if let Ok(_commit) = state.lifecycle_commit.lock() {
        let _ = invalidate_native_effects(app, &state);
    }
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    fs::symlink_metadata(path).is_ok_and(|metadata| {
        metadata.file_type().is_file()
            && !metadata.file_type().is_symlink()
            && metadata.permissions().mode() & 0o111 != 0
    })
}

#[cfg(not(unix))]
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

#[cfg(all(target_os = "macos", not(debug_assertions)))]
fn verify_bundled_code_signature(path: &Path) -> bool {
    Command::new("/usr/bin/codesign")
        .args(["--verify", "--strict"])
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

#[cfg(any(not(target_os = "macos"), debug_assertions))]
fn verify_bundled_code_signature(_path: &Path) -> bool {
    true
}

fn vision_binary_path(app: &AppHandle) -> Result<PathBuf, String> {
    let executable =
        std::env::current_exe().map_err(|_| "无法定位 App 可执行文件。".to_string())?;
    let bundled = executable
        .parent()
        .ok_or_else(|| "App 可执行路径无效。".to_string())?
        .join("talent-signal-vision");
    if is_executable_file(&bundled)
        && verify_vision_unsigned_hash(app, &bundled)
        && verify_bundled_code_signature(&bundled)
    {
        return Ok(bundled);
    }
    #[cfg(not(debug_assertions))]
    return Err("已打包的本地 Vision helper 缺失、不可执行或签名无效；没有云端回退。".into());

    #[cfg(debug_assertions)]
    {
        let target = if cfg!(target_arch = "aarch64") {
            "aarch64-apple-darwin"
        } else if cfg!(target_arch = "x86_64") {
            "x86_64-apple-darwin"
        } else {
            return Err("当前架构不支持本地 Vision helper。".into());
        };
        let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!("talent-signal-vision-{target}"));
        if is_executable_file(&development) && verify_vision_unsigned_hash(app, &development) {
            Ok(development)
        } else {
            let _ = app;
            Err("本地 Vision helper 未打包；没有云端回退。".into())
        }
    }
}

fn verify_vision_unsigned_hash(app: &AppHandle, path: &Path) -> bool {
    let directory = match app.path().app_cache_dir() {
        Ok(value) => value.join("vision-verification"),
        Err(_) => return false,
    };
    if fs::create_dir_all(&directory).is_err() || secure_capture_directory(&directory).is_err() {
        return false;
    }
    let temporary = directory.join(format!("{}.helper", Uuid::new_v4()));
    let verified = (|| -> Result<bool, String> {
        let mut source =
            fs::File::open(path).map_err(|_| "无法读取 Vision helper。".to_string())?;
        #[cfg(unix)]
        let mut target = {
            use std::os::unix::fs::OpenOptionsExt;
            fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .mode(0o700)
                .open(&temporary)
                .map_err(|_| "无法创建 Vision 校验副本。".to_string())?
        };
        #[cfg(not(unix))]
        let mut target = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|_| "无法创建 Vision 校验副本。".to_string())?;
        std::io::copy(&mut source, &mut target)
            .map_err(|_| "无法复制 Vision helper。".to_string())?;
        drop(target);
        let status = Command::new("/usr/bin/codesign")
            .arg("--remove-signature")
            .arg(&temporary)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|_| "无法规范化 Vision helper 签名。".to_string())?;
        if !status.success() {
            return Ok(false);
        }
        let bytes = fs::read(&temporary).map_err(|_| "无法读取 Vision 校验副本。".to_string())?;
        Ok(format!("{:x}", Sha256::digest(bytes)) == env!("TALENT_SIGNAL_VISION_UNSIGNED_SHA256"))
    })()
    .unwrap_or(false);
    let _ = remove_file_confirmed(&temporary, "Vision 校验副本");
    verified
}
#[cfg(target_os = "macos")]
fn screen_capture_permission_granted() -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
    }
    // SAFETY: CoreGraphics exposes this argument-free process permission query.
    unsafe { CGPreflightScreenCaptureAccess() }
}

#[cfg(not(target_os = "macos"))]
fn screen_capture_permission_granted() -> bool {
    false
}

fn lock<T>(mutex: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>, String> {
    mutex
        .lock()
        .map_err(|_| "本机能力状态暂时不可用。".to_string())
}

enum CaptureExit {
    Cancelled,
    Failed,
    Succeeded,
    TerminationUnconfirmed(String),
}

enum OcrProcessExit {
    Cancelled,
    Failed(String),
    TerminationUnconfirmed(String),
    Completed(std::process::Output),
}

#[derive(Deserialize)]
struct VisionHelperResult {
    text: Option<String>,
    reason: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notification_body_contains_only_fixed_lifecycle_state() {
        let ready = match NotificationState::Ready {
            NotificationState::Ready => "当前 Session 的本机草稿已就绪。",
            NotificationState::Failed => "当前 Session 的本机处理失败。",
        };
        assert_eq!(ready, "当前 Session 的本机草稿已就绪。");
        assert!(!ready.contains("candidate"));
        assert!(!ready.contains("evidence"));
    }

    #[test]
    fn notification_dedupe_uses_canonical_uuid_keys() {
        let account = Uuid::new_v4().to_string();
        let session = Uuid::new_v4().to_string();
        let activity = Uuid::new_v4().to_string();

        assert_eq!(
            notification_dedupe_key(&account, &session, &activity, NotificationState::Ready)
                .expect("lowercase key"),
            notification_dedupe_key(
                &account.to_uppercase(),
                &session.to_uppercase(),
                &activity.to_uppercase(),
                NotificationState::Ready
            )
            .expect("uppercase key")
        );
    }

    #[test]
    fn expired_artifact_shape_never_contains_renderer_path() {
        let result = CaptureResult::Captured {
            local_handle: Uuid::new_v4().to_string(),
            expires_at: Utc::now().to_rfc3339(),
        };
        let json = serde_json::to_string(&result).expect("serialize");
        assert!(json.contains("localHandle"));
        assert!(!json.contains("/tmp"));
        assert!(!json.contains("path"));
    }

    #[test]
    fn vision_failure_result_has_no_cloud_fallback_shape() {
        let result = OcrResult::Failed {
            reason: "本地 Vision 识别失败；没有云端回退。".into(),
        };
        let json = serde_json::to_string(&result).expect("serialize");
        assert!(!json.contains("provider"));
        assert!(!json.contains("upload"));
        assert!(!json.contains("url"));
    }

    #[test]
    fn cancelling_an_active_process_yields_no_capture_artifact() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let output = directory.path().join("must-not-exist.png");
        let child = Command::new("/bin/sleep")
            .arg("5")
            .spawn()
            .expect("start bounded test process");
        let active = ActiveCapture {
            account_id: Uuid::new_v4().to_string(),
            session_id: Uuid::new_v4().to_string(),
            intent_id: Uuid::new_v4().to_string(),
            output: output.clone(),
            binding_key_id: Arc::new(Mutex::new(Some(Uuid::new_v4().to_string()))),
            child: Arc::new(Mutex::new(Some(child))),
            cancelled: Arc::new(AtomicBool::new(false)),
        };
        let waiter = active.clone();
        let join = thread::spawn(move || wait_for_capture(&waiter));
        thread::sleep(Duration::from_millis(40));
        active.cancelled.store(true, Ordering::SeqCst);

        assert!(matches!(
            join.join().expect("waiter"),
            CaptureExit::Cancelled
        ));
        assert!(!output.exists());
    }

    #[test]
    fn startup_cleanup_removes_only_direct_capture_images() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let capture = directory.path().join(format!("{}.png", Uuid::new_v4()));
        let unrelated = directory.path().join("keep.txt");
        fs::write(&capture, b"synthetic").expect("write capture");
        fs::write(&unrelated, b"keep").expect("write unrelated");

        purge_capture_directory(directory.path()).expect("purge capture directory");

        assert!(!capture.exists());
        assert!(unrelated.exists());
    }

    #[cfg(unix)]
    #[test]
    fn startup_cleanup_rejects_a_symlink_directory_without_deleting_target_png() {
        use std::os::unix::fs::symlink;
        let root = tempfile::tempdir().expect("temporary root");
        let target = tempfile::tempdir().expect("temporary target");
        let png = target.path().join(format!("{}.png", Uuid::new_v4()));
        fs::write(&png, b"synthetic").expect("write target png");
        let linked = root.path().join("captures");
        symlink(target.path(), &linked).expect("symlink captures");

        assert!(purge_capture_directory(&linked).is_err());
        assert!(png.exists());
    }

    #[cfg(unix)]
    #[test]
    fn capture_permissions_are_restricted_to_the_current_user() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().expect("temporary directory");
        fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o777))
            .expect("widen directory permissions");
        secure_capture_directory(directory.path()).expect("secure directory");
        assert_eq!(
            fs::metadata(directory.path())
                .expect("directory metadata")
                .permissions()
                .mode()
                & 0o777,
            0o700
        );

        let capture = directory.path().join(format!("{}.png", Uuid::new_v4()));
        fs::write(&capture, b"synthetic").expect("write capture");
        fs::set_permissions(&capture, fs::Permissions::from_mode(0o666))
            .expect("widen file permissions");
        secure_capture_file(&capture).expect("secure capture");
        assert_eq!(
            fs::metadata(&capture)
                .expect("capture metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }

    #[test]
    fn lifecycle_epoch_prevents_an_old_verification_from_committing() {
        let state = AppState::new().expect("state");
        let old_epoch = state.lifecycle_epoch.load(Ordering::SeqCst);
        state.lifecycle_epoch.fetch_add(1, Ordering::SeqCst);
        let _commit = state.lifecycle_commit.lock().expect("commit lock");
        assert!(assert_epoch(&state, old_epoch).is_err());
    }

    #[test]
    fn later_verification_failure_invalidates_every_earlier_lease() {
        let state = AppState::new().expect("state");
        let old_lease_epoch = state.lifecycle_epoch.load(Ordering::SeqCst);
        let _commit = state.lifecycle_commit.lock().expect("commit lock");

        advance_epoch_after_verification_failure(&state, old_lease_epoch)
            .expect("advance failed verification generation");

        assert!(assert_epoch(&state, old_lease_epoch).is_err());
    }

    #[test]
    fn revocation_recovery_never_clears_durable_state_after_native_cleanup_failure() {
        let durable_recovery_called = Arc::new(AtomicBool::new(false));
        let observation = Arc::clone(&durable_recovery_called);
        let status =
            revocation_recovery_status(Err("helper termination unconfirmed".into()), move || {
                observation.store(true, Ordering::SeqCst);
                Ok(())
            });

        assert!(matches!(status, BindingStatus::Revoked { .. }));
        assert!(!durable_recovery_called.load(Ordering::SeqCst));
    }

    #[test]
    fn owned_key_inventory_is_deduplicated_and_bounded_before_keychain_work() {
        let duplicate = Uuid::new_v4().to_string();
        assert_eq!(
            normalize_owned_key_ids(vec![duplicate.clone(), duplicate.clone()])
                .expect("deduplicated inventory"),
            vec![duplicate]
        );
        let too_many = (0..=MAX_OWNED_KEYCHAIN_KEYS)
            .map(|_| Uuid::new_v4().to_string())
            .collect();
        assert!(normalize_owned_key_ids(too_many).is_err());
    }

    #[test]
    fn ocr_cancellation_cannot_return_before_spawn_registration_and_termination() {
        let state = Arc::new(AppState::new().expect("state"));
        let active = ActiveOcr {
            account_id: Uuid::new_v4().to_string(),
            session_id: Uuid::new_v4().to_string(),
            local_handle: Uuid::new_v4().to_string(),
            child: Arc::new(Mutex::new(None)),
            stdout_reader: Arc::new(Mutex::new(None)),
            cancelled: Arc::new(AtomicBool::new(false)),
        };
        *state.active_ocr.lock().expect("active OCR") = Some(active.clone());

        let commit = state.lifecycle_commit.lock().expect("spawn barrier");
        let (sender, receiver) = mpsc::sync_channel(1);
        let cancel_state = Arc::clone(&state);
        let account_id = active.account_id.clone();
        let session_id = active.session_id.clone();
        let local_handle = active.local_handle.clone();
        let cancel = thread::spawn(move || {
            let result =
                cancel_matching_ocr(&cancel_state, &account_id, &session_id, &local_handle);
            sender.send(result).expect("send cancel result");
        });

        assert!(receiver.recv_timeout(Duration::from_millis(40)).is_err());
        let child = Command::new("/bin/sleep")
            .arg("5")
            .spawn()
            .expect("start bounded OCR stand-in");
        *active.child.lock().expect("child slot") = Some(child);
        drop(commit);

        assert!(matches!(
            receiver
                .recv_timeout(Duration::from_secs(2))
                .expect("cancel result")
                .expect("cancel operation"),
            OcrResult::Cancelled
        ));
        cancel.join().expect("cancel thread");
        assert!(active.cancelled.load(Ordering::SeqCst));
        assert!(active.child.lock().expect("child slot").is_none());
    }

    #[test]
    fn same_capture_intent_replays_opaque_handle_without_new_work() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("capture.png");
        fs::write(&path, b"synthetic").expect("write capture");
        let account_id = Uuid::new_v4().to_string();
        let session_id = Uuid::new_v4().to_string();
        let intent_id = Uuid::new_v4().to_string();
        let handle = Uuid::new_v4().to_string();
        let expires_at = Utc::now() + chrono::Duration::minutes(5);
        let artifacts = HashMap::from([(
            handle.clone(),
            CaptureArtifact {
                account_id: account_id.clone(),
                session_id: session_id.clone(),
                intent_id: intent_id.clone(),
                path,
                expires_at,
            },
        )]);

        let replay = replay_capture_for_intent(&artifacts, &account_id, &session_id, &intent_id);

        assert!(matches!(
            replay,
            Some(CaptureResult::Captured { local_handle, .. }) if local_handle == handle
        ));
    }

    #[test]
    fn same_active_capture_intent_is_identified_for_non_terminal_replay() {
        let account_id = Uuid::new_v4().to_string();
        let session_id = Uuid::new_v4().to_string();
        let intent_id = Uuid::new_v4().to_string();
        let active = ActiveCapture {
            account_id: account_id.clone(),
            session_id: session_id.clone(),
            intent_id: intent_id.clone(),
            output: PathBuf::from("/tmp/synthetic-capture.png"),
            binding_key_id: Arc::new(Mutex::new(Some(Uuid::new_v4().to_string()))),
            child: Arc::new(Mutex::new(None)),
            cancelled: Arc::new(AtomicBool::new(false)),
        };

        assert!(same_capture_request(
            &active,
            &canonical_uuid("accountId", &account_id.to_uppercase()).expect("canonical account"),
            &canonical_uuid("sessionId", &session_id.to_uppercase()).expect("canonical session"),
            &canonical_uuid("intentId", &intent_id.to_uppercase()).expect("canonical intent"),
        ));
    }

    #[test]
    fn started_capture_receipt_never_restarts_a_picker() {
        let replay = replay_capture_receipt_status(CaptureReceiptStatus::Started);

        assert!(replay.is_err());
        assert!(
            replay
                .expect_err("started receipt is non-terminal")
                .contains("未启动新的系统选择器")
        );
    }

    #[test]
    fn confirmed_invalidation_terminalizes_started_receipt_and_releases_scope() {
        let account_id = Uuid::new_v4().to_string();
        let session_id = Uuid::new_v4().to_string();
        let intent_id = Uuid::new_v4().to_string();
        let mut journal = CaptureReceiptJournal::default();
        upsert_capture_receipt(
            &mut journal,
            &account_id,
            &session_id,
            &intent_id,
            CaptureReceiptStatus::Started,
        )
        .expect("started receipt");
        assert!(scope_has_started_receipt(
            &journal,
            &account_id,
            &session_id
        ));

        upsert_capture_receipt(
            &mut journal,
            &account_id,
            &session_id,
            &intent_id,
            CaptureReceiptStatus::Cancelled,
        )
        .expect("terminal receipt");

        assert!(!scope_has_started_receipt(
            &journal,
            &account_id,
            &session_id
        ));
        assert!(matches!(
            replay_capture_receipt_status(journal.receipts[0].status),
            Ok(CaptureResult::Cancelled)
        ));
    }

    #[test]
    fn unresolved_started_receipt_blocks_a_new_intent_in_the_same_scope() {
        let account_id = Uuid::new_v4().to_string();
        let session_id = Uuid::new_v4().to_string();
        let journal = CaptureReceiptJournal {
            receipts: vec![CaptureReceipt {
                account_id: account_id.clone(),
                session_id: session_id.clone(),
                intent_id: Uuid::new_v4().to_string(),
                status: CaptureReceiptStatus::Started,
                retain_until: Utc::now() + chrono::Duration::hours(1),
            }],
        };

        assert!(scope_has_started_receipt(
            &journal,
            &account_id,
            &session_id
        ));
    }

    #[test]
    fn receipt_quota_never_evicts_an_unresolved_started_intent() {
        let account_id = Uuid::new_v4().to_string();
        let session_id = Uuid::new_v4().to_string();
        let started_intent = Uuid::new_v4().to_string();
        let mut journal = CaptureReceiptJournal {
            receipts: vec![CaptureReceipt {
                account_id: account_id.clone(),
                session_id: session_id.clone(),
                intent_id: started_intent.clone(),
                status: CaptureReceiptStatus::Started,
                retain_until: Utc::now() + chrono::Duration::hours(1),
            }],
        };
        while journal.receipts.len() < MAX_CAPTURE_RECEIPTS {
            journal.receipts.push(CaptureReceipt {
                account_id: Uuid::new_v4().to_string(),
                session_id: Uuid::new_v4().to_string(),
                intent_id: Uuid::new_v4().to_string(),
                status: CaptureReceiptStatus::Failed,
                retain_until: Utc::now() + chrono::Duration::hours(2),
            });
        }

        upsert_capture_receipt(
            &mut journal,
            &Uuid::new_v4().to_string(),
            &Uuid::new_v4().to_string(),
            &Uuid::new_v4().to_string(),
            CaptureReceiptStatus::Failed,
        )
        .expect("evict a terminal receipt");

        assert!(journal.receipts.iter().any(|receipt| {
            receipt.account_id == account_id
                && receipt.session_id == session_id
                && receipt.intent_id == started_intent
                && matches!(receipt.status, CaptureReceiptStatus::Started)
        }));
    }

    #[test]
    fn capture_cache_quota_blocks_unbounded_handle_accumulation() {
        let state = AppState::new().expect("state");
        let directory = tempfile::tempdir().expect("temporary directory");
        for _ in 0..MAX_CAPTURE_ARTIFACTS {
            let handle = Uuid::new_v4().to_string();
            let path = directory.path().join(format!("{handle}.png"));
            fs::write(&path, b"synthetic").expect("write capture");
            state.artifacts.lock().expect("artifacts").insert(
                handle.clone(),
                CaptureArtifact {
                    account_id: Uuid::new_v4().to_string(),
                    session_id: Uuid::new_v4().to_string(),
                    intent_id: Uuid::new_v4().to_string(),
                    path,
                    expires_at: Utc::now() + chrono::Duration::minutes(5),
                },
            );
        }

        assert!(enforce_capture_quota(&state, 1).is_err());
    }

    #[test]
    fn artifact_cleanup_continues_after_one_entry_cannot_be_deleted() {
        let state = AppState::new().expect("state");
        let directory = tempfile::tempdir().expect("temporary directory");
        let blocked = directory.path().join("blocked");
        fs::create_dir(&blocked).expect("blocked directory fixture");
        let removable = directory.path().join("removable.png");
        fs::write(&removable, b"synthetic").expect("removable fixture");
        let expires_at = Utc::now() - chrono::Duration::minutes(1);
        for (handle, path) in [
            ("blocked", blocked.clone()),
            ("removable", removable.clone()),
        ] {
            state.artifacts.lock().expect("artifacts").insert(
                handle.into(),
                CaptureArtifact {
                    account_id: Uuid::new_v4().to_string(),
                    session_id: Uuid::new_v4().to_string(),
                    intent_id: Uuid::new_v4().to_string(),
                    path,
                    expires_at,
                },
            );
        }

        assert!(purge_expired_artifacts(&state).is_err());
        assert!(!removable.exists());
        assert!(blocked.exists());
        assert_eq!(state.artifacts.lock().expect("artifacts").len(), 1);
    }

    #[test]
    fn ocr_stdout_is_drained_while_the_child_is_running() {
        let mut child = Command::new("/bin/sh")
            .args(["-c", "dd if=/dev/zero bs=1024 count=200 2>/dev/null"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn output fixture");
        let stdout = child.stdout.take().expect("piped stdout");
        let active = ActiveOcr {
            account_id: Uuid::new_v4().to_string(),
            session_id: Uuid::new_v4().to_string(),
            local_handle: Uuid::new_v4().to_string(),
            child: Arc::new(Mutex::new(Some(child))),
            stdout_reader: Arc::new(Mutex::new(Some(spawn_capped_stdout_reader(stdout)))),
            cancelled: Arc::new(AtomicBool::new(false)),
        };

        let result = wait_for_ocr(&active);
        assert!(matches!(
            result,
            OcrProcessExit::Completed(output) if output.stdout.len() == 200 * 1024
        ));
    }

    #[test]
    fn legacy_single_key_revocation_record_remains_recoverable() {
        let key_id = Uuid::new_v4().to_string();
        let pending: PendingRevocation = serde_json::from_value(serde_json::json!({
            "keyId": key_id,
        }))
        .expect("legacy revocation record");

        assert_eq!(pending.key_id.as_deref(), Some(key_id.as_str()));
        assert!(pending.key_ids.is_empty());
    }

    #[test]
    fn disconnect_cleanup_attempts_current_and_superseded_keychain_entries() {
        let old_key = Uuid::new_v4().to_string();
        let current_key = Uuid::new_v4().to_string();
        let mut attempted = Vec::new();
        let retained =
            failed_keychain_deletions(&[old_key.clone(), current_key.clone()], |key_id| {
                attempted.push(key_id.to_string());
                if key_id == old_key {
                    Err("synthetic deletion failure".into())
                } else {
                    Ok(())
                }
            })
            .expect("deletion policy");

        assert_eq!(attempted, vec![old_key.clone(), current_key]);
        assert_eq!(retained, vec![old_key]);
    }

    #[test]
    fn keychain_read_errors_distinguish_missing_from_unreadable() {
        assert_eq!(
            keychain_read_error(KeyringError::NoEntry),
            "Keychain 中没有可用的本机连接令牌。"
        );
        assert_eq!(
            keychain_read_error(KeyringError::BadStoreFormat("synthetic".into())),
            "无法从 macOS Keychain 读取本机连接令牌；本机连接保持关闭。"
        );
    }
}
