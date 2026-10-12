import { Jarvis3Gate } from "@/jarvis3/gate";
import { UsageScreen } from "@/jarvis3/screens/usage-screen";

export default function Jarvis3UsageRoute() {
  return (
    <Jarvis3Gate>
      <UsageScreen />
    </Jarvis3Gate>
  );
}
