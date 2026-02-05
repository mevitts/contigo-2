import { Home, BookOpen, TrendingUp, Settings } from "lucide-react";

export type NavPage = "home" | "notes" | "progress" | "settings";

interface BottomNavProps {
  currentPage: NavPage;
  onNavigate: (page: NavPage) => void;
}

export function BottomNav({ currentPage, onNavigate }: BottomNavProps) {
  const navItems: { id: NavPage; icon: typeof Home; label: string }[] = [
    { id: "home", icon: Home, label: "Home" },
    { id: "notes", icon: BookOpen, label: "Cuaderno" },
    { id: "progress", icon: TrendingUp, label: "Journey" },
    { id: "settings", icon: Settings, label: "Settings" },
  ];

  return (
    <nav className="sticky bottom-0 z-50 bg-background/80 backdrop-blur-xl border-t border-border px-2 py-2 safe-area-bottom shadow-2xl">
      <div className="max-w-4xl mx-auto flex items-center justify-around">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;
          
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`flex flex-col items-center gap-1.5 px-6 py-2.5 rounded-2xl transition-all ${
                isActive
                  ? "bg-gradient-to-br from-[#E07A5F]/20 to-[#F4A261]/20 text-[#E07A5F] scale-105"
                  : "text-[#3D405B]/50 hover:text-[#3D405B] hover:bg-muted/50"
              }`}
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className={`w-6 h-6 ${isActive ? "fill-[#E07A5F]/10 stroke-[2.5]" : ""}`} />
              <span className="text-xs font-medium">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}