use anchor_lang::{
    prelude::*,
    solana_program::{account_info::AccountInfo, instruction::Instruction},
};
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

use crate::error::VesselError;

const HEADER_LENGTH: usize = 16;
const PUBLIC_KEY_LENGTH: usize = 32;
const SIGNATURE_LENGTH: usize = 64;
const MESSAGE_LENGTH: usize = 32;
const PUBLIC_KEY_OFFSET: usize = HEADER_LENGTH;
const SIGNATURE_OFFSET: usize = PUBLIC_KEY_OFFSET + PUBLIC_KEY_LENGTH;
const MESSAGE_OFFSET: usize = SIGNATURE_OFFSET + SIGNATURE_LENGTH;
const INSTRUCTION_LENGTH: usize = MESSAGE_OFFSET + MESSAGE_LENGTH;

fn read_u16(data: &[u8], offset: usize) -> Result<u16> {
    let bytes = data
        .get(offset..offset + 2)
        .ok_or_else(|| error!(VesselError::InvalidEd25519Instruction))?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

pub fn verify_ed25519_instruction(
    instruction: &Instruction,
    expected_public_key: &[u8; 32],
    expected_digest: &[u8; 32],
) -> Result<()> {
    require!(
        instruction.program_id.as_ref() == solana_sdk_ids::ed25519_program::id().as_ref(),
        VesselError::InvalidEd25519Instruction
    );
    let data = &instruction.data;
    require!(
        data.len() == INSTRUCTION_LENGTH && data[0] == 1 && data[1] == 0,
        VesselError::InvalidEd25519Instruction
    );

    let signature_offset = read_u16(data, 2)? as usize;
    let signature_instruction_index = read_u16(data, 4)?;
    let public_key_offset = read_u16(data, 6)? as usize;
    let public_key_instruction_index = read_u16(data, 8)?;
    let message_offset = read_u16(data, 10)? as usize;
    let message_size = read_u16(data, 12)? as usize;
    let message_instruction_index = read_u16(data, 14)?;

    require!(
        signature_instruction_index == u16::MAX
            && public_key_instruction_index == u16::MAX
            && message_instruction_index == u16::MAX
            && signature_offset == SIGNATURE_OFFSET
            && public_key_offset == PUBLIC_KEY_OFFSET
            && message_offset == MESSAGE_OFFSET
            && message_size == MESSAGE_LENGTH,
        VesselError::InvalidEd25519Instruction
    );

    let public_key = data
        .get(public_key_offset..public_key_offset + PUBLIC_KEY_LENGTH)
        .ok_or_else(|| error!(VesselError::InvalidEd25519Instruction))?;
    let _signature = data
        .get(signature_offset..signature_offset + SIGNATURE_LENGTH)
        .ok_or_else(|| error!(VesselError::InvalidEd25519Instruction))?;
    let message = data
        .get(message_offset..message_offset + message_size)
        .ok_or_else(|| error!(VesselError::InvalidEd25519Instruction))?;

    require!(
        public_key == expected_public_key,
        VesselError::InvalidQuotePublicKey
    );
    require!(message == expected_digest, VesselError::InvalidQuoteDigest);
    Ok(())
}

pub fn verify_preceding_ed25519(
    instructions: &AccountInfo<'_>,
    expected_public_key: &[u8; 32],
    expected_digest: &[u8; 32],
) -> Result<()> {
    let current_index = load_current_index_checked(instructions)
        .map_err(|_| error!(VesselError::InvalidEd25519Instruction))?;
    require!(current_index > 0, VesselError::MissingEd25519Instruction);
    let instruction = load_instruction_at_checked(current_index as usize - 1, instructions)
        .map_err(|_| error!(VesselError::MissingEd25519Instruction))?;
    verify_ed25519_instruction(&instruction, expected_public_key, expected_digest)
}
