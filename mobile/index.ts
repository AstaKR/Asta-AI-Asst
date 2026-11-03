// LiveKit must install its WebRTC globals before any other module touches them,
// so expo-router is loaded with require() *after* registerGlobals() runs (ES imports are hoisted).
import { registerGlobals } from "@livekit/react-native";

registerGlobals();

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("expo-router/entry");
