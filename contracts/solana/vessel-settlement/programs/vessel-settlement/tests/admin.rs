use vessel_settlement::instructions::admin::change_is_ready;

#[test]
fn config_change_unlocks_at_exactly_twenty_four_hours() {
    assert!(!change_is_ready(86_499, 86_500));
    assert!(change_is_ready(86_500, 86_500));
}
