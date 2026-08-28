// Supabase connection info. The "anon" key is meant to be public/client-side —
// access is controlled by the Row Level Security policies in supabase-schema.sql,
// not by keeping this key secret.
window.TIMER_CONFIG = {
  SUPABASE_URL: "https://rdcmhwuiudrmbqcxbumh.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkY21od3VpdWRybWJxY3hidW1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5NDIzNzUsImV4cCI6MjEwMzUxODM3NX0.fGF2fS5YEmW7FLKiuitftBZ-RmaWmiGf9QqYYaZY82E",
  ROOM_NAME: "qa-focus-room" // the Supabase Realtime channel name — fine to leave as-is
};
