import React from "react";
import { Pressable, Text, View, ActivityIndicator } from "react-native";
import { colors, ui } from "../theme";
export function Action({
  title,
  icon: Icon,
  onPress,
  secondary,
  disabled,
  loading,
  style,
  textStyle,
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ busy: !!loading, disabled: !!(disabled || loading) }}
      disabled={disabled || loading}
      onPress={onPress}
      android_ripple={{ color: "#FFFFFF22" }}
      style={[
        {
          minHeight: 52,
          paddingHorizontal: 18,
          paddingVertical: 12,
          borderRadius: 14,
          backgroundColor: secondary ? colors.raised : colors.accent,
          opacity: disabled && !loading ? 0.4 : 1,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={secondary ? colors.text : colors.ink} />
      ) : Icon ? (
        <Icon size={19} color={secondary ? colors.text : colors.ink} />
      ) : null}
      <Text
        style={[{
          color: secondary ? colors.text : colors.ink,
          fontSize: 15,
          fontWeight: "700",
        }, textStyle]}
      >
        {title}
      </Text>
    </Pressable>
  );
}
export function IconButton({ icon: Icon, label, onPress, style, loading, disabled }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: !!loading, disabled: !!(disabled || loading) }}
      disabled={disabled || loading}
      onPress={onPress}
      android_ripple={{ color: "#FFFFFF22" }}
      style={[
        {
          width: 48,
          height: 48,
          borderRadius: 24,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.surface,
          opacity: disabled && !loading ? 0.4 : 1,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={colors.text} /> : <Icon size={22} color={colors.text} />}
    </Pressable>
  );
}
export function Chip({ title, selected, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        minHeight: 44,
        paddingHorizontal: 18,
        paddingVertical: 12,
        borderRadius: 24,
        backgroundColor: selected ? colors.accent : colors.surface,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
      }}
    >
      <Text
        style={{
          color: selected ? colors.ink : colors.muted,
          fontSize: 13,
          fontWeight: "600",
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}
export function Notice({ title, message, action, onAction }) {
  return (
    <View style={[ui.card, { gap: 12 }]}>
      <Text style={ui.heading}>{title}</Text>
      <Text style={ui.body}>{message}</Text>
      {action && <Action secondary title={action} onPress={onAction} />}
    </View>
  );
}
