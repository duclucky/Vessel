module vessel_settlement::vessel_settlement {
    use std::bcs;
    use std::option::{Self, Option};
    use std::signer;
    use std::table::{Self, Table};
    use std::vector;
    use aptos_framework::chain_id;
    use aptos_framework::event;
    use aptos_framework::object::{Self, ExtendRef, Object};
    use aptos_framework::primary_fungible_store;
    use aptos_framework::timestamp;
    use aptos_std::from_bcs;
    use vessel_settlement::quote_v1;

    const VERSION: u8 = 1;
    const APTOS_CHAIN: u8 = 1;
    const EALREADY_INITIALIZED: u64 = 0x20001;
    const ENOT_ADMIN: u64 = 0x20002;
    const EPAUSED: u64 = 0x20003;
    const EWRONG_DOMAIN: u64 = 0x20004;
    const EWRONG_PAYER: u64 = 0x20005;
    const EWRONG_ASSET: u64 = 0x20006;
    const EINVALID_QUOTE: u64 = 0x20007;
    const ERECEIPT_EXISTS: u64 = 0x20008;
    const EQUOTE_EXPIRED: u64 = 0x20009;
    const ESTALE_CONFIG: u64 = 0x2000a;
    const EPENDING_CHANGE: u64 = 0x2000b;
    const ENO_PENDING_CHANGE: u64 = 0x2000c;
    const ECHANGE_NOT_READY: u64 = 0x2000d;
    const EINVALID_CHANGE: u64 = 0x2000e;
    const EUPGRADE_LOCKED: u64 = 0x2000f;
    const EINVALID_WITHDRAWAL: u64 = 0x20010;
    const CHANGE_QUOTE_SIGNER: u8 = 1;
    const CHANGE_ACCEPTED_ASSET: u8 = 2;
    const CHANGE_TIMELOCK_SECONDS: u64 = 86400;

    struct PendingChange has copy, drop, store {
        kind: u8,
        value: vector<u8>,
        execute_after_secs: u64,
    }

    struct Config has key {
        quote_public_key: vector<u8>,
        accepted_asset: address,
        config_version: u64,
        admin: address,
        paused: bool,
        upgrade_locked: bool,
        vault_extend_ref: ExtendRef,
        vault_address: address,
        settled: Table<vector<u8>, bool>,
        pending_change: Option<PendingChange>,
    }

    #[event]
    public struct SettlementReceiptV1 has copy, drop, store {
        chain: u8,
        network: u32,
        quote_id: vector<u8>,
        payer: vector<u8>,
        storage_address: vector<u8>,
        asset: vector<u8>,
        amount: u64,
        file_hash: vector<u8>,
        storage_expiration_micros: u64,
        config_version: u64,
    }

    #[event]
    public struct ConfigChangeScheduled has copy, drop, store {
        kind: u8,
        execute_after_secs: u64,
    }

    #[event]
    public struct ConfigChangeExecuted has copy, drop, store {
        kind: u8,
        config_version: u64,
    }

    #[event]
    public struct Withdrawal has copy, drop, store {
        asset: address,
        destination: address,
        amount: u64,
    }

    #[event]
    public struct Paused has copy, drop, store {
        paused: bool,
    }

    #[event]
    public struct UpgradeLocked has copy, drop, store {
        locked: bool,
    }

    #[view]
    public fun version(): u8 {
        VERSION
    }

    public entry fun initialize<T: key>(
        admin: &signer,
        metadata: Object<T>,
        quote_public_key: vector<u8>,
        config_version: u64,
    ) {
        initialize_internal(admin, metadata, quote_public_key, config_version)
    }

    fun initialize_internal<T: key>(
        admin: &signer,
        metadata: Object<T>,
        quote_public_key: vector<u8>,
        config_version: u64,
    ) {
        assert!(signer::address_of(admin) == @vessel_settlement, ENOT_ADMIN);
        assert!(!exists<Config>(@vessel_settlement), EALREADY_INITIALIZED);
        assert!(vector::length(&quote_public_key) == 32 && config_version > 0, EINVALID_QUOTE);
        let vault_extend_ref = object::create_named_unowned_onchain_signer(admin, b"vessel-vault-v1");
        let vault_address = object::address_from_extend_ref(&vault_extend_ref);
        primary_fungible_store::ensure_primary_store_exists(vault_address, metadata);
        move_to(admin, Config {
            quote_public_key,
            accepted_asset: object::object_address(&metadata),
            config_version,
            admin: signer::address_of(admin),
            paused: false,
            upgrade_locked: false,
            vault_extend_ref,
            vault_address,
            settled: table::new(),
            pending_change: option::none(),
        });
    }

    fun assert_admin(admin: &signer, config: &Config) {
        assert!(
            signer::address_of(admin) == config.admin
                && signer::address_of(admin) == @vessel_settlement,
            ENOT_ADMIN,
        )
    }

    public entry fun schedule_change(
        admin: &signer,
        kind: u8,
        value: vector<u8>,
    ) acquires Config {
        let config = borrow_global_mut<Config>(@vessel_settlement);
        assert_admin(admin, config);
        assert!(option::is_none(&config.pending_change), EPENDING_CHANGE);
        assert!(
            (kind == CHANGE_QUOTE_SIGNER || kind == CHANGE_ACCEPTED_ASSET)
                && vector::length(&value) == 32,
            EINVALID_CHANGE,
        );
        let execute_after_secs = timestamp::now_seconds() + CHANGE_TIMELOCK_SECONDS;
        option::fill(&mut config.pending_change, PendingChange {
            kind,
            value,
            execute_after_secs,
        });
        event::emit(ConfigChangeScheduled { kind, execute_after_secs });
    }

    public entry fun execute_change(admin: &signer) acquires Config {
        let config = borrow_global_mut<Config>(@vessel_settlement);
        assert_admin(admin, config);
        assert!(option::is_some(&config.pending_change), ENO_PENDING_CHANGE);
        let pending = option::extract(&mut config.pending_change);
        assert!(timestamp::now_seconds() >= pending.execute_after_secs, ECHANGE_NOT_READY);
        if (pending.kind == CHANGE_QUOTE_SIGNER) {
            config.quote_public_key = pending.value;
        } else if (pending.kind == CHANGE_ACCEPTED_ASSET) {
            config.accepted_asset = from_bcs::to_address(pending.value);
        } else {
            abort EINVALID_CHANGE
        };
        config.config_version = config.config_version + 1;
        event::emit(ConfigChangeExecuted {
            kind: pending.kind,
            config_version: config.config_version,
        });
    }

    public entry fun pause(admin: &signer) acquires Config {
        let config = borrow_global_mut<Config>(@vessel_settlement);
        assert_admin(admin, config);
        config.paused = true;
        event::emit(Paused { paused: true });
    }

    public entry fun unpause(admin: &signer) acquires Config {
        let config = borrow_global_mut<Config>(@vessel_settlement);
        assert_admin(admin, config);
        config.paused = false;
        event::emit(Paused { paused: false });
    }

    public entry fun withdraw<T: key>(
        admin: &signer,
        metadata: Object<T>,
        destination: address,
        amount: u64,
    ) acquires Config {
        let config = borrow_global<Config>(@vessel_settlement);
        assert_admin(admin, config);
        let asset = object::object_address(&metadata);
        assert!(
            asset == config.accepted_asset && destination != @0x0 && amount > 0,
            EINVALID_WITHDRAWAL,
        );
        let vault_signer = object::generate_signer_for_extending(&config.vault_extend_ref);
        primary_fungible_store::transfer(&vault_signer, metadata, destination, amount);
        event::emit(Withdrawal { asset, destination, amount });
    }

    public entry fun lock_upgrade_intent(admin: &signer) acquires Config {
        let config = borrow_global_mut<Config>(@vessel_settlement);
        assert_admin(admin, config);
        assert!(!config.upgrade_locked, EUPGRADE_LOCKED);
        config.upgrade_locked = true;
        event::emit(UpgradeLocked { locked: true });
    }

    public entry fun settle<T: key>(
        payer_signer: &signer,
        metadata: Object<T>,
        version: u8,
        chain: u8,
        network: u32,
        quote_id: vector<u8>,
        payer: vector<u8>,
        storage_address: vector<u8>,
        asset: vector<u8>,
        amount: u64,
        file_hash: vector<u8>,
        retention_days: u16,
        storage_expiration_micros: u64,
        quote_expires_at_secs: u64,
        config_version: u64,
        signature: vector<u8>,
    ) acquires Config {
        let config = borrow_global<Config>(@vessel_settlement);
        assert!(!config.paused, EPAUSED);
        assert!(
            version == VERSION
                && chain == APTOS_CHAIN
                && network == (chain_id::get() as u32),
            EWRONG_DOMAIN,
        );
        assert!(
            payer == bcs::to_bytes(&signer::address_of(payer_signer)),
            EWRONG_PAYER,
        );
        assert!(
            asset == bcs::to_bytes(&object::object_address(&metadata))
                && object::object_address(&metadata) == config.accepted_asset,
            EWRONG_ASSET,
        );
        assert!(
            vector::length(&quote_id) == 32
                && vector::length(&storage_address) == 32
                && vector::length(&file_hash) == 32
                && amount > 0
                && retention_days >= 1
                && retention_days <= 365,
            EINVALID_QUOTE,
        );
        assert!(timestamp::now_seconds() < quote_expires_at_secs, EQUOTE_EXPIRED);
        assert!(config_version == config.config_version, ESTALE_CONFIG);
        assert!(!table::contains(&config.settled, copy quote_id), ERECEIPT_EXISTS);

        let quote = quote_v1::new(
            version,
            chain,
            network,
            copy quote_id,
            copy payer,
            copy storage_address,
            copy asset,
            amount,
            copy file_hash,
            retention_days,
            storage_expiration_micros,
            quote_expires_at_secs,
            config_version,
        );
        let quote_public_key = config.quote_public_key;
        quote_v1::verify(&quote, quote_public_key, signature);

        let vault = config.vault_address;
        primary_fungible_store::transfer(payer_signer, metadata, vault, amount);
        let config = borrow_global_mut<Config>(@vessel_settlement);
        table::add(&mut config.settled, copy quote_id, true);
        event::emit(SettlementReceiptV1 {
            chain,
            network,
            quote_id,
            payer,
            storage_address,
            asset,
            amount,
            file_hash,
            storage_expiration_micros,
            config_version,
        });
    }

    #[view]
    public fun is_settled(quote_id: vector<u8>): bool acquires Config {
        table::contains(&borrow_global<Config>(@vessel_settlement).settled, quote_id)
    }

    #[view]
    public fun vault_address(): address acquires Config {
        borrow_global<Config>(@vessel_settlement).vault_address
    }

    #[view]
    public fun is_paused(): bool acquires Config {
        borrow_global<Config>(@vessel_settlement).paused
    }

    #[view]
    public fun is_upgrade_locked(): bool acquires Config {
        borrow_global<Config>(@vessel_settlement).upgrade_locked
    }

    #[view]
    public fun has_pending_change(): bool acquires Config {
        option::is_some(&borrow_global<Config>(@vessel_settlement).pending_change)
    }

    #[view]
    public fun config(): (u8, vector<u8>, address, u64, address, bool, bool) acquires Config {
        let config = borrow_global<Config>(@vessel_settlement);
        let quote_public_key = config.quote_public_key;
        (
            chain_id::get(),
            quote_public_key,
            config.accepted_asset,
            config.config_version,
            config.admin,
            config.paused,
            config.upgrade_locked,
        )
    }

    #[test_only]
    public fun initialize_for_test<T: key>(
        admin: &signer,
        metadata: Object<T>,
        quote_public_key: vector<u8>,
        config_version: u64,
    ) {
        initialize_internal(admin, metadata, quote_public_key, config_version)
    }

    #[test_only]
    public fun receipt_count_for_test(): u64 {
        vector::length(&event::emitted_events<SettlementReceiptV1>())
    }

    #[test_only]
    public fun last_receipt_for_test(): (
        u8,
        u32,
        vector<u8>,
        vector<u8>,
        vector<u8>,
        vector<u8>,
        u64,
        vector<u8>,
        u64,
        u64,
    ) {
        let receipts = event::emitted_events<SettlementReceiptV1>();
        let receipt = vector::borrow(&receipts, vector::length(&receipts) - 1);
        (
            receipt.chain,
            receipt.network,
            receipt.quote_id,
            receipt.payer,
            receipt.storage_address,
            receipt.asset,
            receipt.amount,
            receipt.file_hash,
            receipt.storage_expiration_micros,
            receipt.config_version,
        )
    }
}
