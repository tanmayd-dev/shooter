use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use rand::Rng;
use tokio::sync::{mpsc, oneshot, RwLock};

use crate::physics::Arena;
use crate::protocol::{
    LobbyPlayer, PlayerInput, ServerMessage,
};
use crate::state::{GameOverInfo, GameState};

pub const MAX_PLAYERS_PER_ROOM: usize = 8;
pub const COUNTDOWN_SECS: f32 = 3.0;

/// Generates a clean 4-letter uppercase room code.
pub fn generate_room_code() -> String {
    const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = rand::rng();
    (0..4)
        .map(|_| {
            let idx = rng.random_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoomStatus {
    Waiting,
    Starting,
    Playing,
    GameOver,
}

impl RoomStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            RoomStatus::Waiting => "waiting",
            RoomStatus::Starting => "starting",
            RoomStatus::Playing => "playing",
            RoomStatus::GameOver => "game_over",
        }
    }
}

pub struct RoomPlayer {
    pub id: String,
    pub name: String,
    pub car_type: String,
    pub is_host: bool,
    pub ready: bool,
    pub sender: Option<mpsc::UnboundedSender<ServerMessage>>,
}

pub enum RoomCommand {
    Join {
        player_id: String,
        name: String,
        car_type: String,
        sender: mpsc::UnboundedSender<ServerMessage>,
        reply: oneshot::Sender<Result<bool, String>>,
    },
    Leave {
        player_id: String,
    },
    SetReady {
        player_id: String,
        ready: bool,
    },
    SelectCar {
        player_id: String,
        car_type: String,
    },
    StartGame {
        player_id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Input {
        player_id: String,
        input: PlayerInput,
    },
}

pub struct Room {
    pub code: String,
    pub status: RoomStatus,
    pub players: Vec<RoomPlayer>,
    pub host_id: Option<String>,
    pub map_name: String,
    pub countdown: f32,
    pub arena: Arena,
    pub game_state: Option<GameState>,
    pub latest_inputs: HashMap<String, PlayerInput>,
}

impl Room {
    pub fn new(code: String) -> Self {
        Self {
            code,
            status: RoomStatus::Waiting,
            players: Vec::new(),
            host_id: None,
            map_name: "neon_stadium".to_string(),
            countdown: COUNTDOWN_SECS,
            arena: Arena::default_arena(),
            game_state: None,
            latest_inputs: HashMap::new(),
        }
    }

    pub fn get_lobby_players(&self) -> Vec<LobbyPlayer> {
        self.players
            .iter()
            .map(|p| LobbyPlayer {
                id: p.id.clone(),
                name: p.name.clone(),
                car_type: p.car_type.clone(),
                is_host: p.is_host,
                ready: p.ready,
            })
            .collect()
    }

    pub fn broadcast(&self, msg: &ServerMessage) {
        for p in &self.players {
            if let Some(ref sender) = p.sender {
                let _ = sender.send(msg.clone());
            }
        }
    }

    pub fn send_lobby_update(&self) {
        let lobby_players = self.get_lobby_players();
        let countdown_val = if self.status == RoomStatus::Starting {
            Some(self.countdown.ceil() as u32)
        } else {
            None
        };

        for p in &self.players {
            if let Some(ref sender) = p.sender {
                let msg = ServerMessage::LobbyUpdate {
                    your_id: p.id.clone(),
                    room_code: self.code.clone(),
                    is_host: p.is_host,
                    players: lobby_players.clone(),
                    status: self.status.as_str().to_string(),
                    map: self.map_name.clone(),
                    countdown: countdown_val,
                };
                let _ = sender.send(msg);
            }
        }
    }

    pub fn add_player(
        &mut self,
        id: String,
        name: String,
        car_type: String,
        sender: Option<mpsc::UnboundedSender<ServerMessage>>,
    ) -> Result<bool, String> {
        if self.players.len() >= MAX_PLAYERS_PER_ROOM {
            return Err("Room is full".to_string());
        }

        if self.status != RoomStatus::Waiting && self.status != RoomStatus::GameOver {
            return Err("Game already in progress".to_string());
        }

        let is_host = self.players.is_empty();
        if is_host {
            self.host_id = Some(id.clone());
        }

        let new_player = RoomPlayer {
            id: id.clone(),
            name,
            car_type,
            is_host,
            ready: is_host, // host is ready by default
            sender,
        };

        self.players.push(new_player);
        self.send_lobby_update();

        Ok(is_host)
    }

    pub fn remove_player(&mut self, player_id: &str) {
        let was_host = self
            .host_id
            .as_ref()
            .map(|h| h == player_id)
            .unwrap_or(false);

        self.players.retain(|p| p.id != player_id);
        self.latest_inputs.remove(player_id);

        if was_host && !self.players.is_empty() {
            self.players[0].is_host = true;
            self.players[0].ready = true;
            self.host_id = Some(self.players[0].id.clone());
        } else if self.players.is_empty() {
            self.host_id = None;
        }

        if self.status == RoomStatus::Playing {
            if let Some(ref mut game) = self.game_state {
                game.cars.remove(player_id);
            }
        }

        self.send_lobby_update();
    }

    pub fn set_ready(&mut self, player_id: &str, ready: bool) {
        if let Some(p) = self.players.iter_mut().find(|p| p.id == player_id) {
            p.ready = ready;
            self.send_lobby_update();
        }
    }

    pub fn select_car(&mut self, player_id: &str, car_type: String) {
        if let Some(p) = self.players.iter_mut().find(|p| p.id == player_id) {
            p.car_type = car_type;
            self.send_lobby_update();
        }
    }

    pub fn start_game(&mut self, player_id: &str) -> Result<(), String> {
        let is_host = self
            .host_id
            .as_ref()
            .map(|h| h == player_id)
            .unwrap_or(false);

        if !is_host {
            return Err("Only the lobby host can start the game".to_string());
        }

        if self.status != RoomStatus::Waiting {
            return Err("Match is already starting or running".to_string());
        }

        self.status = RoomStatus::Starting;
        self.countdown = COUNTDOWN_SECS;

        self.broadcast(&ServerMessage::GameStart {
            map: self.map_name.clone(),
            tick_rate: 60,
            countdown: COUNTDOWN_SECS as u32,
        });
        self.send_lobby_update();

        Ok(())
    }

    pub fn set_input(&mut self, player_id: &str, input: PlayerInput) {
        self.latest_inputs.insert(player_id.to_string(), input);
    }

    pub fn tick(&mut self, dt: f32) -> Option<GameOverInfo> {
        match self.status {
            RoomStatus::Waiting => None,
            RoomStatus::Starting => {
                let prev_sec = self.countdown.ceil() as u32;
                self.countdown = (self.countdown - dt).max(0.0);
                let curr_sec = self.countdown.ceil() as u32;

                if curr_sec < prev_sec && curr_sec > 0 {
                    self.send_lobby_update();
                }

                if self.countdown <= 0.0 {
                    self.status = RoomStatus::Playing;
                    let lobby_players = self.get_lobby_players();
                    self.game_state = Some(GameState::new(&lobby_players, &self.arena));

                    self.broadcast(&ServerMessage::GameStart {
                        map: self.map_name.clone(),
                        tick_rate: 60,
                        countdown: 0,
                    });
                }
                None
            }
            RoomStatus::Playing => {
                if let Some(ref mut game) = self.game_state {
                    let game_over = game.step(dt, &self.latest_inputs, &self.arena);
                    let world_msg = game.to_world_state_message();
                    self.broadcast(&world_msg);

                    if let Some(info) = game_over {
                        self.status = RoomStatus::GameOver;
                        self.broadcast(&ServerMessage::GameOver {
                            winner_id: info.winner_id.clone(),
                            scoreboard: info.scoreboard.clone(),
                        });
                        return Some(info);
                    }
                }
                None
            }
            RoomStatus::GameOver => None,
        }
    }

    pub async fn run(mut self, mut rx: mpsc::UnboundedReceiver<RoomCommand>) {
        let mut interval = tokio::time::interval(Duration::from_millis(16));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        let mut empty_ticks = 0u64;

        loop {
            tokio::select! {
                _ = interval.tick() => {
                    self.tick(1.0 / 60.0);

                    if self.players.is_empty() {
                        empty_ticks += 1;
                        if empty_ticks > 60 * 10 { // 10 seconds of no players
                            break;
                        }
                    } else {
                        empty_ticks = 0;
                    }
                }
                Some(cmd) = rx.recv() => {
                    match cmd {
                        RoomCommand::Join { player_id, name, car_type, sender, reply } => {
                            let res = self.add_player(player_id, name, car_type, Some(sender));
                            let _ = reply.send(res);
                        }
                        RoomCommand::Leave { player_id } => {
                            self.remove_player(&player_id);
                        }
                        RoomCommand::SetReady { player_id, ready } => {
                            self.set_ready(&player_id, ready);
                        }
                        RoomCommand::SelectCar { player_id, car_type } => {
                            self.select_car(&player_id, car_type);
                        }
                        RoomCommand::StartGame { player_id, reply } => {
                            let res = self.start_game(&player_id);
                            let _ = reply.send(res);
                        }
                        RoomCommand::Input { player_id, input } => {
                            self.set_input(&player_id, input);
                        }
                    }
                }
            }
        }
    }
}

#[derive(Clone)]
pub struct RoomHandle {
    pub code: String,
    pub command_tx: mpsc::UnboundedSender<RoomCommand>,
}

pub struct RoomManager {
    pub rooms: Arc<RwLock<HashMap<String, RoomHandle>>>,
}

impl RoomManager {
    pub fn new() -> Self {
        Self {
            rooms: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn create_room(&self) -> (String, RoomHandle) {
        let mut rooms_guard = self.rooms.write().await;
        let mut code = generate_room_code();

        while rooms_guard.contains_key(&code) {
            code = generate_room_code();
        }

        let (tx, rx) = mpsc::unbounded_channel();
        let room = Room::new(code.clone());
        tokio::spawn(room.run(rx));

        let handle = RoomHandle {
            code: code.clone(),
            command_tx: tx,
        };

        rooms_guard.insert(code.clone(), handle.clone());
        (code, handle)
    }

    pub async fn get_room(&self, code: &str) -> Option<RoomHandle> {
        let rooms_guard = self.rooms.read().await;
        rooms_guard.get(&code.to_uppercase()).cloned()
    }

    pub async fn join_or_create(
        &self,
        requested_code: Option<String>,
    ) -> Result<(String, RoomHandle), String> {
        if let Some(code) = requested_code {
            let code_clean = code.trim().to_uppercase();
            if !code_clean.is_empty() {
                if let Some(handle) = self.get_room(&code_clean).await {
                    return Ok((code_clean, handle));
                } else {
                    return Err(format!("Room '{}' not found", code_clean));
                }
            }
        }

        Ok(self.create_room().await)
    }

    pub async fn clean_inactive_rooms(&self) {
        let mut rooms_guard = self.rooms.write().await;
        rooms_guard.retain(|_, handle| !handle.command_tx.is_closed());
    }
}

impl Default for RoomManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::WIN_KILL_COUNT;

    #[test]
    fn test_generate_room_code() {
        for _ in 0..50 {
            let code = generate_room_code();
            assert_eq!(code.len(), 4);
            assert!(code.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()));
        }
    }

    #[test]
    fn test_room_lifecycle() {
        let mut room = Room::new("TEST".to_string());
        assert_eq!(room.status, RoomStatus::Waiting);

        // Host joins
        let res = room.add_player("p1".into(), "Alice".into(), "stadium".into(), None);
        assert!(res.is_ok());
        assert!(res.unwrap()); // is_host == true
        assert_eq!(room.players.len(), 1);
        assert_eq!(room.host_id, Some("p1".to_string()));

        // Second player joins
        let res2 = room.add_player("p2".into(), "Bob".into(), "desert".into(), None);
        assert!(res2.is_ok());
        assert!(!res2.unwrap()); // is_host == false
        assert_eq!(room.players.len(), 2);

        // Bob sets ready
        room.set_ready("p2", true);
        assert!(room.players[1].ready);

        // Non-host attempts start -> error
        assert!(room.start_game("p2").is_err());

        // Host starts game -> enters Starting state
        assert!(room.start_game("p1").is_ok());
        assert_eq!(room.status, RoomStatus::Starting);
        assert_eq!(room.countdown, COUNTDOWN_SECS);

        // Tick through countdown (3 seconds)
        room.tick(1.0);
        assert_eq!(room.status, RoomStatus::Starting);
        room.tick(1.0);
        assert_eq!(room.status, RoomStatus::Starting);
        room.tick(1.1);
        // Now reaches 0 -> Playing!
        assert_eq!(room.status, RoomStatus::Playing);
        assert!(room.game_state.is_some());

        let game = room.game_state.as_mut().unwrap();
        assert_eq!(game.cars.len(), 2);

        // Test scoring up to WIN_KILL_COUNT
        let car1 = game.cars.get_mut("p1").unwrap();
        car1.kills = WIN_KILL_COUNT;

        let game_over = room.tick(1.0 / 60.0);
        assert!(game_over.is_some());
        assert_eq!(room.status, RoomStatus::GameOver);
        assert_eq!(game_over.unwrap().winner_id, "p1");
    }

    #[test]
    fn test_host_migration() {
        let mut room = Room::new("HOST".to_string());
        room.add_player("p1".into(), "Alice".into(), "stadium".into(), None).unwrap();
        room.add_player("p2".into(), "Bob".into(), "desert".into(), None).unwrap();

        assert_eq!(room.host_id, Some("p1".to_string()));
        assert!(room.players[0].is_host);

        // Host leaves
        room.remove_player("p1");

        assert_eq!(room.players.len(), 1);
        assert_eq!(room.host_id, Some("p2".to_string()));
        assert!(room.players[0].is_host);
    }

    #[test]
    fn test_lobby_update_your_id() {
        let mut room = Room::new("CODE".to_string());
        let (tx_a, mut rx_a) = mpsc::unbounded_channel();
        let (tx_b, mut rx_b) = mpsc::unbounded_channel();

        // 1. Player A joins: their LobbyUpdate must have your_id == "player_a_id"
        let res_a = room.add_player("player_a_id".into(), "Alice".into(), "stadium".into(), Some(tx_a));
        assert!(res_a.is_ok());

        let msg_a = rx_a.try_recv().expect("Player A should receive LobbyUpdate");
        match msg_a {
            ServerMessage::LobbyUpdate { your_id, is_host, players, room_code, .. } => {
                assert_eq!(your_id, "player_a_id");
                assert!(is_host);
                assert_eq!(room_code, "CODE");
                assert_eq!(players.len(), 1);
                assert_eq!(players[0].id, "player_a_id");
            }
            other => panic!("Expected LobbyUpdate, got {:?}", other),
        }

        // 2. Player B joins:
        // - Player B receives LobbyUpdate with your_id == "player_b_id"
        // - Player A receives updated LobbyUpdate with your_id == "player_a_id"
        let res_b = room.add_player("player_b_id".into(), "Bob".into(), "desert".into(), Some(tx_b));
        assert!(res_b.is_ok());

        let msg_b = rx_b.try_recv().expect("Player B should receive LobbyUpdate");
        match msg_b {
            ServerMessage::LobbyUpdate { your_id, is_host, players, .. } => {
                assert_eq!(your_id, "player_b_id");
                assert!(!is_host);
                assert_eq!(players.len(), 2);
            }
            other => panic!("Expected LobbyUpdate, got {:?}", other),
        }

        let msg_a2 = rx_a.try_recv().expect("Player A should receive updated LobbyUpdate");
        match msg_a2 {
            ServerMessage::LobbyUpdate { your_id, is_host, players, .. } => {
                assert_eq!(your_id, "player_a_id");
                assert!(is_host);
                assert_eq!(players.len(), 2);
            }
            other => panic!("Expected LobbyUpdate, got {:?}", other),
        }

        // 3. Ready toggle: both receive their respective your_id
        room.set_ready("player_b_id", true);

        let msg_b_ready = rx_b.try_recv().expect("Player B should receive ready update");
        match msg_b_ready {
            ServerMessage::LobbyUpdate { your_id, players, .. } => {
                assert_eq!(your_id, "player_b_id");
                assert!(players.iter().any(|p| p.id == "player_b_id" && p.ready));
            }
            other => panic!("Expected LobbyUpdate, got {:?}", other),
        }

        let msg_a_ready = rx_a.try_recv().expect("Player A should receive ready update");
        match msg_a_ready {
            ServerMessage::LobbyUpdate { your_id, players, .. } => {
                assert_eq!(your_id, "player_a_id");
                assert!(players.iter().any(|p| p.id == "player_b_id" && p.ready));
            }
            other => panic!("Expected LobbyUpdate, got {:?}", other),
        }
    }
}
