import { Mic, Globe, Book, BookOpen } from "lucide-react";
import type { SessionRecord } from "../lib/types";

interface DashboardProps {
  userName: string;
  onStartSession: () => void;
  onGoToSettings: () => void;
  onGoToNotebook: () => void;
  onGoToLibrary?: () => void;
  sessions: SessionRecord[];
  isLoading?: boolean;
}

const NoiseOverlay = () => (
  <div 
    className="pointer-events-none fixed inset-0 z-0 opacity-[0.06] mix-blend-multiply" 
    style={{ 
      backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='1'/%3E%3C/svg%3E")` 
    }} 
  />
);

export function Dashboard({ userName, onStartSession, onGoToSettings, onGoToNotebook, onGoToLibrary, isLoading = false }: DashboardProps) {
  return (
    <div className="min-h-screen bg-plaster font-serif animate-fade-in flex flex-col relative overflow-hidden">
      <NoiseOverlay />
      
      {/* Sky Blue Wall */}
      <div className="absolute top-0 left-0 w-full h-[50%] md:h-[60%] bg-sky md:rounded-br-[4rem] lg:rounded-br-[6rem] shadow-2xl z-0 overflow-hidden">
          <div className="absolute inset-0 opacity-[0.04] pointer-events-none" 
             style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='20' height='20' viewBox='0 0 20 20' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23000000' fill-opacity='1' fill-rule='evenodd'%3E%3Ccircle cx='3' cy='3' r='1'/%3E%3Ccircle cx='13' cy='13' r='1'/%3E%3C/g%3E%3C/svg%3E")` }} 
          />
          <div className="absolute top-1/4 left-0 w-full h-64 bg-gradient-to-b from-black/10 to-transparent pointer-events-none transform -skew-y-6 origin-top-left" />
      </div>
      
      {/* Header */}
      <div className="absolute top-8 left-8 z-20 opacity-60">
          <div className="flex items-center gap-2">
              <Globe size={12} className="text-white" />
              <span className="text-[10px] md:text-xs font-sans font-black tracking-[0.2em] uppercase text-white">Contigo</span>
          </div>
      </div>

      <div className="absolute top-8 right-8 z-20">
        <div 
            onClick={onGoToSettings}
            className="relative w-12 h-12 md:w-14 md:h-14 rounded-full border-[3px] border-yellow shadow-lg overflow-hidden cursor-pointer hover:scale-105 transition-all"
          >
            <img src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=100&q=80" className="w-full h-full object-cover" alt="Profile" />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col justify-center px-8 md:px-16 lg:px-24 z-10 relative pt-20 md:pt-32">
        
        <div className="space-y-12 md:space-y-16 lg:space-y-20 relative flex flex-col max-w-4xl">
           <div className="flex flex-col gap-1">
             <span className="text-2xl md:text-3xl lg:text-4xl font-sans font-bold text-white/90 leading-tight">Buenos Días,</span>
             <h1 className="text-5xl md:text-6xl lg:text-8xl font-serif text-white leading-none mb-2">{userName}</h1>
           </div>

           <button 
            onClick={onStartSession}
            disabled={isLoading}
            className="group relative bg-pink text-white w-48 md:w-56 lg:w-64 h-16 md:h-18 lg:h-20 rounded-2xl shadow-[6px_6px_0px_rgba(0,0,0,0.2)] overflow-hidden flex items-center justify-between px-6 md:px-8 gap-3 hover:scale-105 hover:shadow-[8px_8px_0px_rgba(0,0,0,0.2)] active:scale-95 active:shadow-none transition-all duration-300 self-start disabled:opacity-70 disabled:cursor-wait"
           >
              <div className="absolute top-0 right-0 w-32 h-32 bg-black opacity-[0.1] rotate-45 translate-x-12 -translate-y-10 pointer-events-none" />
              
              <span className="relative z-10 font-sans font-bold text-sm md:text-base tracking-widest uppercase">
                {isLoading ? "Loading..." : "Begin Chat"}
              </span>
              <div className="relative z-10 w-8 h-8 md:w-10 md:h-10 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm group-hover:bg-white/30 transition-colors">
                 <Mic size={18} className="text-white" />
              </div>
           </button>
        </div>
      </div>

      {/* Footer */}
      <div className="pb-12 px-8 md:px-16 lg:px-24 z-20 mt-auto">
         <div className="flex flex-col md:flex-row items-center gap-4 md:gap-8">
           <button
             onClick={onGoToNotebook}
             className="w-full md:w-auto flex items-center justify-center gap-2 text-textSoft hover:text-pink transition-colors py-4 font-sans text-xs font-bold uppercase tracking-widest opacity-90 hover:opacity-100"
           >
              <Book size={16} />
              <span>Open Notebook</span>
           </button>
           {onGoToLibrary && (
             <button
               onClick={onGoToLibrary}
               className="w-full md:w-auto flex items-center justify-center gap-2 text-textSoft hover:text-emerald-500 transition-colors py-4 font-sans text-xs font-bold uppercase tracking-widest opacity-90 hover:opacity-100"
             >
                <BookOpen size={16} />
                <span>Reference Library</span>
             </button>
           )}
         </div>
      </div>
    </div>
  );
}
