# Vessel Settlement on Aptos

Move package for Vessel's Aptos Testnet settlement vault. It accepts only signed
`QuoteV1` service-fee settlements and is intended to be published and governed by
an Aptos Multisig Account with a 24-hour timelock.

The package is testnet-only until the deployment manifest records a verified
module, vault, multisig, accepted ShelbyUSD metadata object, and quote signer.
