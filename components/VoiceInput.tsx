import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Alert,
  StyleProp,
  TextStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { Colors, Typography } from '../constants/colors';

const LANG_KEY = 'voice_lang';
const NOTICE_KEY = 'voice_notice_shown';

const LANGS: { code: string; label: string }[] = [
  { code: 'en-IN', label: 'EN' },
  { code: 'hi-IN', label: 'HI' },
  { code: 'mr-IN', label: 'MR' },
];

interface VoiceInputProps {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  editable?: boolean;
  inputStyle?: StyleProp<TextStyle>;
}

/**
 * Multiline notes field with an integrated voice-to-text mic (on-device where
 * supported) + language selector. Live partials stream into the field and stay
 * editable. No audio is ever persisted — transcript text only. Multiple
 * instances can be mounted; each ignores recognition events unless it is the
 * one currently listening (the native module runs a single session at a time).
 */
export default function VoiceInput({
  value,
  onChangeText,
  placeholder,
  editable = true,
  inputStyle,
}: VoiceInputProps) {
  const [lang, setLang] = useState('en-IN');
  const [listening, setListeningState] = useState(false);

  // Snapshot of the field text when a session starts, plus the finalized
  // transcript so far — so live partials recompute instead of double-appending.
  const baseRef = useRef('');
  const finalizedRef = useRef('');
  // Ref mirror of `listening` so the native-event handlers gate on the current
  // value regardless of closure timing (only the active instance reacts).
  const listeningRef = useRef(false);
  const setListening = (v: boolean) => {
    listeningRef.current = v;
    setListeningState(v);
  };

  useEffect(() => {
    AsyncStorage.getItem(LANG_KEY).then((v) => {
      if (v) setLang(v);
    });
  }, []);

  const changeLang = (code: string) => {
    setLang(code);
    AsyncStorage.setItem(LANG_KEY, code);
  };

  const compose = (interim: string) => {
    const base = baseRef.current;
    const fin = finalizedRef.current;
    const body = fin + (fin && interim ? ' ' : '') + interim;
    return base + (base && body ? '\n' : '') + body;
  };

  // All handlers no-op unless THIS instance is the active listener.
  useSpeechRecognitionEvent('result', (e) => {
    if (!listeningRef.current) return;
    const t = e.results?.[0]?.transcript ?? '';
    if (e.isFinal) {
      finalizedRef.current =
        finalizedRef.current + (finalizedRef.current ? ' ' : '') + t;
      onChangeText(compose(''));
    } else {
      onChangeText(compose(t));
    }
  });

  useSpeechRecognitionEvent('end', () => {
    if (!listeningRef.current) return;
    onChangeText(compose('')); // drop any trailing interim
    setListening(false);
  });

  useSpeechRecognitionEvent('error', (e) => {
    if (!listeningRef.current) return;
    setListening(false);
    if (e.error === 'no-speech') return; // silent — nothing was said
    Alert.alert('Voice input', e.message || 'Speech recognition failed.');
  });

  const stop = () => {
    ExpoSpeechRecognitionModule.stop();
    setListening(false);
  };

  const start = async () => {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Permission needed',
        'Microphone and speech permission are required for voice notes.'
      );
      return;
    }

    // One-time honesty notice on first mic use.
    const shown = await AsyncStorage.getItem(NOTICE_KEY);
    if (!shown) {
      await new Promise<void>((resolve) =>
        Alert.alert(
          'Voice notes',
          "Transcription runs on your phone's speech engine. TankAssist stores only the text — no audio is saved.",
          [{ text: 'Got it', onPress: () => resolve() }]
        )
      );
      await AsyncStorage.setItem(NOTICE_KEY, '1');
    }

    baseRef.current = value;
    finalizedRef.current = '';
    setListening(true);
    try {
      // Prefer on-device recognition where the device supports it; otherwise it
      // falls back to the device's speech service (honest — some devices /
      // languages lack local models). No audio is persisted (recordingOptions
      // left off), so nothing to delete afterwards.
      const onDevice = ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
      ExpoSpeechRecognitionModule.start({
        lang,
        interimResults: true,
        continuous: true,
        requiresOnDeviceRecognition: onDevice,
        addsPunctuation: true,
      });
    } catch (err: any) {
      setListening(false);
      Alert.alert('Voice input', err?.message || 'Could not start voice input.');
    }
  };

  return (
    <View>
      <TextInput
        style={inputStyle}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.muted}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        editable={editable && !listening}
      />
      {editable ? (
        <View style={styles.controls}>
          <View style={styles.langRow}>
            {LANGS.map((l) => (
              <TouchableOpacity
                key={l.code}
                style={[styles.langChip, lang === l.code && styles.langChipActive]}
                onPress={() => changeLang(l.code)}
              >
                <Text
                  style={[
                    styles.langText,
                    lang === l.code && styles.langTextActive,
                  ]}
                >
                  {l.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.micBtn, listening && styles.micBtnActive]}
            onPress={listening ? stop : start}
          >
            <Ionicons
              name={listening ? 'stop' : 'mic'}
              size={16}
              color={listening ? Colors.white : Colors.accent}
            />
            <Text style={[styles.micText, listening && styles.micTextActive]}>
              {listening ? 'Listening… tap to stop' : 'Speak'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  langRow: { flexDirection: 'row', gap: 6 },
  langChip: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: Colors.white,
  },
  langChipActive: { borderColor: Colors.accent, backgroundColor: Colors.accent },
  langText: {
    fontFamily: Typography.fontFamily,
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text,
  },
  langTextActive: { color: Colors.white },
  micBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: Colors.accent,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  micBtnActive: { backgroundColor: Colors.alert, borderColor: Colors.alert },
  micText: {
    fontFamily: Typography.fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: Colors.accent,
  },
  micTextActive: { color: Colors.white },
});
