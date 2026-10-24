use super::*;

const TOLERANCE: f32 = 1e-4;

fn position(mesh: &MeshGeometry, index: u32) -> [f32; 3] {
    let start = index as usize * FLOATS_PER_VERTEX;
    let v = mesh.vertices_slice();
    [v[start], v[start + 1], v[start + 2]]
}

fn normal(mesh: &MeshGeometry, index: u32) -> [f32; 3] {
    let start = index as usize * FLOATS_PER_VERTEX + 3;
    let v = mesh.vertices_slice();
    [v[start], v[start + 1], v[start + 2]]
}

fn triangles(mesh: &MeshGeometry) -> Vec<[u32; 3]> {
    mesh.indices_slice().as_chunks::<3>().0.to_vec()
}

/// For a convex mesh around the origin, CCW-from-outside winding means every
/// face normal points away from the origin, and so does every vertex normal.
fn assert_outward(mesh: &MeshGeometry) {
    for [a, b, c] in triangles(mesh) {
        let [pa, pb, pc] = [a, b, c].map(|i| position(mesh, i));
        let face = cross(sub(pb, pa), sub(pc, pa));
        let centroid = [0, 1, 2].map(|k| (pa[k] + pb[k] + pc[k]) / 3.0);
        assert!(dot(face, centroid) > 0.0, "inward triangle {a} {b} {c}");
        for i in [a, b, c] {
            assert!(
                dot(normal(mesh, i), face) > 0.0,
                "vertex normal {i} faces inward"
            );
        }
    }
}

fn assert_unit_normals(mesh: &MeshGeometry) {
    for i in 0..mesh.vertex_count() as u32 {
        let n = normal(mesh, i);
        assert!((dot(n, n).sqrt() - 1.0).abs() < TOLERANCE);
    }
}

#[test]
fn sphere_is_a_closed_unit_sphere_wound_outward() {
    let mesh = MeshGeometry::sphere(16, 8);

    assert_eq!(mesh.vertex_count(), 17 * 9);
    // 16 * 8 quads, minus one triangle per segment at each pole.
    assert_eq!(mesh.index_count(), (16 * 8 * 2 - 2 * 16) * 3);
    for i in 0..mesh.vertex_count() as u32 {
        let p = position(&mesh, i);
        assert!((dot(p, p).sqrt() - 1.0).abs() < TOLERANCE);
    }
    assert!((mesh.bounding_radius() - 1.0).abs() < TOLERANCE);
    assert_outward(&mesh);
    assert_unit_normals(&mesh);
}

#[test]
fn sphere_tessellation_is_clamped() {
    let coarse = MeshGeometry::sphere(0, 0);

    assert_eq!(coarse.vertex_count(), 4 * 3);
    assert_outward(&coarse);
}

#[test]
fn cone_points_up_and_fits_the_unit_sphere() {
    let mesh = MeshGeometry::cone(12);

    assert_outward(&mesh);
    assert_unit_normals(&mesh);
    let heights: Vec<f32> = (0..mesh.vertex_count() as u32)
        .map(|i| position(&mesh, i)[1])
        .collect();
    assert!(heights.iter().all(|&y| y == 0.5 || y == -0.5));
    assert!((mesh.bounding_radius() - 0.5_f32.hypot(0.5)).abs() < TOLERANCE);
    assert_eq!(mesh.index_count(), 12 * 3 * 2);
}

#[test]
fn disc_faces_plus_z() {
    let mesh = MeshGeometry::disc(8);

    assert_eq!(mesh.vertex_count(), 9);
    assert_eq!(mesh.index_count(), 8 * 3);
    for [a, b, c] in triangles(&mesh) {
        let [pa, pb, pc] = [a, b, c].map(|i| position(&mesh, i));
        assert!(cross(sub(pb, pa), sub(pc, pa))[2] > 0.0);
    }
    assert!((mesh.bounding_radius() - 1.0).abs() < TOLERANCE);
}

#[test]
fn from_triangles_builds_smooth_normals() {
    // Two triangles sharing the edge 2-3; their face normals are (1, 1, 2)
    // and (1, 1, -2), so the shared vertices average to (1, 1, 0) / sqrt(2).
    let positions = [
        -1.0, 0.0, 1.0, //
        -1.0, 0.0, -1.0, //
        0.0, 1.0, 0.0, //
        1.0, 0.0, 0.0,
    ];
    let mesh = MeshGeometry::from_triangles(&positions, &[0, 3, 2, 1, 2, 3]);

    assert_eq!(mesh.vertex_count(), 4);
    assert_eq!(mesh.index_count(), 6);
    let half_sqrt2 = std::f32::consts::FRAC_1_SQRT_2;
    for shared in [2, 3] {
        let n = normal(&mesh, shared);
        assert!((n[0] - half_sqrt2).abs() < TOLERANCE, "{n:?}");
        assert!((n[1] - half_sqrt2).abs() < TOLERANCE, "{n:?}");
        assert!(n[2].abs() < TOLERANCE, "{n:?}");
    }
    assert_unit_normals(&mesh);
}

#[test]
fn from_triangles_reads_a_soup_and_drops_bad_triangles() {
    let soup = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    assert_eq!(MeshGeometry::from_triangles(&soup, &[]).index_count(), 3);

    let mut positions = soup.to_vec();
    positions.extend_from_slice(&[f32::NAN, 0.0, 0.0]);
    let mesh = MeshGeometry::from_triangles(&positions, &[0, 1, 2, 0, 1, 9, 0, 1, 3, 0, 1]);

    assert_eq!(mesh.indices_slice(), &[0, 1, 2]);
    // The unreferenced NaN vertex keeps the fallback normal and is ignored by the bound.
    assert_eq!(normal(&mesh, 3), FALLBACK_NORMAL);
    assert!((mesh.bounding_radius() - 1.0).abs() < TOLERANCE);
}

#[test]
fn empty_input_gives_an_empty_mesh() {
    let mesh = MeshGeometry::from_triangles(&[], &[]);

    assert_eq!((mesh.vertex_count(), mesh.index_count()), (0, 0));
    assert_eq!(mesh.bounding_radius(), 0.0);
}
