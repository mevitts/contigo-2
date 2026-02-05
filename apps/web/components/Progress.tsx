import { Compass, Star, TrendingUp, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export function Progress() {
  const timeRange = "month";

  const keyMetrics = [
    { label: "Conversations", value: "18", emoji: "💬", color: "from-[#E07A5F] to-[#F4A261]" },
    { label: "Minutes", value: "2.5", emoji: "⏰", color: "from-[#81B29A] to-[#2A9D8F]" },
    { label: "New Words", value: "67", emoji: "✨", color: "from-[#E9C46A] to-[#F4A261]" },
    { label: "Confidence", value: "85%", emoji: "🚀", color: "from-[#FFB5A7] to-[#E07A5F]" },
  ];

  const sessionData = [
    { week: "Week 1", minutes: 8 },
    { week: "Week 2", minutes: 12 },
    { week: "Week 3", minutes: 15 },
    { week: "Week 4", minutes: 18 },
  ];

  const errorData = [
    { type: "Gender", count: 15 },
    { type: "Tense", count: 8 },
    { type: "Sounds", count: 12 },
    { type: "Vocab", count: 5 },
  ];

  const categoryData = [
    { name: "Grammar", value: 45 },
    { name: "Vocab", value: 30 },
    { name: "Pronunciation", value: 25 },
  ];

  const COLORS = ["#E07A5F", "#81B29A", "#E9C46A"];

  const difficultyProgress = [
    { level: "Beginner", progress: 100, status: "🎉 Mastered!", emoji: "🌱" },
    { level: "Intermediate", progress: 60, status: "Making great progress", emoji: "🌿" },
    { level: "Advanced", progress: 10, status: "Just getting started", emoji: "🌳" },
  ];

  return (
    <div className="min-h-screen pb-24 px-4 py-8">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div className="flex items-center gap-3">
            <Compass className="w-9 h-9 text-[#E07A5F]" />
            <h1 className="text-3xl md:text-4xl">Your Journey</h1>
          </div>
          <p className="text-lg text-muted-foreground">Look how far you've come! 🎊</p>

          <div className="flex items-center gap-3 flex-wrap">
            {["Week", "Month", "All Time"].map((range, index) => (
              <motion.button
                key={range}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.1 }}
                className={`px-5 py-2.5 rounded-full transition-all shadow-sm ${
                  range.toLowerCase() === timeRange
                    ? "bg-gradient-to-r from-[#E07A5F] to-[#F4A261] text-white scale-105"
                    : "bg-white border-2 border-border hover:border-[#E07A5F]/50"
                }`}
              >
                {range}
              </motion.button>
            ))}
          </div>
        </motion.div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {keyMetrics.map((metric, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3 + index * 0.1 }}
              className={`bg-gradient-to-br ${metric.color} rounded-3xl p-6 text-center space-y-3 hover:shadow-xl transition-all hover:scale-105`}
            >
              <div className="text-4xl">{metric.emoji}</div>
              <div className="text-3xl text-white font-semibold">{metric.value}</div>
              <div className="text-sm font-medium text-white/90">{metric.label}</div>
            </motion.div>
          ))}
        </div>

        {/* Charts */}
        <div className="space-y-6">
          {/* Line Chart - Session Time */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-white border-2 border-[#E07A5F]/20 rounded-3xl p-6 space-y-4 shadow-lg"
          >
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-[#E07A5F]" />
              <h2 className="text-xl">Your Conversation Time</h2>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={sessionData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F4F1DE" />
                <XAxis dataKey="week" stroke="#3D405B" />
                <YAxis stroke="#3D405B" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#FFFBF5",
                    border: "2px solid #E07A5F",
                    borderRadius: "1rem",
                    padding: "12px",
                  }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="minutes"
                  stroke="#E07A5F"
                  strokeWidth={4}
                  dot={{ fill: "#E07A5F", r: 8, strokeWidth: 3, stroke: "#fff" }}
                  name="Minutes"
                />
              </LineChart>
            </ResponsiveContainer>
          </motion.div>

          {/* Bar Chart - Learning Moments */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="bg-white border-2 border-[#81B29A]/20 rounded-3xl p-6 space-y-4 shadow-lg"
          >
            <div className="flex items-center gap-2">
              <Star className="w-5 h-5 text-[#81B29A]" />
              <h2 className="text-xl">Learning Moments</h2>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={errorData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F4F1DE" />
                <XAxis dataKey="type" stroke="#3D405B" />
                <YAxis stroke="#3D405B" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#FFFBF5",
                    border: "2px solid #81B29A",
                    borderRadius: "1rem",
                    padding: "12px",
                  }}
                />
                <Legend />
                <Bar dataKey="count" fill="#81B29A" name="Discoveries" radius={[12, 12, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </motion.div>

          {/* Pie Chart - Focus Areas */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
            className="bg-white border-2 border-[#E9C46A]/20 rounded-3xl p-6 space-y-4 shadow-lg"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#E9C46A]" />
              <h2 className="text-xl">What You're Exploring</h2>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={categoryData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }: { name: string; percent: number }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {categoryData.map((entry, index) => (
                    <Cell key={`${entry.name}-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#FFFBF5",
                    border: "2px solid #E9C46A",
                    borderRadius: "1rem",
                    padding: "12px",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </motion.div>
        </div>

        {/* Difficulty Progression */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
          className="bg-gradient-to-br from-[#FFB5A7]/20 to-[#A8DADC]/20 border-2 border-[#E07A5F]/20 rounded-3xl p-8 space-y-6 shadow-lg"
        >
          <div className="flex items-center gap-2">
            <h2 className="text-2xl">Your Adventure Path</h2>
            <span className="text-2xl">🗺️</span>
          </div>

          <div className="space-y-6">
            {difficultyProgress.map((difficulty, index) => (
              <div key={index} className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{difficulty.emoji}</span>
                    <div>
                      <span className="spanish-text font-medium text-lg">{difficulty.level}</span>
                      <p className="text-sm text-muted-foreground">{difficulty.status}</p>
                    </div>
                  </div>
                  <span className="text-lg font-semibold text-[#E07A5F]">
                    {difficulty.progress}%
                  </span>
                </div>
                <div className="w-full h-4 bg-white/60 rounded-full overflow-hidden shadow-inner">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${difficulty.progress}%` }}
                    transition={{ duration: 1, delay: 0.9 + index * 0.2 }}
                    className="h-full bg-gradient-to-r from-[#E07A5F] via-[#F4A261] to-[#E9C46A] rounded-full shadow-sm"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="pt-4 border-t-2 border-white/50">
            <div className="bg-gradient-to-r from-[#81B29A]/30 to-[#2A9D8F]/30 border-2 border-[#81B29A] rounded-2xl p-5 space-y-3">
              <p className="text-lg">
                <span className="font-semibold">Ready for the next adventure?</span> 🚀
              </p>
              <p className="text-muted-foreground">You're doing amazing! Time to level up to Advanced?</p>
              <button className="px-6 py-3 rounded-full bg-gradient-to-r from-[#81B29A] to-[#2A9D8F] hover:from-[#81B29A]/90 hover:to-[#2A9D8F]/90 text-white transition-all font-medium shadow-md">
                Let's go! →
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
