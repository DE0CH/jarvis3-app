import { useLocalSearchParams } from "expo-router";
import { Jarvis3Gate } from "@/jarvis3/gate";
import { FilesScreen } from "@/jarvis3/screens/files-screen";

export default function Jarvis3FilesRoute() {
  const { dir, user } = useLocalSearchParams<{ dir?: string; user?: string }>();
  return (
    <Jarvis3Gate>
      <FilesScreen
        dir={typeof dir === "string" ? dir : ""}
        userId={typeof user === "string" && user ? user : null}
      />
    </Jarvis3Gate>
  );
}
