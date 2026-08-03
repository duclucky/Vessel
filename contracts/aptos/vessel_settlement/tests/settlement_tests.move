#[test_only]
module vessel_settlement::settlement_tests {
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
    const ASSET_BYTES: vector<u8> = x"84a6fbff40f247dd9d0a6681e918be102c3f9f780608686c536f477cd4ceb9ac";
    const STORAGE_BYTES: vector<u8> = x"3333333333333333333333333333333333333333333333333333333333333333";
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
        assert!(object::object_address(&metadata) == @0x84a6fbff40f247dd9d0a6681e918be102c3f9f780608686c536f477cd4ceb9ac, 1);
        primary_fungible_store::mint(&mint_ref, signer::address_of(payer), 1000000);
        settlement::initialize_for_test(admin, metadata, PUBLIC_KEY, 1);
        metadata
    }

    fun settle_fixture(payer: &signer, metadata: Object<Metadata>) {
        settle_with(
            payer,
            metadata,
            1,
            2,
            QUOTE_ID,
            PAYER_BYTES,
            x"3333333333333333333333333333333333333333333333333333333333333333",
            ASSET_BYTES,
            84100,
            x"5555555555555555555555555555555555555555555555555555555555555555",
            7,
            1785749994,
            1,
            SIGNATURE,
        )
    }

    fun settle_with(
        payer: &signer,
        metadata: Object<Metadata>,
        chain: u8,
        network: u32,
        quote_id: vector<u8>,
        payer_bytes: vector<u8>,
        storage_address: vector<u8>,
        asset: vector<u8>,
        amount: u64,
        file_hash: vector<u8>,
        retention_days: u16,
        quote_expires_at_secs: u64,
        config_version: u64,
        signature: vector<u8>,
    ) {
        settlement::settle(
            payer,
            metadata,
            1,
            chain,
            network,
            quote_id,
            payer_bytes,
            storage_address,
            asset,
            amount,
            file_hash,
            retention_days,
            1786354494000000,
            quote_expires_at_secs,
            config_version,
            signature,
        );
    }

    #[test(framework = @0x1, admin = @vessel_settlement, payer = @0x123)]
    fun valid_quote_debits_once(framework: &signer, admin: &signer, payer: &signer) {
        let metadata = setup(framework, admin, payer);
        settle_fixture(payer, metadata);

        assert!(settlement::is_settled(QUOTE_ID), 10);
        assert!(primary_fungible_store::balance(signer::address_of(payer), metadata) == 915900, 11);
        assert!(primary_fungible_store::balance(settlement::vault_address(), metadata) == 84100, 12);
        assert!(settlement::receipt_count_for_test() == 1, 13);
        let (chain, network, quote_id, payer_bytes, storage_address, asset, amount, file_hash, storage_expiration, config_version) = settlement::last_receipt_for_test();
        assert!(chain == 1 && network == 2 && quote_id == QUOTE_ID, 14);
        assert!(payer_bytes == PAYER_BYTES && storage_address == STORAGE_BYTES, 15);
        assert!(asset == ASSET_BYTES && amount == 84100 && file_hash == FILE_HASH, 16);
        assert!(storage_expiration == 1786354494000000 && config_version == 1, 17);
    }

    #[test(framework = @0x1, admin = @vessel_settlement, payer = @0x123)]
    #[expected_failure(abort_code = 131080, location = settlement)]
    fun quote_id_cannot_debit_twice(framework: &signer, admin: &signer, payer: &signer) {
        let metadata = setup(framework, admin, payer);
        settle_fixture(payer, metadata);
        settle_fixture(payer, metadata);
    }

    #[test(framework = @0x1, admin = @vessel_settlement, payer = @0x123)]
    #[expected_failure(abort_code = 131076, location = settlement)]
    fun wrong_chain_rejects_before_transfer(framework: &signer, admin: &signer, payer: &signer) {
        let metadata = setup(framework, admin, payer);
        settle_with(payer, metadata, 2, 2, QUOTE_ID, PAYER_BYTES, STORAGE_BYTES, ASSET_BYTES, 84100, FILE_HASH, 7, 1785749994, 1, SIGNATURE);
    }

    #[test(framework = @0x1, admin = @vessel_settlement, payer = @0x123)]
    #[expected_failure(abort_code = 131076, location = settlement)]
    fun wrong_network_rejects_before_transfer(framework: &signer, admin: &signer, payer: &signer) {
        let metadata = setup(framework, admin, payer);
        settle_with(payer, metadata, 1, 1, QUOTE_ID, PAYER_BYTES, STORAGE_BYTES, ASSET_BYTES, 84100, FILE_HASH, 7, 1785749994, 1, SIGNATURE);
    }

    #[test(framework = @0x1, admin = @vessel_settlement, payer = @0x124)]
    #[expected_failure(abort_code = 131077, location = settlement)]
    fun wrong_payer_rejects_before_transfer(framework: &signer, admin: &signer, payer: &signer) {
        let metadata = setup(framework, admin, payer);
        settle_with(payer, metadata, 1, 2, QUOTE_ID, PAYER_BYTES, STORAGE_BYTES, ASSET_BYTES, 84100, FILE_HASH, 7, 1785749994, 1, SIGNATURE);
    }

    #[test(framework = @0x1, admin = @vessel_settlement, payer = @0x123)]
    #[expected_failure(abort_code = 131078, location = settlement)]
    fun wrong_metadata_rejects_before_transfer(framework: &signer, admin: &signer, payer: &signer) {
        let accepted_metadata = setup(framework, admin, payer);
        let other_constructor = object::create_named_object(admin, b"other-asset");
        primary_fungible_store::create_primary_store_enabled_fungible_asset(
            &other_constructor,
            option::none(),
            string::utf8(b"Other"),
            string::utf8(b"OTHER"),
            2,
            string::utf8(b""),
            string::utf8(b""),
        );
        let other_metadata = object::object_from_constructor_ref<Metadata>(&other_constructor);
        settle_with(payer, other_metadata, 1, 2, QUOTE_ID, PAYER_BYTES, STORAGE_BYTES, ASSET_BYTES, 84100, FILE_HASH, 7, 1785749994, 1, SIGNATURE);
        let _ = accepted_metadata;
    }

    #[test(framework = @0x1, admin = @vessel_settlement, payer = @0x123)]
    #[expected_failure(abort_code = 131079, location = settlement)]
    fun zero_amount_rejects_before_transfer(framework: &signer, admin: &signer, payer: &signer) {
        let metadata = setup(framework, admin, payer);
        settle_with(payer, metadata, 1, 2, QUOTE_ID, PAYER_BYTES, STORAGE_BYTES, ASSET_BYTES, 0, FILE_HASH, 7, 1785749994, 1, SIGNATURE);
    }

    #[test(framework = @0x1, admin = @vessel_settlement, payer = @0x123)]
    #[expected_failure(abort_code = 131079, location = settlement)]
    fun malformed_lengths_reject_before_transfer(framework: &signer, admin: &signer, payer: &signer) {
        let metadata = setup(framework, admin, payer);
        settle_with(payer, metadata, 1, 2, x"11", PAYER_BYTES, x"33", ASSET_BYTES, 84100, x"55", 7, 1785749994, 1, SIGNATURE);
    }

    #[test(framework = @0x1, admin = @vessel_settlement, payer = @0x123)]
    #[expected_failure(abort_code = 131079, location = settlement)]
    fun malformed_storage_address_rejects_before_transfer(framework: &signer, admin: &signer, payer: &signer) {
        let metadata = setup(framework, admin, payer);
        settle_with(payer, metadata, 1, 2, QUOTE_ID, PAYER_BYTES, x"33", ASSET_BYTES, 84100, FILE_HASH, 7, 1785749994, 1, SIGNATURE);
    }

    #[test(framework = @0x1, admin = @vessel_settlement, payer = @0x123)]
    #[expected_failure(abort_code = 131079, location = settlement)]
    fun malformed_file_hash_rejects_before_transfer(framework: &signer, admin: &signer, payer: &signer) {
        let metadata = setup(framework, admin, payer);
        settle_with(payer, metadata, 1, 2, QUOTE_ID, PAYER_BYTES, STORAGE_BYTES, ASSET_BYTES, 84100, x"55", 7, 1785749994, 1, SIGNATURE);
    }

    #[test(framework = @0x1, admin = @vessel_settlement, payer = @0x123)]
    #[expected_failure(abort_code = 131079, location = settlement)]
    fun invalid_retention_rejects_before_transfer(framework: &signer, admin: &signer, payer: &signer) {
        let metadata = setup(framework, admin, payer);
        settle_with(payer, metadata, 1, 2, QUOTE_ID, PAYER_BYTES, STORAGE_BYTES, ASSET_BYTES, 84100, FILE_HASH, 366, 1785749994, 1, SIGNATURE);
    }

    #[test(framework = @0x1, admin = @vessel_settlement, payer = @0x123)]
    #[expected_failure(abort_code = 131079, location = settlement)]
    fun zero_retention_rejects_before_transfer(framework: &signer, admin: &signer, payer: &signer) {
        let metadata = setup(framework, admin, payer);
        settle_with(payer, metadata, 1, 2, QUOTE_ID, PAYER_BYTES, STORAGE_BYTES, ASSET_BYTES, 84100, FILE_HASH, 0, 1785749994, 1, SIGNATURE);
    }

    #[test(framework = @0x1, admin = @vessel_settlement, payer = @0x123)]
    #[expected_failure(abort_code = 131081, location = settlement)]
    fun expired_quote_rejects_before_transfer(framework: &signer, admin: &signer, payer: &signer) {
        let metadata = setup(framework, admin, payer);
        timestamp::update_global_time_for_test_secs(1785749994);
        settle_fixture(payer, metadata);
    }

    #[test(framework = @0x1, admin = @vessel_settlement, payer = @0x123)]
    #[expected_failure(abort_code = 131082, location = settlement)]
    fun stale_config_rejects_before_transfer(framework: &signer, admin: &signer, payer: &signer) {
        let metadata = setup(framework, admin, payer);
        settle_with(payer, metadata, 1, 2, QUOTE_ID, PAYER_BYTES, STORAGE_BYTES, ASSET_BYTES, 84100, FILE_HASH, 7, 1785749994, 2, SIGNATURE);
    }

    #[test(framework = @0x1, admin = @vessel_settlement, payer = @0x123)]
    #[expected_failure(abort_code = 65538, location = vessel_settlement::quote_v1)]
    fun invalid_signature_rejects_before_transfer(framework: &signer, admin: &signer, payer: &signer) {
        let metadata = setup(framework, admin, payer);
        settle_with(
            payer, metadata, 1, 2, QUOTE_ID, PAYER_BYTES,
            x"3333333333333333333333333333333333333333333333333333333333333333",
            ASSET_BYTES, 84100,
            x"5555555555555555555555555555555555555555555555555555555555555555",
            7, 1785749994, 1,
            x"00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
        );
    }
}
