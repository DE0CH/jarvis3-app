import { isJarvis3 } from "@/jarvis3/config";
import { revokeSubscription, startSubscription } from "./internal/subscriptions";
import type { RevokePushNotificationsInput, StartPushNotificationsInput } from "./internal/types";

export function startPushNotifications(input: StartPushNotificationsInput): () => void {
  // Jarvis 3: a task's daemon isn't where notifications come from (the instance pushes notices,
  // src/jarvis3/push.ts), and the variant has no Expo push project.
  if (isJarvis3) return () => undefined;
  return startSubscription(input);
}

export function revokePushNotifications(input: RevokePushNotificationsInput): Promise<void> {
  return revokeSubscription(input).catch((error) => {
    console.warn("[PushNotifications] Failed to remove local push subscription", error);
  });
}
