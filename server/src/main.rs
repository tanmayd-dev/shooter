pub mod physics;
pub mod protocol;
pub mod room;
pub mod state;

use std::collections::VecDeque;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{Html, IntoResponse};
use axum::routing::get;
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio::sync::{mpsc, oneshot};
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use tracing::{debug, error, info, warn};

use crate::protocol::{ClientMessage, ServerMessage};
use crate::room::{RoomCommand, RoomHandle, RoomManager};

fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Sliding window rate limiter to track packet timestamps and enforce rate limits per second.
#[derive(Debug, Clone)]
pub struct SlidingWindowLimiter {
    pub max_packets: usize,
    pub window: Duration,
    pub timestamps: VecDeque<Instant>,
}

impl SlidingWindowLimiter {
    pub fn new(max_packets: usize, window: Duration) -> Self {
        Self {
            max_packets,
            window,
            timestamps: VecDeque::with_capacity(max_packets + 1),
        }
    }

    pub fn allow_at(&mut self, now: Instant) -> bool {
        while let Some(&front) = self.timestamps.front() {
            if now.duration_since(front) > self.window {
                self.timestamps.pop_front();
            } else {
                break;
            }
        }

        if self.timestamps.len() < self.max_packets {
            self.timestamps.push_back(now);
            true
        } else {
            false
        }
    }

    pub fn allow(&mut self) -> bool {
        self.allow_at(Instant::now())
    }
}

/// Sanitizes player display name: whitelist alphanumeric, spaces, dashes, underscores, max 16 chars.
pub fn sanitize_player_name(name: &str) -> String {
    let clean: String = name
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-' || *c == ' ')
        .take(16)
        .collect();
    let trimmed = clean.trim().to_string();
    if trimmed.is_empty() {
        "PILOT".to_string()
    } else {
        trimmed
    }
}

/// Validates and clamps float input to [-1.0, 1.0]. If non-finite, returns 0.0.
pub fn validate_and_clamp_float(val: f32) -> f32 {
    if val.is_finite() {
        val.clamp(-1.0, 1.0)
    } else {
        0.0
    }
}

#[derive(Clone)]
pub struct AppState {
    pub room_manager: Arc<RoomManager>,
    /// Bounds concurrent WebSocket clients so idle sockets cannot exhaust RAM.
    pub connections: Arc<tokio::sync::Semaphore>,
}

pub const MAX_CONNECTIONS: usize = 512;

pub fn create_app(room_manager: Arc<RoomManager>) -> Router {
    let state = AppState {
        room_manager,
        connections: Arc::new(tokio::sync::Semaphore::new(MAX_CONNECTIONS)),
    };

    let mut app = Router::new()
        .route("/health", get(health_handler))
        .route("/ws", get(ws_handler))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let dist_paths = [
        Path::new("client/dist"),
        Path::new("../client/dist"),
    ];
    let found_dist = dist_paths.iter().find(|p| p.exists() && p.is_dir());

    if let Some(dist_dir) = found_dist {
        info!("Serving static files from {:?}", dist_dir);
        app = app.fallback_service(ServeDir::new(dist_dir));
    } else {
        info!("client/dist not found, static file serving inactive");
        app = app.fallback(fallback_handler);
    }

    app
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let room_manager = Arc::new(RoomManager::new());

    // Periodically evict rooms whose simulation task has exited.
    let reaper = Arc::clone(&room_manager);
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        loop {
            interval.tick().await;
            reaper.clean_inactive_rooms().await;
        }
    });

    let app = create_app(room_manager);

    let bind_host = std::env::var("SHOOTER_BIND").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = std::env::var("SHOOTER_PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(8080);
    let addr: SocketAddr = format!("{bind_host}:{port}")
        .parse()
        .expect("Invalid SHOOTER_BIND / SHOOTER_PORT");
    info!("Shooter server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind TCP listener");

    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
            info!("Shutdown signal received");
        })
        .await
        .expect("Server terminated unexpectedly");
}

async fn health_handler() -> impl IntoResponse {
    Json(json!({ "status": "ok" }))
}

async fn fallback_handler() -> impl IntoResponse {
    Html("<h1>Shooter Arena Server</h1><p>Status: Running. Connect WebSocket at /ws</p>")
}

/// Allows same-origin localhost dev clients, Cloudflare Pages deployments, and
/// any explicitly configured origins. Missing Origin (native/test clients) is allowed.
fn is_allowed_origin(headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get(header::ORIGIN) else {
        return true;
    };
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    if origin == "null" {
        return false;
    }

    if let Ok(list) = std::env::var("SHOOTER_ALLOWED_ORIGINS") {
        let configured = list
            .split(',')
            .map(str::trim)
            .filter(|o| !o.is_empty())
            .any(|o| o == origin);
        if configured {
            return true;
        }
    }

    let lower = origin.to_ascii_lowercase();
    lower.starts_with("http://localhost:")
        || lower == "http://localhost"
        || lower.starts_with("http://127.0.0.1:")
        || lower == "http://127.0.0.1"
        || lower.starts_with("https://localhost:")
        || lower == "https://localhost"
        || (lower.starts_with("https://") && lower.ends_with(".pages.dev"))
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    headers: HeaderMap,
    State(state): State<AppState>,
) -> impl IntoResponse {
    if !is_allowed_origin(&headers) {
        warn!("Rejected WebSocket upgrade from disallowed origin");
        return (StatusCode::FORBIDDEN, "Forbidden origin").into_response();
    }

    let permit = match Arc::clone(&state.connections).try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => {
            warn!("Rejected WebSocket upgrade: connection cap reached");
            return (StatusCode::SERVICE_UNAVAILABLE, "Server full").into_response();
        }
    };

    ws.max_message_size(64 * 1024)
        .max_frame_size(16 * 1024)
        .max_write_buffer_size(1 << 20)
        .read_buffer_size(8 * 1024)
        .write_buffer_size(8 * 1024)
        .on_upgrade(move |socket| async move {
            let _permit = permit;
            handle_socket(socket, state).await;
        })
        .into_response()
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut ws_sender, mut ws_receiver) = socket.split();
    let (client_tx, mut client_rx) = mpsc::unbounded_channel::<ServerMessage>();

    let player_id = format!(
        "p_{:016x}{:016x}",
        rand::random::<u64>(),
        rand::random::<u64>()
    );
    let mut current_room: Option<RoomHandle> = None;

    // Rate limiters per connection: max 120 input packets/sec, max 10 lobby commands/sec,
    // max 30 voice signals/sec, max 5 pings/sec
    let mut input_limiter = SlidingWindowLimiter::new(120, Duration::from_secs(1));
    let mut lobby_limiter = SlidingWindowLimiter::new(10, Duration::from_secs(1));
    let mut voice_limiter = SlidingWindowLimiter::new(30, Duration::from_secs(1));
    let mut ping_limiter = SlidingWindowLimiter::new(5, Duration::from_secs(1));

    // Outgoing forwarder task. A stalled peer is disconnected instead of
    // letting the unbounded queue grow without limit.
    let send_task = tokio::spawn(async move {
        while let Some(msg) = client_rx.recv().await {
            if let Ok(json_str) = serde_json::to_string(&msg) {
                let send_fut = ws_sender.send(Message::Text(json_str.into()));
                match tokio::time::timeout(Duration::from_secs(5), send_fut).await {
                    Ok(Ok(())) => {}
                    _ => break,
                }
            }
        }
    });

    // Incoming messages (30s idle timeout; the client pings every few seconds)
    loop {
        let msg_result = match tokio::time::timeout(
            Duration::from_secs(30),
            ws_receiver.next(),
        )
        .await
        {
            Ok(Some(result)) => result,
            Ok(None) => break,
            Err(_) => {
                debug!("Closing idle WebSocket connection {}", player_id);
                break;
            }
        };

        match msg_result {
            Ok(Message::Text(text)) => {
                if text.len() > 64 * 1024 {
                    debug!("Closing {}: oversized text frame", player_id);
                    break;
                }
                match serde_json::from_str::<ClientMessage>(text.as_str()) {
                    Ok(client_msg) => match client_msg {
                        ClientMessage::Ping { client_time } => {
                            if !ping_limiter.allow() {
                                debug!("Rate limit exceeded: ping flood from {}", player_id);
                                continue;
                            }
                            let _ = client_tx.send(ServerMessage::Pong {
                                client_time,
                                server_time: current_time_ms(),
                            });
                        }
                        ClientMessage::JoinLobby {
                            name,
                            room_code,
                            car_type,
                        } => {
                            if !lobby_limiter.allow() {
                                debug!("Rate limit exceeded: lobby command flood from {}", player_id);
                                continue;
                            }

                            // Input sanitization:
                            // Whitelist alphanumeric, spaces, dashes, underscores, max 16 chars
                            let clean_name = sanitize_player_name(&name);

                            let clean_car_type = match car_type.to_lowercase().as_str() {
                                "desert" => "desert".to_string(),
                                "rally" => "rally".to_string(),
                                "apex" => "apex".to_string(),
                                "titan" => "titan".to_string(),
                                _ => "stadium".to_string(),
                            };

                            let clean_room_code = room_code.and_then(|rc| {
                                let cleaned: String = rc
                                    .chars()
                                    .filter(|c| c.is_alphanumeric())
                                    .take(8)
                                    .collect::<String>()
                                    .to_uppercase();
                                if cleaned.is_empty() {
                                    None
                                } else {
                                    Some(cleaned)
                                }
                            });

                            // If player was already in a room, leave it
                            if let Some(ref handle) = current_room {
                                let _ = handle.command_tx.send(RoomCommand::Leave {
                                    player_id: player_id.clone(),
                                });
                                current_room = None;
                            }

                            match state.room_manager.join_or_create(clean_room_code).await {
                                Ok((_, handle)) => {
                                    let (reply_tx, reply_rx) = oneshot::channel();
                                    let join_cmd = RoomCommand::Join {
                                        player_id: player_id.clone(),
                                        name: clean_name,
                                        car_type: clean_car_type,
                                        sender: client_tx.clone(),
                                        reply: reply_tx,
                                    };

                                    if handle.command_tx.send(join_cmd).is_ok() {
                                        match reply_rx.await {
                                            Ok(Ok(_is_host)) => {
                                                current_room = Some(handle);
                                            }
                                            Ok(Err(err_msg)) => {
                                                let _ = client_tx.send(ServerMessage::Error {
                                                    message: err_msg,
                                                });
                                            }
                                            Err(_) => {
                                                let _ = client_tx.send(ServerMessage::Error {
                                                    message: "Failed to join room".to_string(),
                                                });
                                            }
                                        }
                                    } else {
                                        let _ = client_tx.send(ServerMessage::Error {
                                            message: "Room is not accepting connections".to_string(),
                                        });
                                    }
                                }
                                Err(err_msg) => {
                                    let _ = client_tx.send(ServerMessage::Error {
                                        message: err_msg,
                                    });
                                }
                            }
                        }
                        ClientMessage::SetReady { ready } => {
                            if !lobby_limiter.allow() {
                                debug!("Rate limit exceeded: lobby command flood from {}", player_id);
                                continue;
                            }
                            if let Some(ref handle) = current_room {
                                let _ = handle.command_tx.send(RoomCommand::SetReady {
                                    player_id: player_id.clone(),
                                    ready,
                                });
                            }
                        }
                        ClientMessage::SelectCar { car_type } => {
                            if !lobby_limiter.allow() {
                                debug!("Rate limit exceeded: lobby command flood from {}", player_id);
                                continue;
                            }
                            let clean_car_type = match car_type.to_lowercase().as_str() {
                                "desert" => "desert".to_string(),
                                "rally" => "rally".to_string(),
                                "apex" => "apex".to_string(),
                                "titan" => "titan".to_string(),
                                _ => "stadium".to_string(),
                            };
                            if let Some(ref handle) = current_room {
                                let _ = handle.command_tx.send(RoomCommand::SelectCar {
                                    player_id: player_id.clone(),
                                    car_type: clean_car_type,
                                });
                            }
                        }
                        ClientMessage::StartGame => {
                            if !lobby_limiter.allow() {
                                debug!("Rate limit exceeded: lobby command flood from {}", player_id);
                                continue;
                            }
                            if let Some(ref handle) = current_room {
                                let (reply_tx, reply_rx) = oneshot::channel();
                                if handle
                                    .command_tx
                                    .send(RoomCommand::StartGame {
                                        player_id: player_id.clone(),
                                        reply: reply_tx,
                                    })
                                    .is_ok()
                                {
                                    if let Ok(Err(err_msg)) = reply_rx.await {
                                        let _ = client_tx.send(ServerMessage::Error {
                                            message: err_msg,
                                        });
                                    }
                                }
                            }
                        }
                        ClientMessage::PlayerInput {
                            sequence,
                            throttle,
                            steer,
                            brake,
                            fire_primary,
                            fire_special,
                            ability_mobility,
                            ability_utility,
                            turnaround,
                        } => {
                            if !input_limiter.allow() {
                                debug!("Rate limit exceeded: input packet flood from {}", player_id);
                                continue;
                            }

                            // Float validation: verify throttle.is_finite() && steer.is_finite().
                            // If non-finite, clamp to 0.0. Clamp throttle to [-1.0, 1.0], steer to [-1.0, 1.0].
                            let valid_throttle = validate_and_clamp_float(throttle);
                            let valid_steer = validate_and_clamp_float(steer);

                            if let Some(ref handle) = current_room {
                                let input = crate::protocol::PlayerInput {
                                    sequence,
                                    throttle: valid_throttle,
                                    steer: valid_steer,
                                    brake,
                                    fire_primary,
                                    fire_special,
                                    ability_mobility,
                                    ability_utility,
                                    turnaround,
                                };
                                let _ = handle.command_tx.send(RoomCommand::Input {
                                    player_id: player_id.clone(),
                                    input,
                                });
                            }
                        }
                        ClientMessage::VoiceSignal {
                            target_player_id,
                            signal_data,
                        } => {
                            if !voice_limiter.allow() {
                                debug!("Rate limit exceeded: voice signal flood from {}", player_id);
                                continue;
                            }

                            // Payload size verification: max 8192 bytes
                            if signal_data.len() > 8192 {
                                debug!(
                                    "VoiceSignal from {} exceeded payload limit ({} bytes)",
                                    player_id,
                                    signal_data.len()
                                );
                                continue;
                            }

                            if let Some(ref handle) = current_room {
                                let _ = handle.command_tx.send(RoomCommand::VoiceSignal {
                                    from_player_id: player_id.clone(),
                                    target_player_id,
                                    signal_data,
                                });
                            }
                        }
                    },
                    Err(e) => {
                        debug!("Failed to parse client message: {:?}", e);
                    }
                }
            }
            Ok(Message::Close(_)) => break,
            Ok(Message::Ping(_)) => {}
            Err(e) => {
                error!("WebSocket receive error: {:?}", e);
                break;
            }
            _ => {}
        }
    }

    // Client cleanup
    if let Some(handle) = current_room {
        let _ = handle.command_tx.send(RoomCommand::Leave {
            player_id: player_id.clone(),
        });
    }

    send_task.abort();
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    #[tokio::test]
    async fn test_health_endpoint() {
        let room_manager = Arc::new(RoomManager::new());
        let app = create_app(room_manager);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["status"], "ok");
    }

    #[tokio::test]
    async fn test_room_join_sends_lobby_update_with_your_id() {
        let room_manager = RoomManager::new();
        let (_code, handle) = room_manager.create_room().await.unwrap();
        let (client_tx, mut client_rx) = mpsc::unbounded_channel::<ServerMessage>();
        let (reply_tx, reply_rx) = oneshot::channel();

        let player_id = "p_test123".to_string();
        handle
            .command_tx
            .send(RoomCommand::Join {
                player_id: player_id.clone(),
                name: "TestRunner".into(),
                car_type: "stadium".into(),
                sender: client_tx,
                reply: reply_tx,
            })
            .unwrap();

        let join_result = reply_rx.await.unwrap();
        assert!(join_result.is_ok());

        let msg = client_rx.recv().await.unwrap();
        match msg {
            ServerMessage::LobbyUpdate { your_id, is_host, .. } => {
                assert_eq!(your_id, player_id);
                assert!(is_host);
            }
            other => panic!("Expected LobbyUpdate, got {:?}", other),
        }
    }

    #[test]
    fn test_sliding_window_rate_limiter() {
        let mut limiter = SlidingWindowLimiter::new(3, Duration::from_millis(100));
        let now = Instant::now();

        // 3 calls within window should succeed
        assert!(limiter.allow_at(now));
        assert!(limiter.allow_at(now + Duration::from_millis(10)));
        assert!(limiter.allow_at(now + Duration::from_millis(20)));

        // 4th call within same window should fail
        assert!(!limiter.allow_at(now + Duration::from_millis(30)));
        assert!(!limiter.allow_at(now + Duration::from_millis(90)));

        // After window expires (>100ms from first call), new calls should be permitted
        assert!(limiter.allow_at(now + Duration::from_millis(115)));

        // Verify lobby rate limit: exactly 10 allowed, 11th rejected
        let mut lobby_limiter = SlidingWindowLimiter::new(10, Duration::from_secs(1));
        for _ in 0..10 {
            assert!(lobby_limiter.allow_at(now));
        }
        assert!(!lobby_limiter.allow_at(now + Duration::from_millis(500)));

        // Verify input rate limit: exactly 120 allowed, 121st rejected
        let mut input_limiter = SlidingWindowLimiter::new(120, Duration::from_secs(1));
        for _ in 0..120 {
            assert!(input_limiter.allow_at(now));
        }
        assert!(!input_limiter.allow_at(now + Duration::from_millis(500)));
    }

    #[test]
    fn test_sanitize_player_name() {
        // Normal name passes
        assert_eq!(sanitize_player_name("Speedy_99"), "Speedy_99");

        // Spaces and hyphens allowed
        assert_eq!(sanitize_player_name("Drift King-01"), "Drift King-01");

        // Special characters filtered out
        assert_eq!(sanitize_player_name("Hacker<script>"), "Hackerscript");

        // Name truncated to 16 characters
        assert_eq!(sanitize_player_name("A_Very_Long_Name_Exceeding_Sixteen"), "A_Very_Long_Name");

        // Empty or non-alphanumeric defaults to PILOT
        assert_eq!(sanitize_player_name(""), "PILOT");
        assert_eq!(sanitize_player_name("   "), "PILOT");
        assert_eq!(sanitize_player_name("!@#$%^&*()"), "PILOT");
    }

    #[test]
    fn test_validate_and_clamp_float() {
        // Valid floats in range
        assert_eq!(validate_and_clamp_float(0.5), 0.5);
        assert_eq!(validate_and_clamp_float(-0.75), -0.75);

        // Clamping out-of-range floats
        assert_eq!(validate_and_clamp_float(1.5), 1.0);
        assert_eq!(validate_and_clamp_float(-5.0), -1.0);

        // Non-finite floats return 0.0
        assert_eq!(validate_and_clamp_float(f32::NAN), 0.0);
        assert_eq!(validate_and_clamp_float(f32::INFINITY), 0.0);
        assert_eq!(validate_and_clamp_float(f32::NEG_INFINITY), 0.0);
    }
}
