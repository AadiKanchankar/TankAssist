import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Alert,
  Platform,
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

const LANGS: { code: string; label: string; name: string }[] = [
  { code: 'en-IN', label: 'EN', name: 'English' },
  { code: 'hi-IN', label: 'HI', name: 'Hindi' },
  { code: 'mr-IN', label: 'MR', name: 'Marathi' },
];

/** androidTriggerOfflineModelDownload is Android 13 (API 33) and above only. */
const CAN_TRIGGER_DOWNLOAD =
  Platform.OS === 'android' && Number(Platform.Version) >= 33;

/**
 * Why a language failed. Deliberately three states, not two:
 *
 * `unsupported`    — the device listed its locales and this one is genuinely absent.
 * `not-downloaded` — the device supports it but the offline pack isn't installed.
 * `unknown`        — we could not tell. getSupportedLocales() returns an EMPTY
 *                    array on Android 12 and below, and installedLocales is only
 *                    populated for the com.google.android.as service. Treating
 *                    that silence as "unsupported" would wrongly tell every rep
 *                    on an older phone their language doesn't exist, so the
 *                    unknown case gets copy that covers both possibilities.
 */
type LangIssueKind = 'unsupported' | 'not-downloaded' | 'unknown';

const MANUAL_STEPS =
  'On your phone: Settings → System → Languages & input → Voice input → Google → Offline speech recognition, then add the language. You can type your note in the meantime.';

const normLocale = (s: string) => s.toLowerCase().replace(/_/g, '-');

async function diagnoseLang(code: string): Promise<LangIssueKind> {
  if (Platform.OS !== 'android') return 'unknown';
  try {
    const { locales, installedLocales } = await ExpoSpeechRecognitionModule.getSupportedLocales({
      androidRecognitionServicePackage: 'com.google.android.as',
    });
    if (!locales.length) return 'unknown'; // Android <= 12: absence is not evidence
    const want = normLocale(code);
    const base = want.split('-')[0];
    const has = (list: string[]) =>
      list.some((l) => normLocale(l) === want || normLocale(l).startsWith(`${base}-`));
    if (!has(locales)) return 'unsupported';
    // Supported, yet start() failed — the missing offline pack is the cause.
    return has(installedLocales) ? 'unknown' : 'not-downloaded';
  } catch {
    return 'unknown';
  }
}

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
  // Per-language failure, shown inline. Never auto-switches the rep to English:
  // they chose their language, and typing in it stays available regardless.
  const [issues, setIssues] = useState<Record<string, LangIssueKind>>({});
  const [downloading, setDownloading] = useState(false);

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

  /**
   * Android 13+ can fetch the pack in-app. Older devices have no reliable
   * intent for the voice-input settings screen, so they get directions instead
   * of a button that would land them nowhere.
   */
  const downloadPack = async () => {
    setDownloading(true);
    try {
      const r = await ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({
        locale: lang,
      });
      if (r.status === 'download_success') {
        setIssues((p) => {
          const next = { ...p };
          delete next[lang];
          return next;
        });
        Alert.alert('Language ready', 'Downloaded. Tap Speak to try again.');
      } else {
        Alert.alert(
          'Download started',
          'Your phone is fetching the language pack — it may wait for Wi-Fi. Tap Speak again once it finishes. You can keep typing in the meantime.',
        );
      }
    } catch {
      Alert.alert('Couldn’t start the download', MANUAL_STEPS);
    }
    setDownloading(false);
  };

  const compose = (interim: string) => {
    const base = baseRef.current;
    const fin = finalizedRef.current;
    const body = fin + (fin && interim ? ' ' : '') + interim;
    return base + (base && body ? '\n' : '') + body;
  };

  useSpeechRecognitionEvent('result', (e) => {
    if (!listeningRef.current) return;
    // Proof this language works now (e.g. the pack finished downloading) —
    // retire the warning rather than leaving a stale banner up.
    if (issues[lang]) {
      setIssues((p) => {
        const next = { ...p };
        delete next[lang];
        return next;
      });
    }
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
    // The reported dead-end: Android surfaces its raw "supported, but not yet
    // downloaded" string here. Diagnose it into something the rep can act on
    // rather than passing the platform's wording through.
    if (e.error === 'language-not-supported' || e.error === 'service-not-allowed') {
      const failed = lang;
      diagnoseLang(failed).then((kind) => setIssues((p) => ({ ...p, [failed]: kind })));
      return;
    }
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
                accessibilityLabel={
                  issues[l.code]
                    ? `Voice language ${l.label}, voice unavailable on this phone, typing still works`
                    : `Voice language ${l.label}`
                }
              >
                <Text style={[styles.langText, lang === l.code && styles.langTextActive]}>{l.label}</Text>
                {/* Marked before the rep taps the mic, so a known-unavailable
                    language isn't a surprise a second time. */}
                {issues[l.code] ? <View style={styles.langWarnDot} /> : null}
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

      {/* Language unavailable — actionable, never a dead end. Typing is always
          still on: the field above stays editable and nothing here blocks it. */}
      {editable && issues[lang] ? (
        <View style={styles.issueBox}>
          <View style={styles.issueHead}>
            <Ionicons name="information-circle-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.issueTitle}>
              {issues[lang] === 'unsupported'
                ? `${langName(lang)} voice input isn’t available on this phone`
                : `${langName(lang)} voice input needs a language pack`}
            </Text>
          </View>
          <Text style={styles.issueBody}>
            {issues[lang] === 'unsupported'
              ? `This phone’s speech engine doesn’t offer ${langName(lang)}. You can still type your note below, or switch to another language for voice.`
              : issues[lang] === 'not-downloaded'
              ? `Your phone supports ${langName(lang)} but hasn’t downloaded it yet.${
                  CAN_TRIGGER_DOWNLOAD ? ' Tap below to get it.' : ` ${MANUAL_STEPS}`
                }`
              : `Voice couldn’t start in ${langName(lang)} — the language pack is probably not downloaded.${
                  CAN_TRIGGER_DOWNLOAD ? ' Tap below to try fetching it.' : ` ${MANUAL_STEPS}`
                }`}
          </Text>
          {CAN_TRIGGER_DOWNLOAD && issues[lang] !== 'unsupported' ? (
            <Pressable
              onPress={downloadPack}
              disabled={downloading}
              style={styles.issueBtn}
              accessibilityRole="button"
              accessibilityLabel={`Download the ${langName(lang)} language pack`}
            >
              <Ionicons name="cloud-download-outline" size={15} color={Colors.accent} />
              <Text style={styles.issueBtnText}>
                {downloading ? 'Starting…' : `Download ${langName(lang)}`}
              </Text>
            </Pressable>
          ) : null}
          <Text style={styles.issueTyping}>Typing always works — the box above is ready.</Text>
        </View>
      ) : null}
    </View>
  );
}

const langName = (code: string) => LANGS.find((l) => l.code === code)?.name ?? code;

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
  langWarnDot: {
    position: 'absolute',
    top: 4,
    right: 5,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.warning,
  },
  issueBox: {
    marginTop: Space.sm,
    padding: Space.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceAlt,
    borderLeftWidth: 3,
    borderLeftColor: Colors.warning,
  },
  issueHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm },
  issueTitle: { ...Type.caption, fontWeight: '700', color: Colors.text, flex: 1 },
  issueBody: { ...Type.caption, color: Colors.textSecondary, marginTop: Space.xs, lineHeight: 18 },
  issueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    alignSelf: 'flex-start',
    marginTop: Space.sm,
    borderWidth: 1.5,
    borderColor: Colors.accent,
    borderRadius: Radius.pill,
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
    minHeight: Layout.tap - 8,
  },
  issueBtnText: { ...Type.caption, fontWeight: '700', color: Colors.accent },
  issueTyping: { ...Type.caption, color: Colors.textMuted, marginTop: Space.sm },
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
