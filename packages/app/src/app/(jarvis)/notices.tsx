import { Jarvis3Gate } from "@/jarvis3/gate";
import { NoticesScreen } from "@/jarvis3/screens/notices-screen";

export default function Jarvis3NoticesRoute() {
  return (
    <Jarvis3Gate>
      <NoticesScreen />
    </Jarvis3Gate>
  );
}
