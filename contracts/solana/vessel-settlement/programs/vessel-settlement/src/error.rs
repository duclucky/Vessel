use anchor_lang::prelude::*;

#[error_code]
pub enum VesselError {
    #[msg("The Ed25519 verification instruction must immediately precede settlement")]
    MissingEd25519Instruction,
    #[msg("The Ed25519 verification instruction is malformed")]
    InvalidEd25519Instruction,
    #[msg("The Ed25519 verification instruction uses the wrong quote public key")]
    InvalidQuotePublicKey,
    #[msg("The Ed25519 verification instruction signs the wrong quote digest")]
    InvalidQuoteDigest,
    #[msg("The settlement configuration is invalid")]
    InvalidConfiguration,
    #[msg("Settlement is paused")]
    SettlementPaused,
    #[msg("The quote targets the wrong chain or network")]
    WrongSettlementDomain,
    #[msg("The quote payer does not match the transaction signer")]
    WrongPayer,
    #[msg("The quote asset does not match the accepted mint")]
    WrongAsset,
    #[msg("The quote amount or retention period is invalid")]
    InvalidQuote,
    #[msg("The quote has expired")]
    QuoteExpired,
    #[msg("The quote uses a stale settlement configuration")]
    StaleConfiguration,
}
