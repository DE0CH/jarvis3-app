import { Jarvis3Gate } from "@/jarvis3/gate";
import { ProjectsScreen } from "@/jarvis3/screens/projects-screen";

export default function Jarvis3ProjectsRoute() {
  return (
    <Jarvis3Gate>
      <ProjectsScreen />
    </Jarvis3Gate>
  );
}
