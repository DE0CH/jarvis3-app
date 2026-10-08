import { useLocalSearchParams } from "expo-router";
import { Jarvis3Gate } from "@/jarvis3/gate";
import { TaskChatScreen } from "@/jarvis3/screens/task-chat-screen";

export default function Jarvis3TaskRoute() {
  const { taskId } = useLocalSearchParams<{ taskId?: string }>();
  return (
    <Jarvis3Gate>
      <TaskChatScreen key={taskId ?? ""} taskId={typeof taskId === "string" ? taskId : ""} />
    </Jarvis3Gate>
  );
}
