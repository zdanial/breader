/** Consecutive-day streak ending today (or yesterday if today isn't active yet). */
export function computeStreak(days: string[]): number {
  const set = new Set(days)
  const key = (dt: Date) => dt.toISOString().slice(0, 10)
  const d = new Date()
  if (!set.has(key(d))) {
    d.setDate(d.getDate() - 1)
    if (!set.has(key(d))) return 0
  }
  let streak = 0
  while (set.has(key(d))) {
    streak++
    d.setDate(d.getDate() - 1)
  }
  return streak
}
