export function deriveDisplayStatus(event: {
  status: string;
  start_date: string;
  end_date: string;
  timezone?: string;
}): string {
  if (event.status === "cancelled") return "cancelled";
  if (event.status === "completed") return "completed";

  const now = new Date();
  const startDate = new Date(event.start_date + "T00:00:00");
  const endDate   = new Date(event.end_date   + "T23:59:59");

  if (now > endDate) return "completed";
  if (now >= startDate && now <= endDate) return "active";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDay = new Date(startDate);
  startDay.setHours(0, 0, 0, 0);
  if (startDay.getTime() === today.getTime()) return "active";

  return "upcoming";
}
