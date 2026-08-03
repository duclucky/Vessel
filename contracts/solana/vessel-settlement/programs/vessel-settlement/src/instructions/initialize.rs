use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::{error::VesselError, state::Config};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Config::INIT_SPACE,
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, Config>,
    /// CHECK: This PDA only signs token transfers from its associated vault.
    #[account(seeds = [b"vault-authority"], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle(
    ctx: Context<Initialize>,
    quote_public_key: [u8; 32],
    authority: Pubkey,
    network: u32,
    config_version: u64,
) -> Result<()> {
    require!(
        quote_public_key != [0; 32]
            && quote_public_key != authority.to_bytes()
            && authority != Pubkey::default()
            && network == 1
            && config_version > 0,
        VesselError::InvalidConfiguration
    );
    ctx.accounts.config.set_inner(Config {
        authority,
        quote_public_key,
        accepted_mint: ctx.accounts.mint.key(),
        network,
        config_version,
        paused: false,
        upgrade_lock_intent: false,
        vault_bump: ctx.bumps.vault_authority,
    });
    Ok(())
}
