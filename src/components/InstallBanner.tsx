import { useInstallOffer } from "~/pwa";

/**
 * Dismissible "Instalovat aplikaci" offer (#11, #16). Only inside the app
 * layout, i.e. after creating or joining a Household. Hidden when running
 * installed, when Chrome has no install prompt to offer, or once dismissed.
 */
export function InstallBanner() {
  const { visible, install, dismiss } = useInstallOffer();
  if (!visible) return null;
  return (
    <div className="install-banner" role="region" aria-label="Instalace aplikace">
      <button className="btn primary" onClick={() => void install()}>
        Instalovat aplikaci
      </button>
      <button className="icon-btn" aria-label="Skrýt nabídku instalace" onClick={dismiss}>
        ✕
      </button>
    </div>
  );
}
