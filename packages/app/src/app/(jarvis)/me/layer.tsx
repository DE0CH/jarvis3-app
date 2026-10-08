import { Jarvis3Gate } from "@/jarvis3/gate";
import { LayerScreen } from "@/jarvis3/screens/layer-screen";

export default function Jarvis3LayerRoute() {
  return (
    <Jarvis3Gate>
      <LayerScreen />
    </Jarvis3Gate>
  );
}
