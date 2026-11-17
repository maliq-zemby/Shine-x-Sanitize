import { PWAInstallButton } from './PWAInstallButton';
import type { RegisteredUser } from '../types';

export type AppView = 'home' | 'configurator' | 'orders' | 'pro' | 'admin' | 'auth';

interface TopBarProps {
  activeView: AppView;
  currentUser: RegisteredUser | null;
  onNavigate: (view: AppView) => void;
  onStartOrder: () => void;
}

export function TopBar({ activeView, currentUser, onNavigate, onStartOrder }: TopBarProps) {
  const navItems: { id: AppView; label: string }[] = [
    { id: 'home', label: 'Découvrir' },
    { id: 'orders', label: 'Suivi & Commandes' },
    { id: 'pro', label: 'Espace Pro' },
    { id: 'admin', label: 'Administration' },
    {
      id: 'auth',
      label: currentUser ? `Mon profil (${currentUser.name.split(' ')[0]})` : 'Connexion',
    },
  ];

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-[#E2E8F0]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4 sm:gap-8">
        <button
          type="button"
          onClick={() => onNavigate('home')}
          className="flex items-center gap-2.5 text-left whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#059669] rounded-xl"
        >
          <img
            src="/assets/logo-shine-sanitize.png"
            alt="Logo officiel Shine x Sanitize"
            className="w-10 h-10 rounded-xl border border-[#E2E8F0] bg-white object-contain p-0.5 shrink-0"
          />
          <span className="flex flex-col leading-none">
            <span className="text-base sm:text-lg font-bold tracking-tight text-[#0F172A]">
              Shine x Sanitize
            </span>
            <span className="text-[11px] font-medium text-[#475569] mt-0.5">
              Alp Group
            </span>
          </span>
        </button>

        <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
          {navItems.map((item) => {
            const isActive = activeView === item.id;
            const isProTab = item.id === 'pro' || item.id === 'admin';
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`py-1.5 px-2.5 rounded-xl border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#059669] ${
                  isActive
                    ? isProTab
                      ? 'border-[#0F172A] text-[#0F172A] font-semibold bg-[#F1F5F9]'
                      : 'border-[#059669] text-[#059669] font-semibold bg-[#ECFDF5]/60'
                    : 'border-transparent text-[#475569] hover:text-[#0F172A] hover:bg-[#F8FAFC]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <PWAInstallButton />
          <button
            type="button"
            onClick={onStartOrder}
            className="btn-primary px-4 sm:px-5 py-2.5 text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#059669]"
          >
            Commander un service
          </button>
        </div>
      </div>

      {/* Compact mobile navigation row */}
      <nav className="md:hidden flex items-center justify-between px-4 py-2 border-t border-[#E2E8E0] overflow-x-auto gap-2 text-xs font-medium">
        {navItems.map((item) => {
          const isActive = activeView === item.id;
          const isProTab = item.id === 'pro' || item.id === 'admin';
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`py-1.5 px-2.5 rounded-xl whitespace-nowrap shrink-0 cursor-pointer ${
                isActive
                  ? isProTab
                    ? 'bg-[#1E293B] text-white font-semibold'
                    : 'bg-[#ECFDF5] text-[#059669] font-semibold'
                  : 'text-[#475569]'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
