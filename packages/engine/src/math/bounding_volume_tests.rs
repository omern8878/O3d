use super::*;

fn entity(position: [f32; 3], size: f32) -> ([f32; 3], [f32; 3]) {
    (position, [size, size, size])
}

fn enclose(entities: &[([f32; 3], [f32; 3])]) -> Option<BoundingVolume> {
    let positions: Vec<f32> = entities.iter().flat_map(|(p, _)| *p).collect();
    let scales: Vec<f32> = entities.iter().flat_map(|(_, s)| *s).collect();
    BoundingVolume::enclose_entities(&positions, &scales)
}

#[test]
fn a_single_entity_is_bounded_by_its_own_sphere_and_box() {
    let volume = enclose(&[entity([1.0, 2.0, 3.0], 2.0)]).unwrap();
    let r = 3.0_f32.sqrt();

    assert_eq!(volume.center, [1.0, 2.0, 3.0]);
    assert!((volume.radius - r).abs() < 1e-5);
    assert_eq!(volume.min, [1.0 - r, 2.0 - r, 3.0 - r]);
    assert_eq!(volume.max, [1.0 + r, 2.0 + r, 3.0 + r]);
}

#[test]
fn every_entity_sphere_lies_inside_both_shapes() {
    let entities = [
        entity([-50.0, 0.0, 0.0], 1.0),
        entity([40.0, 10.0, -5.0], 4.0),
        entity([0.0, -30.0, 20.0], 0.5),
        entity([5.0, 5.0, 5.0], 10.0),
    ];
    let volume = enclose(&entities).unwrap();

    for (position, scale) in entities {
        let radius = 0.5 * dot(scale, scale).sqrt();
        let offset = sub(position, volume.center);
        assert!(dot(offset, offset).sqrt() + radius <= volume.radius + 1e-4);
        for ((&coordinate, &min), &max) in position.iter().zip(&volume.min).zip(&volume.max) {
            assert!(coordinate - radius >= min - 1e-4);
            assert!(coordinate + radius <= max + 1e-4);
        }
    }
}

#[test]
fn a_round_shell_gets_a_tight_sphere_and_a_flat_scene_a_flat_box() {
    let ring: Vec<_> = (0..64)
        .map(|i| {
            let angle = i as f32 * std::f32::consts::TAU / 64.0;
            entity([100.0 * angle.cos(), 100.0 * angle.sin(), 0.0], 2.0)
        })
        .collect();
    let volume = enclose(&ring).unwrap();

    assert!(volume.center.iter().all(|c| c.abs() < 1e-3));
    assert!(volume.radius >= 100.0 && volume.radius < 102.0);
    assert!(
        volume.max[2] - volume.min[2] < 4.0,
        "the box stays as flat as the ring"
    );
}

#[test]
fn empty_mismatched_or_non_finite_input_cannot_be_bounded() {
    assert_eq!(BoundingVolume::enclose_entities(&[], &[]), None);
    assert_eq!(BoundingVolume::enclose_entities(&[0.0; 6], &[1.0; 3]), None);
    assert_eq!(enclose(&[entity([f32::NAN, 0.0, 0.0], 1.0)]), None);
    assert_eq!(enclose(&[entity([0.0, 0.0, 0.0], f32::INFINITY)]), None);
}

#[test]
fn the_flat_layout_round_trips_and_rejects_invalid_volumes() {
    let volume = enclose(&[entity([1.0, 2.0, 3.0], 2.0), entity([-4.0, 0.0, 1.0], 1.0)]).unwrap();
    assert_eq!(BoundingVolume::from_slice(&volume.to_array()), Some(volume));

    let mut values = volume.to_array();
    assert_eq!(BoundingVolume::from_slice(&values[..9]), None);
    values[3] = -1.0;
    assert_eq!(BoundingVolume::from_slice(&values), None, "negative radius");
    values = volume.to_array();
    values[4] = values[7] + 1.0;
    assert_eq!(BoundingVolume::from_slice(&values), None, "inverted box");
    values = volume.to_array();
    values[0] = f32::NAN;
    assert_eq!(BoundingVolume::from_slice(&values), None);
}
