import { Jarvis3Gate } from "@/jarvis3/gate";
import { NotificationsScreen } from "@/jarvis3/screens/notifications-screen";

export default function Jarvis3NotificationsRoute() {
  return (
    <Jarvis3Gate>
      <NotificationsScreen />
    </Jarvis3Gate>
  );
}
