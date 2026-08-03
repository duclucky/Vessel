use anchor_lang::prelude::*;

pub mod ed25519_ix;
pub mod error;
pub mod instructions;
pub mod quote_v1;
pub mod state;

pub(crate) use instructions::admin::{
    __client_accounts_execute_config_change, __client_accounts_lock_upgrade_intent,
    __client_accounts_schedule_config_change, __client_accounts_set_pause,
    __client_accounts_withdraw,
};
pub(crate) use instructions::initialize::__client_accounts_initialize;
pub(crate) use instructions::settle::__client_accounts_settle;
use instructions::{
    ExecuteConfigChange, Initialize, LockUpgradeIntent, ScheduleConfigChange, SetPause, Settle,
    Withdraw,
};

declare_id!("G2dA3Sz1XxvJ4ppkvwb95kfy5w6M9ip2KiZBmt7xbsBx");

#[program]
pub mod vessel_settlement {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        quote_public_key: [u8; 32],
        authority: Pubkey,
        network: u32,
        config_version: u64,
    ) -> Result<()> {
        instructions::initialize::handle(ctx, quote_public_key, authority, network, config_version)
    }

    pub fn settle(ctx: Context<Settle>, quote: quote_v1::QuoteV1) -> Result<()> {
        instructions::settle::handle(ctx, quote)
    }

    pub fn schedule_config_change(
        ctx: Context<ScheduleConfigChange>,
        kind: u8,
        value: [u8; 32],
    ) -> Result<()> {
        instructions::admin::schedule_config_change(ctx, kind, value)
    }

    pub fn execute_config_change(ctx: Context<ExecuteConfigChange>) -> Result<()> {
        instructions::admin::execute_config_change(ctx)
    }

    pub fn pause(ctx: Context<SetPause>) -> Result<()> {
        instructions::admin::set_pause(ctx, true)
    }

    pub fn unpause(ctx: Context<SetPause>) -> Result<()> {
        instructions::admin::set_pause(ctx, false)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::admin::withdraw(ctx, amount)
    }

    pub fn lock_upgrade_intent(ctx: Context<LockUpgradeIntent>) -> Result<()> {
        instructions::admin::lock_upgrade_intent(ctx)
    }
}
