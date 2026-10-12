// In the jarvis3 variant the app opens on a new chat (`/`) instead of Paseo's host/workspace start,
// and Paseo's pairing welcome goes there too (used by app/index.tsx and app/welcome.tsx). Null in
// every other variant.
import type { ReactElement } from "react";
import { Redirect, type Href } from "expo-router";
import { isJarvis3 } from "./config";
import { Jarvis3Gate } from "./gate";
import { NewChatScreen } from "./screens/new-chat-screen";

function NewChatRoute() {
  return (
    <Jarvis3Gate>
      <NewChatScreen />
    </Jarvis3Gate>
  );
}

function RedirectToNewChat() {
  return <Redirect href={"/" as Href} />;
}

export const Jarvis3Index: (() => ReactElement) | null = isJarvis3 ? NewChatRoute : null;
export const Jarvis3Welcome: (() => ReactElement) | null = isJarvis3 ? RedirectToNewChat : null;
