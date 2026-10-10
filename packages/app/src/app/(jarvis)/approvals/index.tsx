import { Jarvis3Gate } from "@/jarvis3/gate";
import { ApprovalsScreen } from "@/jarvis3/screens/approvals-screen";

export default function Jarvis3ApprovalsRoute() {
  return (
    <Jarvis3Gate>
      <ApprovalsScreen />
    </Jarvis3Gate>
  );
}
