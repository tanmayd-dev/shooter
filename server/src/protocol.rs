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
    },
    Ping {
        #[serde(alias = "clientTime")]
        client_time: u64,
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
            } => Some(PlayerInput {
                sequence: *sequence,
                throttle: *throttle,
                steer: *steer,
                brake: *brake,
                fire_primary: *fire_primary,
                fire_special: *fire_special,
                ability_mobility: *ability_mobility,
                ability_utility: *ability_utility,
            }),
            _ => None,
        }
    }
}

fn default_car_type() -> String {
    "stadium".to_string()
}

/// Server to client protocol messages.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum ServerMessage {
    LobbyUpdate {
        #[serde(alias = "roomCode")]
        room_code: String,
        #[serde(alias = "isHost")]
        is_host: bool,
        players: Vec<LobbyPlayer>,
        status: String,
        map: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        countdown: Option<u32>,
    },
    GameStart {
        map: String,
        #[serde(alias = "tickRate")]
        tick_rate: u32,
        countdown: u32,
    },
    WorldState {
        tick: u64,
        timestamp: u64,
        players: Vec<PlayerState>,
        projectiles: Vec<ProjectileState>,
        hazards: Vec<HazardState>,
        killfeed: Vec<KillFeedItem>,
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
    },
    Error {
        message: String,
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
        };

        let serialized = serde_json::to_string(&lobby).unwrap();
        assert!(serialized.contains(r#""type":"LobbyUpdate""#));
        assert!(serialized.contains(r#""room_code":"NEON""#));
        assert!(serialized.contains(r#""is_host":true"#));
    }
}
