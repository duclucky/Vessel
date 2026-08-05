import { GasStationClient } from '@aptos-labs/gas-station-client';
import { MultiAgentTransaction, AccountAuthenticator, Deserializer, Network } from '@aptos-labs/ts-sdk';
import { NetworkToGasStationBaseUrl } from '@shelby-protocol/sdk/node';

export function resolveGasStationNetwork(network = 'testnet') {
  const name = typeof network === 'object' && network?.aptosNetwork
    ? network.aptosNetwork
    : network;
  if (name === Network.SHELBYNET || name === 'shelbynet') return Network.SHELBYNET;
  if (name === Network.TESTNET || name === 'testnet') return Network.TESTNET;
  if (name === Network.MAINNET || name === 'mainnet') return Network.MAINNET;
  return Network.TESTNET;
}

export function resolveGasStationBaseUrl(network = 'testnet') {
  return NetworkToGasStationBaseUrl[resolveGasStationNetwork(network)];
}

// Server-side sponsor: the customer (Phantom) signs the multi-agent register_blob_with_sponsor as
// SENDER and ships the serialized transaction + sender authenticator here. We submit it via the
// Aptos gas station, which co-signs as BOTH fee payer (APT) and the ShelbyUSD sponsor. The gas
// station API key NEVER reaches the browser. See NOTES.md 5j for the proven recipe.
export class SponsorManager {
  constructor({ gasStationApiKey, network = 'testnet', gasStationClient, deserialize } = {}) {
    if (!gasStationApiKey && !gasStationClient) {
      throw new Error('SponsorManager requires GAS_STATION_API_KEY');
    }
    const net = resolveGasStationNetwork(network);
    this.gs = gasStationClient || new GasStationClient({
      network: net,
      apiKey: gasStationApiKey,
      baseUrl: resolveGasStationBaseUrl(net),
    });
    this._deserialize = deserialize || ((txnB64, senderAuthB64) => ({
      transaction: MultiAgentTransaction.deserialize(
        new Deserializer(Buffer.from(txnB64, 'base64')),
      ),
      senderAuthenticator: AccountAuthenticator.deserialize(
        new Deserializer(Buffer.from(senderAuthB64, 'base64')),
      ),
    }));
  }

  deserialize(txnB64, senderAuthB64) {
    return this._deserialize(txnB64, senderAuthB64);
  }

  /** @param {string} txnB64 base64 of MultiAgentTransaction.bcsToBytes()
   *  @param {string} senderAuthB64 base64 of the sender AccountAuthenticator.bcsToBytes() */
  async submit(txnB64, senderAuthB64, { expectedSender } = {}) {
    if (!expectedSender) {
      throw Object.assign(new Error('Expected sponsored transaction sender is required'), {
        status: 400,
        code: 'sender_required',
      });
    }
    const { transaction, senderAuthenticator } = this.deserialize(txnB64, senderAuthB64);
    const actualSender = transaction.rawTransaction.sender.toString();
    if (actualSender.toLowerCase() !== String(expectedSender).toLowerCase()) {
      throw Object.assign(
        new Error('Sponsored transaction sender does not match paid storage identity'),
        { status: 403, code: 'sender_mismatch' },
      );
    }
    const pending = await this.gs.signAndSubmitTransaction({ transaction, senderAuthenticator });
    return { hash: pending?.hash || pending?.transactionHash };
  }
}
