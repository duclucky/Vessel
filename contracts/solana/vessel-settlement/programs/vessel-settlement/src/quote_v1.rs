use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

const DOMAIN: &[u8] = b"VESSEL_SETTLEMENT_V1";
const FIXED_BYTES_LENGTH: u8 = 32;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct QuoteV1 {
    pub version: u8,
    pub chain: u8,
    pub network: u32,
    pub quote_id: [u8; 32],
    pub payer: [u8; 32],
    pub storage_address: [u8; 32],
    pub asset: [u8; 32],
    pub amount: u64,
    pub file_hash: [u8; 32],
    pub retention_days: u16,
    pub storage_expiration_micros: u64,
    pub quote_expires_at_secs: u64,
    pub config_version: u64,
}

impl QuoteV1 {
    pub fn bcs_bytes(&self) -> Vec<u8> {
        let mut output = Vec::with_capacity(251);
        output.push(self.version);
        output.push(self.chain);
        output.extend_from_slice(&self.network.to_le_bytes());
        for bytes in [
            &self.quote_id,
            &self.payer,
            &self.storage_address,
            &self.asset,
        ] {
            output.push(FIXED_BYTES_LENGTH);
            output.extend_from_slice(bytes);
        }
        output.extend_from_slice(&self.amount.to_le_bytes());
        output.push(FIXED_BYTES_LENGTH);
        output.extend_from_slice(&self.file_hash);
        output.extend_from_slice(&self.retention_days.to_le_bytes());
        output.extend_from_slice(&self.storage_expiration_micros.to_le_bytes());
        output.extend_from_slice(&self.quote_expires_at_secs.to_le_bytes());
        output.extend_from_slice(&self.config_version.to_le_bytes());
        output
    }

    pub fn digest(&self) -> [u8; 32] {
        hashv(&[DOMAIN, &self.bcs_bytes()]).to_bytes()
    }
}
