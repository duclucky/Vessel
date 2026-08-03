use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::{
    error::VesselError,
    state::{
        Config, ConfigChangeExecuted, ConfigChangeScheduled, PendingChange, SettlementPauseChanged,
        UpgradeLockIntentRecorded, VaultWithdrawal,
    },
};

pub const CHANGE_QUOTE_PUBLIC_KEY: u8 = 1;
pub const CHANGE_ACCEPTED_MINT: u8 = 2;
pub const CONFIG_CHANGE_DELAY_SECS: u64 = 86_400;

pub fn change_is_ready(now_secs: u64, execute_after_secs: u64) -> bool {
    now_secs >= execute_after_secs
}

fn valid_change(kind: u8, value: &[u8; 32]) -> bool {
    matches!(kind, CHANGE_QUOTE_PUBLIC_KEY | CHANGE_ACCEPTED_MINT) && *value != [0; 32]
}

#[derive(Accounts)]
pub struct ScheduleConfigChange<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority @ VesselError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = authority,
        space = 8 + PendingChange::INIT_SPACE,
        seeds = [b"pending-change"],
        bump,
    )]
    pub pending_change: Account<'info, PendingChange>,
    pub system_program: Program<'info, System>,
}

pub fn schedule_config_change(
    ctx: Context<ScheduleConfigChange>,
    kind: u8,
    value: [u8; 32],
) -> Result<()> {
    require!(valid_change(kind, &value), VesselError::InvalidConfigChange);
    if kind == CHANGE_QUOTE_PUBLIC_KEY {
        require!(
            value != ctx.accounts.config.quote_public_key
                && value != ctx.accounts.config.authority.to_bytes(),
            VesselError::InvalidConfigChange
        );
    } else {
        require!(
            value != ctx.accounts.config.accepted_mint.to_bytes(),
            VesselError::InvalidConfigChange
        );
    }
    let now = Clock::get()?.unix_timestamp;
    require!(now >= 0, VesselError::InvalidConfigChange);
    let execute_after_secs = (now as u64)
        .checked_add(CONFIG_CHANGE_DELAY_SECS)
        .ok_or_else(|| error!(VesselError::InvalidConfigChange))?;
    ctx.accounts.pending_change.set_inner(PendingChange {
        kind,
        value,
        execute_after_secs,
    });
    emit!(ConfigChangeScheduled {
        kind,
        value,
        execute_after_secs,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ExecuteConfigChange<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority @ VesselError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"pending-change"],
        bump,
        close = authority,
    )]
    pub pending_change: Account<'info, PendingChange>,
}

pub fn execute_config_change(ctx: Context<ExecuteConfigChange>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(now >= 0, VesselError::ConfigChangeNotReady);
    let pending = &ctx.accounts.pending_change;
    require!(
        change_is_ready(now as u64, pending.execute_after_secs),
        VesselError::ConfigChangeNotReady
    );
    require!(
        valid_change(pending.kind, &pending.value),
        VesselError::InvalidConfigChange
    );

    let config = &mut ctx.accounts.config;
    if pending.kind == CHANGE_QUOTE_PUBLIC_KEY {
        require!(
            pending.value != config.authority.to_bytes(),
            VesselError::InvalidConfigChange
        );
        config.quote_public_key = pending.value;
    } else {
        config.accepted_mint = Pubkey::new_from_array(pending.value);
    }
    config.config_version = config
        .config_version
        .checked_add(1)
        .ok_or_else(|| error!(VesselError::InvalidConfigChange))?;
    emit!(ConfigChangeExecuted {
        kind: pending.kind,
        value: pending.value,
        config_version: config.config_version,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SetPause<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority @ VesselError::Unauthorized)]
    pub config: Account<'info, Config>,
}

pub fn set_pause(ctx: Context<SetPause>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused = paused;
    emit!(SettlementPauseChanged { paused });
    Ok(())
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub authority: Signer<'info>,
    #[account(has_one = authority @ VesselError::Unauthorized)]
    pub config: Account<'info, Config>,
    /// CHECK: This PDA is the token authority for the canonical vault ATA.
    #[account(
        seeds = [b"vault-authority"],
        bump = config.vault_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(address = config.accepted_mint)]
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_ata: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint)]
    pub destination_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(
        amount > 0
            && amount <= ctx.accounts.vault_ata.amount
            && ctx.accounts.vault_ata.key() != ctx.accounts.destination_ata.key(),
        VesselError::InvalidWithdrawal
    );
    let bump = [ctx.accounts.config.vault_bump];
    let vault_seeds: &[&[u8]] = &[b"vault-authority", &bump];
    let signer_seeds: &[&[&[u8]]] = &[vault_seeds];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.vault_ata.to_account_info(),
                to: ctx.accounts.destination_ata.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;
    emit!(VaultWithdrawal {
        asset: ctx.accounts.mint.key(),
        destination: ctx.accounts.destination_ata.key(),
        amount,
        slot: Clock::get()?.slot,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct LockUpgradeIntent<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority @ VesselError::Unauthorized)]
    pub config: Account<'info, Config>,
}

pub fn lock_upgrade_intent(ctx: Context<LockUpgradeIntent>) -> Result<()> {
    require!(
        !ctx.accounts.config.upgrade_lock_intent,
        VesselError::UpgradeLockAlreadySet
    );
    ctx.accounts.config.upgrade_lock_intent = true;
    emit!(UpgradeLockIntentRecorded { locked: true });
    Ok(())
}
