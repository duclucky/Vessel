use anchor_lang::prelude::AccountInfo;
use anchor_lang::solana_program::{
    instruction::{BorrowedInstruction, Instruction},
    pubkey::Pubkey,
};
use solana_instructions_sysvar::{construct_instructions_data, store_current_index_checked};
use vessel_settlement::{
    ed25519_ix::{verify_ed25519_instruction, verify_preceding_ed25519},
    quote_v1::QuoteV1,
};

const DIGEST_HEX: &str = "b25001894f27c8433e0d5ae2d386745918a2f0805811d4d72f925b66f3270918";

fn fixture_quote() -> QuoteV1 {
    QuoteV1 {
        version: 1,
        chain: 1,
        network: 2,
        quote_id: [0x11; 32],
        payer: [0x22; 32],
        storage_address: [0x33; 32],
        asset: [0x44; 32],
        amount: 84_100,
        file_hash: [0x55; 32],
        retention_days: 7,
        storage_expiration_micros: 1_786_354_494_000_000,
        quote_expires_at_secs: 1_785_749_994,
        config_version: 1,
    }
}

fn expected_digest() -> [u8; 32] {
    hex::decode(DIGEST_HEX).unwrap().try_into().unwrap()
}

fn ed25519_instruction(key: [u8; 32], message: [u8; 32]) -> Instruction {
    let mut data = Vec::with_capacity(144);
    data.extend_from_slice(&[1, 0]);
    for value in [48u16, u16::MAX, 16, u16::MAX, 112, 32, u16::MAX] {
        data.extend_from_slice(&value.to_le_bytes());
    }
    data.extend_from_slice(&key);
    data.extend_from_slice(&[0x77; 64]);
    data.extend_from_slice(&message);
    Instruction {
        program_id: solana_sdk_ids::ed25519_program::id(),
        accounts: vec![],
        data,
    }
}

fn dummy_instruction() -> Instruction {
    Instruction {
        program_id: Pubkey::new_unique(),
        accounts: vec![],
        data: vec![],
    }
}

fn with_instruction_sysvar(
    instructions: &[Instruction],
    current_index: u16,
    callback: impl FnOnce(&AccountInfo<'_>),
) {
    let borrowed: Vec<_> = instructions
        .iter()
        .map(|instruction| BorrowedInstruction {
            program_id: &instruction.program_id,
            accounts: vec![],
            data: &instruction.data,
        })
        .collect();
    let mut data = construct_instructions_data(&borrowed);
    store_current_index_checked(&mut data, current_index).unwrap();
    let key = solana_instructions_sysvar::id();
    let owner = Pubkey::new_unique();
    let mut lamports = 0;
    let account = AccountInfo::new(&key, false, false, &mut lamports, &mut data, &owner, false);
    callback(&account);
}

#[test]
fn quote_digest_matches_typescript_and_move() {
    assert_eq!(fixture_quote().digest(), expected_digest());
}

#[test]
fn canonical_ed25519_instruction_is_accepted() {
    let key = [0x34; 32];
    let digest = expected_digest();
    let instruction = ed25519_instruction(key, digest);
    assert!(verify_ed25519_instruction(&instruction, &key, &digest).is_ok());
}

#[test]
fn malformed_ed25519_instructions_are_rejected() {
    let key = [0x34; 32];
    let digest = expected_digest();

    let mut zero_signatures = ed25519_instruction(key, digest);
    zero_signatures.data[0] = 0;
    assert!(verify_ed25519_instruction(&zero_signatures, &key, &digest).is_err());

    let mut two_signatures = ed25519_instruction(key, digest);
    two_signatures.data[0] = 2;
    assert!(verify_ed25519_instruction(&two_signatures, &key, &digest).is_err());

    let mut wrong_program = ed25519_instruction(key, digest);
    wrong_program.program_id = Pubkey::new_unique();
    assert!(verify_ed25519_instruction(&wrong_program, &key, &digest).is_err());

    let mut cross_instruction_offsets = ed25519_instruction(key, digest);
    cross_instruction_offsets.data[4..6].copy_from_slice(&0u16.to_le_bytes());
    assert!(verify_ed25519_instruction(&cross_instruction_offsets, &key, &digest).is_err());

    let mut wrong_message_length = ed25519_instruction(key, digest);
    wrong_message_length.data[12..14].copy_from_slice(&31u16.to_le_bytes());
    assert!(verify_ed25519_instruction(&wrong_message_length, &key, &digest).is_err());

    assert!(
        verify_ed25519_instruction(&ed25519_instruction(key, digest), &[0x35; 32], &digest)
            .is_err()
    );
    assert!(
        verify_ed25519_instruction(&ed25519_instruction(key, [0x99; 32]), &key, &digest).is_err()
    );
}

#[test]
fn ed25519_instruction_must_immediately_precede_settlement() {
    let key = [0x34; 32];
    let digest = expected_digest();
    let verify = ed25519_instruction(key, digest);
    let settle = dummy_instruction();

    with_instruction_sysvar(&[verify.clone(), settle.clone()], 1, |account| {
        assert!(verify_preceding_ed25519(account, &key, &digest).is_ok());
    });
    with_instruction_sysvar(&[verify.clone(), settle.clone()], 0, |account| {
        assert!(verify_preceding_ed25519(account, &key, &digest).is_err());
    });
    with_instruction_sysvar(&[verify, dummy_instruction(), settle], 2, |account| {
        assert!(verify_preceding_ed25519(account, &key, &digest).is_err());
    });
}
