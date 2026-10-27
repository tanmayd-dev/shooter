use serde::{Deserialize, Serialize};

pub const PLAYER_RADIUS: f32 = 20.0;
pub const ARENA_WIDTH: f32 = 3600.0;
pub const ARENA_HEIGHT: f32 = 2400.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl Rect {
    pub const fn new(x: f32, y: f32, width: f32, height: f32) -> Self {
        Self { x, y, width, height }
    }

    pub fn left(&self) -> f32 {
        self.x
    }

    pub fn right(&self) -> f32 {
        self.x + self.width
    }

    pub fn top(&self) -> f32 {
        self.y
    }

    pub fn bottom(&self) -> f32 {
        self.y + self.height
    }

    pub fn contains_point(&self, px: f32, py: f32) -> bool {
        px >= self.left() && px <= self.right() && py >= self.top() && py <= self.bottom()
    }

    pub fn closest_point(&self, px: f32, py: f32) -> (f32, f32) {
        let cx = px.clamp(self.left(), self.right());
        let cy = py.clamp(self.top(), self.bottom());
        (cx, cy)
    }

    pub fn collide_circle(&self, cx: f32, cy: f32, radius: f32) -> Option<CircleRectCollision> {
        let (closest_x, closest_y) = self.closest_point(cx, cy);
        let dx = cx - closest_x;
        let dy = cy - closest_y;
        let dist_sq = dx * dx + dy * dy;

        // Inside the rect
        if closest_x == cx && closest_y == cy {
            let left_dist = (cx - self.left()).abs();
            let right_dist = (self.right() - cx).abs();
            let top_dist = (cy - self.top()).abs();
            let bottom_dist = (self.bottom() - cy).abs();

            let min_dist = left_dist.min(right_dist).min(top_dist).min(bottom_dist);

            let (nx, ny) = if min_dist == left_dist {
                (-1.0, 0.0)
            } else if min_dist == right_dist {
                (1.0, 0.0)
            } else if min_dist == top_dist {
                (0.0, -1.0)
            } else {
                (0.0, 1.0)
            };

            return Some(CircleRectCollision {
                normal_x: nx,
                normal_y: ny,
                penetration: min_dist + radius,
            });
        }

        if dist_sq < radius * radius {
            let dist = dist_sq.sqrt();
            if dist > 0.0001 {
                Some(CircleRectCollision {
                    normal_x: dx / dist,
                    normal_y: dy / dist,
                    penetration: radius - dist,
                })
            } else {
                Some(CircleRectCollision {
                    normal_x: 0.0,
                    normal_y: -1.0,
                    penetration: radius,
                })
            }
        } else {
            None
        }
    }

    /// Fast Liang-Barsky segment intersection check
    pub fn intersects_segment(&self, x1: f32, y1: f32, x2: f32, y2: f32) -> bool {
        // If either endpoint is inside
        if self.contains_point(x1, y1) || self.contains_point(x2, y2) {
            return true;
        }

        let dx = x2 - x1;
        let dy = y2 - y1;

        let p = [-dx, dx, -dy, dy];
        let q = [
            x1 - self.left(),
            self.right() - x1,
            y1 - self.top(),
            self.bottom() - y1,
        ];

        let mut u1 = 0.0f32;
        let mut u2 = 1.0f32;

        for i in 0..4 {
            if p[i] == 0.0 {
                if q[i] < 0.0 {
                    return false;
                }
            } else {
                let t = q[i] / p[i];
                if p[i] < 0.0 {
                    if t > u2 {
                        return false;
                    }
                    if t > u1 {
                        u1 = t;
                    }
                } else {
                    if t < u1 {
                        return false;
                    }
                    if t < u2 {
                        u2 = t;
                    }
                }
            }
        }

        u1 <= u2
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CircleRectCollision {
    pub normal_x: f32,
    pub normal_y: f32,
    pub penetration: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BoostPad {
    pub id: u32,
    pub rect: Rect,
    pub boost_speed: f32,
    pub angle: Option<f32>,
}

#[derive(Debug, Clone)]
pub struct Arena {
    pub width: f32,
    pub height: f32,
    pub walls: Vec<Rect>,
    pub boost_pads: Vec<BoostPad>,
    pub spawns: Vec<(f32, f32, f32)>, // x, y, angle
}

impl Arena {
    pub fn default_arena() -> Self {
        let width = ARENA_WIDTH;
        let height = ARENA_HEIGHT;
        let wall_thick = 30.0;

        let walls = vec![
            // Perimeter walls
            Rect::new(0.0, 0.0, width, wall_thick),                         // Top
            Rect::new(0.0, height - wall_thick, width, wall_thick),         // Bottom
            Rect::new(0.0, 0.0, wall_thick, height),                         // Left
            Rect::new(width - wall_thick, 0.0, wall_thick, height),         // Right

            // Central stadium island (800..2800, 650..1750)
            Rect::new(800.0, 650.0, width - 1600.0, height - 1300.0),

            // Shoulder safety curbing (lane at y: 380 is fully clear)
            Rect::new(1350.0, 220.0, 25.0, 100.0),
            Rect::new(2350.0, 220.0, 25.0, 100.0),
            Rect::new(1350.0, height - 320.0, 25.0, 100.0),
            Rect::new(2350.0, height - 320.0, 25.0, 100.0),
        ];

        let boost_pads = vec![
            // Top straightaway boost east
            BoostPad {
                id: 1,
                rect: Rect::new(width / 2.0 - 100.0, 335.0, 200.0, 90.0),
                boost_speed: 650.0,
                angle: Some(0.0),
            },
            // Bottom straightaway boost west
            BoostPad {
                id: 2,
                rect: Rect::new(width / 2.0 - 100.0, height - 425.0, 200.0, 90.0),
                boost_speed: 650.0,
                angle: Some(std::f32::consts::PI),
            },
            // Left corridor boost north
            BoostPad {
                id: 3,
                rect: Rect::new(335.0, height / 2.0 - 100.0, 90.0, 200.0),
                boost_speed: 650.0,
                angle: Some(-std::f32::consts::FRAC_PI_2),
            },
            // Right corridor boost south
            BoostPad {
                id: 4,
                rect: Rect::new(width - 425.0, height / 2.0 - 100.0, 90.0, 200.0),
                boost_speed: 650.0,
                angle: Some(std::f32::consts::FRAC_PI_2),
            },
        ];

        let spawns = vec![
            (800.0, 380.0, 0.0),
            (2800.0, 2020.0, std::f32::consts::PI),
            (2800.0, 380.0, 0.0),
            (800.0, 2020.0, std::f32::consts::PI),
            (500.0, 1200.0, std::f32::consts::FRAC_PI_2),
            (3100.0, 1200.0, -std::f32::consts::FRAC_PI_2),
            (1800.0, 380.0, 0.0),
            (1800.0, 2020.0, std::f32::consts::PI),
        ];

        Self {
            width,
            height,
            walls,
            boost_pads,
            spawns,
        }
    }

    pub fn neon_stadium() -> Self {
        Self::default_arena()
    }

    pub fn cyber_canyon() -> Self {
        let width = ARENA_WIDTH;
        let height = ARENA_HEIGHT;
        let wall_thick = 30.0;

        let walls = vec![
            // Perimeter walls
            Rect::new(0.0, 0.0, width, wall_thick),
            Rect::new(0.0, height - wall_thick, width, wall_thick),
            Rect::new(0.0, 0.0, wall_thick, height),
            Rect::new(width - wall_thick, 0.0, wall_thick, height),

            // West mesa barrier formation (600..1600, 600..1800)
            Rect::new(600.0, 600.0, 1000.0, 1200.0),

            // East mesa top & bottom barriers (centered at x: 2450)
            Rect::new(2150.0, 725.0, 600.0, 350.0),
            Rect::new(2150.0, 1325.0, 600.0, 350.0),

            // Canyon rock pillars
            Rect::new(1065.0, 345.0, 70.0, 70.0),
            Rect::new(2465.0, 345.0, 70.0, 70.0),
            Rect::new(1065.0, height - 415.0, 70.0, 70.0),
            Rect::new(2465.0, height - 415.0, 70.0, 70.0),
        ];

        let boost_pads = vec![
            // North straightaway boost east
            BoostPad {
                id: 1,
                rect: Rect::new(width / 2.0 - 50.0, 250.0, 100.0, 200.0),
                boost_speed: 650.0,
                angle: Some(0.0),
            },
            // South straightaway boost west
            BoostPad {
                id: 2,
                rect: Rect::new(width / 2.0 - 50.0, height - 450.0, 100.0, 200.0),
                boost_speed: 650.0,
                angle: Some(std::f32::consts::PI),
            },
            // Central chasm launch boost east (positioned before jump ramp)
            BoostPad {
                id: 3,
                rect: Rect::new(1250.0, 1110.0, 120.0, 180.0),
                boost_speed: 650.0,
                angle: Some(0.0),
            },
            // West corridor boost north
            BoostPad {
                id: 4,
                rect: Rect::new(335.0, height / 2.0 - 90.0, 90.0, 180.0),
                boost_speed: 650.0,
                angle: Some(-std::f32::consts::FRAC_PI_2),
            },
        ];

        let spawns = vec![
            (800.0, 380.0, 0.0),
            (2800.0, 2020.0, std::f32::consts::PI),
            (2800.0, 380.0, 0.0),
            (800.0, 2020.0, std::f32::consts::PI),
            (500.0, 1200.0, std::f32::consts::FRAC_PI_2),
            (3100.0, 1200.0, -std::f32::consts::FRAC_PI_2),
        ];

        Self {
            width,
            height,
            walls,
            boost_pads,
            spawns,
        }
    }

    pub fn orbital_foundry() -> Self {
        let width = ARENA_WIDTH;
        let height = ARENA_HEIGHT;
        let wall_thick = 30.0;

        let walls = vec![
            // Perimeter walls
            Rect::new(0.0, 0.0, width, wall_thick),
            Rect::new(0.0, height - wall_thick, width, wall_thick),
            Rect::new(0.0, 0.0, wall_thick, height),
            Rect::new(width - wall_thick, 0.0, wall_thick, height),

            // Central reactor core island (900..2700, 800..1600)
            Rect::new(900.0, 800.0, 1800.0, 800.0),

            // Structural steel pillars (80x80)
            Rect::new(610.0, 610.0, 80.0, 80.0),
            Rect::new(width - 690.0, 610.0, 80.0, 80.0),
            Rect::new(610.0, height - 690.0, 80.0, 80.0),
            Rect::new(width - 690.0, height - 690.0, 80.0, 80.0),

            // Core chicane obstacles
            Rect::new(1782.5, 460.0, 35.0, 180.0),
            Rect::new(1782.5, height - 640.0, 35.0, 180.0),
            Rect::new(510.0, 1182.5, 180.0, 35.0),
            Rect::new(width - 690.0, 1182.5, 180.0, 35.0),
        ];

        let boost_pads = vec![
            BoostPad {
                id: 1,
                rect: Rect::new(1155.0, 290.0, 90.0, 180.0),
                boost_speed: 650.0,
                angle: Some(0.0),
            },
            BoostPad {
                id: 2,
                rect: Rect::new(2355.0, 290.0, 90.0, 180.0),
                boost_speed: 650.0,
                angle: Some(0.0),
            },
            BoostPad {
                id: 3,
                rect: Rect::new(2355.0, height - 470.0, 90.0, 180.0),
                boost_speed: 650.0,
                angle: Some(std::f32::consts::PI),
            },
            BoostPad {
                id: 4,
                rect: Rect::new(1155.0, height - 470.0, 90.0, 180.0),
                boost_speed: 650.0,
                angle: Some(std::f32::consts::PI),
            },
            BoostPad {
                id: 5,
                rect: Rect::new(335.0, 710.0, 90.0, 180.0),
                boost_speed: 650.0,
                angle: Some(std::f32::consts::FRAC_PI_2),
            },
            BoostPad {
                id: 6,
                rect: Rect::new(width - 425.0, 1510.0, 90.0, 180.0),
                boost_speed: 650.0,
                angle: Some(-std::f32::consts::FRAC_PI_2),
            },
        ];

        let spawns = vec![
            (800.0, 380.0, 0.0),
            (2800.0, 2020.0, std::f32::consts::PI),
            (2800.0, 380.0, 0.0),
            (800.0, 2020.0, std::f32::consts::PI),
        ];

        Self {
            width,
            height,
            walls,
            boost_pads,
            spawns,
        }
    }

    pub fn from_map_name(map: &str) -> Self {
        let m = map.to_lowercase();
        if m.contains("canyon") {
            Self::cyber_canyon()
        } else if m.contains("foundry") || m.contains("orbital") || m.contains("industrial") {
            Self::orbital_foundry()
        } else {
            Self::neon_stadium()
        }
    }
}

/// Resolves player vs wall collision.
/// Returns true if a collision was detected and resolved.
pub fn resolve_circle_wall_collision(
    x: &mut f32,
    y: &mut f32,
    vx: &mut f32,
    vy: &mut f32,
    radius: f32,
    wall: &Rect,
    restitution: f32,
) -> bool {
    if let Some(col) = wall.collide_circle(*x, *y, radius) {
        *x += col.normal_x * col.penetration;
        *y += col.normal_y * col.penetration;

        let v_dot_n = *vx * col.normal_x + *vy * col.normal_y;
        if v_dot_n < 0.0 {
            *vx -= (1.0 + restitution) * v_dot_n * col.normal_x;
            *vy -= (1.0 + restitution) * v_dot_n * col.normal_y;
        }
        true
    } else {
        false
    }
}

/// Resolves elastic collision between two circular players.
/// Returns relative impact velocity along collision normal if collision occurred.
#[allow(clippy::too_many_arguments)]
pub fn resolve_circle_circle_collision(
    x1: &mut f32,
    y1: &mut f32,
    vx1: &mut f32,
    vy1: &mut f32,
    m1: f32,
    r1: f32,
    x2: &mut f32,
    y2: &mut f32,
    vx2: &mut f32,
    vy2: &mut f32,
    m2: f32,
    r2: f32,
    restitution: f32,
) -> Option<f32> {
    let dx = *x2 - *x1;
    let dy = *y2 - *y1;
    let dist_sq = dx * dx + dy * dy;
    let min_dist = r1 + r2;

    if dist_sq < min_dist * min_dist && dist_sq > 0.00001 {
        let dist = dist_sq.sqrt();
        let nx = dx / dist;
        let ny = dy / dist;
        let penetration = min_dist - dist;

        // Mass-proportional displacement
        let total_mass = m1 + m2;
        let w1 = m2 / total_mass;
        let w2 = m1 / total_mass;

        *x1 -= nx * penetration * w1;
        *y1 -= ny * penetration * w1;
        *x2 += nx * penetration * w2;
        *y2 += ny * penetration * w2;

        // Relative velocity
        let rvx = *vx2 - *vx1;
        let rvy = *vy2 - *vy1;
        let vel_along_normal = rvx * nx + rvy * ny;

        if vel_along_normal < 0.0 {
            let impulse_mag = -(1.0 + restitution) * vel_along_normal / (1.0 / m1 + 1.0 / m2);
            let ix = nx * impulse_mag;
            let iy = ny * impulse_mag;

            *vx1 -= ix / m1;
            *vy1 -= iy / m1;
            *vx2 += ix / m2;
            *vy2 += iy / m2;

            return Some(vel_along_normal.abs());
        }
    }
    None
}

/// Check if two circles intersect
pub fn circle_intersects_circle(x1: f32, y1: f32, r1: f32, x2: f32, y2: f32, r2: f32) -> bool {
    let dx = x2 - x1;
    let dy = y2 - y1;
    let rad_sum = r1 + r2;
    (dx * dx + dy * dy) <= (rad_sum * rad_sum)
}

/// Check if a line segment intersects a circle
pub fn segment_intersects_circle(
    x1: f32,
    y1: f32,
    x2: f32,
    y2: f32,
    cx: f32,
    cy: f32,
    radius: f32,
) -> bool {
    let dx = x2 - x1;
    let dy = y2 - y1;
    let seg_len_sq = dx * dx + dy * dy;

    if seg_len_sq == 0.0 {
        return circle_intersects_circle(x1, y1, 0.0, cx, cy, radius);
    }

    let t = (((cx - x1) * dx + (cy - y1) * dy) / seg_len_sq).clamp(0.0, 1.0);
    let closest_x = x1 + t * dx;
    let closest_y = y1 + t * dy;

    let cdx = cx - closest_x;
    let cdy = cy - closest_y;
    (cdx * cdx + cdy * cdy) <= (radius * radius)
}

/// Check if a car triggers a boost pad
pub fn check_boost_pad(car_x: f32, car_y: f32, pad: &BoostPad) -> bool {
    pad.rect.contains_point(car_x, car_y)
}

/// Check if a car triggers a mine hazard
pub fn check_mine_trigger(
    car_x: f32,
    car_y: f32,
    car_radius: f32,
    mine_x: f32,
    mine_y: f32,
    mine_radius: f32,
) -> bool {
    circle_intersects_circle(car_x, car_y, car_radius, mine_x, mine_y, mine_radius)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rect_closest_point_and_contains() {
        let rect = Rect::new(100.0, 100.0, 200.0, 100.0);
        assert!(rect.contains_point(150.0, 150.0));
        assert!(!rect.contains_point(50.0, 150.0));

        let (cx, cy) = rect.closest_point(50.0, 150.0);
        assert_eq!(cx, 100.0);
        assert_eq!(cy, 150.0);
    }

    #[test]
    fn test_circle_rect_collision() {
        let rect = Rect::new(100.0, 100.0, 200.0, 100.0);
        // Circle overlapping left edge
        let col = rect.collide_circle(90.0, 150.0, 20.0);
        assert!(col.is_some());
        let col = col.unwrap();
        assert_eq!(col.normal_x, -1.0);
        assert_eq!(col.normal_y, 0.0);
        assert!((col.penetration - 10.0).abs() < 0.001);

        // Circle far away
        let col_none = rect.collide_circle(50.0, 50.0, 20.0);
        assert!(col_none.is_none());
    }

    #[test]
    fn test_resolve_circle_wall_collision() {
        let wall = Rect::new(0.0, 0.0, 2400.0, 30.0); // Top wall
        let mut x = 500.0;
        let mut y = 35.0; // Penetrating by 15.0 since radius is 20.0 (edge is at 30.0)
        let mut vx = 100.0;
        let mut vy = -200.0;

        let collided = resolve_circle_wall_collision(
            &mut x,
            &mut y,
            &mut vx,
            &mut vy,
            PLAYER_RADIUS,
            &wall,
            0.6,
        );

        assert!(collided);
        assert!(y >= 50.0); // Pushed out of wall
        assert!(vy > 0.0); // Velocity deflected downwards
    }

    #[test]
    fn test_resolve_circle_circle_collision() {
        let mut x1 = 100.0;
        let mut y1 = 100.0;
        let mut vx1 = 100.0;
        let mut vy1 = 0.0;
        let m1 = 1.0;

        let mut x2 = 130.0; // overlap = 40 - 30 = 10
        let mut y2 = 100.0;
        let mut vx2 = -100.0;
        let mut vy2 = 0.0;
        let m2 = 1.0;

        let impact = resolve_circle_circle_collision(
            &mut x1,
            &mut y1,
            &mut vx1,
            &mut vy1,
            m1,
            PLAYER_RADIUS,
            &mut x2,
            &mut y2,
            &mut vx2,
            &mut vy2,
            m2,
            PLAYER_RADIUS,
            0.8,
        );

        assert!(impact.is_some());
        assert!(x1 < 100.0); // Pushed left
        assert!(x2 > 130.0); // Pushed right
        assert!(vx1 < 0.0); // Rebounded left
        assert!(vx2 > 0.0); // Rebounded right
    }

    #[test]
    fn test_boost_pad_trigger() {
        let pad = BoostPad {
            id: 1,
            rect: Rect::new(200.0, 200.0, 100.0, 50.0),
            boost_speed: 600.0,
            angle: Some(0.0),
        };

        assert!(check_boost_pad(250.0, 220.0, &pad));
        assert!(!check_boost_pad(150.0, 220.0, &pad));
    }

    #[test]
    fn test_mine_trigger() {
        let mine_x = 500.0;
        let mine_y = 500.0;
        let mine_radius = 45.0;

        // Inside trigger radius
        assert!(check_mine_trigger(
            520.0,
            500.0,
            PLAYER_RADIUS,
            mine_x,
            mine_y,
            mine_radius
        ));
        // Outside trigger radius
        assert!(!check_mine_trigger(
            600.0,
            500.0,
            PLAYER_RADIUS,
            mine_x,
            mine_y,
            mine_radius
        ));
    }

    #[test]
    fn test_segment_intersects_circle() {
        // Line passing through circle
        assert!(segment_intersects_circle(
            0.0, 0.0, 100.0, 0.0, 50.0, 0.0, 10.0
        ));
        // Line glancing circle
        assert!(segment_intersects_circle(
            0.0, 10.0, 100.0, 10.0, 50.0, 0.0, 10.0
        ));
        // Line missing circle
        assert!(!segment_intersects_circle(
            0.0, 50.0, 100.0, 50.0, 50.0, 0.0, 10.0
        ));
    }

    #[test]
    fn test_rect_intersects_segment() {
        let rect = Rect::new(100.0, 100.0, 100.0, 100.0);
        // Line passing right through
        assert!(rect.intersects_segment(50.0, 150.0, 250.0, 150.0));
        // Line outside
        assert!(!rect.intersects_segment(50.0, 50.0, 80.0, 50.0));
    }
}
