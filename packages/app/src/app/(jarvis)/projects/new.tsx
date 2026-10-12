import { Jarvis3Gate } from "@/jarvis3/gate";
import { ProjectScreen } from "@/jarvis3/screens/project-screen";

export default function Jarvis3NewProjectRoute() {
  return (
    <Jarvis3Gate>
      <ProjectScreen projectId={null} />
    </Jarvis3Gate>
  );
}
