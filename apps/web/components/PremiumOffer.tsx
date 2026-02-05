import { motion } from "motion/react";
import { Clock, Crown, ArrowRight } from "lucide-react";

export interface PremiumPlanOption {
  id: "monthly" | "yearly";
  label: string;
  price: number;
  billingInterval: "Monthly" | "Yearly";
  minutesIncluded: number;
  subtitle: string;
  highlight?: string;
}

export type PremiumPlanId = PremiumPlanOption["id"];

interface PremiumOfferProps {
  durationSeconds: number;
  freeLimitSeconds: number;
  plans: PremiumPlanOption[];
  onSelectPlan: (planId: PremiumPlanId) => void;
  onSkip: () => void;
}

function formatMinutes(seconds: number): string {
  const minutes = seconds / 60;
  if (minutes >= 1) {
    return `${minutes.toFixed(1)} min`;
  }
  return `${Math.round(seconds)} sec`;
}

function planRate(plan: PremiumPlanOption): string {
  if (!plan.minutesIncluded || plan.minutesIncluded <= 0) {
    return "—";
  }
  const rate = plan.price / plan.minutesIncluded;
  return `$${rate.toFixed(2)} per min`;
}

export function PremiumOffer({ durationSeconds, freeLimitSeconds, plans, onSelectPlan, onSkip }: PremiumOfferProps) {
  return (
    <div className="min-h-screen bg-plaster px-4 py-10 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-4xl bg-white rounded-4xl shadow-2xl border border-black/5 overflow-hidden"
      >
        <div className="bg-sky text-white px-8 py-10 flex flex-col gap-4">
          <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.3em]">
            <Crown size={18} />
            <span>Premium Preview</span>
          </div>
          <h1 className="text-4xl font-serif">Unlock longer conversations</h1>
          <p className="text-white/80 text-lg max-w-2xl">
            You just spent {formatMinutes(durationSeconds)} chatting. Free plans include {formatMinutes(freeLimitSeconds)} per session;
            upgrade to keep the tutor online and get richer feedback.
          </p>
        </div>

        <div className="px-8 py-10 grid gap-8 md:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <div className="bg-plaster rounded-3xl border border-dashed border-gray-300 p-6">
              <div className="flex items-center gap-3 text-sm font-semibold text-textMain">
                <Clock size={18} />
                <span>Free tier recap</span>
              </div>
              <p className="mt-3 text-gray-600 text-sm">
                • {formatMinutes(freeLimitSeconds)} per conversation<br />
                • Lite review notes<br />
                • Access to demo tutor only
              </p>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-[0.3em] text-textSoft">Choose a plan</p>
              <div className="grid gap-4 md:grid-cols-2">
                {plans.map((plan) => (
                  <button
                    key={plan.id}
                    onClick={() => onSelectPlan(plan.id)}
                    className="group text-left bg-white rounded-3xl border border-gray-200 hover:border-black hover:-translate-y-1 transition-all p-6 shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold uppercase tracking-widest text-gray-500">{plan.billingInterval}</p>
                        <h3 className="text-2xl font-serif text-textMain">${plan.price}</h3>
                      </div>
                      <ArrowRight className="text-gray-400 group-hover:text-black transition-colors" />
                    </div>
                    <p className="text-gray-500 text-sm mt-2">{plan.subtitle}</p>
                    <p className="text-sm font-semibold text-textMain mt-4">{planRate(plan)}</p>
                    {plan.highlight && (
                      <span className="inline-block mt-3 text-xs font-bold uppercase tracking-[0.3em] text-sky">
                        {plan.highlight}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-black text-white rounded-3xl p-8 space-y-6 flex flex-col">
            <h2 className="text-2xl font-serif">What premium adds</h2>
            <ul className="space-y-3 text-sm text-white/80">
              <li>• Unlimited live minutes</li>
              <li>• Unlimited Cerebras translations / SOS</li>
              <li>• Personalized review deck + smart memory</li>
              <li>• Priority voice connection & bilingual tutors</li>
            </ul>
            <div className="mt-auto space-y-4">
              <button
                onClick={onSkip}
                className="w-full border border-white/40 rounded-full py-3 text-sm font-bold uppercase tracking-[0.3em] text-white/80 hover:text-white hover:bg-white/10 transition-colors"
              >
                Maybe Later
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
