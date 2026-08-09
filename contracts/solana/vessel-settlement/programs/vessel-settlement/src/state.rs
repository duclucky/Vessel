use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub quote_public_key: [u8; 32],
    pub accepted_mint: Pubkey,
    pub network: u32,
    pub config_version: u64,
    pub paused: bool,
    pub upgrade_lock_intent: bool,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct VesselFeeReceiptV1 {
    pub quote_id: [u8; 32],
    pub payer: Pubkey,
    pub storage_address: [u8; 32],
    pub asset: Pubkey,
    pub amount: u64,
    pub file_hash: [u8; 32],
    pub storage_expiration_micros: u64,
    pub config_version: u64,
    pub settled_slot: u64,
    pub settled_at_secs: i64,
}

#[account]
#[derive(InitSpace)]
pub struct PendingChange {
    pub kind: u8,
    pub value: [u8; 32],
    pub execute_after_secs: u64,
}

#[event]
pub struct VesselFeeReceiptCreatedV1 {
    pub quote_id: [u8; 32],
    pub payer: Pubkey,
    pub storage_address: [u8; 32],
    pub asset: Pubkey,
    pub amount: u64,
    pub file_hash: [u8; 32],
    pub storage_expiration_micros: u64,
    pub config_version: u64,
    pub settled_slot: u64,
    pub settled_at_secs: i64,
}

#[event]
pub struct ConfigChangeScheduled {
    pub kind: u8,
    pub value: [u8; 32],
    pub execute_after_secs: u64,
}

#[event]
pub struct ConfigChangeExecuted {
    pub kind: u8,
    pub value: [u8; 32],
    pub config_version: u64,
}

#[event]
pub struct SettlementPauseChanged {
    pub paused: bool,
}

#[event]
pub struct VaultWithdrawal {
    pub asset: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
    pub slot: u64,
}

#[event]
pub struct UpgradeLockIntentRecorded {
    pub locked: bool,
}
