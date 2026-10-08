// In the jarvis3 variant the app opens on the task list instead of Paseo's host/workspace start
// (used by app/index.tsx and app/welcome.tsx). Null in every other variant.
import type { ReactElement } from "react";
import { Redirect, type Href } from "expo-router";
import { isJarvis3 } from "./config";

function RedirectToTasks() {
  return <Redirect href={"/tasks" as Href} />;
}

export const Jarvis3Index: (() => ReactElement) | null = isJarvis3 ? RedirectToTasks : null;
