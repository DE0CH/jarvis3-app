import { Jarvis3Gate } from "@/jarvis3/gate";
import { AdminUsersScreen } from "@/jarvis3/screens/admin-users-screen";

export default function Jarvis3AdminUsersRoute() {
  return (
    <Jarvis3Gate>
      <AdminUsersScreen />
    </Jarvis3Gate>
  );
}
