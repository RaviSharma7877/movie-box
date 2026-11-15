import React, { useState } from "react";
import { Pressable, Text, View, Image } from "react-native";
import { Film, Star } from "lucide-react-native";
import { colors } from "../theme";
export function MovieCard({ movie, onPress }) {
  const [failed, setFailed] = useState(false);
  const type =
    movie.type === "series"
      ? "Series"
      : movie.category === "anime" || movie.type === "anime"
        ? "Anime"
        : "Film";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={movie.title + ", " + type}
      onPress={onPress}
      android_ripple={{ color: "#FFFFFF22" }}
      style={{
        flex: 1,
        maxWidth: "48%",
        opacity: 1,
      }}
    >
      <View
        style={{
          aspectRatio: 0.68,
          backgroundColor: colors.surface,
          borderRadius: 16,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* The icon stays underneath, so slow artwork shows a placeholder instead of a blank card. */}
        <Film size={36} color={colors.muted} />
        {movie.posterUrl && !failed && (
          <Image
            source={{ uri: movie.posterUrl }}
            style={{ position: "absolute", width: "100%", height: "100%" }}
            resizeMode="cover"
            fadeDuration={200}
            onError={() => setFailed(true)}
          />
        )}
        {movie.rating > 0 && (
          <View
            style={{
              position: "absolute",
              bottom: 10,
              right: 10,
              backgroundColor: "#101824E8",
              borderRadius: 8,
              padding: 7,
              flexDirection: "row",
              gap: 4,
              alignItems: "center",
            }}
          >
            <Star size={11} color={colors.accent} fill={colors.accent} />
            <Text
              style={{ color: colors.text, fontSize: 11, fontWeight: "700" }}
            >
              {Number(movie.rating).toFixed(1)}
            </Text>
          </View>
        )}
      </View>
      <Text
        numberOfLines={2}
        style={{
          color: colors.text,
          fontSize: 15,
          lineHeight: 21,
          fontWeight: "600",
          marginTop: 12,
        }}
      >
        {movie.title}
      </Text>
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 5 }}>
        {type} · {movie.year || "Year unavailable"}
      </Text>
    </Pressable>
  );
}
