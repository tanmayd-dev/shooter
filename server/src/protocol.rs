use serde::{Deserialize, Serialize};

/// Client to server protocol messages.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum ClientMessage {
    JoinLobby {
        name: String,
        #[serde(default, alias = "roomCode")]
        room_code: Option<String>,
        #[serde(default = "default_car_type", alias = "carType")]
        car_type: String,
    },
    SetReady {
        ready: bool,
    },
    SelectCar {
        #[serde(alias = "carType")]
        car_type: String,
    },
    StartGame,
    PlayerInput {
        #[serde(default)]
        sequence: u64,
        #[serde(default)]
        throttle: f32,
        #[serde(default)]
        steer: f32,
        #[serde(default)]
        brake: bool,
        #[serde(default, alias = "firePrimary")]
        fire_primary: bool,
        #[serde(default, alias = "fireSpecial")]
        fire_special: bool,
        #[serde(default, alias = "abilityMobility")]
        ability_mobility: bool,
        #[serde(default, alias = "abilityUtility")]
        ability_utility: bool,
        #[serde(default)]
        turnaround: bool,
    },
    Ping {
        #[serde(alias = "clientTime")]
        client_time: u64,
    },
    VoiceSignal {
        #[serde(alias = "targetPlayerId")]
        target_player_id: String,
        #[serde(alias = "signalData")]
        signal_data: String,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
pub struct PlayerInput {
    pub sequence: u64,
    pub throttle: f32,
    pub steer: f32,
    pub brake: bool,
    pub fire_primary: bool,
    pub fire_special: bool,
    pub ability_mobility: bool,
    pub ability_utility: bool,
    pub turnaround: bool,
}

impl ClientMessage {
    pub fn to_player_input(&self) -> Option<PlayerInput> {
        match self {
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
            } => Some(PlayerInput {
                sequence: *sequence,
                throttle: *throttle,
                steer: *steer,
                brake: *brake,
                fire_primary: *fire_primary,
                fire_special: *fire_special,
                ability_mobility: *ability_mobility,
                ability_utility: *ability_utility,
                turnaround: *turnaround,
            }),
            _ => None,
        }
    }
}

fn default_car_type() -> String {
    "stadium".to_string()
}

fn default_round() -> u32 {
    1
}

fn default_total_rounds() -> u32 {
    3
}

fn default_match_timer() -> f32 {
    180.0
}

/// Server to client protocol messages.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum ServerMessage {
    LobbyUpdate {
        #[serde(alias = "yourId")]
        your_id: String,
        #[serde(alias = "roomCode")]
        room_code: String,
        #[serde(alias = "isHost")]
        is_host: bool,
        players: Vec<LobbyPlayer>,
        status: String,
        map: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        countdown: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        round: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none", alias = "totalRounds")]
        total_rounds: Option<u32>,
    },
    GameStart {
        map: String,
        #[serde(alias = "tickRate")]
        tick_rate: u32,
        countdown: u32,
        #[serde(default = "default_round", alias = "round")]
        round: u32,
        #[serde(default = "default_total_rounds", alias = "totalRounds")]
        total_rounds: u32,
        #[serde(default = "default_match_timer", alias = "matchTimeRemaining")]
        match_time_remaining: f32,
    },
    WorldState {
        tick: u64,
        timestamp: u64,
        players: Vec<PlayerState>,
        projectiles: Vec<ProjectileState>,
        hazards: Vec<HazardState>,
        killfeed: Vec<KillFeedItem>,
        #[serde(default = "default_round")]
        round: u32,
        #[serde(default = "default_total_rounds", alias = "totalRounds")]
        total_rounds: u32,
        #[serde(default = "default_match_timer", alias = "matchTimeRemaining")]
        match_time_remaining: f32,
    },
    Pong {
        #[serde(alias = "clientTime")]
        client_time: u64,
        #[serde(alias = "serverTime")]
        server_time: u64,
    },
    GameOver {
        #[serde(alias = "winnerId")]
        winner_id: String,
        scoreboard: Vec<ScoreEntry>,
        #[serde(default, alias = "isTournamentComplete")]
        is_tournament_complete: bool,
    },
    Error {
        message: String,
    },
    VoiceSignal {
        #[serde(alias = "fromPlayerId")]
        from_player_id: String,
        #[serde(alias = "signalData")]
        signal_data: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LobbyPlayer {
    pub id: String,
    pub name: String,
    #[serde(alias = "carType")]
    pub car_type: String,
    #[serde(alias = "isHost")]
    pub is_host: bool,
    pub ready: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlayerState {
    pub id: String,
    pub name: String,
    #[serde(alias = "carType")]
    pub car_type: String,
    pub x: f32,
    pub y: f32,
    pub angle: f32,
    pub vx: f32,
    pub vy: f32,
    #[serde(alias = "angularVelocity")]
    pub angular_velocity: f32,
    pub steer: f32,
    pub health: f32,
    #[serde(alias = "maxHealth")]
    pub max_health: f32,
    pub shield: f32,
    #[serde(alias = "isAlive")]
    pub is_alive: bool,
    #[serde(alias = "respawnTimer")]
    pub respawn_timer: f32,
    pub boost: f32,
    pub score: u32,
    pub kills: u32,
    pub deaths: u32,
    pub drift: bool,
    #[serde(alias = "lastProcessedInput")]
    pub last_processed_input: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProjectileState {
    pub id: u32,
    #[serde(alias = "ownerId")]
    pub owner_id: String,
    pub kind: String,
    pub x: f32,
    pub y: f32,
    pub vx: f32,
    pub vy: f32,
    pub radius: f32,
    pub lifetime: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HazardState {
    pub id: u32,
    #[serde(alias = "ownerId")]
    pub owner_id: String,
    pub kind: String,
    pub x: f32,
    pub y: f32,
    pub radius: f32,
    pub active: bool,
    pub duration: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct KillFeedItem {
    #[serde(alias = "killerId")]
    pub killer_id: String,
    #[serde(alias = "killerName")]
    pub killer_name: String,
    #[serde(alias = "victimId")]
    pub victim_id: String,
    #[serde(alias = "victimName")]
    pub victim_name: String,
    pub weapon: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ScoreEntry {
    #[serde(alias = "playerId")]
    pub player_id: String,
    pub name: String,
    #[serde(alias = "carType")]
    pub car_type: String,
    pub kills: u32,
    pub deaths: u32,
    pub score: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_message_deserialization() {
        let json_join = r#"{"type":"JoinLobby","name":"Speedy","room_code":"DRIF","car_type":"desert"}"#;
        let msg: ClientMessage = serde_json::from_str(json_join).unwrap();
        assert_eq!(
            msg,
            ClientMessage::JoinLobby {
                name: "Speedy".into(),
                room_code: Some("DRIF".into()),
                car_type: "desert".into(),
            }
        );

        // Test with camelCase aliases
        let json_join_camel = r#"{"type":"JoinLobby","name":"Speedy","roomCode":"NEON","carType":"rally"}"#;
        let msg2: ClientMessage = serde_json::from_str(json_join_camel).unwrap();
        assert_eq!(
            msg2,
            ClientMessage::JoinLobby {
                name: "Speedy".into(),
                room_code: Some("NEON".into()),
                car_type: "rally".into(),
            }
        );

        let json_input = r#"{"type":"PlayerInput","sequence":42,"throttle":1.0,"steer":-0.5,"brake":false,"fire_primary":true,"fire_special":false,"ability_mobility":false,"ability_utility":false}"#;
        let msg_in: ClientMessage = serde_json::from_str(json_input).unwrap();
        let p_in = msg_in.to_player_input().unwrap();
        assert_eq!(p_in.sequence, 42);
        assert_eq!(p_in.throttle, 1.0);
        assert_eq!(p_in.steer, -0.5);
        assert!(p_in.fire_primary);
    }

    #[test]
    fn test_server_message_serialization() {
        let lobby = ServerMessage::LobbyUpdate {
            your_id: "p1".into(),
            room_code: "NEON".into(),
            is_host: true,
            players: vec![LobbyPlayer {
                id: "p1".into(),
                name: "Racer".into(),
                car_type: "stadium".into(),
                is_host: true,
                ready: true,
            }],
            status: "waiting".into(),
            map: "neon_stadium".into(),
            countdown: None,
            round: Some(1),
            total_rounds: Some(3),
        };

        let serialized = serde_json::to_string(&lobby).unwrap();
        assert!(serialized.contains(r#""type":"LobbyUpdate""#));
        assert!(serialized.contains(r#""your_id":"p1""#));
        assert!(serialized.contains(r#""room_code":"NEON""#));
        assert!(serialized.contains(r#""is_host":true"#));
        assert!(serialized.contains(r#""round":1"#));
        assert!(serialized.contains(r#""total_rounds":3"#));
    }

    #[test]
    fn test_lobby_update_your_id_serde() {
        // Test deserialization with snake_case "your_id"
        let json_snake = r#"{
            "type": "LobbyUpdate",
            "your_id": "p_snake_123",
            "room_code": "TEST",
            "is_host": true,
            "players": [],
            "status": "waiting",
            "map": "neon_stadium"
        }"#;
        let msg_snake: ServerMessage = serde_json::from_str(json_snake).unwrap();
        match msg_snake {
            ServerMessage::LobbyUpdate { your_id, .. } => {
                assert_eq!(your_id, "p_snake_123");
            }
            _ => panic!("Expected LobbyUpdate"),
        }

        // Test deserialization with camelCase alias "yourId"
        let json_camel = r#"{
            "type": "LobbyUpdate",
            "yourId": "p_camel_456",
            "roomCode": "TEST",
            "isHost": false,
            "players": [],
            "status": "waiting",
            "map": "neon_stadium"
        }"#;
        let msg_camel: ServerMessage = serde_json::from_str(json_camel).unwrap();
        match msg_camel {
            ServerMessage::LobbyUpdate { your_id, is_host, .. } => {
                assert_eq!(your_id, "p_camel_456");
                assert!(!is_host);
            }
            _ => panic!("Expected LobbyUpdate"),
        }

        // Test serialization produces your_id and can round-trip
        let msg_orig = ServerMessage::LobbyUpdate {
            your_id: "p_roundtrip".into(),
            room_code: "RT01".into(),
            is_host: true,
            players: vec![],
            status: "waiting".into(),
            map: "neon_stadium".into(),
            countdown: None,
            round: None,
            total_rounds: None,
        };
        let serialized = serde_json::to_string(&msg_orig).unwrap();
        assert!(serialized.contains(r#""your_id":"p_roundtrip""#));

        let msg_deser: ServerMessage = serde_json::from_str(&serialized).unwrap();
        assert_eq!(msg_orig, msg_deser);
    }

    #[test]
    fn test_voice_signal_serde() {
        // ClientMessage snake_case
        let json_client = r#"{"type":"VoiceSignal","target_player_id":"p_target","signal_data":"{\"type\":\"offer\"}"}"#;
        let msg: ClientMessage = serde_json::from_str(json_client).unwrap();
        assert_eq!(
            msg,
            ClientMessage::VoiceSignal {
                target_player_id: "p_target".to_string(),
                signal_data: "{\"type\":\"offer\"}".to_string(),
            }
        );

        // ClientMessage camelCase aliases
        let json_client_camel = r#"{"type":"VoiceSignal","targetPlayerId":"p_target2","signalData":"xyz"}"#;
        let msg2: ClientMessage = serde_json::from_str(json_client_camel).unwrap();
        assert_eq!(
            msg2,
            ClientMessage::VoiceSignal {
                target_player_id: "p_target2".to_string(),
                signal_data: "xyz".to_string(),
            }
        );

        // ServerMessage
        let server_voice = ServerMessage::VoiceSignal {
            from_player_id: "p_sender".to_string(),
            signal_data: "ice_candidate".to_string(),
        };
        let serialized = serde_json::to_string(&server_voice).unwrap();
        assert!(serialized.contains(r#""type":"VoiceSignal""#));
        assert!(serialized.contains(r#""from_player_id":"p_sender""#));
        let deserialized: ServerMessage = serde_json::from_str(&serialized).unwrap();
        assert_eq!(server_voice, deserialized);
    }

    #[test]
    fn test_tournament_protocol_serde() {
        // GameStart with default and explicit rounds
        let json_start_default = r#"{"type":"GameStart","map":"neon_stadium","tickRate":60,"countdown":3}"#;
        let start_msg: ServerMessage = serde_json::from_str(json_start_default).unwrap();
        match start_msg {
            ServerMessage::GameStart { round, total_rounds, .. } => {
                assert_eq!(round, 1);
                assert_eq!(total_rounds, 3);
            }
            _ => panic!("Expected GameStart"),
        }

        let json_start_explicit = r#"{"type":"GameStart","map":"cyber_canyon","tick_rate":60,"countdown":0,"round":2,"totalRounds":3}"#;
        let start_msg2: ServerMessage = serde_json::from_str(json_start_explicit).unwrap();
        match start_msg2 {
            ServerMessage::GameStart { round, total_rounds, map, .. } => {
                assert_eq!(map, "cyber_canyon");
                assert_eq!(round, 2);
                assert_eq!(total_rounds, 3);
            }
            _ => panic!("Expected GameStart"),
        }

        // GameOver with is_tournament_complete
        let json_game_over = r#"{"type":"GameOver","winnerId":"p1","scoreboard":[],"isTournamentComplete":true}"#;
        let over_msg: ServerMessage = serde_json::from_str(json_game_over).unwrap();
        match over_msg {
            ServerMessage::GameOver { winner_id, is_tournament_complete, .. } => {
                assert_eq!(winner_id, "p1");
                assert!(is_tournament_complete);
            }
            _ => panic!("Expected GameOver"),
        }
    }
}
