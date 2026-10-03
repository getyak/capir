mod backend;
mod models;
mod native;

use native::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState::new().expect("initialize bounded native state");
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .manage(state)
        .setup(|app| {
            native::purge_capture_cache_on_startup(app.handle()).map_err(std::io::Error::other)?;
            native::start_capture_janitor(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            native::activate_session_binding,
            native::session_binding_status,
            native::disconnect_session_binding,
            native::desktop_capabilities,
            native::capture_selected_window,
            native::cancel_capture,
            native::recognize_local_text,
            native::cancel_ocr,
            native::open_quick_panel,
            native::notify_state,
        ])
        .build(tauri::generate_context!())
        .expect("build capri Hybrid");
    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            native::shutdown_native_state(app_handle);
        }
    });
}
