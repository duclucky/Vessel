#[test_only]
module vessel_settlement::quote_v1_tests {
    use vessel_settlement::quote_v1;

    const PUBLIC_KEY: vector<u8> = x"34b4d9043156cb6dcf0beb0a2949b7559c940d2bcb6dbe8c53a9b30278e3a746";
    const SIGNATURE: vector<u8> = x"3edb1c0446ffc93b53a1f7e8f0c7f3c013f6ddb695bc17f21b5c04fa3e98d82d405e771973f4c15a3ade8841eb667fac3d56ad036399a7c14921378ca8f8da01";

    fun fixture_quote_with_amount(amount: u64): quote_v1::QuoteV1 {
        quote_v1::new(
            1,
            1,
            2,
            x"1111111111111111111111111111111111111111111111111111111111111111",
            x"2222222222222222222222222222222222222222222222222222222222222222",
            x"3333333333333333333333333333333333333333333333333333333333333333",
            x"4444444444444444444444444444444444444444444444444444444444444444",
            amount,
            x"5555555555555555555555555555555555555555555555555555555555555555",
            7,
            1786354494000000,
            1785749994,
            1,
        )
    }

    #[test]
    fun digest_matches_typescript_golden() {
        let quote = fixture_quote_with_amount(84100);
        assert!(
            quote_v1::digest(&quote)
                == x"b25001894f27c8433e0d5ae2d386745918a2f0805811d4d72f925b66f3270918",
            1,
        );
    }

    #[test]
    fun valid_signature_accepts() {
        let quote = fixture_quote_with_amount(84100);
        quote_v1::verify_for_test(&quote, PUBLIC_KEY, SIGNATURE);
    }

    #[test, expected_failure(abort_code = 65538, location = quote_v1)]
    fun tampered_amount_rejects_signature() {
        let quote = fixture_quote_with_amount(84101);
        quote_v1::verify_for_test(&quote, PUBLIC_KEY, SIGNATURE);
    }
}
