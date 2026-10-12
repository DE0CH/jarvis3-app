import { useLocalSearchParams } from "expo-router";
import { Jarvis3Gate } from "@/jarvis3/gate";
import { ChatScreen } from "@/jarvis3/screens/chat-screen";

export default function Jarvis3ChatRoute() {
  const { chatId } = useLocalSearchParams<{ chatId?: string }>();
  return (
    <Jarvis3Gate>
      <ChatScreen key={chatId ?? ""} taskId={typeof chatId === "string" ? chatId : ""} />
    </Jarvis3Gate>
  );
}
