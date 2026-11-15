import React, { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { colors } from "../theme";

export function Shade({ strong = false, end = "#000", opacity = 0.85 }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="shade" x1="0%" x2="0%" y1="0%" y2="100%">
            <Stop offset="0" stopColor="#000" stopOpacity={strong ? 0.28 : 0.05} />
            <Stop offset="0.38" stopColor="#000" stopOpacity={0.03} />
            <Stop offset="1" stopColor={end} stopOpacity={opacity} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#shade)" />
      </Svg>
    </View>
  );
}

export function Artwork({ uri, fallback, shade = false, fadeToBackground = false }) {
  const [failed, setFailed] = useState(null);
  const source = failed === uri ? fallback : uri || fallback;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface }]}>
      {!!source && (
        <Image
          key={source}
          source={{ uri: source }}
          style={[StyleSheet.absoluteFill, { width: "100%", height: "100%" }]}
          resizeMode="cover"
          onError={() => { if (source === uri) setFailed(uri); }}
        />
      )}
      {shade && <Shade strong={fadeToBackground} end={fadeToBackground ? colors.background : "#000"} opacity={fadeToBackground ? 1 : 0.82} />}
    </View>
  );
}
