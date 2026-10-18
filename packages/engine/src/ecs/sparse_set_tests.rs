use super::*;

#[test]
fn allocates_sequential_ids_and_dense_indices() {
    let mut set = SparseSet::with_capacity(2);

    assert_eq!(set.allocate(), (0, 0));
    assert_eq!(set.allocate(), (1, 1));
    assert_eq!(set.active_count(), 2);
}

#[test]
fn remove_reports_swap_and_repoints_moved_entity() {
    let mut set = SparseSet::with_capacity(3);
    let (a, _) = set.allocate();
    let (b, _) = set.allocate();
    let (c, _) = set.allocate();

    assert_eq!(set.remove(a), Some((0, 2)));

    assert_eq!(set.active_count(), 2);
    assert_eq!(set.get_dense_index(a), None);
    assert_eq!(set.get_dense_index(c), Some(0));
    assert_eq!(set.get_dense_index(b), Some(1));
}

#[test]
fn removing_last_entity_reports_identical_indices() {
    let mut set = SparseSet::with_capacity(1);
    let (a, _) = set.allocate();

    assert_eq!(set.remove(a), Some((0, 0)));
    assert_eq!(set.active_count(), 0);
    assert_eq!(set.get_dense_index(a), None);
}

#[test]
fn recycles_removed_ids() {
    let mut set = SparseSet::with_capacity(2);
    let (a, _) = set.allocate();
    set.remove(a);

    assert_eq!(set.allocate(), (a, 0));
}

#[test]
fn rejects_unknown_and_double_removal() {
    let mut set = SparseSet::with_capacity(1);
    let (a, _) = set.allocate();

    assert_eq!(set.remove(a), Some((0, 0)));
    assert_eq!(set.remove(a), None);
    assert_eq!(set.remove(99), None);
    assert_eq!(set.get_dense_index(99), None);
}

#[test]
fn entity_id_at_dense_reports_the_id_stored_in_each_active_slot() {
    let mut set = SparseSet::with_capacity(3);
    let (a, _) = set.allocate();
    let (b, _) = set.allocate();
    let (c, _) = set.allocate();
    set.remove(a);

    assert_eq!(set.entity_id_at_dense(0), Some(c));
    assert_eq!(set.entity_id_at_dense(1), Some(b));
    assert_eq!(set.entity_id_at_dense(2), None);
    assert_eq!(set.entity_id_at_dense(usize::MAX), None);
}
