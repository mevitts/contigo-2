import { MessageCircle, Flame, User } from "lucide-react";

interface HeaderProps {
  userName?: string;
  streak?: number;
  onProfileClick?: () => void;
}

export function Header({ userName = "Alex", streak = 7, onProfileClick }: HeaderProps) {
  return (
    <header className="sticky top-0 z-50 bg-gradient-to-r from-[#FFB5A7]/20 via-background to-[#A8DADC]/20 backdrop-blur-sm px-4 py-4">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#E07A5F] via-[#F4A261] to-[#E9C46A] flex items-center justify-center shadow-lg">
            <MessageCircle className="w-6 h-6 text-white" />
          </div>
          <div className="flex flex-col">
            <span className="text-2xl font-semibold bg-gradient-to-r from-[#E07A5F] to-[#F4A261] bg-clip-text text-transparent">
              Contigo
            </span>
            <span className="text-xs font-semibold tracking-widest uppercase text-muted-foreground">
              Hola, {userName}
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#FFB5A7]/30 to-[#E9C46A]/30 rounded-full shadow-sm">
            <Flame className="w-5 h-5 text-[#E07A5F]" />
            <span className="font-semibold text-foreground">{streak}</span>
          </div>
          
          <button
            onClick={onProfileClick}
            className="w-10 h-10 rounded-full bg-gradient-to-br from-[#81B29A] to-[#2A9D8F] flex items-center justify-center hover:opacity-90 transition-all hover:scale-105 shadow-md"
            aria-label="User profile"
          >
            <User className="w-5 h-5 text-white" />
          </button>
        </div>
      </div>
    </header>
  );
}