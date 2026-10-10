// Wraps every Jarvis 3 route: outside the jarvis3 variant it sends the user home; on iOS it asks
// for the one-time sign-in (device pairing); then it loads who the user is.
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { accountStore } from "./client";
import { isJarvis3 } from "./config";
import { forgetDevice, isFreshlyPaired, loadDevice, pairDevice } from "./device";
import { useAccount, useDevice } from "./hooks";
import { signOutMessage } from "./plan";
import { Banner } from "./ui";

export function Jarvis3Gate({ children }: { children: ReactNode }): ReactNode {
  if (!isJarvis3) return <Redirect href="/" />;
  return <Jarvis3GateContent>{children}</Jarvis3GateContent>;
}

function Jarvis3GateContent({ children }: { children: ReactNode }): ReactNode {
  const device = useDevice();
  const account = useAccount();

  useEffect(() => {
    void loadDevice();
  }, []);

  useEffect(() => {
    if (device.paired) void accountStore.load();
  }, [device.paired]);

  // A freshly minted token is refused for a few seconds (Cloudflare propagation): retry. A token
  // the instance says was revoked is forgotten at once.
  useEffect(() => {
    if (!account.signedOut || Platform.OS === "web") return;
    if (isFreshlyPaired() && account.signOutReason !== "revoked") {
      const timer = setTimeout(() => void accountStore.load(true), 5_000);
      return () => clearTimeout(timer);
    }
    void forgetDevice();
    return undefined;
  }, [account.signedOut, account.signOutReason]);

  // Keep the unread notice count fresh while a Jarvis screen is open.
  const hasMe = account.me !== null;
  useEffect(() => {
    if (!hasMe) return;
    return accountStore.watch();
  }, [hasMe]);

  if (!device.loaded) return <Centered text="Loading…" />;
  if (!device.paired) return <SignIn />;
  if (!account.loaded) return <Centered text="Loading…" />;
  if (account.signedOut && Platform.OS === "web") {
    return (
      <Centered text={signOutMessage(account.signOutReason ?? "signed_out")}>
        <Button variant="default" onPress={reloadPage} testID="jarvis3-reload">
          Sign in again
        </Button>
      </Centered>
    );
  }
  if (!account.me) {
    return (
      <Centered text={account.error ?? "No response from the instance."}>
        <Button variant="outline" onPress={retryAccount} testID="jarvis3-retry">
          Try again
        </Button>
      </Centered>
    );
  }
  return children;
}

function retryAccount(): void {
  void accountStore.load(true);
}

function reloadPage(): void {
  (globalThis as { location?: { reload?: () => void } }).location?.reload?.();
}

function SignIn() {
  const account = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signIn = useCallback(() => {
    const run = async () => {
      setBusy(true);
      setError(null);
      const message = await pairDevice().catch((e: unknown) =>
        e instanceof Error ? e.message : String(e),
      );
      setBusy(false);
      if (message) setError(message);
    };
    void run();
  }, []);
  return (
    <Centered text="Sign in with your work account once on this device.">
      <Button variant="default" onPress={signIn} loading={busy} testID="jarvis3-sign-in">
        Sign in
      </Button>
      {!error && account.signOutReason && account.signOutReason !== "signed_out" ? (
        <Banner tone="info" testID="jarvis3-signed-out-reason">
          {signOutMessage(account.signOutReason)}
        </Banner>
      ) : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
    </Centered>
  );
}

function Centered({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <View style={styles.centered}>
      <Text style={styles.text}>{text}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[4],
    padding: theme.spacing[6],
    backgroundColor: theme.colors.surface0,
  },
  text: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
    maxWidth: 420,
  },
}));
