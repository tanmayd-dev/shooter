pub mod physics;
pub mod protocol;
pub mod room;
pub mod state;

use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::{Html, IntoResponse};
use axum::routing::get;
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio::sync::{mpsc, oneshot};
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use tracing::{error, info, warn};

use crate::protocol::{ClientMessage, ServerMessage};
use crate::room::{generate_room_code, RoomCommand, RoomHandle, RoomManager};

fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Clone)]
pub struct AppState {
    pub room_manager: Arc<RoomManager>,
}

pub fn create_app(room_manager: Arc<RoomManager>) -> Router {
    let state = AppState { room_manager };

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
    let app = create_app(room_manager);

    let addr = SocketAddr::from(([0, 0, 0, 0], 8080));
    info!("Shooter server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind TCP listener to 0.0.0.0:8080");

    axum::serve(listener, app)
        .await
        .expect("Server terminated unexpectedly");
}

async fn health_handler() -> impl IntoResponse {
    Json(json!({ "status": "ok" }))
}

async fn fallback_handler() -> impl IntoResponse {
    Html("<h1>Shooter Arena Server</h1><p>Status: Running. Connect WebSocket at /ws</p>")
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut ws_sender, mut ws_receiver) = socket.split();
    let (client_tx, mut client_rx) = mpsc::unbounded_channel::<ServerMessage>();

    let player_id = format!("p_{}", generate_room_code().to_lowercase());
    let mut current_room: Option<RoomHandle> = None;

    // Outgoing forwarder task
    let send_task = tokio::spawn(async move {
        while let Some(msg) = client_rx.recv().await {
            if let Ok(json_str) = serde_json::to_string(&msg) {
                if ws_sender.send(Message::Text(json_str.into())).await.is_err() {
                    break;
                }
            }
        }
    });

    // Incoming messages
    while let Some(msg_result) = ws_receiver.next().await {
        match msg_result {
            Ok(Message::Text(text)) => {
                match serde_json::from_str::<ClientMessage>(text.as_str()) {
                    Ok(client_msg) => match client_msg {
                        ClientMessage::Ping { client_time } => {
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
                            // If player was already in a room, leave it
                            if let Some(ref handle) = current_room {
                                let _ = handle.command_tx.send(RoomCommand::Leave {
                                    player_id: player_id.clone(),
                                });
                                current_room = None;
                            }

                            match state.room_manager.join_or_create(room_code).await {
                                Ok((_, handle)) => {
                                    let (reply_tx, reply_rx) = oneshot::channel();
                                    let join_cmd = RoomCommand::Join {
                                        player_id: player_id.clone(),
                                        name,
                                        car_type,
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
                            if let Some(ref handle) = current_room {
                                let _ = handle.command_tx.send(RoomCommand::SetReady {
                                    player_id: player_id.clone(),
                                    ready,
                                });
                            }
                        }
                        ClientMessage::SelectCar { car_type } => {
                            if let Some(ref handle) = current_room {
                                let _ = handle.command_tx.send(RoomCommand::SelectCar {
                                    player_id: player_id.clone(),
                                    car_type,
                                });
                            }
                        }
                        ClientMessage::StartGame => {
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
                        } => {
                            if let Some(ref handle) = current_room {
                                let input = crate::protocol::PlayerInput {
                                    sequence,
                                    throttle,
                                    steer,
                                    brake,
                                    fire_primary,
                                    fire_special,
                                    ability_mobility,
                                    ability_utility,
                                };
                                let _ = handle.command_tx.send(RoomCommand::Input {
                                    player_id: player_id.clone(),
                                    input,
                                });
                            }
                        }
                    },
                    Err(e) => {
                        warn!("Failed to parse client message: {:?}", e);
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
        let (_code, handle) = room_manager.create_room().await;
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
}
