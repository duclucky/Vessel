#[test_only]
module vessel_settlement::admin_tests {
    use std::option;
    use std::signer;
    use std::string;
    use aptos_framework::chain_id;
    use aptos_framework::fungible_asset::{Self, Metadata};
    use aptos_framework::object::{Self, Object};
    use aptos_framework::primary_fungible_store;
    use aptos_framework::timestamp;
    use vessel_settlement::vessel_settlement as settlement;

    const PUBLIC_KEY: vector<u8> = x"34b4d9043156cb6dcf0beb0a2949b7559c940d2bcb6dbe8c53a9b30278e3a746";
    const SIGNATURE: vector<u8> = x"3f466d76f8b910974a6fc97c153baba6da31874e2f7274d2e5a4bca019dfac82c9131bf0dc844a2c674c9576729d356653405956f50065fbd2303e3108c28c0b";
    const QUOTE_ID: vector<u8> = x"1111111111111111111111111111111111111111111111111111111111111111";
    const PAYER_BYTES: vector<u8> = x"0000000000000000000000000000000000000000000000000000000000000123";
    const STORAGE_BYTES: vector<u8> = x"3333333333333333333333333333333333333333333333333333333333333333";
    const ASSET_BYTES: vector<u8> = x"84a6fbff40f247dd9d0a6681e918be102c3f9f780608686c536f477cd4ceb9ac";
    const FILE_HASH: vector<u8> = x"5555555555555555555555555555555555555555555555555555555555555555";

    fun setup(framework: &signer, admin: &signer, payer: &signer): Object<Metadata> {
        chain_id::initialize_for_test(framework, 2);
        timestamp::set_time_has_started_for_testing(framework);
        timestamp::update_global_time_for_test_secs(1785749000);
        let constructor = object::create_named_object(admin, b"test-asset");
        primary_fungible_store::create_primary_store_enabled_fungible_asset(
            &constructor,
            option::none(),
            string::utf8(b"Test ShelbyUSD"),
            string::utf8(b"TSUSD"),
            2,
            string::utf8(b""),
            string::utf8(b""),
        );
        let mint_ref = fungible_asset::generate_mint_ref(&constructor);
        let metadata = object::object_from_constructor_ref<Metadata>(&constructor);
        primary_fungible_store::mint(&mint_ref, signer::address_of(payer), 1000000);
        settlement::initialize_for_test(admin, metadata, PUBLIC_KEY, 1);
        metadata
    }

    fun settle_fixture(payer: &signer, metadata: Object<Metadata>) {
        settlement::settle(
            payer, metadata, 1, 1, 2, QUOTE_ID, PAYER_BYTES, STORAGE_BYTES,
            ASSET_BYTES, 84100, FILE_HASH, 7, 1786354494000000, 1785749994,
            1, SIGNATURE,
        )
    }

    #[test(framework = @0x1, admin = @vessel_settlement, payer = @0x123, attacker = @0xbad)]
    #[expected_failure(abort_code = 131074, location = settlement)]
    fun non_admin_cannot_schedule(
        framework: &signer,
        admin: &signer,
        payer: &signer,
        attacker: &signer,
    ) {
        let _metadata = setup(framework, admin, payer);
        settlement::schedule_change(attacker, 1, x"7777777777777777777777777777777777777777777777777777777777777777");
    }

    #[test(framework = @0x1, admin = @vessel_settlement, payer = @0x123)]
    #[expected_failure(abort_code = 131085, location = settlement)]
    fun queued_change_cannot_execute_at_86399(
        framework: &signer,
        admin: &signer,
        payer: &signer,
    ) {
        let _metadata = setup(framework, admin, payer);
        settlement::schedule_change(admin, 1, x"7777777777777777777777777777777777777777777777777777777777777777");
        timestamp::fast_forward_seconds(86399);
        settlement::execute_change(admin);
    }

    #[test(framework = @0x1, admin = @vessel_settlement, payer = @0x123)]
    fun queued_signer_change_executes_at_86400(
        framework: &signer,
        admin: &signer,
        payer: &signer,
    ) {
        let _metadata = setup(framework, admin, payer);
        let next_key = x"7777777777777777777777777777777777777777777777777777777777777777";
        settlement::schedule_change(admin, 1, next_key);
        timestamp::fast_forward_seconds(86400);
        settlement::execute_change(admin);
        let (_chain, quote_key, _asset, config_version, _admin, paused, locked) = settlement::config();
        assert!(quote_key == next_key && config_version == 2, 1);
        assert!(!paused && !locked && !settlement::has_pending_change(), 2);
    }

    #[test(framework = @0x1, admin = @vessel_settlement, payer = @0x123, destination = @0xd1)]
    fun admin_withdraws_exact_vault_amount(
        framework: &signer,
        admin: &signer,
        payer: &signer,
        destination: &signer,
    ) {
        let metadata = setup(framework, admin, payer);
        settle_fixture(payer, metadata);
        settlement::withdraw(admin, metadata, signer::address_of(destination), 4100);
        assert!(primary_fungible_store::balance(settlement::vault_address(), metadata) == 80000, 10);
        assert!(primary_fungible_store::balance(signer::address_of(destination), metadata) == 4100, 11);
    }

    #[test(framework = @0x1, admin = @vessel_settlement, payer = @0x123)]
    fun pause_unpause_and_lock_are_admin_controlled(
        framework: &signer,
        admin: &signer,
        payer: &signer,
    ) {
        let _metadata = setup(framework, admin, payer);
        settlement::pause(admin);
        assert!(settlement::is_paused(), 20);
        settlement::unpause(admin);
        assert!(!settlement::is_paused(), 21);
        settlement::lock_upgrade_intent(admin);
        assert!(settlement::is_upgrade_locked(), 22);
    }

    #[test(framework = @0x1, admin = @vessel_settlement, payer = @0x123)]
    #[expected_failure(abort_code = 131075, location = settlement)]
    fun pause_blocks_new_settlements(
        framework: &signer,
        admin: &signer,
        payer: &signer,
    ) {
        let metadata = setup(framework, admin, payer);
        settlement::pause(admin);
        settle_fixture(payer, metadata);
    }

    #[test(framework = @0x1, admin = @vessel_settlement, payer = @0x123)]
    #[expected_failure(abort_code = 131087, location = settlement)]
    fun upgrade_lock_is_one_way(framework: &signer, admin: &signer, payer: &signer) {
        let _metadata = setup(framework, admin, payer);
        settlement::lock_upgrade_intent(admin);
        settlement::lock_upgrade_intent(admin);
    }
}
