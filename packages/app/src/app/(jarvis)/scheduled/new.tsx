import { Jarvis3Gate } from "@/jarvis3/gate";
import { ScheduleScreen } from "@/jarvis3/screens/schedule-screen";

export default function Jarvis3NewScheduleRoute() {
  return (
    <Jarvis3Gate>
      <ScheduleScreen scheduleId={null} />
    </Jarvis3Gate>
  );
}
