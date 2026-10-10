import { useLocalSearchParams } from "expo-router";
import { Jarvis3Gate } from "@/jarvis3/gate";
import { TranscriptScreen } from "@/jarvis3/screens/transcript-screen";
import { parseSeq } from "@/jarvis3/search";

export default function Jarvis3TranscriptRoute() {
  const { taskId, around, agentId } = useLocalSearchParams<{
    taskId?: string;
    around?: string;
    agentId?: string;
  }>();
  const id = typeof taskId === "string" ? taskId : "";
  return (
    <Jarvis3Gate>
      <TranscriptScreen
        key={`${id}:${around ?? ""}`}
        taskId={id}
        around={parseSeq(around)}
        agentId={typeof agentId === "string" && agentId ? agentId : null}
      />
    </Jarvis3Gate>
  );
}
