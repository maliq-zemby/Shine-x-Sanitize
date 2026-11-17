import { useState } from 'react';
import { Download, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="btn-secondary px-3 py-2 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Download className="w-3.5 h-3.5 text-[#059669]" />
        Installer l’app
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="btn-secondary px-3 py-2 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5 text-[#059669]" />
          Installer sur iOS
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/50 p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white border border-[#E2E8F0] p-6 space-y-4 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <img
                    src="/apple-touch-icon.png"
                    alt="Icône Shine x Sanitize"
                    className="w-12 h-12 rounded-xl border border-[#E2E8F0] bg-white object-contain shrink-0"
                  />
                  <div>
                    <h3 className="text-sm font-bold text-[#0F172A]">Shine x Sanitize</h3>
                    <p className="text-xs text-[#475569]">Alp Group · Écran d’accueil iOS</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Fermer"
                  className="text-[#475569] hover:text-[#0F172A] p-1.5 rounded-xl cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-[#475569] leading-relaxed">
                1. Touchez le bouton <strong className="text-[#0F172A]">Partager</strong> dans la barre Safari.
                <br />
                2. Faites défiler et sélectionnez{' '}
                <strong className="text-[#0F172A]">Sur l’écran d’accueil</strong> pour ajouter l’icône officielle.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="btn-primary w-full py-2.5 text-xs font-semibold cursor-pointer"
              >
                Compris
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
