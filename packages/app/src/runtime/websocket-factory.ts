import { nativeWebSocketFactory } from "@getpaseo/client/internal/daemon-client-websocket-transport";
import type { WebSocketFactory } from "@getpaseo/client/internal/daemon-client-transport-types";
import { withJarvis3Headers } from "@/jarvis3/ws-hook";

export function createAppWebSocketFactory(): WebSocketFactory {
  return withJarvis3Headers(nativeWebSocketFactory);
}
