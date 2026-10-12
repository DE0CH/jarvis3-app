import { useLocalSearchParams } from "expo-router";
import { Jarvis3Gate } from "@/jarvis3/gate";
import { ProjectScreen } from "@/jarvis3/screens/project-screen";

export default function Jarvis3ProjectRoute() {
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const id = typeof projectId === "string" ? projectId : "";
  return (
    <Jarvis3Gate>
      <ProjectScreen key={id} projectId={id} />
    </Jarvis3Gate>
  );
}
