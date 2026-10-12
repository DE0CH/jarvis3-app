import { useSyncExternalStore } from "react";
import {
  accountStore,
  approvalsStore,
  chatMessagesStore,
  layerStore,
  noticesStore,
  projectsStore,
  pushStore,
  schedulesStore,
  taskExtrasStore,
  tasksStore,
} from "./client";
import { getDeviceSnapshot, subscribeDevice } from "./device";
import type { Store } from "./stores";

function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export const useTasks = () => useStore(tasksStore);
export const useAccount = () => useStore(accountStore);
export const useLayer = () => useStore(layerStore);
export const useNotices = () => useStore(noticesStore);
export const useApprovals = () => useStore(approvalsStore);
export const useSchedules = () => useStore(schedulesStore);
export const useTaskExtras = () => useStore(taskExtrasStore);
export const usePush = () => useStore(pushStore);
export const useChatMessages = () => useStore(chatMessagesStore);
export const useProjects = () => useStore(projectsStore);
export const useDevice = () =>
  useSyncExternalStore(subscribeDevice, getDeviceSnapshot, getDeviceSnapshot);
