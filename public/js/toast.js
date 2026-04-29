const CONTAINER_ID = 'toast-container';

export function toast(message, { variant = 'info', duration = 3000 } = {}) {
  const container = document.getElementById(CONTAINER_ID);
  if (!container) {
    console.warn('toast: container not found, message:', message);
    return;
  }
  const el = document.createElement('div');
  el.className = `toast toast--${variant}`;
  el.textContent = message;
  el.setAttribute('role', 'status');
  container.appendChild(el);

  const dismiss = () => {
    el.classList.add('is-leaving');
    const fallback = setTimeout(() => el.remove(), 350);
    el.addEventListener('animationend', () => { clearTimeout(fallback); el.remove(); }, { once: true });
  };

  const timer = setTimeout(dismiss, duration);
  el.addEventListener('click', () => {
    clearTimeout(timer);
    dismiss();
  });
}
