import 'react-native-url-polyfill/dist/polyfill';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ldgunrxceogfrohjrlxz.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxkZ3VucnhjZW9nZnJvaGpybHh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MDg5NzgsImV4cCI6MjA5NjQ4NDk3OH0.A16lbHx701b6sT_-to4Y2CrcyghNgD4eDQxGvJ7gRpk';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
