import { Jarvis3Gate } from "@/jarvis3/gate";
import { SchedulesScreen } from "@/jarvis3/screens/schedules-screen";

export default function Jarvis3SchedulesRoute() {
  return (
    <Jarvis3Gate>
      <SchedulesScreen />
    </Jarvis3Gate>
  );
}
