# Vessel Settlement on Aptos

Move package for Vessel's Aptos Testnet settlement vault. It accepts only signed
`QuoteV1` service-fee settlements and is intended to be published and governed by
a 2-of-3 Aptos Multisig Account. Aptos Testnet has the native multisig timelock
feature disabled, so this beta account is created without a framework timelock.
The Move module still delays scheduled configuration changes by 24 hours.

The package is testnet-only until the deployment manifest records a verified
module, vault, multisig, accepted ShelbyUSD metadata object, and quote signer.

## Multisig deployment

Deployment uses an Aptos Multisig Account with exactly three unique owners and a
2-of-3 threshold. Its native timelock is `null` on Testnet.
The helper emits unsigned wallet payloads and never reads private keys:

```powershell
$env:APTOS_MULTISIG_OWNERS='0xOWNER1,0xOWNER2,0xOWNER3'
$env:APTOS_MULTISIG_THRESHOLD='2'
$env:APTOS_MULTISIG_TIMELOCK_SECONDS='null'
node app/server/scripts/aptos-multisig-payload.mjs create
```

After the creation transaction is signed by the first owner, set the resulting
public multisig address and build the package specifically for that address:

```powershell
$env:APTOS_MULTISIG_ADDRESS='0xMULTISIG'
& 'C:\Users\TBC\AppData\Local\VesselTools\aptos-9.5.0\aptos.exe' move build-publish-payload `
  --package-dir contracts/aptos/vessel_settlement `
  --named-addresses vessel_settlement=$env:APTOS_MULTISIG_ADDRESS `
  --json-output-file contracts/aptos/vessel_settlement/build/publish-payload.json
node app/server/scripts/aptos-multisig-payload.mjs publish-payload
```

The first owner submits the printed proposal, a second owner approves it, and an
owner executes it after the 2-of-3 threshold is met. Initialization is a separate multisig
proposal because the package intentionally has no single-key initializer:

```powershell
$env:QUOTE_SIGNER_PUBLIC_KEY_HEX='PUBLIC_KEY_ONLY'
$env:SHELBYUSD_METADATA_ADDRESS='0xSHELBYUSD_METADATA'
node app/server/scripts/aptos-multisig-payload.mjs initialize-payload
node app/server/scripts/aptos-multisig-payload.mjs status
node app/server/scripts/aptos-multisig-payload.mjs verify
```

Only after `verify` succeeds should the public module, vault, multisig, asset,
and deployment transaction identifiers replace the undeployed sentinels in
`deployments/vessel-settlement.testnet.json`.
