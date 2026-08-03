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
}
