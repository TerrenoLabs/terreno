// Order matters: the first import hides a returned OAuth one-time token from Expo Router's copy
// of the URL, and the second exchanges it, before the router starts.
import "./lib/oauthHandoffUrl";
import "./lib/oauthHandoff";
import "expo-router/entry";
