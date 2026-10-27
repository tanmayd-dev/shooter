use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use rand::seq::SliceRandom;
use rand::Rng;
use tokio::sync::{mpsc, oneshot, RwLock};

use crate::physics::Arena;
use crate::protocol::{
    LobbyPlayer, PlayerInput, ScoreEntry, ServerMessage,
};
use crate::state::{GameOverInfo, GameState};

pub const MAX_PLAYERS_PER_ROOM: usize = 8;
pub const MAX_ROOMS: usize = 512;
pub const ROOM_CODE_LEN: usize = 6;
pub const COUNTDOWN_SECS: f32 = 3.0;

/// Generates a clean 6-letter uppercase room code (~1.07 billion combinations).
pub fn generate_room_code() -> String {
    const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = rand::rng();
    (0..ROOM_CODE_LEN)
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
    VoiceSignal {
        from_player_id: String,
        target_player_id: String,
        signal_data: String,
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
    pub map_rotation: Vec<String>,
    pub current_round: u32,
    pub total_rounds: u32,
    pub cumulative_scores: HashMap<String, u32>,
    pub cumulative_kills: HashMap<String, u32>,
    pub cumulative_deaths: HashMap<String, u32>,
    pub round_intermission: f32,
    pub current_tick: u64,
    pub last_input_ticks: HashMap<String, u64>,
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
            map_rotation: vec![
                "neon_stadium".into(),
                "cyber_canyon".into(),
                "orbital_foundry".into(),
            ],
            current_round: 1,
            total_rounds: 3,
            cumulative_scores: HashMap::new(),
            cumulative_kills: HashMap::new(),
            cumulative_deaths: HashMap::new(),
            round_intermission: 0.0,
            current_tick: 0,
            last_input_ticks: HashMap::new(),
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
                    round: Some(self.current_round),
                    total_rounds: Some(self.total_rounds),
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

        if self.players.iter().any(|p| p.id == id) {
            return Err("Player already in room".to_string());
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

        if self.status != RoomStatus::Waiting && self.status != RoomStatus::GameOver {
            return Err("Match is already starting or running".to_string());
        }

        if !self.players.iter().all(|p| p.ready) {
            return Err("All players must be ready before starting".to_string());
        }

        self.status = RoomStatus::Starting;
        self.countdown = COUNTDOWN_SECS;

        let mut maps = vec![
            "neon_stadium".to_string(),
            "cyber_canyon".to_string(),
            "orbital_foundry".to_string(),
        ];
        maps.shuffle(&mut rand::rng());
        self.map_rotation = maps;
        self.current_round = 1;
        self.map_name = self.map_rotation[0].clone();
        self.arena = Arena::from_map_name(&self.map_name);
        self.cumulative_scores.clear();
        self.cumulative_kills.clear();
        self.cumulative_deaths.clear();
        self.current_tick = 0;
        self.last_input_ticks.clear();

        self.broadcast(&ServerMessage::GameStart {
            map: self.map_name.clone(),
            tick_rate: 60,
            countdown: COUNTDOWN_SECS as u32,
            round: self.current_round,
            total_rounds: self.total_rounds,
            match_time_remaining: crate::state::MATCH_DURATION_SECS,
        });
        self.send_lobby_update();

        Ok(())
    }

    pub fn set_input(&mut self, player_id: &str, input: PlayerInput) {
        if !self.players.iter().any(|p| p.id == player_id) {
            return;
        }
        self.latest_inputs.insert(player_id.to_string(), input);
        self.last_input_ticks.insert(player_id.to_string(), self.current_tick);
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
                        round: self.current_round,
                        total_rounds: self.total_rounds,
                        match_time_remaining: crate::state::MATCH_DURATION_SECS,
                    });
                }
                None
            }
            RoomStatus::Playing => {
                self.current_tick = self.current_tick.wrapping_add(1);

                // Neutralize stale inputs from disconnected or unfocused clients (> 30 ticks / 0.5s)
                for (id, last_tick) in &self.last_input_ticks {
                    if self.current_tick.saturating_sub(*last_tick) > 30 {
                        if let Some(inp) = self.latest_inputs.get_mut(id) {
                            inp.throttle = 0.0;
                            inp.steer = 0.0;
                            inp.brake = false;
                            inp.fire_primary = false;
                            inp.fire_special = false;
                            inp.ability_mobility = false;
                            inp.ability_utility = false;
                        }
                    }
                }

                if let Some(ref mut game) = self.game_state {
                    let game_over = game.step(dt, &self.latest_inputs, &self.arena);
                    let world_msg = game.to_world_state_message_round(self.current_round, self.total_rounds);
                    self.broadcast(&world_msg);

                    if let Some(info) = game_over {
                        // Tally each player's round score, kills, and deaths
                        for entry in &info.scoreboard {
                            *self.cumulative_scores.entry(entry.player_id.clone()).or_insert(0) += entry.score;
                            *self.cumulative_kills.entry(entry.player_id.clone()).or_insert(0) += entry.kills;
                            *self.cumulative_deaths.entry(entry.player_id.clone()).or_insert(0) += entry.deaths;
                        }

                        if self.current_round < self.total_rounds {
                            self.current_round += 1;
                            self.map_name = self.map_rotation[(self.current_round - 1) as usize].clone();
                            self.arena = Arena::from_map_name(&self.map_name);
                            self.status = RoomStatus::Starting;
                            self.countdown = COUNTDOWN_SECS;
                            let lobby_players = self.get_lobby_players();
                            self.game_state = Some(GameState::new(&lobby_players, &self.arena));

                            self.broadcast(&ServerMessage::GameStart {
                                map: self.map_name.clone(),
                                tick_rate: 60,
                                countdown: COUNTDOWN_SECS as u32,
                                round: self.current_round,
                                total_rounds: self.total_rounds,
                                match_time_remaining: crate::state::MATCH_DURATION_SECS,
                            });
                            self.send_lobby_update();
                            return None;
                        } else {
                            // Complete tournament!
                            self.status = RoomStatus::GameOver;

                            // Build final tournament scoreboard
                            let mut scoreboard_map: HashMap<String, (String, String)> = HashMap::new();
                            for p in &self.players {
                                scoreboard_map.insert(p.id.clone(), (p.name.clone(), p.car_type.clone()));
                            }
                            for entry in &info.scoreboard {
                                scoreboard_map
                                    .entry(entry.player_id.clone())
                                    .or_insert_with(|| (entry.name.clone(), entry.car_type.clone()));
                            }

                            let mut scoreboard: Vec<ScoreEntry> = scoreboard_map
                                .into_iter()
                                .map(|(player_id, (name, car_type))| {
                                    let score = *self.cumulative_scores.get(&player_id).unwrap_or(&0);
                                    let kills = *self.cumulative_kills.get(&player_id).unwrap_or(&0);
                                    let deaths = *self.cumulative_deaths.get(&player_id).unwrap_or(&0);
                                    ScoreEntry {
                                        player_id,
                                        name,
                                        car_type,
                                        kills,
                                        deaths,
                                        score,
                                    }
                                })
                                .collect();

                            // Rank players by cumulative score: winner_id = highest cumulative score
                            scoreboard.sort_by(|a, b| {
                                b.score
                                    .cmp(&a.score)
                                    .then_with(|| b.kills.cmp(&a.kills))
                                    .then_with(|| a.deaths.cmp(&b.deaths))
                            });

                            let winner_id = scoreboard
                                .first()
                                .map(|e| e.player_id.clone())
                                .unwrap_or_else(|| "none".to_string());

                            self.broadcast(&ServerMessage::GameOver {
                                winner_id: winner_id.clone(),
                                scoreboard: scoreboard.clone(),
                                is_tournament_complete: true,
                            });

                            return Some(GameOverInfo {
                                winner_id,
                                scoreboard,
                            });
                        }
                    }
                }
                None
            }
            RoomStatus::GameOver => None,
        }
    }

    pub async fn run(mut self, mut rx: mpsc::UnboundedReceiver<RoomCommand>) {
        let mut interval = tokio::time::interval(Duration::from_micros(16_667));
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
                        RoomCommand::VoiceSignal { from_player_id, target_player_id, signal_data } => {
                            if let Some(target) = self.players.iter().find(|p| p.id == target_player_id) {
                                if let Some(ref sender) = target.sender {
                                    let _ = sender.send(ServerMessage::VoiceSignal {
                                        from_player_id,
                                        signal_data,
                                    });
                                }
                            }
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

    pub async fn create_room(&self) -> Result<(String, RoomHandle), String> {
        let mut rooms_guard = self.rooms.write().await;

        if rooms_guard.len() >= MAX_ROOMS {
            return Err("Server at capacity: too many active rooms".to_string());
        }

        // Bounded retry avoids spinning forever while holding the write lock.
        let mut code = generate_room_code();
        let mut attempts = 0;
        while rooms_guard.contains_key(&code) {
            attempts += 1;
            if attempts >= 32 {
                return Err("Could not allocate a unique room code".to_string());
            }
            code = generate_room_code();
        }

        let (tx, rx) = mpsc::unbounded_channel();
        let room = Room::new(code.clone());
        let handle = RoomHandle {
            code: code.clone(),
            command_tx: tx,
        };

        rooms_guard.insert(code.clone(), handle.clone());
        drop(rooms_guard);

        tokio::spawn(room.run(rx));
        Ok((code, handle))
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

        Ok(self.create_room().await?)
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
            assert_eq!(code.len(), ROOM_CODE_LEN);
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

        // Test scoring up to WIN_KILL_COUNT for Round 1
        let car1 = game.cars.get_mut("p1").unwrap();
        car1.kills = WIN_KILL_COUNT;

        // Round 1 ends -> advances to Round 2
        let r1_over = room.tick(1.0 / 60.0);
        assert!(r1_over.is_none());
        assert_eq!(room.status, RoomStatus::Starting);
        assert_eq!(room.current_round, 2);

        // Countdown for Round 2
        room.tick(COUNTDOWN_SECS + 0.1);
        assert_eq!(room.status, RoomStatus::Playing);

        // Round 2 ends -> advances to Round 3
        let game2 = room.game_state.as_mut().unwrap();
        game2.cars.get_mut("p1").unwrap().kills = WIN_KILL_COUNT;
        let r2_over = room.tick(1.0 / 60.0);
        assert!(r2_over.is_none());
        assert_eq!(room.status, RoomStatus::Starting);
        assert_eq!(room.current_round, 3);

        // Countdown for Round 3
        room.tick(COUNTDOWN_SECS + 0.1);
        assert_eq!(room.status, RoomStatus::Playing);

        // Round 3 ends -> completes tournament!
        let game3 = room.game_state.as_mut().unwrap();
        game3.cars.get_mut("p1").unwrap().kills = WIN_KILL_COUNT;
        let game_over = room.tick(1.0 / 60.0);
        assert!(game_over.is_some());
        assert_eq!(room.status, RoomStatus::GameOver);
        let info = game_over.unwrap();
        assert_eq!(info.winner_id, "p1");
        assert_eq!(room.cumulative_kills.get("p1"), Some(&(WIN_KILL_COUNT * 3)));
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

    #[tokio::test]
    async fn test_room_voice_signal_routing() {
        let (tx, rx) = mpsc::unbounded_channel();
        let room = Room::new("VOIC".to_string());
        tokio::spawn(room.run(rx));

        let (tx_a, mut rx_a) = mpsc::unbounded_channel();
        let (tx_b, mut rx_b) = mpsc::unbounded_channel();
        let (reply_a, reply_a_rx) = oneshot::channel();
        let (reply_b, reply_b_rx) = oneshot::channel();

        // Join Player A and B
        tx.send(RoomCommand::Join {
            player_id: "p_alice".into(),
            name: "Alice".into(),
            car_type: "stadium".into(),
            sender: tx_a,
            reply: reply_a,
        }).unwrap();
        reply_a_rx.await.unwrap().unwrap();

        tx.send(RoomCommand::Join {
            player_id: "p_bob".into(),
            name: "Bob".into(),
            car_type: "desert".into(),
            sender: tx_b,
            reply: reply_b,
        }).unwrap();
        reply_b_rx.await.unwrap().unwrap();

        // Drain initial lobby updates
        let _ = rx_a.recv().await;
        let _ = rx_b.recv().await;

        // Alice sends VoiceSignal to Bob
        tx.send(RoomCommand::VoiceSignal {
            from_player_id: "p_alice".into(),
            target_player_id: "p_bob".into(),
            signal_data: "{\"sdp\":\"test_offer\"}".into(),
        }).unwrap();

        // A signal addressed to a non-member must be dropped (no delivery to Bob)
        tx.send(RoomCommand::VoiceSignal {
            from_player_id: "p_alice".into(),
            target_player_id: "p_nobody".into(),
            signal_data: "{\"sdp\":\"spoof\"}".into(),
        }).unwrap();

        // Bob should receive Alice's VoiceSignal
        let bob_msg = rx_b.recv().await.unwrap();
        match bob_msg {
            ServerMessage::VoiceSignal { from_player_id, signal_data } => {
                assert_eq!(from_player_id, "p_alice");
                assert_eq!(signal_data, "{\"sdp\":\"test_offer\"}");
            }
            other => panic!("Expected VoiceSignal, got {:?}", other),
        }
    }

    #[test]
    fn test_start_requires_all_players_ready() {
        let mut room = Room::new("RDY123".to_string());
        room.add_player("p1".into(), "Alice".into(), "stadium".into(), None).unwrap();
        room.add_player("p2".into(), "Bob".into(), "titan".into(), None).unwrap();

        // Host is ready by default, but the joiner is not.
        assert!(room.start_game("p1").is_err());
        assert_eq!(room.status, RoomStatus::Waiting);

        room.set_ready("p2", true);
        assert!(room.start_game("p1").is_ok());
        assert_eq!(room.status, RoomStatus::Starting);
    }

    #[test]
    fn test_tournament_system_shuffle_and_podium() {
        let mut room = Room::new("TOUR".to_string());
        room.add_player("p1".into(), "Alice".into(), "stadium".into(), None).unwrap();
        room.add_player("p2".into(), "Bob".into(), "rally".into(), None).unwrap();
        room.set_ready("p2", true);

        // Start tournament
        assert!(room.start_game("p1").is_ok());
        assert_eq!(room.status, RoomStatus::Starting);
        assert_eq!(room.current_round, 1);
        assert_eq!(room.total_rounds, 3);
        assert_eq!(room.map_rotation.len(), 3);

        // Verify the 3 distinct maps are in rotation
        let mut sorted_rotation = room.map_rotation.clone();
        sorted_rotation.sort();
        assert_eq!(
            sorted_rotation,
            vec!["cyber_canyon".to_string(), "neon_stadium".to_string(), "orbital_foundry".to_string()]
        );
        assert_eq!(room.map_name, room.map_rotation[0]);

        // Complete Round 1: Bob scores WIN_KILL_COUNT kills (500 pts), Alice scores 2 kills (200 pts)
        room.tick(COUNTDOWN_SECS + 0.1);
        assert_eq!(room.status, RoomStatus::Playing);
        {
            let game = room.game_state.as_mut().unwrap();
            let bob = game.cars.get_mut("p2").unwrap();
            bob.kills = WIN_KILL_COUNT;
            bob.score = 500;
            let alice = game.cars.get_mut("p1").unwrap();
            alice.kills = 2;
            alice.score = 200;
        }

        let r1 = room.tick(1.0 / 60.0);
        assert!(r1.is_none());
        assert_eq!(room.current_round, 2);
        assert_eq!(room.status, RoomStatus::Starting);
        assert_eq!(room.map_name, room.map_rotation[1]);
        assert_eq!(*room.cumulative_scores.get("p2").unwrap(), 500);
        assert_eq!(*room.cumulative_scores.get("p1").unwrap(), 200);

        // Complete Round 2: Alice scores WIN_KILL_COUNT kills (500 pts), Bob scores 1 kill (100 pts)
        room.tick(COUNTDOWN_SECS + 0.1);
        assert_eq!(room.status, RoomStatus::Playing);
        {
            let game = room.game_state.as_mut().unwrap();
            let alice = game.cars.get_mut("p1").unwrap();
            alice.kills = WIN_KILL_COUNT;
            alice.score = 500;
            let bob = game.cars.get_mut("p2").unwrap();
            bob.kills = 1;
            bob.score = 100;
        }

        let r2 = room.tick(1.0 / 60.0);
        assert!(r2.is_none());
        assert_eq!(room.current_round, 3);
        assert_eq!(room.status, RoomStatus::Starting);
        assert_eq!(room.map_name, room.map_rotation[2]);
        assert_eq!(*room.cumulative_scores.get("p2").unwrap(), 600);
        assert_eq!(*room.cumulative_scores.get("p1").unwrap(), 700);

        // Complete Round 3: Alice scores WIN_KILL_COUNT kills (500 pts), Bob scores 2 kills (200 pts)
        room.tick(COUNTDOWN_SECS + 0.1);
        assert_eq!(room.status, RoomStatus::Playing);
        {
            let game = room.game_state.as_mut().unwrap();
            let alice = game.cars.get_mut("p1").unwrap();
            alice.kills = WIN_KILL_COUNT;
            alice.score = 500;
            let bob = game.cars.get_mut("p2").unwrap();
            bob.kills = 2;
            bob.score = 200;
        }

        let tournament_over = room.tick(1.0 / 60.0);
        assert!(tournament_over.is_some());
        assert_eq!(room.status, RoomStatus::GameOver);

        let final_info = tournament_over.unwrap();
        // Alice cumulative score: 700 + 500 = 1200; Bob: 600 + 200 = 800
        assert_eq!(final_info.winner_id, "p1");
        assert_eq!(final_info.scoreboard[0].player_id, "p1");
        assert_eq!(final_info.scoreboard[0].score, 1200);
        assert_eq!(final_info.scoreboard[0].kills, 22);
        assert_eq!(final_info.scoreboard[1].player_id, "p2");
        assert_eq!(final_info.scoreboard[1].score, 800);
        assert_eq!(final_info.scoreboard[1].kills, 13);
    }
}
