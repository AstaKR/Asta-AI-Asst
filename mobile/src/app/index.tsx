import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useAuth } from "../auth";
import { colors } from "../components/ui";

export default function Index() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  return <Redirect href={user ? "/home" : "/login"} />;
}
