// The instance's own pages that the app hands over to: the Tier 3 approval page (the owner signs
// the change with a passkey, i.e. Face ID) and the owner's passkey setup page. WebAuthn needs the
// instance's origin, so these run there, not in the app. On the web the app navigates to the page,
// which comes back to `return` (an app path). On iOS the page opens in the system sign-in sheet
// the way device pairing does, and the sheet closes when the page returns to the app's URL.
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { approvalPageUrl, approvalReturnUrl, passkeysPageUrl } from "./approvals";
import { getInstanceUrl, jarvis3Scheme } from "./config";

function open(url: string, ret: string): Promise<void> {
  if (Platform.OS === "web") {
    (globalThis as { location?: { assign?: (url: string) => void } }).location?.assign?.(url);
    return Promise.resolve();
  }
  return WebBrowser.openAuthSessionAsync(url, ret, { preferEphemeralSession: false }).then(
    () => undefined,
  );
}

/** Opens the passkey page for a Tier 3 approval; resolves when the user is back in the app. */
export function openApprovalPage(approvalId: string): Promise<void> {
  const instanceUrl = getInstanceUrl();
  if (!instanceUrl) return Promise.reject(new Error("This app has no instance URL."));
  const ret = approvalReturnUrl({ platform: Platform.OS, scheme: jarvis3Scheme, approvalId });
  return open(approvalPageUrl(instanceUrl, approvalId, ret), ret);
}

/** Opens the owner's passkey setup page; it comes back to the approvals screen. */
export function openPasskeysPage(): Promise<void> {
  const instanceUrl = getInstanceUrl();
  if (!instanceUrl) return Promise.reject(new Error("This app has no instance URL."));
  const ret = Platform.OS === "web" ? "/approvals" : `${jarvis3Scheme}://approvals`;
  return open(passkeysPageUrl(instanceUrl, ret), ret);
}
