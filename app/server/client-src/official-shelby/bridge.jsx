import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useOfficialShelbyStorageAccounts } from './shelby-hooks.jsx';

const defaultBridgeState = Object.freeze({
  ready: false,
  session: null,
  lastError: null,
});

function unavailable(method) {
  const error = new Error(`Official Shelby ${method} is not connected yet`);
  error.code = 'official_shelby_unavailable';
  return error;
}

function sameSession(left, right) {
  return left?.chain === right?.chain
    && left?.sourceAddress === right?.sourceAddress
    && left?.storageAddress === right?.storageAddress;
}

function createNoopApi(getState, setState, setRequestedWallet, pendingRef) {
  return Object.freeze({
    isReady() {
      return getState().ready === true;
    },
    async scanWallets() {
      return [];
    },
    async connectWallet(input = {}) {
      if (!input.wallet || !input.chain) throw unavailable('connectWallet');
      pendingRef.current?.reject?.(unavailable('connectWallet'));
      setRequestedWallet(input);
      return new Promise((resolve, reject) => {
        pendingRef.current = { resolve, reject };
      });
    },
    async disconnect() {
      pendingRef.current?.reject?.(unavailable('disconnect'));
      pendingRef.current = null;
      setRequestedWallet(null);
      setState((current) => ({ ...current, session: null, lastError: null }));
    },
    getSession() {
      return getState().session;
    },
    async upload() {
      throw unavailable('upload');
    },
    async resumeUpload() {
      throw unavailable('resumeUpload');
    },
  });
}

function OfficialShelbyBridge() {
  const [requestedWallet, setRequestedWallet] = useState(null);
  const officialStorage = useOfficialShelbyStorageAccounts({
    solanaWallet: requestedWallet?.chain === 'solana' ? requestedWallet.wallet : null,
    ethereumWallet: requestedWallet?.chain === 'evm' ? requestedWallet.wallet : null,
  });
  const [state, setState] = useState(defaultBridgeState);
  const stateRef = useRef(state);
  const pendingRef = useRef(null);
  stateRef.current = state;

  const api = useMemo(
    () => createNoopApi(() => stateRef.current, setState, setRequestedWallet, pendingRef),
    [],
  );

  useEffect(() => {
    window.VesselOfficialShelby = api;
    setState((current) => ({ ...current, ready: true }));
    window.dispatchEvent(new CustomEvent('vessel:official-shelby-ready'));
    return () => {
      if (window.VesselOfficialShelby === api) delete window.VesselOfficialShelby;
    };
  }, [api]);

  useEffect(() => {
    if (!requestedWallet) return;
    const session = requestedWallet.chain === 'solana'
      ? officialStorage.solana
      : officialStorage.evm;
    if (!session) return;
    const nextSession = Object.freeze({
      ...session,
      walletId: requestedWallet.descriptor?.id || '',
      walletName: requestedWallet.descriptor?.name || requestedWallet.chain,
      sourceNetwork: requestedWallet.chain === 'solana' ? 'devnet' : 'sepolia',
    });
    setState((current) => (
      sameSession(current.session, nextSession)
        ? current
        : { ...current, session: nextSession, lastError: null }
    ));
    pendingRef.current?.resolve?.(nextSession);
    pendingRef.current = null;
  }, [officialStorage.evm, officialStorage.solana, requestedWallet]);

  return null;
}

export function mountOfficialShelbyBridge(target = document.createElement('div')) {
  target.hidden = true;
  target.dataset.vesselOfficialShelby = 'true';
  if (!target.isConnected) document.body.append(target);
  const root = createRoot(target);
  root.render(<OfficialShelbyBridge />);
  return root;
}
