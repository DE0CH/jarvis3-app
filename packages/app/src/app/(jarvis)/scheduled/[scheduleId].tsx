import { useLocalSearchParams } from "expo-router";
import { Jarvis3Gate } from "@/jarvis3/gate";
import { ScheduleScreen } from "@/jarvis3/screens/schedule-screen";

export default function Jarvis3ScheduleRoute() {
  const { scheduleId } = useLocalSearchParams<{ scheduleId?: string }>();
  const id = typeof scheduleId === "string" ? scheduleId : "";
  return (
    <Jarvis3Gate>
      <ScheduleScreen key={id} scheduleId={id} />
    </Jarvis3Gate>
  );
}
