export function confirmAction(options, document = globalThis.document) {
  const {
    opener,
    kicker,
    title,
    message,
    cancelLabel = 'CANCEL',
    confirmLabel,
  } = options;

  return new Promise((resolve) => {
    const uid = `vessel-dialog-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const host = document.createElement('div');
    host.className = 'vessel-dialog-backdrop';

    const dialog = document.createElement('section');
    dialog.className = 'vessel-dialog vessel-glass';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', `${uid}-title`);
    dialog.setAttribute('aria-describedby', `${uid}-message`);

    const kickerNode = document.createElement('p');
    kickerNode.className = 'vessel-kicker text-primary';
    kickerNode.textContent = kicker;

    const titleNode = document.createElement('h2');
    titleNode.id = `${uid}-title`;
    titleNode.className = 'font-display text-3xl font-semibold';
    titleNode.textContent = title;

    const messageNode = document.createElement('p');
    messageNode.id = `${uid}-message`;
    messageNode.className = 'vessel-dialog-message text-on-surface-variant';
    messageNode.textContent = message;

    const actions = document.createElement('div');
    actions.className = 'vessel-dialog-actions';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'vessel-button vessel-button-secondary';
    cancelButton.textContent = cancelLabel;

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'vessel-button vessel-button-danger';
    confirmButton.textContent = confirmLabel;

    actions.append(cancelButton, confirmButton);
    dialog.append(kickerNode, titleNode, messageNode, actions);
    host.appendChild(dialog);

    const previousOverflow = document.body.style.overflow;
    let closed = false;

    const close = (value) => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKeydown);
      host.remove();
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
      resolve(value);
    };

    const onKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
        return;
      }
      if (event.key !== 'Tab') return;
      if (event.shiftKey && document.activeElement === cancelButton) {
        event.preventDefault();
        confirmButton.focus();
      } else if (!event.shiftKey && document.activeElement === confirmButton) {
        event.preventDefault();
        cancelButton.focus();
      }
    };

    cancelButton.addEventListener('click', () => close(false));
    confirmButton.addEventListener('click', () => close(true));
    host.addEventListener('click', (event) => {
      if (event.target === host) close(false);
    });
    document.addEventListener('keydown', onKeydown);
    document.body.style.overflow = 'hidden';
    document.body.appendChild(host);
    cancelButton.focus();
  });
}
