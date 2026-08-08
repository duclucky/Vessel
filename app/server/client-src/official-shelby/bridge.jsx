import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

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

function createNoopApi(getState, setState) {
  return Object.freeze({
    isReady() {
      return getState().ready === true;
    },
    async scanWallets() {
      return [];
    },
    async connectWallet() {
      throw unavailable('connectWallet');
    },
    async disconnect() {
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
  const [state, setState] = useState(defaultBridgeState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const api = useMemo(
    () => createNoopApi(() => stateRef.current, setState),
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
