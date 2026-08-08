import { mountOfficialShelbyBridge } from './official-shelby/bridge.jsx';

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const mount = () => {
    if (window.__vesselOfficialShelbyMounted) return;
    window.__vesselOfficialShelbyMounted = true;
    mountOfficialShelbyBridge();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
}
