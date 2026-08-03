module vessel_settlement::quote_v1 {
    use std::bcs;
    use std::vector;
    use aptos_std::ed25519;
    use aptos_std::hash;

    const DOMAIN: vector<u8> = b"VESSEL_SETTLEMENT_V1";
    const EINVALID_SIGNATURE: u64 = 0x10002;

    public struct QuoteV1 has copy, drop, store {
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
    }

    public fun new(
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
    ): QuoteV1 {
        QuoteV1 {
            version,
            chain,
            network,
            quote_id,
            payer,
            storage_address,
            asset,
            amount,
            file_hash,
            retention_days,
            storage_expiration_micros,
            quote_expires_at_secs,
            config_version,
        }
    }

    public fun digest(quote: &QuoteV1): vector<u8> {
        let bytes = DOMAIN;
        vector::append(&mut bytes, bcs::to_bytes(quote));
        hash::sha2_256(bytes)
    }

    public(package) fun verify(
        quote: &QuoteV1,
        public_key: vector<u8>,
        signature: vector<u8>,
    ) {
        let key = ed25519::new_unvalidated_public_key_from_bytes(public_key);
        let signature = ed25519::new_signature_from_bytes(signature);
        assert!(
            ed25519::signature_verify_strict(&signature, &key, digest(quote)),
            EINVALID_SIGNATURE,
        );
    }

    #[test_only]
    public fun verify_for_test(
        quote: &QuoteV1,
        public_key: vector<u8>,
        signature: vector<u8>,
    ) {
        verify(quote, public_key, signature)
    }
}
