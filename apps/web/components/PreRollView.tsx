import React from "react";
import { motion } from "motion/react";

interface PreRollViewProps {
  onComplete: () => void;
}

const NoiseOverlay = () => (
  <div 
    className="pointer-events-none fixed inset-0 z-0 opacity-[0.06] mix-blend-multiply" 
    style={{ 
      backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='1'/%3E%3C/svg%3E")` 
    }} 
  />
);

export function PreRollView({ onComplete }: PreRollViewProps) {
  React.useEffect(() => {
    const timer = setTimeout(() => {
      onComplete();
    }, 3000);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-50 bg-sky flex flex-col items-center justify-center overflow-hidden">
      <NoiseOverlay />
      
      {/* Geometric Shapes */}
      <motion.div 
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1, ease: "easeOut" }}
        className="absolute top-1/4 left-1/4 w-32 h-32 bg-pink rounded-full opacity-80 blur-xl"
      />
      <motion.div 
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1.2, delay: 0.2, ease: "easeOut" }}
        className="absolute bottom-1/3 right-1/4 w-48 h-48 bg-yellow rounded-lg rotate-12 opacity-80 blur-xl"
      />

      <div className="relative z-10 text-center space-y-8">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.8 }}
          className="space-y-2"
        >
          <h2 className="text-white font-serif text-4xl md:text-5xl">Setting the scene...</h2>
          <p className="text-white/80 font-sans text-lg tracking-widest uppercase">Terraza • Coffee Shop</p>
        </motion.div>

        <div className="flex justify-center gap-2">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="w-3 h-3 bg-white rounded-full"
              animate={{ y: [0, -10, 0] }}
              transition={{
                duration: 0.6,
                repeat: Infinity,
                delay: i * 0.2,
                ease: "easeInOut"
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
