// The jarvis3 variant's singletons: the API client and the stores.
import { Platform } from "react-native";
import { createJarvis3Api } from "./api";
import { createPushStore } from "./push";
import { pushDevice } from "./push-device";
import { createApprovalsStore } from "./approvals";
import { getInstanceUrl } from "./config";
import { deviceHeaders } from "./device-token";
import { registerJarvis3InstanceUrl } from "./ws-hook";
import { createSchedulesStore, createTaskExtrasStore, deviceTimeZone } from "./schedules";
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
  timeZone: deviceTimeZone,
});

const timers = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const tasksStore = createTasksStore(jarvis3Api, timers);
export const accountStore = createAccountStore(jarvis3Api, timers);
export const noticesStore = createNoticesStore(jarvis3Api, accountStore);
export const layerStore = createLayerStore(jarvis3Api);
export const approvalsStore = createApprovalsStore(jarvis3Api, accountStore);
export const schedulesStore = createSchedulesStore(jarvis3Api);
export const taskExtrasStore = createTaskExtrasStore(jarvis3Api, accountStore);
export const pushStore = createPushStore(jarvis3Api, pushDevice);

registerJarvis3InstanceUrl();
