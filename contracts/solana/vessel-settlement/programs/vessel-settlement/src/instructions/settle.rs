use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, TransferChecked},
};

use crate::{
    ed25519_ix::verify_preceding_ed25519,
    error::VesselError,
    quote_v1::QuoteV1,
    state::{Config, SettlementReceiptCreatedV1, SettlementReceiptV1},
};

const QUOTE_VERSION: u8 = 1;
const SOLANA_CHAIN: u8 = 2;

#[derive(Accounts)]
#[instruction(quote: QuoteV1)]
pub struct Settle<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = payer,
        space = 8 + SettlementReceiptV1::INIT_SPACE,
        seeds = [b"receipt", quote.quote_id.as_ref()],
        bump,
    )]
    pub receipt: Account<'info, SettlementReceiptV1>,
    #[account(address = config.accepted_mint)]
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = payer,
    )]
    pub payer_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_ata: Account<'info, TokenAccount>,
    /// CHECK: Its seeds are verified and it owns only the vault ATA.
    #[account(
        seeds = [b"vault-authority"],
        bump = config.vault_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: The address is fixed and its data is parsed by the Solana sysvar API.
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle(ctx: Context<Settle>, quote: QuoteV1) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, VesselError::SettlementPaused);
    require!(
        quote.version == QUOTE_VERSION
            && quote.chain == SOLANA_CHAIN
            && quote.network == config.network,
        VesselError::WrongSettlementDomain
    );
    require!(
        quote.payer == ctx.accounts.payer.key().to_bytes(),
        VesselError::WrongPayer
    );
    require!(
        quote.asset == ctx.accounts.mint.key().to_bytes(),
        VesselError::WrongAsset
    );
    require!(
        quote.amount > 0
            && quote.retention_days >= 1
            && quote.retention_days <= 365
            && quote.storage_expiration_micros > 0,
        VesselError::InvalidQuote
    );
    require!(
        quote.config_version == config.config_version,
        VesselError::StaleConfiguration
    );

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp >= 0
            && quote.quote_expires_at_secs > clock.unix_timestamp as u64
            && quote.storage_expiration_micros > (clock.unix_timestamp as u64) * 1_000_000,
        VesselError::QuoteExpired
    );
    let digest = quote.digest();
    verify_preceding_ed25519(
        &ctx.accounts.instructions.to_account_info(),
        &config.quote_public_key,
        &digest,
    )?;

    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.payer_ata.to_account_info(),
                to: ctx.accounts.vault_ata.to_account_info(),
                authority: ctx.accounts.payer.to_account_info(),
            },
        ),
        quote.amount,
        ctx.accounts.mint.decimals,
    )?;

    let receipt = SettlementReceiptV1 {
        quote_id: quote.quote_id,
        payer: ctx.accounts.payer.key(),
        storage_address: quote.storage_address,
        asset: ctx.accounts.mint.key(),
        amount: quote.amount,
        file_hash: quote.file_hash,
        storage_expiration_micros: quote.storage_expiration_micros,
        config_version: quote.config_version,
        settled_slot: clock.slot,
        settled_at_secs: clock.unix_timestamp,
    };
    ctx.accounts.receipt.set_inner(receipt);
    emit!(SettlementReceiptCreatedV1 {
        quote_id: quote.quote_id,
        payer: ctx.accounts.payer.key(),
        storage_address: quote.storage_address,
        asset: ctx.accounts.mint.key(),
        amount: quote.amount,
        file_hash: quote.file_hash,
        storage_expiration_micros: quote.storage_expiration_micros,
        config_version: quote.config_version,
        settled_slot: clock.slot,
        settled_at_secs: clock.unix_timestamp,
    });
    Ok(())
}
