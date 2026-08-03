use anchor_lang::prelude::*;

pub mod ed25519_ix;
pub mod error;
pub mod instructions;
pub mod quote_v1;
pub mod state;

pub(crate) use instructions::initialize::__client_accounts_initialize;
pub(crate) use instructions::settle::__client_accounts_settle;
use instructions::{Initialize, Settle};

declare_id!("6K7MzA7zbRkgxKmQikZzawYxmDHv3LWK8XFjHhqChi1b");

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
}
