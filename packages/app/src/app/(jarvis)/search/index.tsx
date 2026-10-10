import { Jarvis3Gate } from "@/jarvis3/gate";
import { SearchScreen } from "@/jarvis3/screens/search-screen";

export default function Jarvis3SearchRoute() {
  return (
    <Jarvis3Gate>
      <SearchScreen />
    </Jarvis3Gate>
  );
}
