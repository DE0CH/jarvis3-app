import { useLocalSearchParams } from "expo-router";
import { Jarvis3Gate } from "@/jarvis3/gate";
import { ApprovalScreen } from "@/jarvis3/screens/approval-screen";

export default function Jarvis3ApprovalRoute() {
  const { approvalId } = useLocalSearchParams<{ approvalId?: string }>();
  return (
    <Jarvis3Gate>
      <ApprovalScreen
        key={approvalId ?? ""}
        approvalId={typeof approvalId === "string" ? approvalId : ""}
      />
    </Jarvis3Gate>
  );
}
