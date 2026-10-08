import { Jarvis3Gate } from "@/jarvis3/gate";
import { NewTaskScreen } from "@/jarvis3/screens/new-task-screen";

export default function Jarvis3NewTaskRoute() {
  return (
    <Jarvis3Gate>
      <NewTaskScreen />
    </Jarvis3Gate>
  );
}
