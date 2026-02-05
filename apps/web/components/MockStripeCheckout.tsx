import { motion } from "motion/react";
import { ShieldCheck, ArrowLeft } from "lucide-react";
import type { PremiumPlanOption } from "./PremiumOffer";

interface MockStripeCheckoutProps {
  plan: PremiumPlanOption;
  onBack: () => void;
  onComplete: () => void;
}

function computeRate(plan: PremiumPlanOption): string {
  if (!plan.minutesIncluded) {
    return "—";
  }
  const rate = plan.price / plan.minutesIncluded;
  return `$${rate.toFixed(2)} per min`;
}

export function MockStripeCheckout({ plan, onBack, onComplete }: MockStripeCheckoutProps) {
  return (
    <div className="min-h-screen bg-plaster px-4 py-10 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-2xl bg-white rounded-4xl shadow-xl border border-black/5 p-8 space-y-6"
      >
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.3em] text-gray-400 hover:text-black transition-colors"
        >
          <ArrowLeft size={14} />
          Back
        </button>

        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-textSoft">Checkout</p>
          <h1 className="text-3xl font-serif text-textMain">Confirm your {plan.billingInterval.toLowerCase()} plan</h1>
          <p className="text-sm text-gray-500">Secure payment powered by Stripe</p>
        </div>

        <div className="bg-plaster rounded-3xl p-6 space-y-3">
          <div className="flex items-center justify-between text-sm font-semibold">
            <span>{plan.label} plan</span>
            <span>${plan.price}</span>
          </div>
          <div className="flex items-center justify-between text-sm text-gray-500">
            <span>Minutes included</span>
            <span>{plan.minutesIncluded.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between text-sm text-gray-500">
            <span>Effective rate</span>
            <span>{computeRate(plan)}</span>
          </div>
        </div>

        <button
          onClick={onComplete}
          className="w-full bg-[#635bff] text-white rounded-full py-4 text-sm font-bold uppercase tracking-[0.3em] shadow-lg shadow-[#635bff]/30 hover:bg-[#5146ff] transition-colors"
        >
          {`Pay $${plan.price} • Complete Checkout With Stripe`}
        </button>
      </motion.div>
    </div>
  );
}
