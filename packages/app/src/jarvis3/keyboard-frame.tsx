// The chat screens' body: on the web the browser resizes the page for its keyboard, so this is a
// plain view; iOS and Android get keyboard-frame.native.tsx, which keeps the composer on top of the
// keyboard.
import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

export function KeyboardFrame({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={style}>{children}</View>;
}
