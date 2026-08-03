const GROUP_LABELS = {
  aptos: 'APTOS',
  solana: 'SOLANA',
  evm: 'EVM · BETA',
};

const focusable = (root) => [
  ...root.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'),
];

function trapTab(event, root) {
  if (event.key !== 'Tab') return;
  const items = focusable(root);
  if (!items.length) return;
  const first = items[0];
  const last = items.at(-1);
  const active = root.ownerDocument.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function statusLabel(wallet) {
  if (wallet.status === 'beta') return 'BETA';
  if (wallet.status === 'unavailable') return 'COMING SOON';
  if (wallet.status === 'incompatible') return 'INCOMPATIBLE';
  return wallet.enabled ? 'READY' : String(wallet.status || 'UNAVAILABLE').toUpperCase();
}

async function copyText(document, value, button) {
  try {
    const clipboard = document.defaultView?.navigator?.clipboard;
    if (!clipboard?.writeText) throw new Error('Clipboard unavailable');
    await clipboard.writeText(value);
    button.textContent = 'COPIED';
  } catch {
    button.textContent = 'COPY FAILED';
  }
}

function appendCopyRow(document, menu, label, value) {
  const row = document.createElement('div');
  row.className = 'wallet-account-row';
  const text = document.createElement('div');
  text.className = 'wallet-account-value';
  const title = document.createElement('span');
  title.className = 'vessel-kicker';
  title.textContent = label;
  const address = document.createElement('code');
  address.textContent = value;
  address.title = value;
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'wallet-copy-button';
  copy.setAttribute('aria-label', `Copy ${label.toLowerCase()}`);
  copy.textContent = 'COPY';
  copy.addEventListener('click', () => void copyText(document, value, copy));
  text.append(title, address);
  row.append(text, copy);
  menu.appendChild(row);
}

export function mountWalletUi({ controller, document }) {
  const host = document.createElement('div');
  host.id = 'wallet-ui-root';
  host.innerHTML = `<div id="wallet-backdrop" class="wallet-backdrop hidden">
    <section id="wallet-dialog" class="wallet-dialog" role="dialog" aria-modal="true" aria-labelledby="wallet-dialog-title" aria-busy="false">
      <header class="wallet-dialog-header">
        <div><p class="vessel-kicker wallet-dialog-kicker">Wallet identity</p><h2 id="wallet-dialog-title">Connect a wallet</h2></div>
        <button type="button" class="wallet-icon-button" data-wallet-close aria-label="Close wallet dialog">×</button>
      </header>
      <p class="wallet-dialog-copy">Choose an installed wallet. Aptos and Solana identities remain separate.</p>
      <p id="wallet-dialog-error" class="wallet-dialog-error" aria-live="polite"></p>
      <div id="wallet-groups" class="wallet-groups"></div>
      <button type="button" data-wallet-rescan class="vessel-button vessel-button-secondary wallet-rescan">SCAN AGAIN</button>
    </section>
  </div>
  <section id="wallet-account-menu" class="wallet-account-menu hidden" role="dialog" aria-label="Connected wallet menu"></section>`;
  document.body.appendChild(host);

  const backdrop = host.querySelector('#wallet-backdrop');
  const dialog = host.querySelector('#wallet-dialog');
  const groups = host.querySelector('#wallet-groups');
  const error = host.querySelector('#wallet-dialog-error');
  const closeButton = host.querySelector('[data-wallet-close]');
  const rescanButton = host.querySelector('[data-wallet-rescan]');
  const accountMenu = host.querySelector('#wallet-account-menu');
  let dialogOpener = null;
  let accountOpener = null;

  const setError = (message = '') => {
    error.textContent = message;
  };

  const close = ({ force = false, restoreFocus = true } = {}) => {
    if (!force && controller.getState().status === 'connecting') return;
    backdrop.classList.add('hidden');
    document.body.classList.remove('wallet-modal-open');
    if (restoreFocus) dialogOpener?.focus?.();
  };

  const renderRows = (wallets) => {
    groups.replaceChildren();
    for (const chain of ['aptos', 'solana', 'evm']) {
      const section = document.createElement('section');
      section.className = 'wallet-group';
      const title = document.createElement('h3');
      title.className = 'wallet-group-title';
      title.textContent = GROUP_LABELS[chain];
      section.appendChild(title);
      const rows = wallets.filter((wallet) => wallet.chain === chain);
      if (!rows.length) {
        const empty = document.createElement('p');
        empty.className = 'wallet-group-empty';
        empty.textContent = 'No wallet detected';
        section.appendChild(empty);
      }
      for (const wallet of rows) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'wallet-row';
        row.dataset.walletEnabled = wallet.enabled ? 'true' : 'false';
        row.disabled = !wallet.enabled;
        row.setAttribute('aria-label', `${wallet.name}: ${statusLabel(wallet)}`);

        const icon = document.createElement('img');
        icon.src = wallet.icon || '';
        icon.alt = '';
        icon.loading = 'lazy';
        icon.addEventListener('error', () => { icon.hidden = true; });
        const name = document.createElement('span');
        name.className = 'wallet-row-name';
        name.textContent = wallet.name;
        const status = document.createElement('span');
        status.className = 'wallet-row-status';
        status.textContent = statusLabel(wallet);
        row.append(icon, name, status);
        row.addEventListener('click', async () => {
          setError();
          try {
            const session = await controller.connect(wallet.id);
            if (session) close({ force: true });
          } catch (connectError) {
            setError(connectError?.message || String(connectError));
          }
        });
        section.appendChild(row);
      }
      groups.appendChild(section);
    }

    const hasReadyWallet = wallets.some(
      (wallet) => wallet.enabled && (wallet.chain === 'aptos' || wallet.chain === 'solana'),
    );
    if (!hasReadyWallet) {
      const empty = document.createElement('aside');
      empty.className = 'wallet-install-help';
      const copy = document.createElement('p');
      copy.textContent = 'No supported Aptos or Solana wallet is ready.';
      const petra = document.createElement('a');
      petra.href = 'https://petra.app/';
      petra.target = '_blank';
      petra.rel = 'noreferrer';
      petra.textContent = 'GET PETRA ↗';
      const phantom = document.createElement('a');
      phantom.href = 'https://phantom.com/download';
      phantom.target = '_blank';
      phantom.rel = 'noreferrer';
      phantom.textContent = 'GET PHANTOM ↗';
      empty.append(copy, petra, phantom);
      groups.appendChild(empty);
    }
  };

  const scanAndRender = async () => {
    setError();
    groups.textContent = 'SCANNING INSTALLED WALLETS…';
    try {
      renderRows(await controller.scan());
    } catch (scanError) {
      groups.replaceChildren();
      setError(scanError?.message || String(scanError));
    }
  };

  const closeAccountMenu = ({ restoreFocus = true } = {}) => {
    accountMenu.classList.add('hidden');
    if (restoreFocus) accountOpener?.focus?.();
  };

  const open = async (button) => {
    dialogOpener = button || document.activeElement;
    closeAccountMenu({ restoreFocus: false });
    backdrop.classList.remove('hidden');
    document.body.classList.add('wallet-modal-open');
    closeButton.focus();
    await scanAndRender();
  };

  const renderAccountMenu = (session) => {
    accountMenu.replaceChildren();
    const header = document.createElement('header');
    header.className = 'wallet-account-header';
    const heading = document.createElement('h2');
    heading.textContent = `${session.walletName} · ${session.mode === 'daa' ? 'SOLANA DAA' : 'APTOS'}`;
    const closeAccountButton = document.createElement('button');
    closeAccountButton.type = 'button';
    closeAccountButton.className = 'wallet-icon-button';
    closeAccountButton.setAttribute('data-wallet-account-close', '');
    closeAccountButton.setAttribute('aria-label', 'Close connected wallet menu');
    closeAccountButton.textContent = '×';
    closeAccountButton.addEventListener('click', () => closeAccountMenu());
    header.append(heading, closeAccountButton);
    accountMenu.appendChild(header);
    appendCopyRow(document, accountMenu, 'Wallet address', session.sourceAddress);
    appendCopyRow(document, accountMenu, 'Shelby storage address', session.storageAddress);
    const actions = document.createElement('div');
    actions.className = 'wallet-account-actions';
    const switchButton = document.createElement('button');
    switchButton.type = 'button';
    switchButton.className = 'vessel-button vessel-button-secondary';
    switchButton.textContent = 'SWITCH WALLET';
    const disconnectButton = document.createElement('button');
    disconnectButton.type = 'button';
    disconnectButton.className = 'vessel-button wallet-disconnect-button';
    disconnectButton.textContent = 'DISCONNECT';
    switchButton.addEventListener('click', () => {
      const opener = accountOpener;
      closeAccountMenu({ restoreFocus: false });
      void open(opener);
    });
    disconnectButton.addEventListener('click', async () => {
      await controller.disconnect();
      closeAccountMenu();
    });
    actions.append(switchButton, disconnectButton);
    accountMenu.appendChild(actions);
  };

  const openAccountMenu = (button) => {
    const session = controller.getState().session;
    if (!session) return open(button);
    accountOpener = button || document.activeElement;
    renderAccountMenu(session);
    accountMenu.classList.remove('hidden');
    focusable(accountMenu)[0]?.focus();
    return undefined;
  };

  closeButton.addEventListener('click', () => close());
  rescanButton.addEventListener('click', () => void scanAndRender());
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  dialog.addEventListener('keydown', (event) => {
    trapTab(event, dialog);
    if (event.key === 'Escape' && controller.getState().status !== 'connecting') close();
  });
  accountMenu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAccountMenu();
  });
  const onDocumentPointerDown = (event) => {
    if (accountMenu.classList.contains('hidden')) return;
    if (accountMenu.contains(event.target) || event.target.closest?.('[data-wallet-summary]')) return;
    closeAccountMenu({ restoreFocus: false });
  };
  document.addEventListener('pointerdown', onDocumentPointerDown);

  const offController = controller.subscribe((next) => {
    const connecting = next.status === 'connecting';
    dialog.setAttribute('aria-busy', connecting ? 'true' : 'false');
    closeButton.disabled = connecting;
    groups.querySelectorAll('.wallet-row').forEach((row) => {
      row.disabled = connecting || row.dataset.walletEnabled !== 'true';
    });
    if (next.error) setError(next.error);
    if (!accountMenu.classList.contains('hidden')) {
      if (next.session) renderAccountMenu(next.session);
      else closeAccountMenu();
    }
  });

  return {
    open,
    close,
    renderRows,
    openAccountMenu,
    closeAccountMenu,
    destroy() {
      offController?.();
      document.removeEventListener('pointerdown', onDocumentPointerDown);
      document.body.classList.remove('wallet-modal-open');
      host.remove();
    },
  };
}
