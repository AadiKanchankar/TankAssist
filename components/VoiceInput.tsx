import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Alert,
  StyleProp,
  TextStyle,
} from 'react-native';
import { MotiView } from 'moti';
import { useReducedMotion } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { Colors, Type, Space, Radius, Layout } from '../constants/colors';

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
 * editable. No audio is ever persisted — transcript text only.
 */
export default function VoiceInput({
  value,
  onChangeText,
  placeholder,
  editable = true,
  inputStyle,
}: VoiceInputProps) {
  const reduce = useReducedMotion();
  const [lang, setLang] = useState('en-IN');
  const [listening, setListeningState] = useState(false);

  const baseRef = useRef('');
  const finalizedRef = useRef('');
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

  useSpeechRecognitionEvent('result', (e) => {
    if (!listeningRef.current) return;
    const t = e.results?.[0]?.transcript ?? '';
    if (e.isFinal) {
      finalizedRef.current = finalizedRef.current + (finalizedRef.current ? ' ' : '') + t;
      onChangeText(compose(''));
    } else {
      onChangeText(compose(t));
    }
  });

  useSpeechRecognitionEvent('end', () => {
    if (!listeningRef.current) return;
    onChangeText(compose(''));
    setListening(false);
  });

  useSpeechRecognitionEvent('error', (e) => {
    if (!listeningRef.current) return;
    setListening(false);
    if (e.error === 'no-speech') return;
    Alert.alert('Voice input', e.message || 'Speech recognition failed.');
  });

  const stop = () => {
    ExpoSpeechRecognitionModule.stop();
    setListening(false);
  };

  const start = async () => {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Microphone and speech permission are required for voice notes.');
      return;
    }

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
        placeholderTextColor={Colors.textMuted}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        editable={editable && !listening}
      />
      {editable ? (
        <View style={styles.controls}>
          <View style={styles.langRow}>
            {LANGS.map((l) => (
              <Pressable
                key={l.code}
                style={[styles.langChip, lang === l.code && styles.langChipActive]}
                onPress={() => changeLang(l.code)}
                accessibilityRole="button"
                accessibilityLabel={`Voice language ${l.label}`}
              >
                <Text style={[styles.langText, lang === l.code && styles.langTextActive]}>{l.label}</Text>
              </Pressable>
            ))}
          </View>
          <MotiView
            animate={{ scale: listening && !reduce ? 1.04 : 1 }}
            transition={
              listening && !reduce
                ? { type: 'timing', duration: 700, loop: true, repeatReverse: true }
                : { type: 'timing', duration: 150 }
            }
          >
            <Pressable
              style={[styles.micBtn, listening && styles.micBtnActive]}
              onPress={listening ? stop : start}
              accessibilityRole="button"
              accessibilityLabel={listening ? 'Stop voice input' : 'Start voice input'}
            >
              <Ionicons name={listening ? 'stop' : 'mic'} size={16} color={listening ? Colors.white : Colors.accent} />
              <Text style={[styles.micText, listening && styles.micTextActive]}>
                {listening ? 'Listening… tap to stop' : 'Speak'}
              </Text>
            </Pressable>
          </MotiView>
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
    marginTop: Space.sm,
  },
  langRow: { flexDirection: 'row', gap: Space.xs },
  langChip: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.pill,
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
    backgroundColor: Colors.surface,
    minHeight: 32,
    justifyContent: 'center',
  },
  langChipActive: { borderColor: Colors.accent, backgroundColor: Colors.accent },
  langText: { ...Type.caption, fontWeight: '700', color: Colors.text },
  langTextActive: { color: Colors.white },
  micBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    borderWidth: 1.5,
    borderColor: Colors.accent,
    borderRadius: Radius.pill,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    minHeight: 36,
  },
  micBtnActive: { backgroundColor: Colors.alert, borderColor: Colors.alert },
  micText: { ...Type.caption, fontWeight: '600', color: Colors.accent },
  micTextActive: { color: Colors.white },
});
