use anchor_lang::prelude::*;

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
