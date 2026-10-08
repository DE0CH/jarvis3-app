import { useSyncExternalStore } from "react";
import { accountStore, layerStore, tasksStore } from "./client";
import { getDeviceSnapshot, subscribeDevice } from "./device";
import type { Store } from "./stores";

function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export const useTasks = () => useStore(tasksStore);
export const useAccount = () => useStore(accountStore);
export const useLayer = () => useStore(layerStore);
export const useDevice = () =>
  useSyncExternalStore(subscribeDevice, getDeviceSnapshot, getDeviceSnapshot);
