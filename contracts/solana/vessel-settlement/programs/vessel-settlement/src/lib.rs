use anchor_lang::prelude::*;

pub mod ed25519_ix;
pub mod error;
pub mod quote_v1;

declare_id!("6K7MzA7zbRkgxKmQikZzawYxmDHv3LWK8XFjHhqChi1b");

#[program]
pub mod vessel_settlement {
    use super::*;

    pub fn ping(_ctx: Context<Ping>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Ping {}
