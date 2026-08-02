import { GasStationClient } from '@aptos-labs/gas-station-client';
import { MultiAgentTransaction, AccountAuthenticator, Deserializer, Network } from '@aptos-labs/ts-sdk';

// Server-side sponsor: the customer (Phantom) signs the multi-agent register_blob_with_sponsor as
// SENDER and ships the serialized transaction + sender authenticator here. We submit it via the
// Aptos gas station, which co-signs as BOTH fee payer (APT) and the ShelbyUSD sponsor. The gas
// station API key NEVER reaches the browser. See NOTES.md 5j for the proven recipe.
export class SponsorManager {
  constructor({ gasStationApiKey, network = 'testnet' }) {
    if (!gasStationApiKey) throw new Error('SponsorManager requires GAS_STATION_API_KEY');
    const net = network === 'testnet' ? Network.TESTNET : network === 'mainnet' ? Network.MAINNET : Network.TESTNET;
    this.gs = new GasStationClient({ network: net, apiKey: gasStationApiKey });
  }

  /** @param {string} txnB64 base64 of MultiAgentTransaction.bcsToBytes()
   *  @param {string} senderAuthB64 base64 of the sender AccountAuthenticator.bcsToBytes() */
  async submit(txnB64, senderAuthB64) {
    const transaction = MultiAgentTransaction.deserialize(new Deserializer(Buffer.from(txnB64, 'base64')));
    const senderAuthenticator = AccountAuthenticator.deserialize(new Deserializer(Buffer.from(senderAuthB64, 'base64')));
    const pending = await this.gs.signAndSubmitTransaction({ transaction, senderAuthenticator });
    return { hash: pending?.hash || pending?.transactionHash };
  }
}
