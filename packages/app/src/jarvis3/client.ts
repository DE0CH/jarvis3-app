// The jarvis3 variant's singletons: the API client and the stores.
import { Platform } from "react-native";
import { createJarvis3Api } from "./api";
import { getInstanceUrl } from "./config";
import { deviceHeaders } from "./device-token";
import { registerJarvis3InstanceUrl } from "./ws-hook";
import {
  createAccountStore,
  createLayerStore,
  createNoticesStore,
  createTasksStore,
} from "./stores";

export const jarvis3Api = createJarvis3Api({
  baseUrl: getInstanceUrl,
  authHeaders: deviceHeaders,
  credentials: Platform.OS === "web" ? "include" : "omit",
  fetch: (input, init) => fetch(input, init),
});

const timers = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const tasksStore = createTasksStore(jarvis3Api, timers);
export const accountStore = createAccountStore(jarvis3Api, timers);
export const noticesStore = createNoticesStore(jarvis3Api, accountStore);
export const layerStore = createLayerStore(jarvis3Api);

registerJarvis3InstanceUrl();
