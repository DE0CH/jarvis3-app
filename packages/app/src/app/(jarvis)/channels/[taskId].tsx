import { useLocalSearchParams } from "expo-router";
import { Jarvis3Gate } from "@/jarvis3/gate";
import { TaskChannelScreen } from "@/jarvis3/screens/task-channel-screen";

export default function Jarvis3ChannelRoute() {
  const { taskId } = useLocalSearchParams<{ taskId?: string }>();
  const id = typeof taskId === "string" ? taskId : "";
  return (
    <Jarvis3Gate>
      <TaskChannelScreen key={id} taskId={id} />
    </Jarvis3Gate>
  );
}
