use std::collections::{HashMap, VecDeque};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::physics::{
    check_boost_pad, check_mine_trigger, resolve_circle_circle_collision,
    resolve_circle_wall_collision, Arena, PLAYER_RADIUS,
};
use crate::protocol::{
    HazardState, KillFeedItem, LobbyPlayer, PlayerInput, PlayerState, ProjectileState, ScoreEntry,
    ServerMessage,
};

pub const MATCH_DURATION_SECS: f32 = 300.0;
pub const WIN_KILL_COUNT: u32 = 10;
pub const RESPAWN_DELAY_SECS: f32 = 3.0;
pub const RESPAWN_SHIELD_SECS: f32 = 2.0;

fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Debug, Clone)]
pub struct Projectile {
    pub id: u32,
    pub owner_id: String,
    pub kind: String,
    pub x: f32,
    pub y: f32,
    pub vx: f32,
    pub vy: f32,
    pub radius: f32,
    pub damage: f32,
    pub lifetime: f32,
}

#[derive(Debug, Clone)]
pub struct Hazard {
    pub id: u32,
    pub owner_id: String,
    pub kind: String,
    pub x: f32,
    pub y: f32,
    pub radius: f32,
    pub active: bool,
    pub duration: f32,
    pub damage: f32,
}

#[derive(Debug, Clone)]
pub struct CarSimulation {
    pub id: String,
    pub name: String,
    pub car_type: String,

    pub x: f32,
    pub y: f32,
    pub angle: f32,
    pub vx: f32,
    pub vy: f32,
    pub angular_velocity: f32,
    pub steer: f32,

    pub mass: f32,
    pub top_speed: f32,
    pub acceleration: f32,
    pub turn_rate: f32,
    pub grip: f32,
    pub drift_grip: f32,

    pub health: f32,
    pub max_health: f32,
    pub shield_timer: f32,
    pub is_alive: bool,
    pub respawn_timer: f32,
    pub boost_meter: f32,
    pub is_drifting: bool,

    pub primary_cooldown: f32,
    pub special_cooldown: f32,
    pub mobility_cooldown: f32,
    pub utility_cooldown: f32,
    pub boost_pad_cooldown: f32,
    pub ram_active_timer: f32,
    pub emp_slow_timer: f32,

    pub score: u32,
    pub kills: u32,
    pub deaths: u32,
    pub last_input_seq: u64,
}

impl CarSimulation {
    pub fn new(player: &LobbyPlayer, spawn_x: f32, spawn_y: f32, spawn_angle: f32) -> Self {
        let car_type_lower = player.car_type.to_lowercase();
        let (max_hp, mass, top_speed, accel, turn_rate, grip, drift_grip) =
            if car_type_lower.contains("desert") {
                (150.0, 1.5, 700.0, 780.0, 2.8, 0.85, 0.55)
            } else if car_type_lower.contains("rally") {
                (85.0, 0.8, 640.0, 1020.0, 4.6, 0.78, 0.45)
            } else {
                // Stadium Spec (default)
                (100.0, 1.0, 620.0, 920.0, 3.8, 0.92, 0.70)
            };

        Self {
            id: player.id.clone(),
            name: player.name.clone(),
            car_type: player.car_type.clone(),

            x: spawn_x,
            y: spawn_y,
            angle: spawn_angle,
            vx: 0.0,
            vy: 0.0,
            angular_velocity: 0.0,
            steer: 0.0,

            mass,
            top_speed,
            acceleration: accel,
            turn_rate,
            grip,
            drift_grip,

            health: max_hp,
            max_health: max_hp,
            shield_timer: RESPAWN_SHIELD_SECS,
            is_alive: true,
            respawn_timer: 0.0,
            boost_meter: 100.0,
            is_drifting: false,

            primary_cooldown: 0.0,
            special_cooldown: 0.0,
            mobility_cooldown: 0.0,
            utility_cooldown: 0.0,
            boost_pad_cooldown: 0.0,
            ram_active_timer: 0.0,
            emp_slow_timer: 0.0,

            score: 0,
            kills: 0,
            deaths: 0,
            last_input_seq: 0,
        }
    }

    pub fn reset_at_spawn(&mut self, spawn_x: f32, spawn_y: f32, spawn_angle: f32) {
        self.x = spawn_x;
        self.y = spawn_y;
        self.angle = spawn_angle;
        self.vx = 0.0;
        self.vy = 0.0;
        self.angular_velocity = 0.0;
        self.steer = 0.0;
        self.health = self.max_health;
        self.shield_timer = RESPAWN_SHIELD_SECS;
        self.is_alive = true;
        self.respawn_timer = 0.0;
        self.boost_meter = 100.0;
        self.is_drifting = false;
        self.ram_active_timer = 0.0;
        self.emp_slow_timer = 0.0;
    }

    pub fn step_physics(&mut self, input: &PlayerInput, dt: f32) {
        if !self.is_alive {
            return;
        }

        self.last_input_seq = input.sequence;

        // Decrement cooldowns
        if self.primary_cooldown > 0.0 {
            self.primary_cooldown = (self.primary_cooldown - dt).max(0.0);
        }
        if self.special_cooldown > 0.0 {
            self.special_cooldown = (self.special_cooldown - dt).max(0.0);
        }
        if self.mobility_cooldown > 0.0 {
            self.mobility_cooldown = (self.mobility_cooldown - dt).max(0.0);
        }
        if self.utility_cooldown > 0.0 {
            self.utility_cooldown = (self.utility_cooldown - dt).max(0.0);
        }
        if self.boost_pad_cooldown > 0.0 {
            self.boost_pad_cooldown = (self.boost_pad_cooldown - dt).max(0.0);
        }
        if self.shield_timer > 0.0 {
            self.shield_timer = (self.shield_timer - dt).max(0.0);
        }
        if self.ram_active_timer > 0.0 {
            self.ram_active_timer = (self.ram_active_timer - dt).max(0.0);
        }
        if self.emp_slow_timer > 0.0 {
            self.emp_slow_timer = (self.emp_slow_timer - dt).max(0.0);
        }

        // Regenerate boost meter gradually
        self.boost_meter = (self.boost_meter + 15.0 * dt).min(100.0);

        let steer_in = input.steer.clamp(-1.0, 1.0);
        self.steer = steer_in;
        let throttle_in = input.throttle.clamp(-1.0, 1.0);

        let speed = (self.vx * self.vx + self.vy * self.vy).sqrt();

        // Steering dynamics: responsive when rolling
        let steer_speed_factor = (speed / 140.0).clamp(0.2, 1.0);
        let turn_amount = steer_in * self.turn_rate * steer_speed_factor * dt;
        self.angle += turn_amount;
        self.angular_velocity = turn_amount / dt;

        // Normalize angle to [-PI, PI]
        while self.angle > std::f32::consts::PI {
            self.angle -= 2.0 * std::f32::consts::PI;
        }
        while self.angle < -std::f32::consts::PI {
            self.angle += 2.0 * std::f32::consts::PI;
        }

        // Compute directions after turn
        let fx = self.angle.cos();
        let fy = self.angle.sin();
        let rx = -self.angle.sin();
        let ry = self.angle.cos();

        let mut v_long = self.vx * fx + self.vy * fy;
        let mut v_lat = self.vx * rx + self.vy * ry;

        // Acceleration / Throttle
        let accel_mult = if self.ram_active_timer > 0.0 { 1.4 } else { 1.0 };
        let current_top_speed = if self.ram_active_timer > 0.0 {
            self.top_speed * 1.3
        } else {
            self.top_speed
        };

        if throttle_in > 0.0 {
            v_long = (v_long + throttle_in * self.acceleration * accel_mult * dt).min(current_top_speed);
        } else if throttle_in < 0.0 {
            // Reverse
            v_long = (v_long + throttle_in * 500.0 * dt).max(-220.0);
        }

        // Braking / Handbrake
        if input.brake {
            if v_long > 15.0 {
                v_long = (v_long - 1100.0 * dt).max(0.0);
            } else if v_long < -15.0 {
                v_long = (v_long + 1100.0 * dt).min(0.0);
            }
            self.is_drifting = true;
        } else {
            self.is_drifting = v_lat.abs() > 170.0 && speed > 220.0;
        }

        // Longitudinal drag
        v_long *= 1.0 - 0.35 * dt;

        // Lateral friction / grip
        if self.is_drifting {
            let drift_factor = (1.0 - self.drift_grip) * 12.0;
            v_lat *= (1.0 - drift_factor * dt).clamp(0.0, 1.0);
        } else {
            let grip_factor = self.grip * 28.0;
            v_lat *= (1.0 - grip_factor * dt).clamp(0.0, 1.0);
        }

        // EMP slow effect
        if self.emp_slow_timer > 0.0 {
            v_long *= 0.65;
            v_lat *= 0.65;
        }

        // Reconstruct velocity in world frame
        self.vx = fx * v_long + rx * v_lat;
        self.vy = fy * v_long + ry * v_lat;

        // Position integration
        self.x += self.vx * dt;
        self.y += self.vy * dt;
    }
}

pub struct GameOverInfo {
    pub winner_id: String,
    pub scoreboard: Vec<ScoreEntry>,
}

#[derive(Debug, Clone)]
pub struct GameState {
    pub tick: u64,
    pub match_timer: f32,
    pub cars: HashMap<String, CarSimulation>,
    pub projectiles: Vec<Projectile>,
    pub hazards: Vec<Hazard>,
    pub killfeed: VecDeque<KillFeedItem>,
    pub next_projectile_id: u32,
    pub next_hazard_id: u32,
}

impl GameState {
    pub fn new(players: &[LobbyPlayer], arena: &Arena) -> Self {
        let mut cars = HashMap::new();

        for (i, p) in players.iter().enumerate() {
            let spawn_idx = i % arena.spawns.len();
            let (sx, sy, s_angle) = arena.spawns[spawn_idx];
            let car = CarSimulation::new(p, sx, sy, s_angle);
            cars.insert(p.id.clone(), car);
        }

        Self {
            tick: 0,
            match_timer: MATCH_DURATION_SECS,
            cars,
            projectiles: Vec::new(),
            hazards: Vec::new(),
            killfeed: VecDeque::new(),
            next_projectile_id: 1,
            next_hazard_id: 1,
        }
    }

    pub fn step(
        &mut self,
        dt: f32,
        inputs: &HashMap<String, PlayerInput>,
        arena: &Arena,
    ) -> Option<GameOverInfo> {
        self.tick += 1;
        self.match_timer = (self.match_timer - dt).max(0.0);

        // 1. Process player inputs & abilities
        let car_ids: Vec<String> = self.cars.keys().cloned().collect();
        for id in &car_ids {
            let default_input = PlayerInput {
                sequence: 0,
                throttle: 0.0,
                steer: 0.0,
                brake: false,
                fire_primary: false,
                fire_special: false,
                ability_mobility: false,
                ability_utility: false,
            };
            let input = inputs.get(id).unwrap_or(&default_input);

            if let Some(car) = self.cars.get_mut(id) {
                if car.is_alive {
                    // Mobility ability
                    if input.ability_mobility && car.mobility_cooldown <= 0.0 {
                        let ct = car.car_type.to_lowercase();
                        if ct.contains("stadium") {
                            // Air-brake drift snap: snap angle to velocity heading, instant grip recovery
                            let spd = (car.vx * car.vx + car.vy * car.vy).sqrt();
                            if spd > 30.0 {
                                car.angle = car.vy.atan2(car.vx);
                            }
                            car.vx += car.angle.cos() * 150.0;
                            car.vy += car.angle.sin() * 150.0;
                            car.is_drifting = false;
                            car.mobility_cooldown = 2.0;
                        } else if ct.contains("desert") {
                            // Twin-turbo burner: instant boost forward
                            car.vx += car.angle.cos() * 380.0;
                            car.vy += car.angle.sin() * 380.0;
                            car.mobility_cooldown = 3.0;
                        } else if ct.contains("rally") {
                            // 180 slide pivot
                            car.angle += std::f32::consts::PI;
                            car.mobility_cooldown = 2.2;
                        }
                    }

                    // Utility ability
                    if input.ability_utility && car.utility_cooldown <= 0.0 {
                        let ct = car.car_type.to_lowercase();
                        if ct.contains("stadium") {
                            // Kinetic deflector shield
                            car.shield_timer = 2.5;
                            car.utility_cooldown = 5.0;
                        } else if ct.contains("desert") {
                            // Caltrop mine (deals 60 HP)
                            let mine_x = car.x - car.angle.cos() * 38.0;
                            let mine_y = car.y - car.angle.sin() * 38.0;
                            let hid = self.next_hazard_id;
                            self.next_hazard_id += 1;
                            self.hazards.push(Hazard {
                                id: hid,
                                owner_id: car.id.clone(),
                                kind: "mine".to_string(),
                                x: mine_x,
                                y: mine_y,
                                radius: 35.0,
                                active: true,
                                duration: 30.0,
                                damage: 60.0,
                            });
                            car.utility_cooldown = 4.0;
                        } else if ct.contains("rally") {
                            // EMP smoke screen
                            let hid = self.next_hazard_id;
                            self.next_hazard_id += 1;
                            self.hazards.push(Hazard {
                                id: hid,
                                owner_id: car.id.clone(),
                                kind: "emp_smoke".to_string(),
                                x: car.x,
                                y: car.y,
                                radius: 90.0,
                                active: true,
                                duration: 4.0,
                                damage: 0.0,
                            });
                            car.utility_cooldown = 4.5;
                        }
                    }

                    // Special weapon
                    if input.fire_special && car.special_cooldown <= 0.0 {
                        let ct = car.car_type.to_lowercase();
                        if ct.contains("stadium") {
                            // Rocket salvo: fires a rocket (45 HP)
                            let pid = self.next_projectile_id;
                            self.next_projectile_id += 1;
                            let px = car.x + car.angle.cos() * 28.0;
                            let py = car.y + car.angle.sin() * 28.0;
                            let p_speed = 780.0;
                            self.projectiles.push(Projectile {
                                id: pid,
                                owner_id: car.id.clone(),
                                kind: "rocket".to_string(),
                                x: px,
                                y: py,
                                vx: car.vx * 0.2 + car.angle.cos() * p_speed,
                                vy: car.vy * 0.2 + car.angle.sin() * p_speed,
                                radius: 7.0,
                                damage: 45.0,
                                lifetime: 1.6,
                            });
                            // Chassis recoil
                            car.vx -= car.angle.cos() * 65.0;
                            car.vy -= car.angle.sin() * 65.0;
                            car.special_cooldown = 1.6;
                        } else if ct.contains("desert") {
                            // Ramming overdrive charge: up to 50 HP on ram
                            car.ram_active_timer = 2.0;
                            car.vx += car.angle.cos() * 300.0;
                            car.vy += car.angle.sin() * 300.0;
                            car.special_cooldown = 4.0;
                        } else if ct.contains("rally") {
                            // Overcharge rail beam (40 HP)
                            let pid = self.next_projectile_id;
                            self.next_projectile_id += 1;
                            let px = car.x + car.angle.cos() * 30.0;
                            let py = car.y + car.angle.sin() * 30.0;
                            let p_speed = 1800.0;
                            self.projectiles.push(Projectile {
                                id: pid,
                                owner_id: car.id.clone(),
                                kind: "rail_beam".to_string(),
                                x: px,
                                y: py,
                                vx: car.angle.cos() * p_speed,
                                vy: car.angle.sin() * p_speed,
                                radius: 8.0,
                                damage: 40.0,
                                lifetime: 0.9,
                            });
                            // Chassis recoil
                            car.vx -= car.angle.cos() * 80.0;
                            car.vy -= car.angle.sin() * 80.0;
                            car.special_cooldown = 1.8;
                        }
                    }

                    // Primary weapon (15 HP)
                    if input.fire_primary && car.primary_cooldown <= 0.0 {
                        let ct = car.car_type.to_lowercase();
                        let (kind, speed, radius, cd, recoil) = if ct.contains("desert") {
                            ("autocannon", 920.0, 5.5, 0.28, 50.0)
                        } else if ct.contains("rally") {
                            ("rail", 1400.0, 4.0, 0.32, 40.0)
                        } else {
                            ("pulse", 950.0, 4.0, 0.18, 35.0)
                        };

                        let pid = self.next_projectile_id;
                        self.next_projectile_id += 1;
                        let px = car.x + car.angle.cos() * 26.0;
                        let py = car.y + car.angle.sin() * 26.0;
                        self.projectiles.push(Projectile {
                            id: pid,
                            owner_id: car.id.clone(),
                            kind: kind.to_string(),
                            x: px,
                            y: py,
                            vx: car.vx * 0.2 + car.angle.cos() * speed,
                            vy: car.vy * 0.2 + car.angle.sin() * speed,
                            radius,
                            damage: 15.0,
                            lifetime: 1.2,
                        });

                        // Chassis recoil force
                        car.vx -= car.angle.cos() * recoil;
                        car.vy -= car.angle.sin() * recoil;
                        car.primary_cooldown = cd;
                    }

                    // Step physics movement
                    car.step_physics(input, dt);

                    // Arena wall collisions
                    for wall in &arena.walls {
                        resolve_circle_wall_collision(
                            &mut car.x,
                            &mut car.y,
                            &mut car.vx,
                            &mut car.vy,
                            PLAYER_RADIUS,
                            wall,
                            0.55,
                        );
                    }

                    // Boost pad triggers
                    if car.boost_pad_cooldown <= 0.0 {
                        for pad in &arena.boost_pads {
                            if check_boost_pad(car.x, car.y, pad) {
                                let boost_dir = pad.angle.unwrap_or(car.angle);
                                car.vx += boost_dir.cos() * pad.boost_speed;
                                car.vy += boost_dir.sin() * pad.boost_speed;
                                car.boost_meter = 100.0;
                                car.boost_pad_cooldown = 0.6;
                                break;
                            }
                        }
                    }
                }
            }
        }

        // 2. Car vs Car collisions
        let mut ram_kills = Vec::new();
        let ids: Vec<String> = self.cars.keys().cloned().collect();
        for i in 0..ids.len() {
            for j in (i + 1)..ids.len() {
                let id1 = &ids[i];
                let id2 = &ids[j];

                let (c1_alive, c2_alive) = {
                    let c1 = self.cars.get(id1).unwrap();
                    let c2 = self.cars.get(id2).unwrap();
                    (c1.is_alive, c2.is_alive)
                };

                if c1_alive && c2_alive {
                    let mut c1 = self.cars.get(id1).cloned().unwrap();
                    let mut c2 = self.cars.get(id2).cloned().unwrap();

                    if let Some(impact) = resolve_circle_circle_collision(
                        &mut c1.x,
                        &mut c1.y,
                        &mut c1.vx,
                        &mut c1.vy,
                        c1.mass,
                        PLAYER_RADIUS,
                        &mut c2.x,
                        &mut c2.y,
                        &mut c2.vx,
                        &mut c2.vy,
                        c2.mass,
                        PLAYER_RADIUS,
                        0.7,
                    ) {
                        // Check ram overdrive damage (up to 50 HP)
                        if c1.ram_active_timer > 0.0 && c2.shield_timer <= 0.0 {
                            let dmg = (50.0 * (impact / 250.0).clamp(0.4, 1.0)).min(50.0);
                            c2.health -= dmg;
                            if c2.health <= 0.0 {
                                ram_kills.push((
                                    c1.id.clone(),
                                    c1.name.clone(),
                                    c2.id.clone(),
                                    c2.name.clone(),
                                    "ram".to_string(),
                                ));
                            }
                        }

                        if c2.ram_active_timer > 0.0 && c1.shield_timer <= 0.0 {
                            let dmg = (50.0 * (impact / 250.0).clamp(0.4, 1.0)).min(50.0);
                            c1.health -= dmg;
                            if c1.health <= 0.0 {
                                ram_kills.push((
                                    c2.id.clone(),
                                    c2.name.clone(),
                                    c1.id.clone(),
                                    c1.name.clone(),
                                    "ram".to_string(),
                                ));
                            }
                        }
                    }

                    self.cars.insert(id1.clone(), c1);
                    self.cars.insert(id2.clone(), c2);
                }
            }
        }

        // Process any ram kills
        for (killer_id, killer_name, victim_id, victim_name, weapon) in ram_kills {
            self.handle_kill(&killer_id, &killer_name, &victim_id, &victim_name, &weapon);
        }

        // 3. Projectiles simulation and hit resolution
        let current_projectiles = std::mem::take(&mut self.projectiles);
        let mut surviving_projectiles = Vec::new();
        let mut projectile_kills = Vec::new();

        for mut p in current_projectiles {
            let next_x = p.x + p.vx * dt;
            let next_y = p.y + p.vy * dt;
            p.lifetime -= dt;

            if p.lifetime <= 0.0 {
                continue;
            }

            // Wall collision check
            let mut hit_wall = false;
            for wall in &arena.walls {
                if wall.intersects_segment(p.x, p.y, next_x, next_y)
                    || wall.collide_circle(next_x, next_y, p.radius).is_some()
                {
                    hit_wall = true;
                    break;
                }
            }

            if hit_wall {
                continue;
            }

            // Player hit check
            let mut hit_player = false;

            for (cid, car) in self.cars.iter_mut() {
                if cid != &p.owner_id
                    && car.is_alive
                    && crate::physics::segment_intersects_circle(
                        p.x,
                        p.y,
                        next_x,
                        next_y,
                        car.x,
                        car.y,
                        PLAYER_RADIUS + p.radius,
                    )
                {
                    hit_player = true;
                    if car.shield_timer <= 0.0 {
                        car.health -= p.damage;
                        let p_spd = (p.vx * p.vx + p.vy * p.vy).sqrt().max(1.0);
                        car.vx += (p.vx / p_spd) * 120.0 / car.mass;
                        car.vy += (p.vy / p_spd) * 120.0 / car.mass;

                        if car.health <= 0.0 {
                            projectile_kills.push((
                                p.owner_id.clone(),
                                car.id.clone(),
                                car.name.clone(),
                                p.kind.clone(),
                            ));
                        }
                    }
                    break;
                }
            }

            if !hit_player {
                p.x = next_x;
                p.y = next_y;
                surviving_projectiles.push(p);
            }
        }
        self.projectiles = surviving_projectiles;

        for (killer_id, victim_id, victim_name, weapon) in projectile_kills {
            let killer_name = self
                .cars
                .get(&killer_id)
                .map(|c| c.name.clone())
                .unwrap_or_else(|| "Unknown".to_string());
            self.handle_kill(&killer_id, &killer_name, &victim_id, &victim_name, &weapon);
        }

        // 4. Hazard simulation (Mines, EMP)
        let current_hazards = std::mem::take(&mut self.hazards);
        let mut surviving_hazards = Vec::new();
        let mut mine_kills = Vec::new();

        for mut h in current_hazards {
            h.duration -= dt;
            if h.duration <= 0.0 || !h.active {
                continue;
            }

            if h.kind == "mine" {
                let mut detonated = false;
                for (cid, car) in self.cars.iter_mut() {
                    if cid != &h.owner_id
                        && car.is_alive
                        && check_mine_trigger(
                            car.x,
                            car.y,
                            PLAYER_RADIUS,
                            h.x,
                            h.y,
                            h.radius,
                        )
                    {
                        detonated = true;
                        if car.shield_timer <= 0.0 {
                            car.health -= h.damage;
                            let dx = car.x - h.x;
                            let dy = car.y - h.y;
                            let dist = (dx * dx + dy * dy).sqrt().max(1.0);
                            car.vx += (dx / dist) * 450.0 / car.mass;
                            car.vy += (dy / dist) * 450.0 / car.mass;

                            if car.health <= 0.0 {
                                mine_kills.push((
                                    h.owner_id.clone(),
                                    car.id.clone(),
                                    car.name.clone(),
                                ));
                            }
                        }
                    }
                }

                if !detonated {
                    surviving_hazards.push(h);
                }
            } else if h.kind == "emp_smoke" {
                // Apply EMP slow to all other players in smoke cloud
                for (cid, car) in self.cars.iter_mut() {
                    if cid != &h.owner_id
                        && car.is_alive
                        && crate::physics::circle_intersects_circle(
                            car.x,
                            car.y,
                            PLAYER_RADIUS,
                            h.x,
                            h.y,
                            h.radius,
                        )
                    {
                        car.emp_slow_timer = 0.5;
                    }
                }
                surviving_hazards.push(h);
            }
        }
        self.hazards = surviving_hazards;

        for (killer_id, victim_id, victim_name) in mine_kills {
            let killer_name = self
                .cars
                .get(&killer_id)
                .map(|c| c.name.clone())
                .unwrap_or_else(|| "Unknown".to_string());
            self.handle_kill(&killer_id, &killer_name, &victim_id, &victim_name, "mine");
        }

        // 5. Respawns
        for car in self.cars.values_mut() {
            if !car.is_alive {
                car.respawn_timer -= dt;
                if car.respawn_timer <= 0.0 {
                    // Pick safe spawn
                    let (sx, sy, s_angle) = arena.spawns[0];
                    car.reset_at_spawn(sx, sy, s_angle);
                }
            }
        }

        // 6. Check game over conditions
        let mut leader_id = String::new();
        let mut max_kills = 0;
        let mut kill_cap_reached = false;

        for car in self.cars.values() {
            if car.kills >= WIN_KILL_COUNT {
                kill_cap_reached = true;
            }
            if car.kills >= max_kills {
                max_kills = car.kills;
                leader_id = car.id.clone();
            }
        }

        if kill_cap_reached || self.match_timer <= 0.0 {
            let scoreboard = self.get_scoreboard();
            let winner = if !leader_id.is_empty() {
                leader_id
            } else if let Some(first) = scoreboard.first() {
                first.player_id.clone()
            } else {
                "none".to_string()
            };

            return Some(GameOverInfo {
                winner_id: winner,
                scoreboard,
            });
        }

        None
    }

    fn handle_kill(
        &mut self,
        killer_id: &str,
        killer_name: &str,
        victim_id: &str,
        victim_name: &str,
        weapon: &str,
    ) {
        if let Some(victim) = self.cars.get_mut(victim_id) {
            victim.health = 0.0;
            victim.is_alive = false;
            victim.respawn_timer = RESPAWN_DELAY_SECS;
            victim.deaths += 1;
        }

        if let Some(killer) = self.cars.get_mut(killer_id) {
            killer.kills += 1;
            killer.score += 100;
        }

        let item = KillFeedItem {
            killer_id: killer_id.to_string(),
            killer_name: killer_name.to_string(),
            victim_id: victim_id.to_string(),
            victim_name: victim_name.to_string(),
            weapon: weapon.to_string(),
            timestamp: current_time_ms(),
        };

        self.killfeed.push_back(item);
        while self.killfeed.len() > 8 {
            self.killfeed.pop_front();
        }
    }

    pub fn to_world_state_message(&self) -> ServerMessage {
        let players = self
            .cars
            .values()
            .map(|c| PlayerState {
                id: c.id.clone(),
                name: c.name.clone(),
                car_type: c.car_type.clone(),
                x: c.x,
                y: c.y,
                angle: c.angle,
                vx: c.vx,
                vy: c.vy,
                angular_velocity: c.angular_velocity,
                steer: c.steer,
                health: c.health,
                max_health: c.max_health,
                shield: c.shield_timer,
                is_alive: c.is_alive,
                respawn_timer: c.respawn_timer,
                boost: c.boost_meter,
                score: c.score,
                kills: c.kills,
                deaths: c.deaths,
                drift: c.is_drifting,
                last_processed_input: c.last_input_seq,
            })
            .collect();

        let projectiles = self
            .projectiles
            .iter()
            .map(|p| ProjectileState {
                id: p.id,
                owner_id: p.owner_id.clone(),
                kind: p.kind.clone(),
                x: p.x,
                y: p.y,
                vx: p.vx,
                vy: p.vy,
                radius: p.radius,
                lifetime: p.lifetime,
            })
            .collect();

        let hazards = self
            .hazards
            .iter()
            .map(|h| HazardState {
                id: h.id,
                owner_id: h.owner_id.clone(),
                kind: h.kind.clone(),
                x: h.x,
                y: h.y,
                radius: h.radius,
                active: h.active,
                duration: h.duration,
            })
            .collect();

        ServerMessage::WorldState {
            tick: self.tick,
            timestamp: current_time_ms(),
            players,
            projectiles,
            hazards,
            killfeed: self.killfeed.iter().cloned().collect(),
        }
    }

    pub fn get_scoreboard(&self) -> Vec<ScoreEntry> {
        let mut entries: Vec<ScoreEntry> = self
            .cars
            .values()
            .map(|c| ScoreEntry {
                player_id: c.id.clone(),
                name: c.name.clone(),
                car_type: c.car_type.clone(),
                kills: c.kills,
                deaths: c.deaths,
                score: c.score,
            })
            .collect();

        // Sort by kills descending, then deaths ascending
        entries.sort_by(|a, b| {
            b.kills
                .cmp(&a.kills)
                .then_with(|| a.deaths.cmp(&b.deaths))
                .then_with(|| b.score.cmp(&a.score))
        });

        entries
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_car_archetypes_health() {
        let p_stadium = LobbyPlayer {
            id: "1".into(),
            name: "S".into(),
            car_type: "stadium".into(),
            is_host: true,
            ready: true,
        };
        let p_desert = LobbyPlayer {
            id: "2".into(),
            name: "D".into(),
            car_type: "desert".into(),
            is_host: false,
            ready: true,
        };
        let p_rally = LobbyPlayer {
            id: "3".into(),
            name: "R".into(),
            car_type: "rally".into(),
            is_host: false,
            ready: true,
        };

        let car_s = CarSimulation::new(&p_stadium, 0.0, 0.0, 0.0);
        let car_d = CarSimulation::new(&p_desert, 0.0, 0.0, 0.0);
        let car_r = CarSimulation::new(&p_rally, 0.0, 0.0, 0.0);

        assert_eq!(car_s.max_health, 100.0);
        assert_eq!(car_d.max_health, 150.0);
        assert_eq!(car_r.max_health, 85.0);
    }

    #[test]
    fn test_primary_fire_and_hit_damage() {
        let arena = Arena::default_arena();
        let players = vec![
            LobbyPlayer {
                id: "p1".into(),
                name: "Shooter".into(),
                car_type: "stadium".into(),
                is_host: true,
                ready: true,
            },
            LobbyPlayer {
                id: "p2".into(),
                name: "Target".into(),
                car_type: "stadium".into(),
                is_host: false,
                ready: true,
            },
        ];

        let mut game = GameState::new(&players, &arena);

        // Target is placed 300 units away so projectile travels first
        {
            let p1 = game.cars.get_mut("p1").unwrap();
            p1.x = 200.0;
            p1.y = 500.0;
            p1.angle = 0.0; // Facing east (+X)
            p1.shield_timer = 0.0;

            let p2 = game.cars.get_mut("p2").unwrap();
            p2.x = 400.0; // 200 units away
            p2.y = 500.0;
            p2.shield_timer = 0.0; // remove spawn shield for damage test
        }

        // Fire primary
        let mut inputs = HashMap::new();
        inputs.insert(
            "p1".to_string(),
            PlayerInput {
                fire_primary: true,
                ..Default::default()
            },
        );

        // Step 1: fires projectile and it flies in the air
        game.step(1.0 / 60.0, &inputs, &arena);
        assert_eq!(game.projectiles.len(), 1);
        assert_eq!(game.projectiles[0].damage, 15.0);

        // Step multiple ticks until projectile reaches target
        let empty_inputs = HashMap::new();
        for _ in 0..15 {
            game.step(1.0 / 60.0, &empty_inputs, &arena);
        }

        let p2 = game.cars.get("p2").unwrap();
        // Target took 15 HP damage: 100 - 15 = 85
        assert_eq!(p2.health, 85.0);
    }

    #[test]
    fn test_mine_damage_and_respawn() {
        let arena = Arena::default_arena();
        let players = vec![
            LobbyPlayer {
                id: "p1".into(),
                name: "DesertCar".into(),
                car_type: "desert".into(),
                is_host: true,
                ready: true,
            },
            LobbyPlayer {
                id: "p2".into(),
                name: "Victim".into(),
                car_type: "rally".into(), // 85 HP
                is_host: false,
                ready: true,
            },
        ];

        let mut game = GameState::new(&players, &arena);

        // p1 drops mine
        {
            let p1 = game.cars.get_mut("p1").unwrap();
            p1.x = 400.0;
            p1.y = 400.0;
        }

        let mut inputs = HashMap::new();
        inputs.insert(
            "p1".to_string(),
            PlayerInput {
                ability_utility: true,
                ..Default::default()
            },
        );

        game.step(1.0 / 60.0, &inputs, &arena);
        assert_eq!(game.hazards.len(), 1);
        let mine = &game.hazards[0];
        assert_eq!(mine.damage, 60.0);
        let mine_x = mine.x;
        let mine_y = mine.y;

        // Position p2 (victim) on top of the mine without shield
        {
            let p2 = game.cars.get_mut("p2").unwrap();
            p2.x = mine_x;
            p2.y = mine_y;
            p2.shield_timer = 0.0;
        }

        // Step to trigger mine explosion
        game.step(1.0 / 60.0, &HashMap::new(), &arena);

        let p2 = game.cars.get("p2").unwrap();
        // Rally car had 85 HP, mine deals 60 HP -> 25 HP left
        assert_eq!(p2.health, 25.0);

        // Mine should be gone
        assert!(game.hazards.is_empty());
    }

    #[test]
    fn test_respawn_after_death() {
        let arena = Arena::default_arena();
        let players = vec![
            LobbyPlayer {
                id: "p1".into(),
                name: "P1".into(),
                car_type: "stadium".into(),
                is_host: true,
                ready: true,
            },
            LobbyPlayer {
                id: "p2".into(),
                name: "P2".into(),
                car_type: "stadium".into(),
                is_host: false,
                ready: true,
            },
        ];

        let mut game = GameState::new(&players, &arena);
        let p2 = game.cars.get_mut("p2").unwrap();
        p2.health = 0.0;
        p2.is_alive = false;
        p2.respawn_timer = 3.0;

        // Tick 2 seconds: still dead
        game.step(2.0, &HashMap::new(), &arena);
        assert!(!game.cars.get("p2").unwrap().is_alive);

        // Tick another 1.1 seconds: respawns with full HP and 2s shield!
        game.step(1.1, &HashMap::new(), &arena);
        let p2_respawned = game.cars.get("p2").unwrap();
        assert!(p2_respawned.is_alive);
        assert_eq!(p2_respawned.health, p2_respawned.max_health);
        assert!(p2_respawned.shield_timer > 0.0);
    }
}
