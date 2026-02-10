import { useState, useRef } from "react";
import { Mic, Globe, Book, BookOpen, Info } from "lucide-react";
import type { SessionRecord, WeeklyArticle } from "../lib/types";
import { SpotlightCard } from "./SpotlightCard";

const GREETINGS = [
  { text: "Buenos días", origin: "Universal Spanish", flags: "\u{1F30E}", note: "The standard morning greeting used across all Spanish-speaking countries." },
  { text: "¿Qué onda?", origin: "Mexico", flags: "\u{1F32E}", note: "Casual slang meaning 'What's up?' — from 'onda' (wave/vibe). Ubiquitous among young Mexicans." },
  { text: "¿Qué tal?", origin: "Spain & Latin America", flags: "\u{2600}\u{FE0F}", note: "A universal informal greeting, short for '¿Qué tal estás?' — works anywhere Spanish is spoken." },
  { text: "¡Buenas!", origin: "Universal Informal", flags: "\u{1F30E}", note: "A friendly shortening of 'buenos días/tardes/noches' — works any time of day." },
  { text: "¿Cómo andás?", origin: "Argentina & Uruguay", flags: "\u{1F9C9}", note: "Rioplatense Spanish using 'vos' conjugation instead of 'tú'. Literally 'How are you walking?'" },
  { text: "¡Epa!", origin: "Venezuela", flags: "\u{1F33A}", note: "A quick, upbeat greeting or exclamation of surprise — pure Venezuelan energy." },
  { text: "¿Qué hubo?", origin: "Colombia", flags: "\u{2615}", note: "Pronounced 'quiubo' — a warm, casual 'What's been going on?' heard on the streets of Bogotá and Medellín." },
  { text: "¿Qué hay de nuevo?", origin: "Caribbean Spanish", flags: "\u{1F334}", note: "Literally 'What's new?' — a breezy conversation opener popular in Cuba, Dominican Republic, and Puerto Rico." },
  { text: "¡Hola, che!", origin: "Argentina", flags: "\u{1F9C9}", note: "'Che' is the iconic Argentine interjection — a term of familiarity, like 'hey, buddy.'" },
  { text: "¿Cómo vas?", origin: "Central America", flags: "\u{1F30B}", note: "A casual 'How's it going?' widely used in Guatemala, El Salvador, and Honduras." },
  { text: "¿Qué más?", origin: "Colombia & Ecuador", flags: "\u{2615}", note: "Short for '¿Qué más hay?' — a laid-back 'What else is going on?' among friends." },
  { text: "¡Quiúbole!", origin: "Mexico", flags: "\u{1F32E}", note: "A playful contraction of '¿Qué hubo le?' — very informal, mostly between close friends." },
  { text: "¿Cómo te va?", origin: "Universal", flags: "\u{1F30E}", note: "Literally 'How's it going for you?' — polite and warm, works in any context." },
  { text: "¡Hola, pana!", origin: "Venezuela & Ecuador", flags: "\u{1F33A}", note: "'Pana' means buddy/pal — from 'panadero' (baker), old slang for a trusted companion." },
  { text: "¿Todo bien?", origin: "Spain & Southern Cone", flags: "\u{2600}\u{FE0F}", note: "A casual check-in — 'Everything good?' Used like the English 'All right?'" },
  { text: "¡Pura vida!", origin: "Costa Rica", flags: "\u{1F98B}", note: "Literally 'pure life' — Costa Rica's national motto, used as hello, goodbye, thanks, and everything in between." },
] as const;

interface DashboardProps {
  userName: string;
  userPicture?: string;
  onStartSession: () => void;
  onGoToSettings: () => void;
  onGoToNotebook: () => void;
  onGoToLibrary?: () => void;
  sessions: SessionRecord[];
  isLoading?: boolean;
  spotlightArticle?: WeeklyArticle | null;
  onReadArticle?: (article: WeeklyArticle) => void;
}

const NoiseOverlay = () => (
  <div 
    className="pointer-events-none fixed inset-0 z-0 opacity-[0.06] mix-blend-multiply" 
    style={{ 
      backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='1'/%3E%3C/svg%3E")` 
    }} 
  />
);

export function Dashboard({ userName, userPicture, onStartSession, onGoToSettings, onGoToNotebook, onGoToLibrary, isLoading = false, spotlightArticle, onReadArticle }: DashboardProps) {
  const [greetingIndex] = useState(() => Math.floor(Math.random() * GREETINGS.length));
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipTimeout = useRef<ReturnType<typeof setTimeout>>();

  const greeting = GREETINGS[greetingIndex];

  const handleTooltipEnter = () => {
    clearTimeout(tooltipTimeout.current);
    setShowTooltip(true);
  };
  const handleTooltipLeave = () => {
    tooltipTimeout.current = setTimeout(() => setShowTooltip(false), 150);
  };
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
              <Globe size={20} className="text-white" />
              <span className="text-sm md:text-base font-sans font-black tracking-[0.2em] uppercase text-white">Contigo</span>
          </div>
      </div>

      <div className="absolute top-8 right-8 z-20">
        <div
            onClick={onGoToSettings}
            className="relative w-16 h-16 md:w-20 md:h-20 rounded-full border-[3px] border-yellow shadow-lg overflow-hidden cursor-pointer hover:scale-105 transition-all"
          >
            {userPicture ? (
              <img src={userPicture} className="w-full h-full object-cover" alt="Profile" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-full h-full bg-yellow flex items-center justify-center text-xl font-serif text-textMain">{userName.charAt(0)}</div>
            )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col justify-center px-8 md:px-16 lg:px-24 z-10 relative pt-20 md:pt-32">
        
        <div className="space-y-12 md:space-y-16 lg:space-y-20 relative flex flex-col max-w-4xl">
           <div className="flex flex-col gap-1">
             <div className="flex items-center gap-2">
               <span
                 key={greetingIndex}
                 className="text-3xl md:text-4xl lg:text-5xl font-sans font-bold text-white/90 leading-tight animate-fade-in"
               >
                 {greeting.text},
               </span>
               <div
                 className="relative"
                 onMouseEnter={handleTooltipEnter}
                 onMouseLeave={handleTooltipLeave}
                 onTouchStart={() => setShowTooltip((v) => !v)}
               >
                 <Info size={18} className="text-white/60 hover:text-white/90 transition-colors cursor-help mt-1" />
                 {showTooltip && (
                   <div className="absolute left-full bottom-0 ml-3 w-80 bg-white rounded-2xl shadow-2xl border border-black/10 p-5 z-50 text-left">
                     <div className="flex items-center gap-2.5 mb-2">
                       <span className="text-xl leading-none">{greeting.flags}</span>
                       <p className="text-sm font-sans font-bold uppercase tracking-[0.2em] text-pink">{greeting.origin}</p>
                     </div>
                     <p className="text-base font-sans text-textMain leading-relaxed">{greeting.note}</p>
                     <a
                       href="https://blog.worldsacross.com/index/regional-vocabulary-words-from-different-spanish-speaking-countries"
                       target="_blank"
                       rel="noopener noreferrer"
                       className="inline-block mt-3 text-xs font-sans font-semibold text-sky/70 hover:text-pink transition-colors"
                     >
                       Explore regional expressions &rarr;
                     </a>
                   </div>
                 )}
               </div>
             </div>
             <h1 className="text-5xl md:text-6xl lg:text-8xl font-serif text-white leading-none mb-2">{userName}</h1>
           </div>

           <button 
            onClick={onStartSession}
            disabled={isLoading}
            className="group relative bg-pink text-white w-48 md:w-56 lg:w-64 h-16 md:h-18 lg:h-20 rounded-2xl shadow-[6px_6px_0px_rgba(0,0,0,0.2)] overflow-hidden flex items-center justify-between px-6 md:px-8 gap-3 hover:scale-105 hover:shadow-[8px_8px_0px_rgba(0,0,0,0.2)] active:scale-95 active:shadow-none transition-all duration-300 self-start disabled:opacity-70 disabled:cursor-wait"
           >
              <div className="absolute top-0 right-0 w-32 h-32 bg-black opacity-[0.1] rotate-45 translate-x-12 -translate-y-10 pointer-events-none" />
              
              <span className="relative z-10 font-sans font-bold text-base md:text-lg tracking-widest uppercase">
                {isLoading ? "Loading..." : "Begin Chat"}
              </span>
              <div className="relative z-10 w-8 h-8 md:w-10 md:h-10 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm group-hover:bg-white/30 transition-colors">
                 <Mic size={18} className="text-white" />
              </div>
           </button>
        </div>
      </div>

      {/* Weekly Spotlight */}
      {spotlightArticle && onReadArticle && (
        <div className="px-8 md:px-16 lg:px-24 z-10 relative mt-4 md:mt-0">
          <div className="max-w-2xl">
            <SpotlightCard article={spotlightArticle} onReadArticle={onReadArticle} />
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="pb-12 px-8 md:px-16 lg:px-24 z-20 mt-auto">
         <div className="flex flex-col md:flex-row items-center gap-4 md:gap-8">
           <button
             onClick={onGoToNotebook}
             className="w-full md:w-auto flex items-center justify-center gap-3 text-textMain hover:text-pink transition-colors py-4 font-sans text-base font-bold uppercase tracking-widest"
           >
              <Book size={22} />
              <span>Open Notebook</span>
           </button>
           {onGoToLibrary && (
             <button
               onClick={onGoToLibrary}
               className="w-full md:w-auto flex items-center justify-center gap-3 text-textMain hover:text-emerald-500 transition-colors py-4 font-sans text-base font-bold uppercase tracking-widest"
             >
                <BookOpen size={20} />
                <span>Reference Library</span>
             </button>
           )}
         </div>
      </div>
    </div>
  );
}
