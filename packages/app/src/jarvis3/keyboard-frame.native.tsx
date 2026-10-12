// The chat screens' body on iOS and Android: the content shrinks as the keyboard rises (moving with
// it), so the composer rides on top of the keyboard and the history stays scrollable above it.
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

export function KeyboardFrame({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <KeyboardAvoidingView behavior="padding" style={style}>
      {children}
    </KeyboardAvoidingView>
  );
}
