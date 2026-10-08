import { Jarvis3Gate } from "@/jarvis3/gate";
import { TaskListScreen } from "@/jarvis3/screens/task-list-screen";

export default function Jarvis3TasksRoute() {
  return (
    <Jarvis3Gate>
      <TaskListScreen />
    </Jarvis3Gate>
  );
}
