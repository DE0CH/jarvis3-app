// The chat screens' body on iOS and Android: it gets the keyboard's height (and the home indicator's
// inset) as bottom padding, moving with the keyboard through Paseo's keyboard shift (the same one
// its terminal uses), so the composer rides on top of the keyboard and the history stays
// scrollable above it. The animated node has only static React Native styles (docs/mobile-panels.md:
// never Unistyles styles on a Reanimated node); the caller's style goes on the view inside.
import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import { useKeyboardShiftStyle } from "@/keyboard/shift";

export function KeyboardFrame({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { style: keyboardPadding } = useKeyboardShiftStyle({ mode: "padding" });
  return (
    <Animated.View style={[frame.fill, keyboardPadding]}>
      <View style={style}>{children}</View>
    </Animated.View>
  );
}

const frame = StyleSheet.create({
  fill: { flex: 1 },
});
